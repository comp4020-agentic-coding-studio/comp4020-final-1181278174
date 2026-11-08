import { JSDOM } from "jsdom";
import { afterEach, expect, it, vi } from "vitest";

// The hand's own script (src/scripts/hand.ts) when the stream overtakes a
// press's answer: the count follows the stream, and a hand the server never
// had does not stay up as somebody else's.
let dom: JSDOM | undefined;
afterEach(() => {
  dom?.window.close();
  vi.unstubAllGlobals();
  vi.resetModules();
});

/** A student's hall: one person here, no hand up, class on. */
function page(): string {
  const room = JSON.stringify({ here: 1, hands: [], mine: null, recent: [], startedAt: Date.now() });
  return `<!doctype html><body><main>
    <p data-lost data-room='${room}'>1 here. No hands up right now.</p>
    <form method="post" data-hand data-class="on">
      <input type="hidden" name="intent" value="hand" /><input type="hidden" name="up" value="1" />
      <button type="submit" aria-pressed="false">I'm lost</button><p data-hand-note></p>
    </form></main></body>`;
}

/** The page the server answers a press with: the room as it has it, and why, on a refusal. */
const answer = (room: { here: number; hands: number[]; mine: number | null }, alert = ""): string =>
  `<!doctype html><body>${alert ? `<p role="alert">${alert}</p>` : ""}<p data-lost data-room='${JSON.stringify(room)}'></p></body>`;

async function start(reply: () => Promise<Response>): Promise<JSDOM["window"]> {
  dom = new JSDOM(page(), { url: "http://localhost/s/ABCD" });
  const window = dom.window;
  for (const name of ["window", "document", "location", "HTMLElement", "HTMLFormElement", "HTMLButtonElement", "HTMLInputElement", "DOMParser", "Event", "CustomEvent", "FormData"] as const) {
    vi.stubGlobal(name, window[name]);
  }
  vi.stubGlobal("fetch", vi.fn().mockImplementation(reply));
  await import("../src/scripts/hand.ts");
  return window;
}

/** What the stream says: how many are here, and how long each hand has been up. */
function stream(window: JSDOM["window"], here: number, hands: number[]): void {
  window.document.dispatchEvent(new window.CustomEvent("hands-up:board", { detail: { here, hands, classState: "on" } }));
}

const count = (window: JSDOM["window"]): string => window.document.querySelector("[data-lost]")!.textContent!.trim();

it("drops the pressed hand when a refusal comes after the stream, so it is nobody else's either", async () => {
  let release!: (res: Response) => void;
  const window = await start(() => new Promise<Response>((resolve) => { release = resolve; }));
  window.document.querySelector("form")!.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(count(window)).toBe("1 of 1 here says they're lost"));
  // the stream overtakes the answer: the server has no hand yet
  stream(window, 1, []);
  release(new Response(answer({ here: 1, hands: [], mine: null }, "Too many in a row. Try again in 40 seconds."), { status: 429 }));
  await vi.waitFor(() => expect(count(window)).toBe("1 here. No hands up right now."));
});

it("keeps the stream's newer hands when the press got no answer and the check after it is older", async () => {
  let release!: (res: Response) => void;
  let calls = 0;
  const window = await start(() => {
    calls++;
    // the press itself gets no answer; the check that follows is slow
    if (calls === 1) return Promise.reject(new TypeError("no connection"));
    return new Promise<Response>((resolve) => { release = resolve; });
  });
  window.document.querySelector("form")!.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(calls).toBe(2));
  // three hands, this person's among them, then the check's older picture of one
  stream(window, 3, [100, 200, 300]);
  release(new Response(answer({ here: 1, hands: [100], mine: 100 }), { status: 200 }));
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(count(window)).toBe("3 of 3 here say they're lost");
});

it("counts this person's hand once when a slow answer comes after the stream confirmed it", async () => {
  let release!: (res: Response) => void;
  const window = await start(() => new Promise<Response>((resolve) => { release = resolve; }));
  window.document.querySelector("form")!.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(count(window)).toBe("1 of 1 here says they're lost"));
  // the stream confirms the hand at once; the answer was held up for four seconds
  stream(window, 1, [0]);
  release(new Response(answer({ here: 1, hands: [4000], mine: 4000 }), { status: 200 }));
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(count(window)).toBe("1 of 1 here says they're lost");
});
