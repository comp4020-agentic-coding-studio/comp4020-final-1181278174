import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";

// Run the real enhancement against a small projector document. Plain forms
// and private queue responses are exercised separately by tutorial.test.ts.
let dom: JSDOM | undefined;
let reload: ReturnType<typeof vi.fn>;
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
  onmessage: ((event: { data: string }) => void) | null = null;
  addEventListener = vi.fn();
  close = vi.fn(() => { this.readyState = Source.CLOSED; });

  constructor(readonly url: string) { Source.opened.push(this); }
}

const serverNow = Date.UTC(2026, 10, 9, 0, 0, 0);
const endsAt = serverNow + 5000;
const html = `<main data-live="/s/ABCD/events?screen">
  <p role="status" data-live-status hidden></p>
  <section aria-label="Current exercise" data-tutorial-timer data-ends-at="${endsAt}" data-server-now="${serverNow}">
    <h2 data-exercise-label>Graph traversal</h2><p data-exercise-note></p>
    <div data-exercise-clock><p role="timer" data-exercise-remaining>00:05</p>
      <p data-exercise-deadline><time datetime="${new Date(endsAt).toISOString()}">11:00</time></p>
    </div>
    <p role="status" data-exercise-expired hidden>Time to regroup. The tutor decides what happens next.</p>
  </section>
</main>`;

type Viewer = { mark?: string | null; room?: boolean; freshMark?: string | null };
function pageFor(mark: string | null, room: boolean, privateText: string): string {
  let content = html;
  if (room) content = content.replace("<main ", '<main data-tutorial-room data-revision="1" data-class="on" ')
    .replace("</main>", `<div data-tutorial-refresh="queue">${privateText}</div></main>`);
  return `<!doctype html><body${mark === null ? "" : ` data-signed-in="${mark}"`}>${content}</body>`;
}

async function start({ mark = null, room = false, freshMark = mark }: Viewer = {}): Promise<Source> {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance"] });
  // A wrong device clock must not change the shared deadline/countdown.
  vi.setSystemTime(new Date("2034-01-01T12:00:00Z"));
  Source.opened = [];
  dom = new JSDOM(pageFor(mark, room, "The first account's private queue"), { url: "http://localhost/s/ABCD/present" });
  const window = dom.window;
  // In a browser, window.setTimeout and unqualified clearTimeout share
  // handles. Give jsdom that same fake clock instead of its own timer map.
  window.setTimeout = globalThis.setTimeout as unknown as typeof window.setTimeout;
  window.clearTimeout = globalThis.clearTimeout as unknown as typeof window.clearTimeout;
  for (const name of ["window", "document", "HTMLElement", "DOMParser", "Event", "CustomEvent"] as const) {
    vi.stubGlobal(name, name === "window" ? window : window[name]);
  }
  reload = vi.fn();
  vi.stubGlobal("location", { href: window.location.href, pathname: window.location.pathname, reload });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(pageFor(freshMark, room, "Another account's private queue"))));
  Object.assign(window, { EventSource: Source });
  vi.stubGlobal("EventSource", Source);
  await import("../src/scripts/tutorial.ts");
  expect(Source.opened).toHaveLength(1);
  return Source.opened[0];
}

function send(source: Source, overrides: { label?: string | null; endsAt?: number | null; revision?: number; serverNow?: number } = {}): void {
  source.onmessage!({ data: JSON.stringify({
    tutorial: { label: "Graph traversal", endsAt, revision: 1, serverNow, ...overrides },
    classState: "on", questions: [],
  }) });
}

function element(selector: string): HTMLElement {
  return dom!.window.document.querySelector<HTMLElement>(selector)!;
}

function who(source: Source, mark: string): void {
  const call = source.addEventListener.mock.calls.find(([name]) => name === "who");
  expect(call, "the tutorial listens for main's private sign-in event").toBeDefined();
  (call![1] as (event: { data: string }) => void)({ data: mark });
}

describe("the tutorial's live timer", () => {
  it("counts the server's remaining time down to zero, announces regrouping once and keeps the deadline", async () => {
    const source = await start();
    source.readyState = Source.OPEN;
    source.onopen!();
    send(source);
    expect(element("[data-exercise-remaining]").textContent).toBe("00:05");
    expect(element("[data-exercise-expired]").hidden).toBe(true);
    const deadline = element("time").getAttribute("datetime");
    expect(deadline).toBe(new Date(endsAt).toISOString());

    const notices: string[] = [];
    const observer = new dom!.window.MutationObserver(() => {
      if (!element("[data-exercise-expired]").hidden) notices.push(element("[data-exercise-expired]").textContent!);
    });
    observer.observe(element("[data-exercise-expired]"), { attributes: true, childList: true, subtree: true });
    await vi.advanceTimersByTimeAsync(4000);
    expect(element("[data-exercise-remaining]").textContent).toBe("00:01");
    expect(element("[data-exercise-expired]").hidden).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(element("[data-exercise-remaining]").textContent).toBe("00:00");
    expect(element("[data-exercise-expired]").hidden).toBe(false);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(element("[data-exercise-remaining]").textContent).toBe("00:00");
    expect(element("time").getAttribute("datetime")).toBe(deadline);
    expect(notices).toEqual(["Time to regroup. The tutor decides what happens next."]);
    observer.disconnect();

    send(source, { label: null, endsAt: null, revision: 2, serverNow: serverNow + 15_000 });
    expect(element("[data-exercise-clock]").hidden).toBe(true);
    expect(element("[data-exercise-expired]").hidden).toBe(true);
  });

  it("clears the projector's stale warning when an unchanged exercise arrives after reconnecting", async () => {
    const source = await start();
    source.readyState = Source.OPEN;
    source.onopen!();
    send(source);
    expect(element("[data-live-status]").textContent).toBe("Live");
    source.readyState = Source.CONNECTING;
    source.onerror!();
    expect(element("[data-live-status]").textContent).toMatch(/reconnecting/i);
    source.readyState = Source.OPEN;
    source.onopen!();
    send(source);
    expect(element("[data-live-status]").textContent).toBe("Live");
    expect(Source.opened).toHaveLength(1);
  });

  it("schedules just one retry for duplicate errors from a closed stream", async () => {
    const source = await start();
    source.readyState = Source.CLOSED;
    source.onerror!();
    source.onerror!();
    await vi.advanceTimersByTimeAsync(1999);
    expect(Source.opened).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(Source.opened).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(Source.opened).toHaveLength(2);
  });

  it("closes the old stream on pagehide and opens one fresh stream when a cached page returns", async () => {
    const source = await start();
    // A pending retry must not open a second stream after leaving the page.
    source.readyState = Source.CLOSED;
    source.onerror!();
    dom!.window.dispatchEvent(new dom!.window.PageTransitionEvent("pagehide", { persisted: true }));
    expect(source.close).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(Source.opened).toHaveLength(1);
    dom!.window.dispatchEvent(new dom!.window.PageTransitionEvent("pageshow", { persisted: true }));
    expect(Source.opened).toHaveLength(2);
    const current = Source.opened[1];
    current.readyState = Source.OPEN;
    current.onopen!();
    send(current);
    expect(element("[data-live-status]").textContent).toBe("Live");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(Source.opened).toHaveLength(2);
  });

  it.each([null, "account-one"])("keeps the page when its who event matches its account marker %s", async (mark) => {
    const source = await start({ mark });
    who(source, mark ?? "-");
    expect(reload).not.toHaveBeenCalled();
  });

  it.each([
    { before: "account-one", after: "account-two" },
    { before: "account-one", after: "-" },
    { before: null, after: "account-two" },
  ])("reloads on a who change from $before to $after, including switching signed-in accounts", async ({ before, after }) => {
    const source = await start({ mark: before });
    who(source, after);
    expect(reload).toHaveBeenCalledTimes(1);
    // A state already in flight must not redraw controls after the identity change.
    send(source, { label: "Later state for another viewer", revision: 3 });
    expect(element("[data-exercise-label]").textContent).toBe("Graph traversal");
    who(source, after);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("reloads before adopting private queue HTML rendered for another signed-in account", async () => {
    const source = await start({ mark: "account-one", room: true, freshMark: "account-two" });
    send(source, { revision: 2 });
    await vi.advanceTimersByTimeAsync(0);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(element('[data-tutorial-refresh="queue"]').textContent).toBe("The first account's private queue");
  });
});
