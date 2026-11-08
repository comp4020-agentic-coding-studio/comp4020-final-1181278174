import { JSDOM } from "jsdom";
import { afterEach, expect, it, vi } from "vitest";

// The page's own script (src/scripts/live.ts) when this browser's sign-in
// changes in another tab or on another device, and the host's reported line,
// in a stand-in page with a stand-in stream.
let dom: JSDOM | undefined;
afterEach(() => {
  dom?.window.close();
  vi.unstubAllGlobals();
  vi.resetModules();
});

class Source {
  static opened: Source[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  addEventListener = vi.fn();
  close = vi.fn();

  constructor(readonly url: string) {
    Source.opened.push(this);
  }
}

const KEPT = "hands-up:kept-question:/s/ABCD/questions";
const board = '<div data-board><ol></ol></div>';
const asking = '<form data-ask method="post"><textarea name="body">Why does that term disappear?</textarea></form>';
const reported = '<div data-board><p class="notice" role="status" data-reported>1 question has been reported. <a href="/s/ABCD/questions#q-1">Show it</a></p><ol></ol></div>';

/** A questions page made for the account marked `mark`, or signed out (null). */
const page = (mark: string | null, inner: string): string =>
  `<!doctype html><body${mark === null ? "" : ` data-signed-in="${mark}"`}><main data-live="/s/ABCD/events"><p data-live-status></p>${inner}</main></body>`;

/** Load `html` with the script; the page fetched again will be `next`. */
async function start(html: string, next: string, kept?: string): Promise<{ window: JSDOM["window"]; reload: ReturnType<typeof vi.fn> }> {
  Source.opened = [];
  dom = new JSDOM(html, { url: "http://localhost/s/ABCD/questions" });
  const window = dom.window;
  for (const name of ["window", "document", "HTMLElement", "HTMLButtonElement", "DOMParser", "Event", "CustomEvent", "sessionStorage"] as const) {
    vi.stubGlobal(name, window[name]);
  }
  const reload = vi.fn();
  vi.stubGlobal("location", { href: window.location.href, pathname: window.location.pathname, reload });
  window.matchMedia = vi.fn().mockReturnValue({ matches: true });
  if (kept) window.sessionStorage.setItem(KEPT, kept);
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response(next)));
  Object.assign(window, { EventSource: Source });
  vi.stubGlobal("EventSource", Source);
  await import("../src/scripts/live.ts");
  return { window, reload };
}

/** The stream tells the page to fetch itself again, as it does after a report. */
function nudge(): void {
  const call = Source.opened.at(-1)!.addEventListener.mock.calls.find(([name]) => name === "refresh");
  (call![1] as () => void)();
}

it("loads again when this browser is signed in as someone else, keeping a half-written question for the tab", async () => {
  const { window, reload } = await start(page("one", asking + board), page("two", asking + board));
  nudge();
  await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  expect(window.sessionStorage.getItem(KEPT)).toBe("Why does that term disappear?");
});

it("loads again when this browser was signed out, at once, so nothing only the host may see stays on screen", async () => {
  const { window, reload } = await start(page("one", reported), page(null, board));
  nudge();
  await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  expect(window.sessionStorage.getItem(KEPT)).toBeNull();
});

it("after that load, shows the question that wasn't sent, to copy, once", async () => {
  const { window } = await start(page(null, board), page(null, board), "Why does that term disappear?");
  const words = window.document.querySelector<HTMLTextAreaElement>("[data-kept-question] textarea");
  expect(words?.value).toBe("Why does that term disappear?");
  expect(words?.readOnly).toBe(true);
  expect(window.sessionStorage.getItem(KEPT)).toBeNull();
});

it("takes the host's reported line away when the fresh page has none, and keeps keyboard feedback apart from it", async () => {
  const { window, reload } = await start(page("one", reported), page("one", board));
  const focus = window.document.querySelector("[data-focus-status]");
  expect(focus).not.toBeNull();
  expect(focus!.closest("[data-board]")).toBeNull();
  nudge();
  await vi.waitFor(() => expect(window.document.querySelector("[data-reported]")).toBeNull());
  expect(reload).not.toHaveBeenCalled();
});

it("adds the reported line when a report arrives on a page that had none", async () => {
  const { window } = await start(page("one", board), page("one", reported));
  nudge();
  await vi.waitFor(() => expect(window.document.querySelector("[data-reported] a")?.getAttribute("href")).toBe("/s/ABCD/questions#q-1"));
});
