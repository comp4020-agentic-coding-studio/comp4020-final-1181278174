import { JSDOM } from "jsdom";
import { afterEach, expect, it, vi } from "vitest";

// The page's own script (src/scripts/live.ts) with a stand-in EventSource and a
// fake clock: how long it waits before opening the stream again.
let dom: JSDOM | undefined;
afterEach(() => {
  dom?.window.close();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
});

class Source {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  static opened: Source[] = [];
  readyState = Source.CONNECTING;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  addEventListener = vi.fn();
  close = vi.fn();

  constructor(readonly url: string) {
    Source.opened.push(this);
  }
}

const hall = '<main data-live="/s/ABCD/events"><p data-live-status></p><div data-board><ol></ol></div></main>';
const timeline = '<main class="timeline" data-live="/s/ABCD/events"><p data-live-status></p><div data-sittings></div></main>';

async function start(html = hall, script: "live" | "timeline" = "live"): Promise<void> {
  vi.useFakeTimers();
  Source.opened = [];
  dom = new JSDOM(html, { url: "http://localhost/s/ABCD" });
  const window = dom.window;
  for (const name of ["window", "document", "location", "HTMLElement", "DOMParser"] as const) {
    vi.stubGlobal(name, name === "window" ? window : window[name]);
  }
  window.matchMedia = vi.fn().mockReturnValue({ matches: true });
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response(html)));
  Object.assign(window, { EventSource: Source });
  vi.stubGlobal("EventSource", Source);
  await (script === "live" ? import("../src/scripts/live.ts") : import("../src/scripts/timeline.ts"));
  expect(Source.opened).toHaveLength(1);
}

/** The stream ends on an error page: the next one opens after exactly `ms`. */
async function failsThenReopensAfter(ms: number): Promise<void> {
  const current = Source.opened.at(-1)!;
  const before = Source.opened.length;
  current.readyState = Source.CLOSED;
  current.onerror!();
  // a second error from the same stream schedules nothing more
  current.onerror!();
  await vi.advanceTimersByTimeAsync(ms - 1);
  expect(Source.opened, `opened before ${ms} ms`).toHaveLength(before);
  await vi.advanceTimersByTimeAsync(1);
  expect(Source.opened, `not opened at ${ms} ms`).toHaveLength(before + 1);
}

it("leaves a dropped connection to the browser, which tries again by itself", async () => {
  await start();
  const source = Source.opened[0];
  source.readyState = Source.CONNECTING;
  source.onerror!();
  await vi.advanceTimersByTimeAsync(120_000);
  expect(Source.opened).toHaveLength(1);
  expect(source.close).not.toHaveBeenCalled();
});

it("after an error page waits 2 s, then twice as long each time up to a minute, and starts over once open", async () => {
  await start();
  // a redeploy is over in seconds; a refused page knocks about once a minute
  for (const ms of [2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000]) await failsThenReopensAfter(ms);
  Source.opened.at(-1)!.onopen!();
  await failsThenReopensAfter(2_000);
});

it("waits the same way on the timeline", async () => {
  await start(timeline, "timeline");
  for (const ms of [2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000]) await failsThenReopensAfter(ms);
  Source.opened.at(-1)!.onopen!();
  await failsThenReopensAfter(2_000);
});
