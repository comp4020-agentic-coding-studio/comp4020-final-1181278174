import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";

// The teaching workspace's lists share the existing live script. Changes
// must move a card between lists once, without losing the keyboard user.
let dom: JSDOM | undefined;
afterEach(() => {
  dom?.window.close();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
});

type Question = { id: number; state: "open" | "answered" | "hidden" };
class Source {
  static OPEN = 1;
  static CLOSED = 2;
  static current: Source;
  readyState = Source.OPEN;
  onopen: (() => void) | null = null;
  onmessage: ((message: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  addEventListener = vi.fn();
  constructor() { Source.current = this; }
}
const card = (q: Question): string => `<li id="q-${q.id}" data-state="${q.state}"><p>Question ${q.id}</p>
  <form method="post"><input type="hidden" name="intent" value="state"><input type="hidden" name="question" value="${q.id}">
  <button name="to" value="${q.state === "open" ? "answered" : "open"}">${q.state === "open" ? "Answered" : q.state === "answered" ? "Not answered" : "Show again"}</button></form></li>`;
function html(wanted: Question[], more: Question[], answered: Question[], hidden: Question[]): string {
  return `<main data-live="/s/ABCD/events"><p data-live-status></p><div data-board data-refresh data-grouped>
    <p data-empty ${wanted.length + more.length > 0 ? "hidden" : ""}>No open questions.</p>
    <p data-board-label="unanswered">${wanted.length + more.length} unanswered</p>
    <ol data-question-list="wanted">${wanted.map(card).join("")}</ol>
    <details data-question-group="more"><summary data-board-label="more">More (${more.length})</summary><ol data-question-list="more">${more.map(card).join("")}</ol></details>
    <details data-question-group="answered"><summary data-board-label="answered">Answered (${answered.length})</summary><ol data-question-list="answered">${answered.map(card).join("")}</ol></details>
    <details data-question-group="hidden"><summary data-board-label="hidden">Hidden (${hidden.length})</summary><ol data-question-list="hidden">${hidden.map(card).join("")}</ol></details>
    </div></main>`;
}
async function start(initial: string, next: string): Promise<Document> {
  vi.useFakeTimers();
  dom = new JSDOM(initial, { url: "http://localhost/s/ABCD/teach" });
  const window = dom.window;
  for (const name of ["window", "document", "location", "HTMLElement", "HTMLButtonElement", "HTMLFormElement", "DOMParser", "Event", "CustomEvent"] as const) {
    vi.stubGlobal(name, name === "window" ? window : window[name]);
  }
  window.matchMedia = vi.fn().mockReturnValue({ matches: true });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(next)));
  Object.assign(window, { EventSource: Source });
  vi.stubGlobal("EventSource", Source);
  await import("../src/scripts/live.ts");
  Source.current.onopen!();
  return window.document;
}
async function changed(questions: [number, number, "open" | "answered"][]): Promise<void> {
  Source.current.onmessage!({ data: JSON.stringify({ here: 4, hands: [], questions, goingOver: null, classState: "on" }) });
  await vi.advanceTimersByTimeAsync(0);
}
const ids = (document: Document, group: string): string[] => [...document.querySelectorAll(`[data-question-list="${group}"] > li`)].map(li => li.id);
describe("live questions in the lecturer workspace", () => {
  it("moves cards between wanted, more and answered once, keeping the focused question reachable", async () => {
    const initial = html([{ id: 1, state: "open" }], [{ id: 2, state: "open" }], [], []);
    const next = html([{ id: 2, state: "open" }], [], [{ id: 1, state: "answered" }], []);
    const document = await start(initial, next);
    const first = document.getElementById("q-1");
    const second = document.getElementById("q-2");
    first!.querySelector("button")!.focus();
    await changed([[2, 0, "open"], [1, 0, "answered"]]);
    expect(ids(document, "wanted")).toEqual(["q-2"]);
    expect(ids(document, "more")).toEqual([]);
    expect(ids(document, "answered")).toEqual(["q-1"]);
    expect(document.querySelectorAll("#q-1")).toHaveLength(1);
    expect(document.querySelectorAll("#q-2")).toHaveLength(1);
    expect(document.getElementById("q-1")).toBe(first);
    expect(document.getElementById("q-2")).toBe(second);
    expect(document.activeElement?.closest("li")?.id).toBe("q-1");
    expect(document.activeElement?.closest("details")?.open).toBe(true);
    expect(document.querySelector('[data-board-label="answered"]')?.textContent).toBe("Answered (1)");
  });

  it("shows the open-question empty message even while hidden questions remain available to the host", async () => {
    const document = await start(html([{ id: 1, state: "open" }], [], [], []), html([], [], [], [{ id: 1, state: "hidden" }]));
    await changed([]);
    expect(ids(document, "wanted")).toEqual([]);
    expect(ids(document, "hidden")).toEqual(["q-1"]);
    expect(document.querySelector<HTMLElement>("[data-empty]")?.hidden).toBe(false);
    expect(document.querySelector('[data-board-label="unanswered"]')?.textContent).toBe("0 unanswered");
    expect(document.querySelector('#q-1 button')?.textContent).toBe("Show again");
  });
});
