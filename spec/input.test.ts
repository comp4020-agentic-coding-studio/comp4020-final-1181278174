import { describe, expect, it, inject } from "vitest";
import { ask, meToo, question, questionsPath, startSession, Visitor } from "./visitor.ts";

// Use it wasn't designed for: every page reads a POST as a form, so a body
// sent another way, or a form that can't be read, is refused with a 400,
// never a 500.
const baseUrl = inject("baseUrl");
const pages = ["/", "/signin", "/signup", "/s/HAND", "/s/HAND/questions", "/s/HAND/timeline"];

async function send(path: string, type: string, body: string): Promise<number> {
  const response = await fetch(new URL(path, baseUrl), {
    method: "POST",
    headers: { "content-type": type, origin: new URL(baseUrl).origin },
    body,
    redirect: "manual",
  });
  await response.text();
  return response.status;
}

describe("a POST that is not a form", () => {
  it("is refused with a 400 when it is JSON", async () => {
    for (const path of pages) expect(await send(path, "application/json", '{"intent":"ask","body":"hi"}'), path).toBe(400);
  });

  it("is refused with a 400 when it is a form that can't be read", async () => {
    for (const path of pages) expect(await send(path, "multipart/form-data; boundary=x", "--x\r\nnot a part"), path).toBe(400);
  });
});

describe("another site", () => {
  it("can't show a page in a frame, so nobody is tricked into pressing on it", async () => {
    for (const path of ["/", "/s/HAND", "/s/HAND/questions", "/signin"]) {
      const response = await fetch(new URL(path, baseUrl));
      await response.text();
      expect(response.headers.get("x-frame-options"), path).toBe("DENY");
      expect(response.headers.get("content-security-policy"), path).toContain("frame-ancestors 'none'");
    }
  });
});

const tag = (): string => Math.random().toString(36).slice(2, 8);

describe("a form that asks for something the app doesn't do", () => {
  it("refuses a vote that is neither 1 nor 0, and keeps the vote", async () => {
    const hall = await startSession(new Visitor(), `Want ${tag()}`);
    const path = questionsPath(hall);
    const body = `A question to vote on ${tag()}`;
    await ask(new Visitor(), path, body);
    const voter = new Visitor();
    await meToo(voter, path, body);
    const id = question(await voter.open(path), body)!.id;
    for (const want of [undefined, "toggle", "2"]) {
      const data = new URLSearchParams({ intent: "vote", question: String(id) });
      if (want !== undefined) data.set("want", want);
      const response = await voter.post(path, data);
      expect(response.status, `want=${want}`).toBe(422);
      await response.text();
    }
    expect(question(await voter.open(path), body)!.votes).toBe(1);
  });

  it("refuses the host's button for no question, an unknown intent, and other methods", async () => {
    const host = new Visitor();
    const hall = await startSession(host, `Intent ${tag()}`);
    const path = questionsPath(hall);
    const noQuestion = await host.post(path, new URLSearchParams({ intent: "state", to: "answered" }));
    expect(noQuestion.status).toBe(404);
    await noQuestion.text();
    for (const where of [hall.url.pathname, path]) {
      const unknown = await host.post(where, new URLSearchParams({ intent: "nonsense" }));
      expect(unknown.status, where).toBe(400);
      await unknown.text();
    }
    for (const method of ["PUT", "PATCH", "DELETE"]) {
      // with this site's Origin, so the method itself is what is refused
      const response = await fetch(new URL(path, baseUrl), { method, headers: { origin: new URL(baseUrl).origin }, redirect: "manual" });
      await response.text();
      expect(response.status, method).toBe(405);
    }
  });

  it("refuses a title, question or mark with a character that can't be shown, without a 500", async () => {
    const host = new Visitor();
    const nul = String.fromCharCode(0);
    const start = await host.post("/", new URLSearchParams({ title: `${nul}Title` }));
    expect(start.status).toBe(422);
    await start.text();
    const hall = await startSession(host, `Unshowable ${tag()}`);
    const asked = await new Visitor().post(questionsPath(hall), new URLSearchParams({ intent: "ask", body: `${nul}Question` }));
    expect(asked.status).toBe(422);
    await asked.text();
    const marked = await host.post(hall.url.pathname, new URLSearchParams({ intent: "timeline_mark", label: `${nul}Part` }));
    expect(marked.status).toBe(422);
    await marked.text();
  });

  it("refuses a post over 64 KB unread", async () => {
    const hall = await startSession(new Visitor(), `Size ${tag()}`);
    const response = await new Visitor().post(questionsPath(hall), new URLSearchParams({ intent: "ask", body: "x".repeat(70_000) }));
    expect(response.status).toBe(413);
    await response.text();
  });
});

