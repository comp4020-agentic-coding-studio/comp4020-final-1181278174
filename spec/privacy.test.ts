import { afterEach, describe, expect, it } from "vitest";
import { type Page, startSession, type Stream, Visitor } from "./visitor.ts";

// The limits of "no one is shown whose hand is up": what the app
// does so that a hand cannot be tied to a person by watching the counts.
const tag = (): string => Math.random().toString(36).slice(2, 8);
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 600));

const open: Stream[] = [];
afterEach(() => {
  for (const stream of open.splice(0)) stream.close();
});

/** The "I'm lost" button on a page, or undefined. */
const handButton = (p: Page): HTMLButtonElement | undefined =>
  [...p.doc.querySelectorAll("button")].find((b) => /i'm lost/i.test(b.textContent ?? ""));

describe("privacy", () => {
  it("a hand stays in the room while its page is closed: a locked phone gives nobody away", async () => {
    const path = (await startSession(new Visitor(), `Grace ${tag()}`)).url.pathname;
    const watcher = new Visitor();
    const watching = await watcher.listen(await watcher.open(path));
    open.push(watching);

    const lost = new Visitor();
    const page = await lost.open(path);
    const theirs = await lost.listen(page);
    const button = handButton(page)!;
    await lost.submit(page, button.closest("form")!, button);
    await watching.until((board) => board.here === 2 && board.hands.length === 1);

    theirs.close();
    await settle();
    expect(watching.last?.here, "the count dropped the moment their page closed").toBe(2);
    expect(watching.last?.hands.length, "their hand went down with their page").toBe(1);
  });

  it("refuses a hand from the host, so no host hand reaches a count or the timeline", async () => {
    const host = new Visitor();
    const hall = await startSession(host, `Host hand ${tag()}`);
    const path = hall.url.pathname;
    const watcher = new Visitor();
    const watching = await watcher.listen(await watcher.open(path));
    open.push(watching);

    // the host's page has no button, so send the form a student's page has
    const student = await new Visitor().open(path);
    const button = handButton(student)!;
    const refused = await host.submit(student, button.closest("form")!, button);
    expect(refused.status).toBe(403);
    await settle();
    expect(watching.last?.hands.length ?? 0).toBe(0);
    const timeline = await new Visitor().open(`${path}/timeline`);
    expect(timeline.doc.querySelectorAll('[aria-label="The minutes most people were lost"] > li')).toHaveLength(0);
  });
});
