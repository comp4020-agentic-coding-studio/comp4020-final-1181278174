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

  it("says what is kept, who sees what, and the rules", async () => {
    const page = await new Visitor({ signedOut: true }).open("/privacy");
    expect(page.status).toBe(200);
    expect(text(page.doc.querySelector("h1"))).toBe("Privacy and rules");
    const headings = [...page.doc.querySelectorAll("main h2")].map((h) => text(h));
    expect(headings).toEqual(["What is kept", "Who sees what", "Cookies and other sites", "How long", "Rules"]);
    const main = text(page.doc.querySelector("main"));
    expect(main).toContain("Two cookies, both needed");
    expect(main).toContain("which lasts 30 days");
    expect(main).toContain("nothing on these pages is loaded from another site");
  });

  it("sets two cookies and no more, as Privacy and rules says", async () => {
    // a browser's whole first visit: the home page, signing up, a session's pages
    const origin = (await new Visitor({ signedOut: true }).open("/")).url.origin;
    const jar = new Map<string, string>();
    const send = async (path: string, init: RequestInit = {}): Promise<Response> => {
      const headers = new Headers(init.headers);
      headers.set("cookie", [...jar].map(([k, v]) => `${k}=${v}`).join("; "));
      const response = await fetch(origin + path, { ...init, headers, redirect: "manual" });
      for (const line of response.headers.getSetCookie()) {
        const [name, value] = line.split(";")[0].split("=");
        jar.set(name.trim(), value);
      }
      await response.text();
      return response;
    };
    await send("/");
    const signedUp = await send("/signup", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", origin },
      body: new URLSearchParams({ username: `ck${Date.now() % 1_000_000}${Math.random().toString(36).slice(2, 6)}`, password: "a long enough password", return: "/" }),
    });
    expect(signedUp.status).toBe(303);
    for (const path of ["/", "/s/HAND", "/s/HAND/questions", "/s/HAND/timeline", "/help", "/privacy"]) await send(path);
    expect([...jar.keys()].sort()).toEqual(["hands_up_person", "hands_up_signin"]);
  });
});
