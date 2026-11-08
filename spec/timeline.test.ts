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

const text = (el: Element): string => el.textContent?.replace(/\s+/g, " ").trim() ?? "";

/** The chart's complete reading, including minutes when nobody raised a hand. */
const everyMinute = (p: Page): Element[] => [...p.doc.querySelectorAll('details ol[aria-label="Every minute"] > li')];

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
    expect(busiest(page).some((line) => minutes.some((m) => line === `${m} 1 of 2 said they were lost`)), `busiest: ${busiest(page).join(" | ")}`).toBe(true);
  });

  it("names a live stream that keeps its reader and their raised hand here after the hall closes", async () => {
    const path = (await startSession(new Visitor(), `Reading ${tag()}`)).url.pathname;
    const reader = new Visitor();
    const hall = await reader.listen(await reader.open(path));
    open.push(hall);
    await hall.until((board) => board.here === 1);
    await press(reader, path);
    await hall.until((board) => board.hands.length === 1);

    const reading = await reader.listen(await timeline(reader, path));
    open.push(reading);
    expect(reading.status).toBe(200);
    await reading.until((board) => board.here === 1 && board.hands.length === 1);
    reading.forget();
    hall.close();

    // Someone arriving gives a fresh state after the hall stream has closed.
    // The timeline is the reader's only stream; it must still count them.
    await here(path);
    await reading.until((board) => board.here === 2 && board.hands.length === 1, 2000);
    reading.forget();
    await press(reader, path);
    await reading.until((board) => board.here === 2 && board.hands.length === 0);
  });

  it("lists every minute inside details, including zero hands, and agrees with the busiest minutes", async () => {
    const host = new Visitor();
    const path = (await startSession(host, `Minutes ${tag()}`)).url.pathname;
    const reader = await here(path);
    await here(path);
    const quiet = await timeline(reader, path);
    expect(everyMinute(quiet).some((li) => text(li).includes("0 of 2 said they were lost"))).toBe(true);

    const part = `Proofs ${tag()}`;
    const marking = await timeline(host, path);
    const mark = formWithButton(marking, /^mark$/i);
    fill(mark, part);
    expect((await host.submit(marking, mark)).status).toBe(200);
    const recording = await timeline(host, path);
    const save = formWithButton(recording, /^save$/i);
    save.querySelector<HTMLInputElement>("input[type='time']")!.value = clock(Date.now());
    expect((await host.submit(recording, save)).status).toBe(200);
    await press(reader, path);
    await press(reader, path);

    const page = await timeline(reader, path);
    const rows = everyMinute(page);
    expect(rows.length).toBeGreaterThan(0);
    const section = rows[0].closest("section")!;
    const range = [...section.querySelectorAll("h3 time[datetime]")].map((time) => Date.parse(time.getAttribute("datetime")!));
    expect(range).toHaveLength(2);
    expect(rows).toHaveLength((range[1] - range[0]) / 60_000);
    rows.forEach((li, i) => {
      const at = range[0] + i * 60_000;
      expect(Date.parse(li.querySelector("time")?.getAttribute("datetime") ?? "")).toBe(at);
      expect(text(li)).toMatch(new RegExp(`^${clock(at)} \\d+ of \\d+ said they were lost`));
    });
    const listed = rows.map(text);
    const top = busiest(page);
    expect(top.length).toBeGreaterThan(0);
    for (const line of top) {
      expect(listed).toContain(line);
      expect(line).toContain("1 of 2 said they were lost");
      expect(line).toContain(part);
      expect(line).toMatch(/\b\d+ min into the recording\b/);
    }
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
  it("numbers nearby marks with a legend and shows the sitting's clock times and chart scale", async () => {
    const host = new Visitor();
    const path = (await startSession(host, `Legend ${tag()}`)).url.pathname;
    for (let i = 0; i < 4; i++) await here(path);
    const labels = [`First part ${tag()}`, `A longer name for the next part ${tag()}`, `Last part ${tag()}`];
    for (const label of labels) {
      const page = await timeline(host, path);
      const form = formWithButton(page, /^mark$/i);
      fill(form, label);
      expect((await host.submit(page, form)).status).toBe(200);
    }

    const page = await timeline(new Visitor(), path);
    const legend = page.doc.querySelector('ol[aria-label="Chart marks"]');
    expect(legend, "the numbered chart has no legend").not.toBeNull();
    const items = [...legend!.querySelectorAll(":scope > li")];
    expect(items).toHaveLength(labels.length);
    labels.forEach((label, i) => {
      expect(items[i].getAttribute("value")).toBe(String(i + 1));
      expect(text(items[i])).toContain(label);
      expect(items[i].querySelector("time[datetime]")).not.toBeNull();
      const marker = [...page.doc.querySelectorAll("[title]")].find((el) => el.getAttribute("title") === `Mark ${i + 1}: ${label}`);
      expect(marker, `no chart marker for ${label}`).toBeDefined();
      expect(text(marker!)).toBe(String(i + 1));
    });
    const section = legend!.closest("section")!;
    const range = [...section.querySelectorAll("h3 time[datetime]")];
    expect(range).toHaveLength(2);
    for (const time of range) expect(text(time)).toBe(clock(Date.parse(time.getAttribute("datetime")!)));
    expect(text(section)).toContain("Each bar is one minute. Height: how many said they were lost.");
    const chart = section.querySelector('[aria-hidden="true"]');
    expect(chart, "the sitting has no chart").not.toBeNull();
    const chartLabels = [...chart!.querySelectorAll("span")].filter((el) => el.children.length === 0).map(text);
    // Four is the scale's upper value, distinct from the three mark numbers.
    expect(chartLabels).toEqual(expect.arrayContaining(["0", "4", ...range.map(text)]));
  });

  it("sends a fresh state to timeline readers after a mark or recording time is saved", async () => {
    const host = new Visitor();
    const path = (await startSession(host, `Updates ${tag()}`)).url.pathname;
    const reader = new Visitor();
    const stream = await reader.listen(await timeline(reader, path));
    open.push(stream);
    await stream.until((board) => board.here === 1);
    // Drain the gathered join event before looking for a save's notification.
    await new Promise((resolve) => setTimeout(resolve, 300));

    for (const intent of ["mark", "save"] as const) {
      const page = await timeline(host, path);
      const form = formWithButton(page, intent === "mark" ? /^mark$/i : /^save$/i);
      if (intent === "mark") fill(form, `A new part ${tag()}`);
      else form.querySelector<HTMLInputElement>("input[type='time']")!.value = clock(Date.now());
      stream.forget();
      const before = Date.now();
      expect((await host.submit(page, form)).status).toBe(200);
      const sent = await stream.until(() => true);
      expect(sent.at).toBeGreaterThanOrEqual(before);
      expect(sent.at - before).toBeLessThan(1000);
    }
  });

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
