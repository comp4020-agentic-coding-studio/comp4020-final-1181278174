import { afterEach, describe, expect, it } from "vitest";
import { ask, hostPress, meToo, question, questions, startSession, type Stream, Visitor } from "./visitor.ts";

// What the person who started a session can do to a question: mark it
// answered, or hide it. Everyone with the session open is sent the change.
const tag = (): string => Math.random().toString(36).slice(2, 8);

const open: Stream[] = [];
afterEach(() => {
  for (const stream of open.splice(0)) stream.close();
});

/** A session with two questions, the first with a vote, and a guest watching live. */
async function hosted() {
  const host = new Visitor();
  const path = (await startSession(host, `Hosted ${tag()}`)).url.pathname;
  const voted = `Has a vote ${tag()}`;
  const plain = `Has none ${tag()}`;
  await ask(new Visitor(), path, voted);
  await ask(new Visitor(), path, plain);
  await meToo(new Visitor(), path, voted);
  const guest = new Visitor();
  const stream = await guest.listen(await guest.open(path));
  open.push(stream);
  await stream.until((board) => board.questions.length === 2);
  return { host, path, voted, plain, guest, stream };
}

describe("the host", () => {
  it("is the only one offered Answered and Hide", async () => {
    const { host, path, voted, guest } = await hosted();
    const mine = question(await host.open(path), voted)!;
    expect(mine.button(/^answered/i)).toBeDefined();
    expect(mine.button(/^hide/i)).toBeDefined();

    const theirs = question(await guest.open(path), voted)!;
    expect(theirs.button(/answered/i)).toBeUndefined();
    expect(theirs.button(/hide/i)).toBeUndefined();
  });

  it("anyone else who sends the host's form is refused, and nothing changes", async () => {
    const { host, path, voted, guest } = await hosted();
    const hide = question(await host.open(path), voted)!.button(/^hide/i)!;
    // the guest sends exactly what the host's button would
    const refused = await guest.submit(await guest.open(path), hide.closest("form")!, hide);
    expect(refused.status).toBe(403);
    expect(question(await new Visitor().open(path), voted)).toBeDefined();
  });

  it("marks a question answered: it says so to everyone, sits below the open ones, and the stream says it within a second", async () => {
    const { host, path, voted, plain, guest, stream } = await hosted();
    const pressed = Date.now();
    await hostPress(host, path, voted, /^answered/i);
    const sent = await stream.until((board) => board.questions.some((q) => q[2] === "answered"));
    expect(sent.at - pressed).toBeLessThan(1000);

    const page = questions(await guest.open(path));
    expect(page.map((q) => q.text.includes(plain))).toEqual([true, false]);
    expect(page[1].text).toMatch(/\bAnswered\b/);
    expect(page[0].text).not.toMatch(/\bAnswered\b/);
    expect(sent.board.questions).toEqual([
      [page[0].id, 0, "open"],
      [page[1].id, 1, "answered"],
    ]);

    // and it can be put back
    await hostPress(host, path, voted, /not answered/i);
    const back = questions(await guest.open(path));
    expect(back[0].text).toContain(voted);
    expect(back[0].text).not.toMatch(/\bAnswered\b/);
  });

  it("hides a question: it is gone for everyone else and from the stream, and the host can show it again", async () => {
    const { host, path, voted, guest, stream } = await hosted();
    const id = question(await guest.open(path), voted)!.id;
    const pressed = Date.now();
    await hostPress(host, path, voted, /^hide/i);
    const sent = await stream.until((board) => board.questions.length === 1);
    expect(sent.at - pressed).toBeLessThan(1000);
    expect(sent.board.questions.map((q) => q[0])).not.toContain(id);
    expect(question(await guest.open(path), voted)).toBeUndefined();
    expect((await guest.open(path)).doc.body.textContent).not.toContain(voted);

    const kept = question(await host.open(path), voted);
    expect(kept, "the host no longer sees the hidden question").toBeDefined();
    expect(kept!.text).toMatch(/\bHidden\b/);

    await hostPress(host, path, voted, /show again/i);
    expect(question(await guest.open(path), voted)).toBeDefined();
  });

  it("the projector page lists only the questions still to answer", async () => {
    const { host, path, voted, plain, guest } = await hosted();
    const third = `Hidden later ${tag()}`;
    await ask(new Visitor(), path, third);
    await hostPress(host, path, voted, /^answered/i);
    await hostPress(host, path, third, /^hide/i);

    const session = await guest.open(path);
    const link = [...session.doc.querySelectorAll("a")].find((a) => /projector/i.test(a.textContent ?? ""));
    const screen = await guest.open(new URL(link!.getAttribute("href")!, session.url));
    const shown = [...screen.doc.querySelectorAll('[aria-label="Top questions"] > li')].map((li) => li.textContent ?? "");
    expect(shown).toHaveLength(1);
    expect(shown[0]).toContain(plain);
  });
});
