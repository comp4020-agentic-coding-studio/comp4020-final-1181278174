import { afterEach, describe, expect, it } from "vitest";
import { ask, hostPress, meToo, type Page, questions, questionsPath, startSession, type Stream, Visitor } from "./visitor.ts";

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
    expect(after.doc.body.textContent).toContain("1 of 1 here says they're lost");
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

describe("the two parts of a session", () => {
  it("the hall shows the three open questions with the most Me too, and takes Me too there", async () => {
    const host = new Visitor();
    const hallPage = await startSession(host, `Wanted ${tag()}`);
    const asking = questionsPath(hallPage);
    const t = tag();
    const [a, b, c, d, e] = ["a", "b", "c", "d", "e"].map((n) => `Question ${n} ${t}`);
    const vote = async (body: string, times: number): Promise<void> => {
      for (let i = 0; i < times; i++) await meToo(new Visitor(), asking, body);
    };
    const wanted = async (): Promise<string[]> =>
      questions(await new Visitor().open(hallPage.url.pathname), "Most wanted").map(
        (q) => [a, b, c, d, e].find((body) => q.text.includes(body)) ?? q.text,
      );

    for (const body of [a, b, c]) await ask(new Visitor(), asking, body);
    await vote(b, 1);
    await vote(c, 2);
    // an answered question is no longer wanted, however many votes it has
    await hostPress(host, asking, c, /^answered/i);
    expect(await wanted()).toEqual([b, a]);

    // only the top three
    for (const body of [d, e]) await ask(new Visitor(), asking, body);
    await vote(e, 3);
    expect(await wanted()).toEqual([e, b, a]);

    const guest = new Visitor();
    const page = await guest.open(hallPage.url.pathname);
    const first = questions(page, "Most wanted").find((q) => q.text.includes(a))!;
    const after = await guest.submit(page, first.meToo.closest("form")!, first.meToo);
    expect(after.url.pathname).toBe(hallPage.url.pathname);
    const voted = questions(after, "Most wanted").find((q) => q.text.includes(a))!;
    expect(voted.pressed).toBe(true);
    expect(voted.votes).toBe(1);
  });

  it("each part has a tab for the other, and says which one it is", async () => {
    const hallPage = await startSession(new Visitor(), `Parts ${tag()}`);
    const guest = new Visitor();
    const tabs = (p: Page): HTMLAnchorElement[] => [...p.doc.querySelectorAll<HTMLAnchorElement>('[aria-label="Parts of the session"] a')];

    const fromHall = tabs(await guest.open(hallPage.url.pathname));
    expect(fromHall.map((a) => a.getAttribute("aria-current"))).toEqual(["page", null]);
    const questionsPage = await guest.open(new URL(fromHall[1].getAttribute("href")!, hallPage.url));
    expect(questionsPage.url.pathname).toBe(questionsPath(hallPage));
    expect(questions(questionsPage)).toEqual([]);

    const fromQuestions = tabs(questionsPage);
    expect(fromQuestions.map((a) => a.getAttribute("aria-current"))).toEqual([null, "page"]);
    expect(new URL(fromQuestions[0].getAttribute("href")!, questionsPage.url).pathname).toBe(hallPage.url.pathname);
  });
});

describe("the host and the empty hall", () => {
  it("the host teaches: no hand on their hall, and not counted among those here", async () => {
    const host = new Visitor();
    const hallPage = await startSession(host, `Host ${tag()}`);
    const path = hallPage.url.pathname;
    const own = await host.open(path);
    expect([...own.doc.querySelectorAll("button")].some((b) => /i'm lost/i.test(b.textContent ?? "")), "the host has a hand").toBe(false);

    const hostStream = await host.listen(own);
    open.push(hostStream);
    await here(path);
    await hostStream.until((board) => board.here === 1);
    await settle();
    expect(hostStream.last?.here, "the host was counted").toBe(1);
  });

  it("with no hand up, says so and that silence is not understanding", async () => {
    const { path, watcher } = await hall();
    const text = (await watcher.open(path)).doc.body.textContent ?? "";
    expect(text).toContain("No hands up right now");
    expect(text).toContain("doesn't mean everyone follows");
  });

  it("the host can mark one of the most wanted answered from the hall", async () => {
    const host = new Visitor();
    const hallPage = await startSession(host, `Answered ${tag()}`);
    const body = `Answer me ${tag()}`;
    await ask(new Visitor(), questionsPath(hallPage), body);
    const page = await host.open(hallPage.url.pathname);
    const card = questions(page, "Most wanted").find((q) => q.text.includes(body))!;
    const answered = card.button(/^answered/i);
    expect(answered, "no Answered button on the host's hall").toBeDefined();
    const after = await host.submit(page, answered!.closest("form")!, answered);
    expect(after.url.pathname).toBe(hallPage.url.pathname);
    expect(questions(after, "Most wanted").some((q) => q.text.includes(body))).toBe(false);
  });
});
