import { describe, expect, it } from "vitest";
import { Visitor } from "./visitor.ts";

// The pages a real site has: what it is for and how to use it, what it keeps,
// where a wrong address lands, and the same links at the foot of every page.
const text = (html: Element | null): string => html?.textContent?.replace(/\s+/g, " ").trim() ?? "";

describe("pages a real site has", () => {
  it("explains how it works, for a student and for a host", async () => {
    const page = await new Visitor({ signedOut: true }).open("/help");
    expect(page.status).toBe(200);
    expect(text(page.doc.querySelector("h1"))).toBe("How it works");
    const main = text(page.doc.querySelector("main"));
    for (const part of ["In the room", "Teaching", "What no one is shown"]) expect(main).toContain(part);
    expect(main).toContain("Your hand comes down by itself after 3 minutes.");
    expect(main).toContain("Who raised a hand, who asked, who pressed Me too, who reported.");
  });
});
