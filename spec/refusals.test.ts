import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { ask, hostPress, question, questionsPath, startSession, Visitor } from "./visitor.ts";

// A refused press comes back saying why, on the page it was sent from, and a
// refused mark keeps its words: sent the way a browser without script sends them.
const tag = (): string => Math.random().toString(36).slice(2, 8);

/** Send a form by hand; the refusal's alerts, as text, and the page's HTML. */
async function refused(who: Visitor, path: string, fields: Record<string, string>, status: number): Promise<{ alerts: string; html: string }> {
  const response = await who.post(path, new URLSearchParams(fields));
  expect(response.status, `${fields.intent} on ${path}`).toBe(status);
  const html = await response.text();
  const alerts = [...new JSDOM(html).window.document.querySelectorAll('[role="alert"]')].map((p) => p.textContent?.trim()).join("\n");
  return { alerts, html };
}

describe("a refused press says why", () => {
  it("tells the host in the hall that they have no hand", async () => {
    const host = new Visitor();
    const hall = await startSession(host, `No hand ${tag()}`);
    expect((await refused(host, hall.url.pathname, { intent: "hand", up: "1" }, 403)).alerts).toContain("The host teaches and has no hand.");
  });

  it("says so on both pages when a question isn't there, a report isn't yours, or a control is the host's", async () => {
    const host = new Visitor();
    const hall = await startSession(host, `Gone ${tag()}`);
    const path = questionsPath(hall);
    const body = `Soon hidden ${tag()}`;
    const id = String(question(await ask(new Visitor(), path, body), body)!.id);
    await hostPress(host, path, body, /^hide/i);
    const student = new Visitor();
    for (const route of [hall.url.pathname, path]) {
      expect((await refused(student, route, { intent: "vote", question: id, want: "1" }, 404)).alerts).toContain("That question isn't here any more.");
      expect((await refused(student, route, { intent: "report", question: id }, 404)).alerts).toContain("That question isn't here any more.");
      expect((await refused(student, route, { intent: "unreport", question: id }, 404)).alerts).toContain("There's no report of yours to take back.");
      expect((await refused(student, route, { intent: "state", question: id, to: "answered" }, 403)).alerts).toContain("Only the host can do that.");
      expect((await refused(student, route, { intent: "nonsense" }, 400)).alerts).toContain("That didn't work. Reload the page and try again.");
    }
  });

  it("keeps a refused mark's words in the hall, and says why", async () => {
    const host = new Visitor();
    const hall = await startSession(host, `Mark ${tag()}`);
    const max = Number((await host.open(hall.url.pathname)).doc.querySelector("#mark-label")?.getAttribute("maxlength"));
    expect(max).toBeGreaterThan(0);
    const label = "x".repeat(max + 1);
    const { alerts, html } = await refused(host, hall.url.pathname, { intent: "timeline_mark", label }, 422);
    expect(alerts).toContain(`Use at most ${max} characters for a mark.`);
    expect(new JSDOM(html).window.document.querySelector<HTMLInputElement>("#mark-label")?.value).toBe(label);
  });
});
