import { afterEach, describe, expect, it } from "vitest";
import { fill, formWithButton, type Page, startSession, type Stream, Visitor } from "./visitor.ts";

// The hall's record: how many hands were up in each minute, out of how many
// people. These read the timeline page over HTTP. That it is still there after
// a restart is checked by hand after a deploy.
const tag = (): string => Math.random().toString(36).slice(2, 8);

const open: Stream[] = [];
afterEach(() => {
  for (const stream of open.splice(0)) stream.close();
});

const clock = (ms: number): string =>
  new Date(ms).toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Australia/Sydney" });

/** Someone with the session open: they count as here. */
async function here(path: string): Promise<Visitor> {
  const who = new Visitor();
  const stream = await who.listen(await who.open(path));
  open.push(stream);
  await stream.until((board) => board.here >= 1);
  return who;
}

/** Press "I'm lost" as it is on the hall now. */
async function press(who: Visitor, path: string): Promise<Page> {
  const page = await who.open(path);
  const button = [...page.doc.querySelectorAll("button")].find((b) => /i'm lost/i.test(b.textContent ?? ""))!;
  return who.submit(page, button.closest("form")!, button);
}

/** The timeline, found the way a person finds it: by the link on the hall. */
async function timeline(who: Visitor, path: string): Promise<Page> {
  const hall = await who.open(path);
  const link = [...hall.doc.querySelectorAll("a")].find((a) => /when the room was lost/i.test(a.textContent ?? ""));
  expect(link, "no link to the timeline on the hall").toBeDefined();
  return who.open(new URL(link!.getAttribute("href")!, hall.url));
}

/** The minutes listed as the ones most people were lost, as their text. */
const busiest = (p: Page): string[] =>
  [...p.doc.querySelectorAll('[aria-label="The minutes most people were lost"] > li')].map((li) => li.textContent?.replace(/\s+/g, " ").trim() ?? "");

describe("the timeline", () => {
  it("keeps a hand that came down, as how many were lost that minute, out of how many were here", async () => {
    const path = (await startSession(new Visitor(), `Record ${tag()}`)).url.pathname;
    await here(path);
    const lost = await here(path);
    const pressed = Date.now();
    await press(lost, path);
    await press(lost, path);

    const page = await timeline(new Visitor(), path);
    expect(page.status).toBe(200);
    const minutes = [clock(pressed), clock(pressed + 2000)];
    expect(busiest(page).some((line) => minutes.some((m) => line === `${m} 1 of 2 lost`)), `busiest: ${busiest(page).join(" | ")}`).toBe(true);
  });

  it("names nobody: not who was lost, not who was here", async () => {
    const path = (await startSession(new Visitor(), `Record ${tag()}`)).url.pathname;
    const lost = await here(path);
    await press(lost, path);
    const page = await timeline(new Visitor(), path);
    for (const secret of lost.secrets) expect(page.html).not.toContain(secret);
  });

  it("says when nobody has had the session open", async () => {
    const host = new Visitor();
    const path = (await startSession(host, `Record ${tag()}`)).url.pathname;
    const page = await timeline(new Visitor(), path);
    expect(page.doc.body.textContent).toMatch(/nobody has had this session open yet/i);
  });
});

describe("the host's marks and the recording", () => {
  it("only the host can mark a new part, and the minutes after it say which part they were in", async () => {
    const host = new Visitor();
    const hall = await startSession(host, `Marks ${tag()}`);
    const path = hall.url.pathname;
    const part = `Part 2: proofs ${tag()}`;

    const guest = new Visitor();
    await guest.open(path);
    const form = formWithButton(await host.open(path), /^mark$/i);
    fill(form, `Not mine ${tag()}`);
    const refused = await guest.submit(await host.open(path), form);
    expect(refused.status).toBe(403);
    expect(() => formWithButton(refused, /^mark$/i), "a guest is shown the host's mark form").toThrow();

    const mine = formWithButton(await host.open(path), /^mark$/i);
    fill(mine, part);
    expect((await host.submit(await host.open(path), mine)).status).toBe(200);

    const lost = await here(path);
    await press(lost, path);
    const page = await timeline(new Visitor(), path);
    expect(page.doc.body.textContent).toContain(part);
    expect(page.doc.body.textContent).not.toContain("Not mine");
    expect(busiest(page).some((line) => line.includes(part)), `busiest: ${busiest(page).join(" | ")}`).toBe(true);
  });

  it("the host can say when the recording started, and each minute says how far into it", async () => {
    const host = new Visitor();
    const path = (await startSession(host, `Recording ${tag()}`)).url.pathname;
    const lost = await here(path);
    await press(lost, path);

    const started = clock(Date.now() - 10 * 60_000);
    const guest = new Visitor();
    const hostView = await timeline(host, path);
    const form = formWithButton(hostView, /^save$/i);
    form.querySelector<HTMLInputElement>("input[type='time']")!.value = started;
    expect((await guest.submit(hostView, form)).status, "a guest set the recording time").toBe(403);
    expect((await host.submit(hostView, form)).status).toBe(200);

    const page = await timeline(new Visitor(), path);
    expect(busiest(page).some((line) => /\b(9|10|11) min into the recording\b/.test(line)), `busiest: ${busiest(page).join(" | ")}`).toBe(true);
  });
});
