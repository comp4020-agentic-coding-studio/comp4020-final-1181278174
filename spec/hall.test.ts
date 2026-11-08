import { afterEach, describe, expect, it } from "vitest";
import { type Page, startSession, type Stream, Visitor } from "./visitor.ts";

// The final version: "I'm lost" is a hand anyone can raise with one press and
// no words, and the whole room sees how many are up. These read the pages and
// the stream over HTTP. The 3D hall, and a hand coming down by itself after its
// 3 minutes, are checked by hand in a browser.
const tag = (): string => Math.random().toString(36).slice(2, 8);

// longer than the server takes to gather changes into one event
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 400));

const open: Stream[] = [];
afterEach(() => {
  for (const stream of open.splice(0)) stream.close();
});

/** The "I'm lost" button on a page. */
function handButton(p: Page): HTMLButtonElement {
  const button = [...p.doc.querySelectorAll("button")].find((b) => /i'm lost/i.test(b.textContent ?? ""));
  if (!button) throw new Error(`no "I'm lost" button on ${p.url.pathname}`);
  return button;
}

/** Press "I'm lost" as it is on the page now: up if it is down, down if it is up. */
async function press(who: Visitor, path: string): Promise<Page> {
  const page = await who.open(path);
  const button = handButton(page);
  return who.submit(page, button.closest("form")!, button);
}

/** A new session, and someone with it open, so they count as here. */
async function hall(): Promise<{ path: string; watcher: Visitor; stream: Stream }> {
  const path = (await startSession(new Visitor(), `Hall ${tag()}`)).url.pathname;
  return { path, ...(await here(path)) };
}

/** Someone who has the session open, with its stream. */
async function here(path: string): Promise<{ watcher: Visitor; stream: Stream }> {
  const watcher = new Visitor();
  const stream = await watcher.listen(await watcher.open(path));
  open.push(stream);
  expect(stream.status).toBe(200);
  return { watcher, stream };
}

describe("the hall", () => {
  it("raises a hand with one press, and asks for no words", async () => {
    const { path, watcher } = await hall();
    const form = handButton(await watcher.open(path)).closest("form")!;
    expect(form.querySelector("textarea, input:not([type='hidden'])"), "the hand's form asks for words").toBeNull();

    const after = await press(watcher, path);
    expect(after.status).toBe(200);
    expect(handButton(after).getAttribute("aria-pressed")).toBe("true");
    expect(after.doc.body.textContent).toContain("1 of 1 here is lost");
  });

  it("shows a raised hand on another open page within a second", async () => {
    const { path, stream } = await hall();
    const { watcher: lost } = await here(path);
    await stream.until((board) => board.here === 2 && board.hands.length === 0);

    const pressed = Date.now();
    await press(lost, path);
    const sent = await stream.until((board) => board.hands.length === 1);
    expect(sent.at - pressed).toBeLessThan(1000);

    await press(lost, path);
    await stream.until((board) => board.hands.length === 0);
  });

  it("sends how many hands are up and for how long, never whose", async () => {
    const { path, watcher, stream } = await hall();
    const { watcher: lost } = await here(path);
    await press(lost, path);
    const { board } = await stream.until((b) => b.hands.length === 1);

    expect(Object.keys(board).sort()).toEqual(["hands", "here", "questions"]);
    for (const ms of board.hands) expect(typeof ms).toBe("number");
    for (const secret of lost.secrets) {
      expect(stream.raw).not.toContain(secret);
      expect((await watcher.open(path)).html).not.toContain(secret);
    }
  });

  it("counts one hand for two presses sent at once", async () => {
    const { path, stream } = await hall();
    const { watcher: lost } = await here(path);
    const page = await lost.open(path);
    const button = handButton(page);
    await Promise.all([lost.submit(page, button.closest("form")!, button), lost.submit(page, button.closest("form")!, button)]);

    await stream.until((board) => board.hands.length === 1);
    await settle();
    expect(stream.last?.hands.length).toBe(1);
  });

  it("tells the person whose hand is up when it comes down by itself, 3 minutes on", async () => {
    const { path, watcher } = await hall();
    const pressed = Date.now();
    const after = await press(watcher, path);
    const clock = (ms: number): string =>
      new Date(ms).toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Australia/Sydney" });
    const text = after.doc.body.textContent ?? "";
    const said = [clock(pressed + 179_000), clock(pressed + 182_000)].some((time) => text.includes(`comes down by itself at ${time}`));
    expect(said, `the page does not say when the hand comes down: ${handButton(after).closest("form")?.textContent}`).toBe(true);
  });
});
