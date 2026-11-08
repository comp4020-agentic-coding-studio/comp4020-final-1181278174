import { afterEach, describe, expect, it } from "vitest";
import { fill, formWithButton, type Page, startSession, type Stream, Visitor } from "./visitor.ts";

// Read the server's HTML and streams only: no scripts or browser features run.
const tag = (): string => Math.random().toString(36).slice(2, 8);
const text = (el: Element): string => el.textContent?.replace(/\s+/g, " ").trim() ?? "";

const open: Stream[] = [];
afterEach(() => {
  for (const stream of open.splice(0)) stream.close();
});

async function listen(who: Visitor, path: string): Promise<Stream> {
  const page = await who.open(path);
  expect(page.status).toBe(200);
  const stream = await who.listen(page);
  open.push(stream);
  expect(stream.status).toBe(200);
  return stream;
}

/** Submit the hand form as it is now, so the same press can lower it later. */
async function press(who: Visitor, path: string): Promise<void> {
  const page = await who.open(path);
  const form = formWithButton(page, /^I'm lost$/i);
  expect((await who.submit(page, form)).status).toBe(200);
}

async function counts(host: Visitor, student: Visitor, path: string, words: string, quiet: boolean): Promise<void> {
  const short = "That doesn't mean everyone follows.";
  const pages = [
    { who: student, path, name: "student's hall", silence: `${short} Lost? Raise yours, no words needed.` },
    { who: host, path, name: "host's hall", silence: short },
    { who: host, path: `${path}/questions`, name: "host's questions", silence: short },
    { who: host, path: `${path}/present`, name: "projector", silence: short },
  ];
  for (const view of pages) {
    const page = await view.who.open(view.path);
    expect(page.status, view.name).toBe(200);
    const count = page.doc.querySelector("[data-lost]");
    expect(count, `${view.name} has no count`).not.toBeNull();
    expect(text(count!), view.name).toBe(words);
    expect(count!.closest("[hidden]"), `${view.name} hides its count`).toBeNull();

    const note = page.doc.querySelector("[data-silence]");
    expect(note, `${view.name} has no silence note`).not.toBeNull();
    expect(text(note!), view.name).toBe(view.silence);
    expect(note!.closest("[hidden]") === null, `${view.name}: ${words}`).toBe(quiet);
  }
}

describe("the room's promises", () => {
  it.each([
    { people: 1, words: ["1 here. No hands up right now.", "1 of 1 here says they're lost"] },
    { people: 2, words: ["2 here. No hands up right now.", "1 of 2 here says they're lost", "2 of 2 here say they're lost"] },
  ])("says how many of $people people are lost, with a silence note only while no hand is up", async ({ people, words }) => {
    const host = new Visitor();
    const path = (await startSession(host, `Count words ${tag()}`)).url.pathname;
    const students = Array.from({ length: people }, () => new Visitor());
    const streams: Stream[] = [];
    for (const student of students) streams.push(await listen(student, path));
    const stream = streams[0];
    await stream.until((board) => board.here === people && board.hands.length === 0);

    for (let lost = 0; lost <= people; lost++) {
      if (lost > 0) {
        stream.forget();
        await press(students[lost - 1], path);
        await stream.until((board) => board.here === people && board.hands.length === lost);
      }
      await counts(host, students[0], path, words[lost], lost === 0);
    }

    // The note must return when everyone lowers their hand, too.
    stream.forget();
    for (const student of students) await press(student, path);
    await stream.until((board) => board.here === people && board.hands.length === 0);
    await counts(host, students[0], path, words[0], true);
  });

  it("leaves the listening host out of the timeline's count of people who were lost", async () => {
    const host = new Visitor();
    const path = (await startSession(host, `Only students ${tag()}`)).url.pathname;
    const hostStream = await listen(host, path);
    const student = new Visitor();
    const studentStream = await listen(student, path);
    for (const stream of [hostStream, studentStream]) {
      await stream.until((board) => board.here === 1 && board.hands.length === 0);
    }

    await press(student, path);
    for (const stream of [hostStream, studentStream]) {
      await stream.until((board) => board.here === 1 && board.hands.length === 1);
    }
    const page = await host.open(`${path}/timeline`);
    expect(page.status).toBe(200);
    const busiest = page.doc.querySelector('[aria-label="The minutes most people were lost"] > li');
    expect(busiest, "no busiest minute is recorded").not.toBeNull();
    expect(text(busiest!)).toContain("1 of 1 said they were lost");
  });

  it("refuses a guest's mark through the timeline's own form as well as the hall's", async () => {
    const host = new Visitor();
    const path = (await startSession(host, `Only host marks ${tag()}`)).url.pathname;
    const guest = new Visitor();
    const label = `A guest's mark ${tag()}`;
    for (const route of [path, `${path}/timeline`]) {
      const page = await host.open(route);
      expect(page.status).toBe(200);
      const form = formWithButton(page, /^mark$/i);
      fill(form, label);
      expect((await guest.submit(page, form)).status, route).toBe(403);
    }
    const timeline = await host.open(`${path}/timeline`);
    expect(timeline.status).toBe(200);
    expect(timeline.doc.body.textContent).not.toContain(label);
  });

  it("puts the timeline's floating window button in the page before anyone has joined, for its script to show later", async () => {
    const host = new Visitor();
    const path = (await startSession(host, `Early timeline ${tag()}`, { started: false })).url.pathname;
    const page = await host.open(`${path}/timeline`);
    expect(page.status).toBe(200);
    expect(page.doc.querySelectorAll(".sitting"), "someone is already in the record").toHaveLength(0);
    const button = page.doc.querySelector("button[data-pop='timeline']");
    expect(button, "no Pop out to show when the first sitting arrives").not.toBeNull();
    expect(button!.hasAttribute("hidden")).toBe(true);
  });

  it("keeps the floating window button and its wrapper hidden in the hall and timeline HTML", async () => {
    const host = new Visitor();
    const path = (await startSession(host, `Floating window ${tag()}`)).url.pathname;
    const student = new Visitor();
    const stream = await listen(student, path);
    // The timeline only offers Pop out once there is a sitting to show.
    await stream.until((board) => board.here === 1);

    for (const who of [student, host]) {
      for (const route of [path, `${path}/timeline`]) {
        const page: Page = await who.open(route);
        expect(page.status).toBe(200);
        const buttons = page.doc.querySelectorAll("button[data-pop]");
        expect(buttons, `${route} has no floating window button`).toHaveLength(1);
        for (const button of buttons) {
          expect(button.hasAttribute("hidden"), route).toBe(true);
          const wrapper = button.closest(".pop-control");
          expect(wrapper, `${route} has no floating window wrapper`).not.toBeNull();
          expect(wrapper!.hasAttribute("hidden"), route).toBe(true);
        }
      }
    }
  });
});
