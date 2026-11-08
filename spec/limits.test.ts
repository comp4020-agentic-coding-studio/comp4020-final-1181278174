import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { ask, question, questionsPath, startSession, Visitor } from "./visitor.ts";

const sentence = /^Too many in a row\. Try again in \d+ (seconds?|minutes)\.$/;

async function accepted(who: Visitor, path: string, fields: Record<string, string>): Promise<void> {
  const response = await who.post(path, new URLSearchParams(fields));
  expect(response.status).toBe(303);
  await response.text();
}

async function refused(who: Visitor, path: string, fields: Record<string, string>, seconds: number): Promise<Document> {
  const response = await who.post(path, new URLSearchParams(fields));
  expect(response.status).toBe(429);
  const retry = response.headers.get("retry-after");
  expect(retry).toMatch(/^[1-9]\d*$/);
  expect(Number(retry)).toBeLessThanOrEqual(seconds);
  const doc = new JSDOM(await response.text()).window.document;
  // said where a screen reader hears it: an alert, or the timeline's status line
  const said = [...doc.querySelectorAll('[role="alert"], [role="status"]')].map((node) => node.textContent?.trim() ?? "");
  expect(said.some((text) => sentence.test(text)), `no "Too many in a row" in: ${JSON.stringify(said)}`).toBe(true);
  return doc;
}

async function sibling(who: Visitor): Promise<Visitor> {
  const other = new Visitor({ signedOut: true });
  expect((await other.signIn(who.username, who.password)).status).toBe(200);
  return other;
}

describe("account action limits over HTTP", () => {
  it("refuses a fourth question across browsers and rooms, preserving its draft", async () => {
    const host = new Visitor();
    const hall = await startSession(host, "Question allowance");
    const elsewhere = await startSession(host, "Same account elsewhere");
    const path = questionsPath(hall);
    const otherPath = questionsPath(elsewhere);
    const asker = new Visitor();
    await accepted(asker, path, { intent: "ask", body: "First question" });
    const other = await sibling(asker);
    await accepted(other, otherPath, { intent: "ask", body: "Second question" });
    await accepted(asker, path, { intent: "ask", body: "Third question" });
    const body = "Keep this fourth draft & its <words>.";
    const doc = await refused(other, path, { intent: "ask", body }, 60);
    expect(doc.querySelector<HTMLTextAreaElement>('textarea[name="body"]')?.value).toBe(body);
    expect(question(await asker.open(path), body)).toBeUndefined();
    expect(question(await ask(new Visitor(), path, body), body)).toBeDefined();
  });

  it("refuses an eleventh session across browsers and keeps its title", async () => {
    const host = new Visitor();
    await accepted(host, "/", { title: "First session" });
    const other = await sibling(host);
    for (let n = 1; n < 10; n++) await accepted(n % 2 ? other : host, "/", { title: `Session ${n + 1}` });
    const title = "Keep this session title";
    const doc = await refused(other, "/", { title }, 3600);
    expect(doc.querySelector<HTMLInputElement>('input[name="title"]')?.value).toBe(title);
    expect(doc.querySelectorAll('[aria-label="Sessions you started"] li')).toHaveLength(10);
    await accepted(new Visitor(), "/", { title });
  });

  it("counts repeated hand presses and refuses the twenty-first without changing the hand", async () => {
    const hall = await startSession(new Visitor(), "Hand allowance");
    const student = new Visitor();
    for (let n = 0; n < 20; n++) await accepted(student, hall.url.pathname, { intent: "hand", up: "1" });
    const doc = await refused(student, hall.url.pathname, { intent: "hand", up: "0" }, 60);
    expect(doc.querySelector('[data-hand] button')?.getAttribute("aria-pressed")).toBe("true");
  });

  it("shares sixty Me too, Report and Undo presses between both pages, including repeats", async () => {
    const hall = await startSession(new Visitor(), "Vote allowance");
    const path = questionsPath(hall);
    const body = "A question to vote on";
    const id = String(question(await ask(new Visitor(), path, body), body)!.id);
    const voter = new Visitor();
    for (let n = 0; n < 57; n++) {
      await accepted(voter, n % 2 ? path : hall.url.pathname, { intent: "vote", question: id, want: "1" });
    }
    await accepted(voter, hall.url.pathname, { intent: "report", question: id });
    await accepted(voter, path, { intent: "unreport", question: id });
    await accepted(voter, path, { intent: "report", question: id });
    for (const route of [hall.url.pathname, path]) {
      await refused(voter, route, { intent: "vote", question: id, want: "0" }, 60);
      await refused(voter, route, { intent: "report", question: id }, 60);
      await refused(voter, route, { intent: "unreport", question: id }, 60);
    }
    expect(question(await voter.open(path), body)?.votes).toBe(1);
  });

  it("shares twenty host changes across controls and pages, preserving refused marks and recording time", async () => {
    const host = new Visitor();
    const hall = await startSession(host, "Host allowance");
    const path = questionsPath(hall);
    const timeline = `${hall.url.pathname}/timeline`;
    const body = "A question for the host";
    const id = String(question(await ask(new Visitor(), path, body), body)!.id);
    for (let n = 0; n < 5; n++) {
      await accepted(host, hall.url.pathname, { intent: "going-over" });
      await accepted(host, path, { intent: "state", question: id, to: "answered" });
      await accepted(host, timeline, { intent: "timeline_mark", label: `Part ${n}` });
      await accepted(host, timeline, { intent: "recording", at: "14:02" });
    }
    for (const route of [hall.url.pathname, timeline]) {
      const doc = await refused(host, route, { intent: "timeline_mark", label: "Keep this mark" }, 60);
      expect(doc.querySelector<HTMLInputElement>('input[name="label"]')?.value).toBe("Keep this mark");
    }
    for (const route of [hall.url.pathname, path]) {
      await refused(host, route, { intent: "state", question: id, to: "open" }, 60);
    }
    await refused(host, hall.url.pathname, { intent: "going-over" }, 60);
    const doc = await refused(host, timeline, { intent: "recording", at: "15:03" }, 60);
    expect(doc.querySelector<HTMLInputElement>('input[name="at"]')?.value).toBe("15:03");
    expect(question(await host.open(path), body)?.text).toContain("Answered");
  });
});
