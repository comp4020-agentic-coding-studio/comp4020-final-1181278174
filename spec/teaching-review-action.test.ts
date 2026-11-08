import { describe, expect, it } from "vitest";
import { formWithButton, startSession, Visitor } from "./visitor.ts";

const tag = (): string => Math.random().toString(36).slice(2, 8);

describe("a lecturer checking the room", () => {
  it("provides a plain check form that refreshes the review on the same workspace", async () => {
    const host = new Visitor();
    const hall = await startSession(host, `Review a pause ${tag()}`);
    for (const path of [hall.url.pathname, `${hall.url.pathname}/teach`]) {
      const page = await host.open(path);
      const form = formWithButton(page, /^checked now$/i);
      expect(form.method).toBe("post");
      expect(form.querySelector('input[name="intent"]')?.getAttribute("value")).toBe("review");
      expect(form.querySelector('input:not([type="hidden"]), textarea')).toBeNull();
      const response = await host.post(path, new URLSearchParams({ intent: "review" }));
      expect(response.status).toBe(303);
      const target = new URL(response.headers.get("location")!, page.url);
      await response.text();
      expect(target.pathname).toBe(path);
      expect(Number(target.searchParams.get("checked"))).toBeGreaterThan(Date.now() - 10_000);
      const reviewed = await host.open(target);
      expect(reviewed.status).toBe(200);
      expect(reviewed.doc.querySelector('input[name="intent"][value="review"]')).not.toBeNull();
      expect(reviewed.doc.querySelector('input[name="intent"][value="hand"]')).toBeNull();
    }
  });

  it("never gives a student the check action or accepts a forged check", async () => {
    const host = new Visitor();
    const hall = await startSession(host, `Private review ${tag()}`);
    const student = new Visitor();
    const page = await student.open(hall.url.pathname);
    expect(page.doc.querySelector('input[name="intent"][value="review"]')).toBeNull();
    for (const path of [hall.url.pathname, `${hall.url.pathname}/teach`]) {
      const response = await student.post(path, new URLSearchParams({ intent: "review" }));
      expect(response.status).toBe(403);
      await response.text();
    }
  });
});
