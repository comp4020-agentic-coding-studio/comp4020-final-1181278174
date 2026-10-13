import { afterEach, describe, expect, it } from "vitest";
import { ask, meToo, questions, startSession, type Stream, Visitor } from "./visitor.ts";

// Crit 9: a change one person makes reaches every other open page within
// about a second, with no reload. These read the stream a page names, over
// HTTP, so they show the server sends the change in time and what it sends.
// That a page moves when the event arrives is checked by hand in a browser.
const tag = (): string => Math.random().toString(36).slice(2, 8);

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
    expect(sent.board.questions).toEqual(page.map((q) => [q.id, q.votes]));
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
