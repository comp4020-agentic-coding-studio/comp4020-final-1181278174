import { afterEach, describe, expect, it } from "vitest";
import { formWithButton, type Page, startSession, type Stream, Visitor } from "./visitor.ts";

// HTTP only: the forms, server-rendered pages, saved timeline and the stream
// another profile receives. The live banner disappearing after two minutes,
// and the floating windows, are checked in a browser at both widths.
const tag = (): string => Math.random().toString(36).slice(2, 8);
const banner = "The lecturer is going over it.";
const open: Stream[] = [];
afterEach(() => {
  for (const stream of open.splice(0)) stream.close();
});

const text = (el: Element): string => el.textContent?.replace(/\s+/g, " ").trim() ?? "";

/** A sentence the server actually shows, not a hidden placeholder for script. */
function hasBanner(page: Page): boolean {
  return [...page.doc.body.querySelectorAll("*")].some(
    (el) => el.children.length === 0 && text(el) === banner && !el.closest("[hidden]"),
  );
}

/** The saved events in the chart's own legend, separate from numbered parts. */
const events = (page: Page): Element[] => [...page.doc.querySelectorAll('ul[aria-label="Going over it"] > li')];

/** A host's hall and another browser profile already listening to it. */
async function watched(): Promise<{ host: Visitor; page: Page; path: string; student: Visitor; stream: Stream }> {
  const host = new Visitor();
  const page = await startSession(host, `Going over it ${tag()}`);
  const path = page.url.pathname;
  const student = new Visitor();
  const stream = await student.listen(await student.open(path));
  open.push(stream);
  expect(stream.status).toBe(200);
  await stream.until((board) => board.goingOver === null);
  return { host, page, path, student, stream };
}

async function press(host: Visitor, path: string): Promise<Page> {
  const page = await host.open(path);
  return host.submit(page, formWithButton(page, /^going over it$/i));
}

describe("Going over it", () => {
  it("refuses a guest's press with 403 and shows and records nothing", async () => {
    const { host, path, student, stream } = await watched();
    const guestPage = await student.open(path);
    expect(() => formWithButton(guestPage, /^going over it$/i), "a guest is offered the host's button").toThrow();
    const hostPage = await host.open(path);
    const refused = await student.submit(hostPage, formWithButton(hostPage, /^going over it$/i));
    expect(refused.status).toBe(403);
    expect(hasBanner(refused)).toBe(false);

    // Let any wrongly published state arrive before checking it, then fetch
    // every public view afresh so a refusal cannot leave a saved announcement.
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(stream.last?.goingOver).toBeNull();
    for (const suffix of ["", "/questions", "/present"]) {
      const page = await student.open(`${path}${suffix}`);
      expect(page.status).toBe(200);
      expect(hasBanner(page), `a refused press appears on ${page.url.pathname}`).toBe(false);
    }
    expect(events(await student.open(`${path}/timeline`))).toHaveLength(0);
  });

  it("sends the host's press to another profile within a second without lowering their hand", async () => {
    const { host, path, student, stream } = await watched();
    const studentPage = await student.open(path);
    const hand = formWithButton(studentPage, /i'm lost/i);
    expect((await student.submit(studentPage, hand)).status).toBe(200);
    await stream.until((board) => board.hands.length === 1);
    const hostPage = await host.open(path);
    const form = formWithButton(hostPage, /^going over it$/i);
    expect(form.textContent).toContain("Shows on every screen for 2 minutes.");
    stream.forget();

    const pressed = Date.now();
    expect((await host.submit(hostPage, form)).status).toBe(200);
    const sent = await stream.until((board) => typeof board.goingOver === "number");
    expect(sent.at - pressed).toBeLessThan(1000);
    expect(sent.board.goingOver).toBeGreaterThanOrEqual(0);
    expect(sent.board.goingOver).toBeLessThan(1000);
    expect(sent.board.hands).toHaveLength(1);
    const stillUp = formWithButton(await student.open(path), /i'm lost/i).querySelector("button");
    expect(stillUp?.getAttribute("aria-pressed")).toBe("true");
  });

  it("renders the banner on the hall, questions and projector for a page opened afterwards", async () => {
    const { host, path } = await watched();
    expect((await press(host, path)).status).toBe(200);
    const late = new Visitor();
    for (const suffix of ["", "/questions", "/present"]) {
      const page = await late.open(`${path}${suffix}`);
      expect(page.status).toBe(200);
      expect(hasBanner(page), `${page.url.pathname} needs script to show the active banner`).toBe(true);
    }
    const stream = await late.listen(await late.open(path));
    open.push(stream);
    const initial = await stream.until(() => true);
    expect(typeof initial.board.goingOver).toBe("number");
    expect(initial.board.goingOver).toBeGreaterThanOrEqual(0);
    expect(initial.board.goingOver).toBeLessThan(120_000);
  });

  it("records one event for two presses at once and keeps its original moment on another press", async () => {
    // No streams in this session: plain forms must leave a readable record
    // even when no script has opened a connection or counted anyone as here.
    const host = new Visitor();
    const page = await startSession(host, `Plain going over it ${tag()}`);
    const path = page.url.pathname;
    const student = new Visitor();
    const form = formWithButton(page, /^going over it$/i);
    const replies = await Promise.all([host.submit(page, form), host.submit(page, form)]);
    expect(replies.map((reply) => reply.status)).toEqual([200, 200]);

    const saved = events(await student.open(`${path}/timeline`));
    expect(saved).toHaveLength(1);
    const at = saved[0].querySelector("time[datetime]")?.getAttribute("datetime");
    expect(at).toBeDefined();
    expect(Number.isFinite(Date.parse(at!))).toBe(true);

    // A stale form may be sent while the button is disabled on a fresh page.
    // It must neither add another event nor move the first event's timestamp.
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect((await host.submit(page, form)).status).toBe(200);
    const unchanged = events(await student.open(`${path}/timeline`));
    expect(unchanged).toHaveLength(1);
    expect(unchanged[0].querySelector("time[datetime]")?.getAttribute("datetime")).toBe(at);
  });

  it("keeps its own timeline marker, legend and minute entry after reload without taking a part number", async () => {
    const { host, path, student } = await watched();
    const mark = async (): Promise<void> => {
      const page = await host.open(path);
      expect((await host.submit(page, formWithButton(page, /^mark$/i))).status).toBe(200);
    };
    await mark();
    expect((await press(host, path)).status).toBe(200);
    await mark();

    const before = await student.open(`${path}/timeline`);
    expect(events(before)).toHaveLength(1);
    const savedAt = events(before)[0].querySelector("time[datetime]")?.getAttribute("datetime");
    const reloaded = await student.open(before.url);
    const saved = events(reloaded);
    expect(saved).toHaveLength(1);
    expect(text(saved[0])).toContain("Going over it");
    expect(saved[0].querySelector("time[datetime]")?.getAttribute("datetime")).toBe(savedAt);

    const marker = reloaded.doc.querySelector('[title="Going over it"]');
    expect(marker, "the saved event has no chart marker").not.toBeNull();
    expect(text(marker!)).not.toMatch(/^\d+$/);
    const partLegend = [...reloaded.doc.querySelectorAll('ol[aria-label="Chart marks"] > li')];
    expect(partLegend.map((li) => li.getAttribute("value"))).toEqual(["1", "2"]);
    expect(text(partLegend[0])).toContain("Part 1");
    expect(text(partLegend[1])).toContain("Part 2");

    const minutes = [...reloaded.doc.querySelectorAll('details ol[aria-label="Every minute"] > li')];
    const eventMinute = Math.floor(Date.parse(savedAt!) / 60_000) * 60_000;
    const row = minutes.find((li) => Date.parse(li.querySelector("time[datetime]")?.getAttribute("datetime") ?? "") === eventMinute);
    expect(row, "the event's minute is absent from Every minute").toBeDefined();
    expect(text(row!)).toContain("Going over it");
    expect(text(row!)).toMatch(/\d+ of \d+ said they were lost/);
  });
});
