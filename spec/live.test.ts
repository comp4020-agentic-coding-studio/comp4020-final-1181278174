import { afterEach, describe, expect, it } from "vitest";
import { ask, meToo, questions, startSession, type Stream, Visitor } from "./visitor.ts";

// Crit 9: a change one person makes reaches every other open page within
// about a second, with no reload. These read the stream a page names, over
// HTTP, so they show the server sends the change in time and what it sends.
// That a page moves when the event arrives is checked by hand in a browser.
const tag = (): string => Math.random().toString(36).slice(2, 8);

// longer than the server takes to gather changes into one event
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 400));

const open: Stream[] = [];
afterEach(() => {
  for (const stream of open.splice(0)) stream.close();
});

/** A new session with one person watching it live. */
async function watched(): Promise<{ path: string; watcher: Visitor; stream: Stream }> {
  const session = await startSession(new Visitor(), `Live ${tag()}`);
  const path = session.url.pathname;
  const watcher = new Visitor();
  const stream = await watcher.listen(await watcher.open(path));
  open.push(stream);
  expect(stream.status).toBe(200);
  return { path, watcher, stream };
}

describe("live", () => {
  it("someone with the page open is sent a question another person asks, within a second", async () => {
    const { path, stream } = await watched();
    await stream.until((board) => board.questions.length === 0);

    const asked = Date.now();
    await ask(new Visitor(), path, `Is this live? ${tag()}`);
    const sent = await stream.until((board) => board.questions.length === 1);
    expect(sent.at - asked).toBeLessThan(1000);
    expect(sent.board.questions[0][1]).toBe(0);
  });

  it("and a vote, within a second, with the questions in their new order", async () => {
    const { path, watcher, stream } = await watched();
    const first = `Asked first ${tag()}`;
    const second = `Asked second ${tag()}`;
    await ask(new Visitor(), path, first);
    await ask(new Visitor(), path, second);
    await stream.until((board) => board.questions.length === 2);

    const voted = Date.now();
    await meToo(new Visitor(), path, second);
    const sent = await stream.until((board) => board.questions[0]?.[1] === 1);
    expect(sent.at - voted).toBeLessThan(1000);

    // what was sent is what a page opened now shows: the same questions, in
    // the same order, with the same counts
    const page = questions(await watcher.open(path));
    expect(page.map((q) => q.text.includes(second))).toEqual([true, false]);
    expect(sent.board.questions.map(([id, votes]) => [id, votes])).toEqual(page.map((q) => [q.id, q.votes]));
  });

  it("nothing in the stream carries who asked or who voted", async () => {
    const { path, stream } = await watched();
    const asker = new Visitor();
    const body = `Who asked this? ${tag()}`;
    await ask(asker, path, body);
    const voter = new Visitor();
    await meToo(voter, path, body);
    await stream.until((board) => board.questions[0]?.[1] === 1);

    expect(asker.secrets.length).toBeGreaterThan(0);
    for (const secret of [...asker.secrets, ...voter.secrets]) {
      expect(stream.raw).not.toContain(secret);
    }
  });

  it("counts the people with the session open: two tabs are one person, and leaving is noticed", async () => {
    const { path, stream } = await watched();
    await stream.until((board) => board.here === 1);

    const other = new Visitor();
    const tab = await other.listen(await other.open(path));
    const secondTab = await other.listen(await other.open(path));
    open.push(tab, secondTab);
    await secondTab.until(() => true);
    await stream.until((board) => board.here === 2);
    // give a wrong count of three the time to arrive
    await settle();
    expect(stream.last?.here).toBe(2);

    stream.forget();
    tab.close();
    secondTab.close();
    await stream.until((board) => board.here === 1, 2000);
  });

  it("does not count the projector page as a person", async () => {
    const { path, stream } = await watched();
    await stream.until((board) => board.here === 1);

    const screen = new Visitor();
    const session = await screen.open(path);
    const link = [...session.doc.querySelectorAll("a")].find((a) => /projector/i.test(a.textContent ?? ""));
    const projector = await screen.listen(await screen.open(new URL(link!.getAttribute("href")!, session.url)));
    open.push(projector);
    await projector.until(() => true);
    // the projector's arrival is sent to everyone a moment later; the count has not moved
    await settle();
    expect(projector.last?.here).toBe(1);
    expect(stream.last?.here).toBe(1);

    // a person arriving is what raises it, to two and not three
    const other = new Visitor();
    open.push(await other.listen(await other.open(path)));
    await stream.until((board) => board.here > 1);
    await settle();
    expect(stream.last?.here).toBe(2);
  });

  it("a new question is sent to the others with its words, so their pages need not fetch it", async () => {
    const { path, stream } = await watched();
    const body = `Sent with its words ${tag()}`;
    const asked = Date.now();
    await ask(new Visitor(), path, body);
    const sent = await stream.untilAdded((question) => question.body === body);
    expect(sent.at - asked).toBeLessThan(1000);
    expect(Math.abs(sent.question.at - asked)).toBeLessThan(2000);
    // it is the question the state then lists
    const listed = await stream.until((board) => board.questions.length === 1);
    expect(listed.board.questions[0][0]).toBe(sent.question.id);
  });

  it("the person who asked is not sent it: their pages ask the server, which marks it theirs", async () => {
    const { path, stream } = await watched();
    const asker = new Visitor();
    const own = await asker.listen(await asker.open(path));
    open.push(own);
    const body = `Asked by the one listening ${tag()}`;
    await ask(asker, path, body);
    await stream.untilAdded((question) => question.body === body);
    await own.until((board) => board.questions.length === 1);
    await settle();
    expect(own.added).toHaveLength(0);
    expect(own.raw).not.toContain(body);
  });

  it("a question carries the time it was asked, so an open page can keep its \"just now\" true", async () => {
    const { path, watcher } = await watched();
    const before = Date.now();
    await ask(new Visitor(), path, `When was this asked? ${tag()}`);
    const time = (await watcher.open(path)).doc.querySelector('[aria-label="Questions"] > li time');
    expect(time, "the question has no <time>").not.toBeNull();
    const asked = Date.parse(time!.getAttribute("datetime") ?? "");
    expect(asked).toBeGreaterThanOrEqual(before - 1000);
    expect(asked).toBeLessThanOrEqual(Date.now() + 1000);
    expect(time!.textContent).toBe("just now");
  });

  it("the stream of an unknown code is a 404", async () => {
    const { path, watcher } = await watched();
    const page = await watcher.open(path);
    const named = page.doc.querySelector("[data-live]")!.getAttribute("data-live")!;
    const code = path.split("/").filter(Boolean).pop()!;
    // "0000" has the right length but no session can have it: codes have no 0
    const stream = await watcher.listenTo(new URL(named.replace(code, "0000"), page.url));
    expect(stream.status).toBe(404);
  });
});
