import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it } from "vitest";
import { formWithButton, type Page, startSession, type Stream, Visitor } from "./visitor.ts";

// A class: the host starts it, hands go up only while it is on, ending it takes
// every hand down, and the timeline marks both. HAND is always open.
const tag = (): string => Math.random().toString(36).slice(2, 8);
const text = (el: Element | null | undefined): string => el?.textContent?.replace(/\s+/g, " ").trim() ?? "";
const streams: Stream[] = [];
afterEach(() => {
  for (const stream of streams.splice(0)) stream.close();
});

/** Send the hand form by hand; the status and what the page said. */
async function hand(who: Visitor, path: string, up: "1" | "0"): Promise<{ status: number; said: string }> {
  const response = await who.post(path, new URLSearchParams({ intent: "hand", up }));
  const doc = new JSDOM(await response.text()).window.document;
  return { status: response.status, said: [...doc.querySelectorAll('[role="alert"]')].map((p) => text(p)).join(" ") };
}

const note = (page: Page): string => text(page.doc.querySelector("[data-hand-note]"));
const handDisabled = (page: Page): boolean => page.doc.querySelector("form[data-hand] button")?.hasAttribute("disabled") ?? false;

async function hostPress(host: Visitor, path: string, name: RegExp): Promise<Page> {
  const page = await host.open(path);
  return host.submit(page, formWithButton(page, name));
}

describe("a class", () => {
  it("opens hands only once the host starts it, and says so before", async () => {
    const host = new Visitor();
    const path = (await startSession(host, `Not yet ${tag()}`, { started: false })).url.pathname;
    const student = new Visitor();
    const before = await student.open(path);
    expect(handDisabled(before)).toBe(true);
    expect(note(before)).toBe("The class hasn't started. Hands open when the host starts it.");
    const refused = await hand(student, path, "1");
    expect(refused.status).toBe(422);
    expect(refused.said).toContain("The class hasn't started.");

    await hostPress(host, path, /^start class$/i);
    expect(handDisabled(await student.open(path))).toBe(false);
    expect((await hand(student, path, "1")).status).toBe(303);
  });

  it("takes every hand down at the end, refuses new ones, and opens them again on a new start", async () => {
    const host = new Visitor();
    const path = (await startSession(host, `Ending ${tag()}`)).url.pathname;
    const [one, two] = [new Visitor(), new Visitor()];
    for (const who of [one, two]) expect((await hand(who, path, "1")).status).toBe(303);
    const watching = await host.listen(await host.open(path));
    streams.push(watching);
    await watching.until((board) => board.hands.length === 2 && board.classState === "on");

    const ended = await hostPress(host, path, /^end class$/i);
    expect(text(ended.doc.querySelector("#class-note"))).toMatch(/^Class ended at \d{2}:\d{2}\./);
    await watching.until((board) => board.hands.length === 0 && board.classState === "over");
    const after = await one.open(path);
    expect(handDisabled(after)).toBe(true);
    expect(note(after)).toBe("The class has ended.");
    const refused = await hand(two, path, "1");
    expect(refused.status).toBe(422);
    expect(refused.said).toContain("The class has ended.");

    // the timeline keeps both moments, in their own legend, apart from the numbered parts
    const timeline = await host.open(`${path}/timeline`);
    const moments = [...timeline.doc.querySelectorAll('ul[aria-label="Class"] > li')].map((li) => text(li));
    expect(moments).toHaveLength(2);
    expect(moments[0]).toMatch(/^▸ \d{2}:\d{2} Class started$/);
    expect(moments[1]).toMatch(/^■ \d{2}:\d{2} Class ended$/);
    expect(timeline.doc.querySelector('ol[aria-label="Chart marks"]')).toBeNull();

    // next week, the same code: started again, hands go up again
    await hostPress(host, path, /^start class$/i);
    await watching.until((board) => board.classState === "on");
    expect((await hand(two, path, "1")).status).toBe(303);
  });

  it("is started and ended by the host alone", async () => {
    const host = new Visitor();
    const path = (await startSession(host, `Host only ${tag()}`, { started: false })).url.pathname;
    const student = new Visitor();
    for (const intent of ["class-start", "class-end"]) {
      const refused = await student.post(path, new URLSearchParams({ intent }));
      expect(refused.status, intent).toBe(403);
      await refused.text();
    }
    expect(handDisabled(await student.open(path))).toBe(true);
    // a student's page offers neither control
    expect((await student.open(path)).doc.querySelector('input[name="intent"][value^="class-"]')).toBeNull();
  });

  it("tells the room on the projector when hands are closed, and why", async () => {
    const host = new Visitor();
    const path = (await startSession(host, `Projector ${tag()}`, { started: false })).url.pathname;
    const screen = new Visitor({ signedOut: true });
    const classNote = (page: Page): Element | null => page.doc.querySelector("[data-class-note]");
    const silence = (page: Page): boolean => page.doc.querySelector("[data-silence]")?.hasAttribute("hidden") ?? true;

    const before = await screen.open(`${path}/present`);
    expect(classNote(before)?.hasAttribute("hidden")).toBe(false);
    expect(text(classNote(before))).toBe("The class hasn't started. Hands open when the host starts it.");
    expect(silence(before), "silence means nothing while hands are closed").toBe(true);

    await hostPress(host, path, /^start class$/i);
    const on = await screen.open(`${path}/present`);
    expect(classNote(on)?.hasAttribute("hidden")).toBe(true);
    expect(silence(on)).toBe(false);

    await hostPress(host, path, /^end class$/i);
    expect(text(classNote(await screen.open(`${path}/present`)))).toBe("The class has ended.");
  });

  it("leaves HAND open, with no class to start", async () => {
    const student = new Visitor();
    const page = await student.open("/s/HAND");
    expect(handDisabled(page)).toBe(false);
    expect((await hand(student, "/s/HAND", "1")).status).toBe(303);
    expect((await hand(student, "/s/HAND", "0")).status).toBe(303);
  });
});
