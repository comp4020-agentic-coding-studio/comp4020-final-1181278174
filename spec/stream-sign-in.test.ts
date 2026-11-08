import { afterEach, describe, expect, it } from "vitest";
import { startSession, type Stream, Visitor } from "./visitor.ts";

// The stream says which sign-in it is for, as the page's mark, each time it
// opens, so a page made for another account, or before a sign-out, loads again
// (src/scripts/live.ts). The mark is the page's own, never another person's.
const tag = (): string => Math.random().toString(36).slice(2, 8);
const open: Stream[] = [];
afterEach(() => {
  for (const stream of open.splice(0)) stream.close();
});

describe("the stream's sign-in", () => {
  it("names the same sign-in as the page, and '-' when signed out", async () => {
    const host = new Visitor();
    const hall = await startSession(host, `Who ${tag()}`);
    const mark = hall.doc.body.getAttribute("data-signed-in");
    expect(mark).toMatch(/^[A-Za-z0-9_-]{16}$/);
    const hosting = await host.listen(hall);
    open.push(hosting);
    await hosting.until(() => true);
    expect(hosting.raw).toContain(`event: who\ndata: ${mark}\n\n`);

    const reader = new Visitor({ signedOut: true });
    const page = await reader.open(hall.url);
    expect(page.doc.body.hasAttribute("data-signed-in")).toBe(false);
    const reading = await reader.listen(page);
    open.push(reading);
    await reading.until(() => true);
    expect(reading.raw).toContain("event: who\ndata: -\n\n");
    expect(reading.raw).not.toContain(mark!);
  });
});
