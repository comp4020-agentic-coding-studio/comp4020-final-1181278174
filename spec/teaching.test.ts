import { afterEach, describe, expect, it } from "vitest";
import { ask, fill, formWithButton, type Page, questions, questionsPath, startSession, type Stream, Visitor } from "./visitor.ts";

// The lecturer can keep one page open: these are the forms the server sends,
// without any script. The student preview changes the view, never the account's role.
const tag = (): string => Math.random().toString(36).slice(2, 8);
const text = (el: Element | null | undefined): string => el?.textContent?.replace(/\s+/g, " ").trim() ?? "";
const streams: Stream[] = [];
afterEach(() => {
  for (const stream of streams.splice(0)) stream.close();
});

function buttonInQuestion(page: Page, body: string, name: RegExp): HTMLButtonElement {
  const card = [...page.doc.querySelectorAll("li")].find((li) => [...li.querySelectorAll("p")].some((p) => text(p) === body));
  const button = [...(card?.querySelectorAll("button") ?? [])].find((b) => name.test(b.getAttribute("aria-label") ?? text(b)));
  if (!button) throw new Error(`no ${name} button on the question on ${page.url.pathname}`);
  return button;
}

async function useButton(who: Visitor, path: string, name: RegExp): Promise<Page> {
  const page = await who.open(path);
  return who.submit(page, formWithButton(page, name));
}

const clock = (ms: number): string => new Date(ms).toLocaleTimeString("en-AU", {
  hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Australia/Sydney",
});

describe("the lecturer's end on main", () => {
  it("selects the workspace by account, keeps the hall URL, and offers a student preview", async () => {
    const host = new Visitor();
    const hall = await startSession(host, `Two ends ${tag()}`, { started: false });
    const path = hall.url.pathname;
    expect(path).toMatch(/^\/s\/[A-Z2-9]{4}$/);
    expect(text(hall.doc.body)).toContain("Lecturer workspace");
    expect(() => formWithButton(hall, /^save$/i)).not.toThrow();

    const secondLaptop = new Visitor({ signedOut: true });
    expect((await secondLaptop.signIn(host.username, host.password)).status).toBe(200);
    expect(text((await secondLaptop.open(path)).doc.body)).toContain("Lecturer workspace");
    const dedicated = await host.open(`${path}/teach`);
    expect(dedicated.status).toBe(200);
    expect(text(dedicated.doc.body)).toContain("Lecturer workspace");

    const preview = [...dedicated.doc.querySelectorAll("a")].find((a) => /student view/i.test(text(a)));
    expect(preview, "the lecturer needs a link to the student's view").toBeDefined();
    const previewPage = await host.open(new URL(preview!.getAttribute("href")!, dedicated.url));
    expect(previewPage.url.pathname).toBe(path);
    expect(previewPage.url.searchParams.get("view")).toBe("student");
    expect(previewPage.doc.querySelector('input[name="intent"][value="class-start"]')).toBeNull();
    expect(previewPage.doc.querySelector('input[name="intent"][value="timeline_mark"]')).toBeNull();
    expect(previewPage.doc.querySelector('input[name="intent"][value="hand"]')).toBeNull();
    expect([...previewPage.doc.querySelectorAll("a")].some((a) => a.getAttribute("href") === `${path}/teach`)).toBe(true);

    const studentPage = await new Visitor().open(path);
    expect(studentPage.doc.querySelector('input[name="intent"][value="hand"]')).not.toBeNull();
    expect(text(studentPage.doc.querySelector("main"))).not.toContain("Lecturer workspace");
    expect([...studentPage.doc.querySelectorAll("a")].some((a) => a.getAttribute("href")?.includes("/teach"))).toBe(false);
  });

  it("refuses the lecturer page and its actions to students and signed-out visitors", async () => {
    const host = new Visitor();
    const hall = await startSession(host, `Private controls ${tag()}`, { started: false });
    const path = `${hall.url.pathname}/teach`;
    for (const visitor of [new Visitor(), new Visitor({ signedOut: true })]) {
      const refused = await visitor.open(path);
      expect(refused.status).toBe(403);
      expect(refused.doc.querySelector('input[name="intent"][value="class-start"]')).toBeNull();
      for (const intent of ["class-start", "class-end", "going-over", "timeline_mark", "recording", "state"]) {
        const response = await visitor.post(path, new URLSearchParams({ intent, label: "Not permitted", at: "12:00", question: "1", to: "hidden" }));
        expect(response.status, intent).toBe(403);
        await response.text();
      }
    }
    const unchanged = await host.open(path);
    expect(() => formWithButton(unchanged, /^start class$/i)).not.toThrow();
    expect((await host.open("/s/NOPE/teach")).status).toBe(404);
  });

  it("starts and ends class in place, then shows its recap and the questions still open", async () => {
    const host = new Visitor();
    const hall = await startSession(host, `A whole class ${tag()}`, { started: false });
    const path = hall.url.pathname;
    const teach = `${path}/teach`;
    const student = new Visitor();
    const before = await student.open(path);
    expect(before.doc.querySelector('form[data-hand] button')?.hasAttribute("disabled")).toBe(true);

    const started = await useButton(host, teach, /^start class$/i);
    expect(started.status).toBe(200);
    expect(started.url.pathname).toBe(teach);
    expect(() => formWithButton(started, /^end class$/i)).not.toThrow();
    const raise = await student.post(path, new URLSearchParams({ intent: "hand", up: "1" }));
    expect(raise.status).toBe(303);
    await raise.text();
    const unanswered = `A question for next class ${tag()}`;
    await ask(student, questionsPath(hall), unanswered);

    const ended = await useButton(host, teach, /^end class$/i);
    expect(ended.status).toBe(200);
    expect(ended.url.pathname).toBe(teach);
    expect(text(ended.doc.querySelector("[data-recap]"))).toContain("The class that ended");
    expect(text(ended.doc.querySelector("main"))).toContain(unanswered);
    expect(text(ended.doc.querySelector("[data-recap]"))).toContain("1 question left open.");
    expect(text(ended.doc.querySelector("main"))).toContain("1 of 1");
    expect(() => formWithButton(ended, /^start class$/i)).not.toThrow();
    const after = await student.open(path);
    expect(after.doc.querySelector('form[data-hand] button')?.getAttribute("aria-pressed")).toBe("false");
    expect(after.doc.querySelector('form[data-hand] button')?.hasAttribute("disabled")).toBe(true);

    // Main owns the recap: it remains until the next class starts.
    const again = await useButton(host, teach, /^start class$/i);
    expect(again.doc.querySelector("[data-recap]")).toBeNull();
    expect(again.doc.querySelector("[data-checkpoint]")?.hasAttribute("hidden")).toBe(false);
  });

  it("keeps Going over it, named and one-press marks, and recording time on the workspace", async () => {
    const host = new Visitor();
    const hall = await startSession(host, `Teaching tools ${tag()}`);
    const path = `${hall.url.pathname}/teach`;
    const going = await useButton(host, path, /^going over it$/i);
    expect(going.status).toBe(200);
    expect(going.url.pathname).toBe(path);
    expect(text((await new Visitor().open(hall.url.pathname)).doc.querySelector("main"))).toContain("The lecturer is going over it");

    const blank = await useButton(host, path, /^mark$/i);
    expect(blank.url.pathname).toBe(path);
    expect(text(blank.doc.querySelector("main"))).toContain("Part 1");
    const named = await host.open(path);
    const mark = formWithButton(named, /^mark$/i);
    const label = `A worked example ${tag()}`;
    fill(mark, label);
    const marked = await host.submit(named, mark);
    expect(marked.status).toBe(200);
    expect(marked.url.pathname).toBe(path);
    expect(text(marked.doc.querySelector("main"))).toContain(`Marked “${label}”`);

    const recording = await host.open(path);
    const save = formWithButton(recording, /^save$/i);
    const at = clock(Date.now() - 5 * 60_000);
    save.querySelector<HTMLInputElement>('input[type="time"]')!.value = at;
    const saved = await host.submit(recording, save);
    expect(saved.status).toBe(200);
    expect(saved.url.pathname).toBe(path);
    expect(saved.doc.querySelector<HTMLInputElement>('input[name="at"]')?.value).toBe(at);
    expect(text(saved.doc.querySelector("main"))).toMatch(/does(?:n't| not) start (?:the |your )?recording/i);
  });

  it("keeps a refused mark's words and gives a reason without leaving the workspace", async () => {
    const host = new Visitor();
    const hall = await startSession(host, `Refused mark ${tag()}`);
    const path = `${hall.url.pathname}/teach`;
    const page = await host.open(path);
    const mark = formWithButton(page, /^mark$/i);
    const label = "a".repeat(81);
    fill(mark, label);
    const refused = await host.submit(page, mark);
    expect(refused.status).toBe(422);
    expect(refused.url.pathname).toBe(path);
    expect(refused.doc.querySelector<HTMLInputElement>('input[name="label"]')?.value).toBe(label);
    expect(text(refused.doc.querySelector('[role="alert"]'))).toMatch(/at most \d+ characters/i);

    const invalid = await host.post(path, new URLSearchParams({ intent: "recording", at: "not-a-time" }));
    expect(invalid.status).toBe(422);
    expect(await invalid.text()).toContain("Enter the recording start as a time");
  });

  it("answers, reopens, hides and restores any question without leaving the workspace", async () => {
    const host = new Visitor();
    const hall = await startSession(host, `Moderation ${tag()}`);
    const path = `${hall.url.pathname}/teach`;
    const student = new Visitor();
    const bodies = Array.from({ length: 4 }, (_, i) => `Question ${i + 1} ${tag()}`);
    for (const [i, body] of bodies.entries()) expect((await ask(i < 3 ? student : new Visitor(), questionsPath(hall), body)).status).toBe(200);
    const body = bodies[3];
    for (const name of [/^answered$/i, /^not answered$/i, /^hide$/i, /^show again$/i]) {
      const page = await host.open(path);
      const button = buttonInQuestion(page, body, name);
      const result = await host.submit(page, button.closest("form")!, button);
      expect(result.status).toBe(200);
      expect(result.url.pathname).toBe(path);
      const visible = (await student.open(questionsPath(hall))).doc.body.textContent ?? "";
      if (name.source === "^hide$") expect(visible).not.toContain(body);
      else expect(visible).toContain(body);
    }
  });

  it("brings a report on a question outside the top three into the lecturer's workspace", async () => {
    const host = new Visitor();
    const hall = await startSession(host, `Reports in one place ${tag()}`);
    const path = `${hall.url.pathname}/teach`;
    const author = new Visitor();
    const bodies = Array.from({ length: 4 }, (_, i) => `Reported question ${i + 1} ${tag()}`);
    for (const [i, body] of bodies.entries()) expect((await ask(i === 3 ? author : new Visitor(), questionsPath(hall), body)).status).toBe(200);
    const reporter = new Visitor();
    const page = await reporter.open(questionsPath(hall));
    const question = questions(page).find((q) => q.text.includes(bodies[3]))!;
    const report = question.button(/^report$/i)!;
    expect((await reporter.submit(page, report.closest("form")!, report)).status).toBe(200);

    const review = await host.open(path);
    const reported = [...review.doc.querySelectorAll('[role="status"]')].find((el) => /1 question has been reported/.test(text(el)));
    expect(reported).toBeDefined();
    const href = reported!.querySelector("a")?.getAttribute("href");
    expect(href).toBeDefined();
    const target = new URL(href!, review.url);
    expect(target.pathname).toBe(path);
    expect(text(review.doc.querySelector(target.hash))).toContain(bodies[3]);
    expect(buttonInQuestion(review, bodies[3], /^hide$/i)).toBeDefined();
    expect(text(review.doc.querySelector(`[aria-label="Reported 1 time"]`))).toContain("1");
    for (const privateValue of [...author.secrets, ...reporter.secrets, author.username, reporter.username]) {
      expect(review.html).not.toContain(privateValue);
    }
  });

  it("keeps main's host guide and floating-window hooks on the dedicated workspace", async () => {
    const host = new Visitor();
    const hall = await startSession(host, `Guide in teaching ${tag()}`);
    const path = `${hall.url.pathname}/teach`;
    const first = await host.open(`${path}?from=lecture`);
    expect(text(first.doc.querySelector("[data-guide] h2"))).toBe("Host guide");
    expect(first.doc.querySelector("form.hall-mark")).not.toBeNull();
    expect(first.doc.querySelector("[data-checkpoint]")?.hasAttribute("hidden")).toBe(false);
    const dismiss = formWithButton(first, /^got it$/i);
    const button = [...dismiss.querySelectorAll("button")].find(b => text(b) === "Got it")!;
    const after = await host.submit(first, dismiss, button);
    expect(after.status).toBe(200);
    expect(after.url.pathname).toBe(path);
    expect(after.url.searchParams.get("from")).toBe("lecture");
    expect(after.doc.querySelector("[data-guide]")).toBeNull();
    expect(text(after.doc.querySelector("main"))).not.toContain("Shows on every screen for 2 minutes.");
    expect(text(after.doc.querySelector("main"))).not.toContain("You teach: you have no hand here, and you aren't counted.");
    expect(after.doc.querySelector("form.hall-mark")).not.toBeNull();
    expect(after.doc.querySelector("[data-checkpoint]")).not.toBeNull();
    expect(text(after.doc.querySelector("main"))).toContain("No one, the host included, is shown whose hand is up.");
    // The owner’s visual student preview must not accidentally finish the
    // different guide they need when joining another lecturer’s session.
    const other = await startSession(new Visitor(), `Other lecturer ${tag()}`);
    expect(text((await host.open(other.url.pathname)).doc.querySelector("[data-guide] h2"))).toBe("Student guide");
  });

  it("keeps the lecturer and their student preview out of the room count", async () => {
    const host = new Visitor();
    const hall = await startSession(host, `No host hand ${tag()}`);
    const lecturer = await host.listen(await host.open(`${hall.url.pathname}/teach`));
    const preview = await host.listen(await host.open(`${hall.url.pathname}?view=student`));
    streams.push(lecturer, preview);
    await lecturer.until((board) => board.here === 0);
    const student = new Visitor();
    const studentStream = await student.listen(await student.open(hall.url.pathname));
    streams.push(studentStream);
    const { board } = await lecturer.until((board) => board.here === 1);
    expect(Object.keys(board).sort()).toEqual(["classState", "goingOver", "hands", "here", "questions"]);
    const refused = await host.post(`${hall.url.pathname}?view=student`, new URLSearchParams({ intent: "hand", up: "1" }));
    expect(refused.status).toBe(403);
    await refused.text();
  });
});
