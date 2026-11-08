import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it } from "vitest";
import { ask, type Board, fill, formWithButton, type Page, question, startSession, type Stream, Visitor } from "./visitor.ts";

const tag = (): string => Math.random().toString(36).slice(2, 8);
const words = (node: Element | null | undefined): string => {
  if (!node) return "";
  const walker = node.ownerDocument.createTreeWalker(node, 4);
  const parts: string[] = [];
  for (let next = walker.nextNode(); next; next = walker.nextNode()) parts.push(next.nodeValue ?? "");
  return parts.join(" ").replace(/\s+/g, " ").trim();
};
const streamList: Stream[] = [];
afterEach(() => {
  for (const stream of streamList.splice(0)) stream.close();
});

type TutorialState = { label: string | null; endsAt: number | null; revision: number; serverNow: number };
const tutorialState = (board: Board): TutorialState | undefined => (board as Board & { tutorial?: TutorialState }).tutorial;

async function tutorial(host: Visitor, started = true): Promise<Page> {
  const home = await host.open("/");
  const form = formWithButton(home, /^start a session$/i);
  fill(form, `Tutorial ${tag()}`);
  const mode = form.querySelector<HTMLSelectElement>('select[name="mode"]');
  expect(mode, "starting a session offers the mode").not.toBeNull();
  mode!.value = "tutorial";
  const page = await host.submit(home, form);
  expect(page.status).toBe(200);
  expect(page.url.pathname).toMatch(/^\/s\/[A-Z2-9]{4}$/);
  return started ? host.submit(page, formWithButton(page, /^start tutorial$/i)) : page;
}

async function press(who: Visitor, path: string, label: RegExp): Promise<Page> {
  const page = await who.open(path);
  return who.submit(page, formWithButton(page, label));
}

async function post(who: Visitor, path: string, fields: Record<string, string>, status = 303): Promise<Document> {
  const response = await who.post(path, new URLSearchParams(fields));
  expect(response.status, `${fields.intent ?? "start"} on ${path}`).toBe(status);
  const doc = new JSDOM(await response.text()).window.document;
  if (status >= 400) expect(words(doc.querySelector('[role="alert"]'))).not.toBe("");
  return doc;
}

const own = (page: Page): Element | null => page.doc.querySelector('[aria-label="Your help request"]');
const queue = (page: Page): Element | null => page.doc.querySelector('[aria-label="Tutor help queue"]');
const ticket = (page: Page): string => {
  const found = words(own(page)).match(/\b\d{4}\b/);
  expect(found, "a queued student is given their own four-digit ticket").not.toBeNull();
  return found![0];
};

async function watching(who: Visitor, page: Page, screen = false): Promise<Stream> {
  const stream = screen ? await who.listenTo(new URL(`${page.url.pathname}/events?screen`, page.url)) : await who.listen(page);
  expect(stream.status).toBe(200);
  streamList.push(stream);
  return stream;
}

describe("tutorial mode", () => {
  it("offers tutorial mode while keeping lecture as the default", async () => {
    const home = await new Visitor().open("/");
    const form = formWithButton(home, /^start a session$/i);
    const mode = form.querySelector<HTMLSelectElement>('select[name="mode"]');
    expect(mode).not.toBeNull();
    expect(mode!.value).toBe("lecture");
    expect([...mode!.options].map((option) => option.value)).toEqual(["lecture", "tutorial"]);
  });

  it("keeps the title and valid mode on a refusal, and refuses an unknown mode", async () => {
    const host = new Visitor();
    const longTitle = "x".repeat(81);
    const refused = await post(host, "/", { title: longTitle, mode: "tutorial" }, 422);
    expect(refused.querySelector<HTMLInputElement>('input[name="title"]')?.value).toBe(longTitle);
    expect(refused.querySelector<HTMLSelectElement>('select[name="mode"]')?.value).toBe("tutorial");
    const unknown = await post(host, "/", { title: "Keep this title", mode: "quiz" }, 422);
    expect(unknown.querySelector<HTMLInputElement>('input[name="title"]')?.value).toBe("Keep this title");
  });

  it("keeps omitted mode as a lecture, and does not expose tutorial controls on a lecture", async () => {
    const host = new Visitor();
    const response = await host.post("/", new URLSearchParams({ title: `Legacy lecture ${tag()}` }));
    expect(response.status).toBe(303);
    const path = response.headers.get("location")!;
    await response.text();
    const lecture = await host.open(path);
    expect(formWithButton(lecture, /^start class$/i)).not.toBeNull();
    expect(queue(lecture)).toBeNull();
    const stream = await watching(host, lecture);
    const first = await stream.until(() => true);
    expect(tutorialState(first.board)).toBeUndefined();
    expect((await host.open(`${path}/tutorial`)).status).toBe(404);
  });

  it("lists a hosted tutorial with links back to its room and retained questions", async () => {
    const host = new Visitor();
    const room = await tutorial(host);
    const title = words(room.doc.querySelector("h1"));
    const home = await host.open("/");
    const entry = [...home.doc.querySelectorAll('[aria-label="Sessions you started"] > li')]
      .find((item) => words(item).includes(title));
    expect(entry).toBeDefined();
    expect([...entry!.querySelectorAll("a")].map((link) => new URL(link.getAttribute("href")!, home.url).pathname))
      .toEqual([room.url.pathname, `${room.url.pathname}/questions`]);
    expect(words(entry)).toMatch(/tutorial/i);
  });

  it("keeps tutorial controls separate from the lecture guide, pause card, recap and class buttons", async () => {
    const host = new Visitor();
    const student = new Visitor();
    const path = (await tutorial(host, false)).url.pathname;
    const noLectureUI = (page: Page): void => {
      const main = words(page.doc.querySelector("main"));
      for (const heading of ["Host guide", "Student guide", "At your next pause", "The class that ended"]) {
        expect(main, `${heading} on ${page.url.pathname}`).not.toContain(heading);
      }
      expect(page.doc.querySelector("[data-checkpoint], [data-recap], [data-hall], form[data-hand]")).toBeNull();
      const buttons = [...page.doc.querySelectorAll("button")].map((button) => words(button));
      expect(buttons).not.toContain("Start class");
      expect(buttons).not.toContain("End class");
    };
    for (const phase of ["before", "on", "over"] as const) {
      if (phase === "on") await press(host, path, /^start tutorial$/i);
      if (phase === "over") await press(host, path, /^end tutorial$/i);
      const hostPage = await host.open(path);
      noLectureUI(hostPage);
      expect(formWithButton(hostPage, phase === "on" ? /^end tutorial$/i : /^start tutorial$/i)).toBeDefined();
      for (const page of [await student.open(path), await host.open(`${path}/present`), await host.open(`${path}/questions`)]) noLectureUI(page);
      expect((await student.open(path)).doc.querySelector('input[value="class-start"], input[value="class-end"]')).toBeNull();
    }
  });

  it("leaves main's lecture guide, pause card and recap available after hosting a tutorial", async () => {
    const host = new Visitor();
    await tutorial(host);
    const lecture = await startSession(host, `Lecture after tutorial ${tag()}`, { started: false });
    const path = lecture.url.pathname;
    expect(words(lecture.doc.querySelector("main"))).toContain("Host guide");
    expect(formWithButton(lecture, /^start class$/i)).toBeDefined();
    expect(lecture.doc.querySelector('[aria-label="Tutor help queue"]')).toBeNull();
    const running = await press(host, path, /^start class$/i);
    const pause = running.doc.querySelector("[data-checkpoint]");
    expect(pause?.hasAttribute("hidden")).toBe(false);
    expect(words(pause)).toContain("At your next pause");
    const ended = await press(host, path, /^end class$/i);
    expect(words(ended.doc.querySelector("[data-recap]"))).toContain("The class that ended");
    const student = await new Visitor().open(path);
    expect(words(student.doc.querySelector("main"))).toContain("Student guide");
  });

  it("opens a wordless request only during the tutorial, with separate student and tutor controls", async () => {
    const host = new Visitor();
    const room = await tutorial(host, false);
    const path = room.url.pathname;
    const student = new Visitor();
    const before = await student.open(path);
    const request = formWithButton(before, /^ask tutor to come over$/i);
    expect(request.querySelector("button")?.disabled).toBe(true);
    expect(request.querySelector("textarea, input:not([type='hidden'])")).toBeNull();
    expect(words(before.doc.body)).not.toContain("I'm lost");
    await post(student, path, { intent: "tutorial-join" }, 422);
    await press(host, path, /^start tutorial$/i);
    const joined = await press(student, path, /^ask tutor to come over$/i);
    expect(ticket(joined)).toMatch(/^\d{4}$/);
    expect(words(own(joined))).toMatch(/1 of 1 waiting/i);
    expect(queue(joined)).toBeNull();
    expect(own(await host.open(path))).toBeNull();
    expect(words(joined.doc.body)).toMatch(/small room|see your screen|nearby|recognis/i);
    expect(words(joined.doc.body)).not.toMatch(/nobody can tell|no one can tell|without anyone knowing/i);
  });

  it("serves requests in order, keeps repeat joins and calls to one ticket, and lets a student leave", async () => {
    const host = new Visitor();
    const path = (await tutorial(host)).url.pathname;
    const first = new Visitor();
    const second = new Visitor();
    await Promise.all([
      post(first, path, { intent: "tutorial-join" }),
      post(first, path, { intent: "tutorial-join" }),
    ]);
    const firstTicket = ticket(await first.open(path));
    const secondPage = await press(second, path, /^ask tutor to come over$/i);
    const secondTicket = ticket(secondPage);
    expect(secondTicket).not.toBe(firstTicket);
    expect(words(own(secondPage))).toMatch(/2 of 2 waiting/i);
    expect(words(queue(await host.open(path)))).toMatch(/2 of 2 open requests waiting/i);
    await Promise.all([
      post(host, path, { intent: "tutorial-call" }),
      post(host, path, { intent: "tutorial-call" }),
    ]);
    const called = await host.open(path);
    expect(words(queue(called))).toContain(firstTicket);
    expect(words(queue(called))).not.toContain(secondTicket);
    expect(words(own(await first.open(path)))).toMatch(/calling|your turn/i);
    expect(words(own(await second.open(path)))).toMatch(/1 of 1 waiting/i);
    await press(first, path, /^leave queue$/i);
    expect(words(own(await first.open(path)))).not.toContain(firstTicket);
    const next = await press(host, path, /^call next ticket$/i);
    expect(words(queue(next))).toContain(secondTicket);
    await press(host, path, /^finish helping$/i);
    expect(words(own(await second.open(path)))).not.toContain(secondTicket);
    expect(words(queue(await host.open(path)))).toMatch(/0 of 0 open requests waiting/i);
  });

  it("refuses tutor controls from students and requests from the tutor", async () => {
    const host = new Visitor();
    const path = (await tutorial(host)).url.pathname;
    const student = new Visitor();
    for (const intent of ["class-start", "class-end", "tutorial-call", "tutorial-finish", "tutorial-exercise", "tutorial-clear-exercise"]) {
      await post(student, path, { intent, request: "1", label: "Exercise", minutes: "5", endsAt: "1" }, 403);
    }
    await post(host, path, { intent: "tutorial-join" }, 403);
    await post(host, path, { intent: "tutorial-leave" }, 403);
    const studentPage = await student.open(path);
    expect(studentPage.doc.querySelector('input[value="tutorial-call"], input[value="tutorial-exercise"], input[value="class-end"]')).toBeNull();
  });

  it("a stale finish cannot dismiss the next student's request or a request in another session", async () => {
    const host = new Visitor();
    const path = (await tutorial(host)).url.pathname;
    const first = new Visitor();
    const second = new Visitor();
    await post(first, path, { intent: "tutorial-join" });
    await post(second, path, { intent: "tutorial-join" });
    const old = await press(host, path, /^call next ticket$/i);
    const stale = formWithButton(old, /^finish helping$/i);
    const request = stale.querySelector<HTMLInputElement>('input[name="request"]')!.value;
    await host.submit(old, stale);
    const next = await press(host, path, /^call next ticket$/i);
    const nextTicket = ticket(await second.open(path));
    expect(words(queue(next))).toContain(nextTicket);
    await post(host, path, { intent: "tutorial-finish", request }, 404);
    expect(words(queue(await host.open(path)))).toContain(nextTicket);

    const otherPath = (await tutorial(host)).url.pathname;
    const other = new Visitor();
    await post(other, otherPath, { intent: "tutorial-join" });
    const otherCalled = await press(host, otherPath, /^call next ticket$/i);
    const otherRequest = formWithButton(otherCalled, /^finish helping$/i).querySelector<HTMLInputElement>('input[name="request"]')!.value;
    await post(host, path, { intent: "tutorial-finish", request: otherRequest }, 404);
    expect(words(queue(await host.open(path)))).toContain(nextTicket);
  });

  it("shares one exercise deadline across room, questions, projector and the public stream", async () => {
    const host = new Visitor();
    const room = await tutorial(host);
    const path = room.url.pathname;
    const student = new Visitor();
    const stream = await watching(student, await student.open(path));
    const label = `Exercise on graphs ${tag()}`;
    const before = Date.now();
    await post(host, path, { intent: "tutorial-exercise", label, minutes: "5" });
    const event = await stream.until((board) => tutorialState(board)?.label === label);
    const state = tutorialState(event.board)!;
    expect(state.endsAt).toBeGreaterThanOrEqual(before + 5 * 60_000);
    expect(state.endsAt).toBeLessThanOrEqual(Date.now() + 5 * 60_000);
    expect(state.serverNow).toBeGreaterThanOrEqual(before);
    for (const route of [path, `${path}/questions`, `${path}/present`, `${path}/timeline`]) {
      const page = await student.open(route);
      expect(page.status, route).toBe(200);
      const exercise = page.doc.querySelector('[aria-label="Current exercise"]');
      expect(words(exercise), route).toContain(label);
      expect(exercise?.querySelector(`time[datetime="${new Date(state.endsAt!).toISOString()}"]`), route).not.toBeNull();
    }
    const projector = await host.open(`${path}/present`);
    expect(projector.doc.querySelector("form")).toBeNull();
    expect(projector.html).not.toContain(host.username);
  });

  it("keeps refused exercise fields and gives a reason without changing the running timer", async () => {
    const host = new Visitor();
    const path = (await tutorial(host)).url.pathname;
    await post(host, path, { intent: "tutorial-exercise", label: "Already running", minutes: "5" });
    for (const fields of [
      { label: "x".repeat(81), minutes: "4" },
      { label: "Keep this exercise", minutes: "0" },
      { label: "Keep this exercise", minutes: "121" },
      { label: "Keep this exercise", minutes: "1.5" },
    ]) {
      const doc = await post(host, path, { intent: "tutorial-exercise", ...fields }, 422);
      expect(doc.querySelector<HTMLInputElement>('input[name="label"]')?.value).toBe(fields.label);
      expect(doc.querySelector<HTMLInputElement>('input[name="minutes"]')?.value).toBe(fields.minutes);
      expect(words(doc.querySelector('[aria-label="Current exercise"]'))).toContain("Already running");
    }
    const cleared = await press(host, path, /^clear exercise$/i);
    expect(words(cleared.doc.querySelector('[aria-label="Current exercise"]'))).not.toContain("Already running");
  });

  it("does not clear a newer exercise when an old clear form arrives", async () => {
    const host = new Visitor();
    const path = (await tutorial(host)).url.pathname;
    await post(host, path, { intent: "tutorial-exercise", label: "First exercise", minutes: "2" });
    const before = await host.open(path);
    const old = formWithButton(before, /^clear exercise$/i);
    const endsAt = old.querySelector<HTMLInputElement>('input[name="endsAt"]')!.value;
    await post(host, path, { intent: "tutorial-exercise", label: "Second exercise", minutes: "3" });
    await post(host, path, { intent: "tutorial-clear-exercise", endsAt }, 422);
    expect(words((await host.open(path)).doc.querySelector('[aria-label="Current exercise"]'))).toContain("Second exercise");
  });

  it("keeps waiting tickets private and sends no queue, person, position or ticket in public events", async () => {
    const host = new Visitor();
    const room = await tutorial(host);
    const path = room.url.pathname;
    const first = new Visitor();
    const other = new Visitor();
    const bystander = new Visitor({ signedOut: true });
    const hostStream = await watching(host, room);
    const studentStream = await watching(other, await other.open(path));
    const publicStream = await watching(bystander, room, true);
    const initial = await hostStream.until((board) => !!tutorialState(board));
    const revision = tutorialState(initial.board)!.revision;
    const joined = await press(first, path, /^ask tutor to come over$/i);
    const firstTicket = ticket(joined);
    for (const stream of [hostStream, studentStream, publicStream]) {
      const event = await stream.until((board) => (tutorialState(board)?.revision ?? 0) > revision);
      const state = tutorialState(event.board)!;
      expect(Object.keys(state).sort()).toEqual(["endsAt", "label", "revision", "serverNow"]);
      expect(stream.raw).not.toMatch(/"(?:ticket|person|account|position|queue|request|waiting)"/);
      for (const secret of first.secrets) expect(stream.raw).not.toContain(secret);
      expect(stream.raw).not.toContain(first.username);
    }
    for (const viewer of [host, other, bystander]) {
      for (const route of [path, `${path}/questions`, `${path}/present`]) {
        const page = await viewer.open(route);
        expect(words(own(page))).not.toContain(firstTicket);
        expect(words(queue(page))).not.toContain(firstTicket);
        expect(page.html).not.toContain(first.username);
        for (const secret of first.secrets) expect(page.html).not.toContain(secret);
      }
    }
    const called = await press(host, path, /^call next ticket$/i);
    expect(words(queue(called))).toContain(firstTicket);
    expect(words(own(await first.open(path)))).toContain(firstTicket);
    expect(words((await other.open(path)).doc.body)).not.toContain(firstTicket);
    expect(words((await host.open(`${path}/present`)).doc.body)).not.toContain(firstTicket);
  });

  it("clears help requests and the timer at the end, while keeping questions for the next lecture", async () => {
    const host = new Visitor();
    const path = (await tutorial(host)).url.pathname;
    const student = new Visitor();
    const joined = await press(student, path, /^ask tutor to come over$/i);
    const oldTicket = ticket(joined);
    await post(host, path, { intent: "tutorial-exercise", label: "Before the end", minutes: "5" });
    const body = `Question to bring to the next lecture ${tag()}`;
    await ask(student, `${path}/questions`, body);
    await press(host, path, /^end tutorial$/i);
    const after = await student.open(path);
    expect(words(own(after))).not.toContain(oldTicket);
    expect(words(after.doc.querySelector('[aria-label="Current exercise"]'))).not.toContain("Before the end");
    await post(student, path, { intent: "tutorial-join" }, 422);
    await post(host, path, { intent: "tutorial-exercise", label: "Too late", minutes: "5" }, 422);
    expect(question(await student.open(`${path}/questions`), body)?.yours).toBe(true);
    await press(host, path, /^start tutorial$/i);
    expect(words(queue(await host.open(path)))).toMatch(/0 of 0 open requests waiting/i);
    expect(question(await host.open(`${path}/questions`), body)?.yours).toBe(false);
  });

  it("keeps new question text out of the tutorial projector stream while ordinary question pages receive it", async () => {
    const host = new Visitor();
    const room = await tutorial(host);
    const path = room.url.pathname;
    const asker = new Visitor();
    const reader = new Visitor();
    const projector = await host.open(`${path}/present`);
    const screen = await watching(host, projector);
    const reading = await watching(reader, await reader.open(`${path}/questions`));
    await screen.until(() => true);
    await reading.until(() => true);

    const body = `A question for later, not the shared screen ${tag()}`;
    const posted = await ask(asker, `${path}/questions`, body);
    const id = question(posted, body)!.id;
    await reading.untilAdded((added) => added.id === id && added.body === body);
    // The state follows the question announcement. Receiving this state is
    // the barrier: any leaked announcement would already be in screen.raw.
    await screen.until((board) => board.questions.some(([questionId]) => questionId === id));
    expect(screen.added).toEqual([]);
    expect(screen.raw).not.toContain(body);
    expect((await host.open(`${path}/present`)).html).not.toContain(body);
  });

  it("refuses lecture-only actions in a tutorial and leaves its queue and exercise unchanged", async () => {
    const host = new Visitor();
    const path = (await tutorial(host)).url.pathname;
    const student = new Visitor();
    const joined = await press(student, path, /^ask tutor to come over$/i);
    const currentTicket = ticket(joined);
    await post(host, path, { intent: "tutorial-exercise", label: "Keep working", minutes: "5" });
    const before = await host.open(path);
    const deadline = before.doc.querySelector('[aria-label="Current exercise"] time')?.getAttribute("datetime");

    for (const who of [student, host]) {
      await post(who, path, { intent: "hand", up: "1" }, 422);
      await post(who, path, { intent: "not-a-tutorial-action" }, 422);
      for (const intent of ["timeline_mark", "recording"]) {
        const response = await who.post(`${path}/timeline`, new URLSearchParams({ intent, label: "Unsupported mark", at: "10:00" }));
        expect(response.status).toBe(who === host ? 422 : 403);
        expect(await response.text()).toContain("Questions for later");
      }
    }
    const after = await student.open(path);
    expect(ticket(after)).toBe(currentTicket);
    expect(after.doc.querySelector('[aria-label="Current exercise"] time')?.getAttribute("datetime")).toBe(deadline);
    expect(words(after.doc.querySelector('[aria-label="Current exercise"]'))).toContain("Keep working");
    const stream = await watching(student, after);
    const state = (await stream.until(() => true)).board;
    expect(state.hands).toEqual([]);
    expect(state.classState).toBe("on");
  });

  it("lets signed-out people read but refuses their actions, and keeps unknown sessions as 404", async () => {
    const host = new Visitor();
    const path = (await tutorial(host)).url.pathname;
    const guest = new Visitor({ signedOut: true });
    expect((await guest.open(path)).status).toBe(200);
    await post(guest, path, { intent: "tutorial-join" }, 401);
    const guestHelp = own(await guest.open(path));
    expect(guestHelp?.querySelector("form")).toBeNull();
    expect(words(guestHelp)).toContain("Sign in to request help");
    expect(words(guestHelp)).not.toMatch(/Your ticket\s*\d{4}/i);
    expect((await guest.open("/s/0000/tutorial")).status).toBe(404);
    const lecture = await startSession(host, `No tutorial ${tag()}`);
    expect((await guest.open(`${lecture.url.pathname}/tutorial`)).status).toBe(404);
  });
});
