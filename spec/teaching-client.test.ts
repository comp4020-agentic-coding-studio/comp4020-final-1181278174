import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";

let dom: JSDOM | undefined;
afterEach(() => {
  dom?.window.close();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
});
const now = Date.parse("2026-11-09T00:00:00Z");
const lesson = now - 5 * 60_000;
const page = (state = "on", recording = "10:55", checked = 0, hands = 1, here = 8): string => `
  <a data-class-summary-link ${state === "over" ? "" : "hidden"} href="#class-summary">The class that ended</a>
  <main data-teaching data-session="ABCD" data-lesson="${lesson}" data-class-state="${state}" data-checked-at="${checked}">
    <p data-room='${JSON.stringify({ hands: Array(hands).fill(0), here })}'></p>
    <form method="post" data-teaching-check><p data-check-difference></p><button>Checked now</button></form>
    <div data-teaching-refresh="class"><form><input type="hidden" name="intent" value="${state === "on" ? "class-end" : "class-start"}"><button>${state === "on" ? "End class" : "Start class"}</button></form></div>
    <div data-teaching-refresh="summary">${state === "over" ? "The class that ended" : ""}</div>
    <div data-teaching-refresh="recording"><p>${recording}</p><label for="recording-at">Recording time</label><input type="time" id="recording-at" value="${recording}"></div>
  </main>`;
async function start(): Promise<Document> {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  dom = new JSDOM(page(), { url: "http://localhost/s/ABCD/teach" });
  const window = dom.window;
  for (const name of ["window", "document", "location", "sessionStorage", "HTMLElement", "HTMLInputElement", "DOMParser", "Event", "CustomEvent"] as const) {
    vi.stubGlobal(name, name === "window" ? window : window[name]);
  }
  await import("../src/scripts/teaching.ts");
  return window.document;
}
function adopt(html: string): void {
  const fresh = new dom!.window.DOMParser().parseFromString(html, "text/html");
  dom!.window.document.dispatchEvent(new dom!.window.CustomEvent("hands-up:page", { detail: fresh }));
}

describe("the lecturer workspace's optional live enhancement", () => {
  it("remembers a check only after its POST is confirmed and compares subsequent counts with that response", async () => {
    const document = await start();
    let confirm!: (response: Response) => void;
    const request = vi.fn((_url: string, _options: RequestInit) => new Promise<Response>(resolve => { confirm = resolve; }));
    vi.stubGlobal("fetch", request);
    document.querySelector("form[data-teaching-check]")!.dispatchEvent(new dom!.window.Event("submit", { bubbles: true, cancelable: true }));
    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0]?.[1]).toMatchObject({ method: "POST" });
    expect(dom!.window.sessionStorage.length).toBe(0);
    document.dispatchEvent(new dom!.window.CustomEvent("hands-up:board", { detail: { hands: [0, 0, 0], here: 10, classState: "on" } }));
    confirm(new Response(page("on", "10:55", now, 2, 9)));
    await vi.advanceTimersByTimeAsync(0);
    expect(document.querySelector("[data-check-difference]")?.textContent).toContain("1 more hand since you checked");
    expect(document.querySelector("[data-check-difference]")?.textContent).toContain("(2 of 9 then)");
    expect(JSON.parse(dom!.window.sessionStorage.getItem(`hands-up:checked:ABCD:${lesson}`)!)).toEqual({ lost: 2, here: 9, at: now });
    expect(document.querySelector("form[data-teaching-check]")?.hasAttribute("aria-busy")).toBe(false);
  });

  it("refreshes class controls and summary navigation even while the class button has keyboard focus", async () => {
    const document = await start();
    document.querySelector<HTMLButtonElement>('[data-teaching-refresh="class"] button')!.focus();
    adopt(page("over"));
    expect(document.querySelector<HTMLElement>("[data-class-summary-link]")?.hidden).toBe(false);
    expect(document.querySelector<HTMLInputElement>('[data-teaching-refresh="class"] input')?.value).toBe("class-start");
    expect(document.activeElement?.textContent).toBe("Start class");
    expect(document.querySelector('[data-teaching-refresh="summary"]')?.textContent).toBe("The class that ended");
  });

  it("accepts an external recording correction while preserving an unsaved local correction", async () => {
    const document = await start();
    adopt(page("on", "10:50"));
    const field = document.querySelector<HTMLInputElement>("#recording-at")!;
    expect(field.value).toBe("10:50");
    field.value = "10:45";
    adopt(page("on", "10:40"));
    expect(document.querySelector<HTMLInputElement>("#recording-at")?.value).toBe("10:45");
    expect(document.querySelector<HTMLInputElement>("#recording-at")?.defaultValue).toBe("10:50");
  });
});
