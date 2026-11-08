import { describe, expect, it } from "vitest";
import { ask, fill, formWithButton, type Page, startSession, Visitor } from "./visitor.ts";

// "At your next pause": the host's card on the hall. A lecturer can't watch a
// number while they talk, so the card keeps the part so far for when they
// pause: the minute with the most hands up, out of how many were here, and the
// question the room most wants answered.
const tag = (): string => Math.random().toString(36).slice(2, 8);
const text = (el: Element | null | undefined): string => el?.textContent?.replace(/\s+/g, " ").trim() ?? "";
const card = (page: Page): Element | null => page.doc.querySelector("[data-checkpoint]");
const shown = (page: Page): boolean => card(page) !== null && !card(page)!.hasAttribute("hidden");
/** The card's heading and lines, kept apart: the page's HTML has no space between them. */
const lines = (page: Page): string => [...(card(page)?.children ?? [])].map((el) => text(el)).join(" ");

async function press(who: Visitor, path: string, name: RegExp): Promise<Page> {
  const page = await who.open(path);
  return who.submit(page, formWithButton(page, name));
}

async function hand(who: Visitor, path: string, up: "1" | "0"): Promise<void> {
  const res = await who.post(path, new URLSearchParams({ intent: "hand", up }));
  expect(res.status).toBe(303);
  await res.text();
}

describe("At your next pause", () => {
  it("is on the host's hall alone, and only while a class is on", async () => {
    const host = new Visitor();
    const path = (await startSession(host, `Pause ${tag()}`, { started: false })).url.pathname;
    const student = new Visitor();
    expect(shown(await host.open(path))).toBe(false);

    await press(host, path, /^start class$/i);
    const on = await host.open(path);
    expect(shown(on)).toBe(true);
    expect(lines(on)).toMatch(
      /^At your next pause Since the class started at \d\d:\d\d\. No one has said they were lost in this part\. That doesn't mean everyone follows\.$/,
    );
    expect(card(await student.open(path)), "a student is shown the host's card").toBeNull();

    await press(host, path, /^end class$/i);
    expect(shown(await host.open(path))).toBe(false);
  });

  it("names the part, its minute with the most hands up out of how many were here, and the most wanted question", async () => {
    const host = new Visitor();
    const path = (await startSession(host, `Pause ${tag()}`)).url.pathname;
    const label = `Proofs ${tag()}`;
    const page = await host.open(path);
    const form = formWithButton(page, /^mark$/i);
    fill(form, label);
    expect((await host.submit(page, form)).status).toBe(200);

    const [one, two] = [new Visitor(), new Visitor()];
    await hand(one, path, "1");
    await hand(two, path, "1");
    // a hand that has come down still counts in the minute it was up
    await hand(two, path, "0");
    const body = `Why does that term disappear ${tag()}?`;
    await ask(new Visitor(), `${path}/questions`, body);

    const said = lines(await host.open(path));
    expect(said).toContain(`${label}, since `);
    expect(said).toMatch(/At \d\d:\d\d, 2 of 2 here said they were lost: the most in this part\./);
    expect(said).toContain(`Most wanted: “${body}” · 0 Me too`);
  });
});

describe("The class that ended", () => {
  it("shows the host its minutes with the most hands up and the questions left open, until the next class starts", async () => {
    const host = new Visitor();
    const path = (await startSession(host, `Recap ${tag()}`)).url.pathname;
    await hand(new Visitor(), path, "1");
    await ask(new Visitor(), `${path}/questions`, `Left open ${tag()}?`);
    await press(host, path, /^end class$/i);

    const recap = (await host.open(path)).doc.querySelector("[data-recap]");
    expect(recap, "the host has no recap after End class").not.toBeNull();
    const minutes = [...recap!.querySelectorAll("ol > li")].map((li) => text(li));
    expect(minutes).toHaveLength(1);
    expect(minutes[0]).toMatch(/^\d\d:\d\d 1 of 1 said they were lost/);
    expect(text(recap)).toContain("1 question left open.");
    expect((await new Visitor().open(path)).doc.querySelector("[data-recap]"), "a student is shown the host's recap").toBeNull();

    await press(host, path, /^start class$/i);
    expect((await host.open(path)).doc.querySelector("[data-recap]")).toBeNull();
  });
});
