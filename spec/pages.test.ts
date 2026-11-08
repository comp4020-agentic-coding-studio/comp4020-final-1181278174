import { describe, expect, it } from "vitest";
import { type Page, startSession, Visitor } from "./visitor.ts";

// The pages a real site has: what it is for and how to use it, what it keeps,
// where a wrong address lands, and the same links at the foot of every page.
const text = (html: Element | null): string => html?.textContent?.replace(/\s+/g, " ").trim() ?? "";

describe("pages a real site has", () => {
  it("explains how it works, for a student and for a host", async () => {
    const page = await new Visitor({ signedOut: true }).open("/help");
    expect(page.status).toBe(200);
    expect(text(page.doc.querySelector("h1"))).toBe("How it works");
    const main = text(page.doc.querySelector("main"));
    for (const part of ["In the room", "Teaching", "What the app shows"]) expect(main).toContain(part);
    expect(main).toContain("Your hand comes down by itself after 3 minutes.");
    expect(main).toContain("The app shows no one else which account raised a hand, asked, pressed Me too or reported");
  });

  it("says what is kept, who sees what, and the rules", async () => {
    const page = await new Visitor({ signedOut: true }).open("/privacy");
    expect(page.status).toBe(200);
    expect(text(page.doc.querySelector("h1"))).toBe("Privacy and rules");
    const headings = [...page.doc.querySelectorAll("main h2")].map((h) => text(h));
    expect(headings).toEqual(["What is kept", "Who sees what", "Cookies and other sites", "Where it is", "How long", "Rules"]);
    const main = text(page.doc.querySelector("main"));
    expect(main).toContain("One cookie tells browsers apart and lasts a year. Signing in adds one that lasts 30 days or until you sign out.");
    expect(main).toContain("nothing on these pages is loaded from another site");
  });

  it("links How it works, Privacy and rules and About at the foot of every page but the projector", async () => {
    const links = (page: Page): (string | null)[] =>
      [...page.doc.querySelectorAll('footer nav[aria-label="About this app"] a')].map((a) => a.getAttribute("href"));
    const visitor = new Visitor({ signedOut: true });
    for (const path of ["/", "/signin", "/signup", "/readme/", "/help", "/privacy"]) {
      expect(links(await visitor.open(path)), path).toEqual(["/help", "/privacy", "/readme/"]);
    }
    const host = new Visitor();
    const hall = (await startSession(host, `Footer ${Date.now() % 100000}`)).url.pathname;
    for (const path of [hall, `${hall}/questions`, `${hall}/timeline`]) {
      expect(links(await host.open(path)), path).toEqual(["/help", "/privacy", "/readme/"]);
    }
    expect(links(await host.open(`${hall}/present`)), "the projector").toEqual([]);
  });

  it("answers a wrong address with a 404 page that offers a code or the home page", async () => {
    for (const path of ["/no-such-page", "/help/me", "/s"]) {
      const page = await new Visitor({ signedOut: true }).open(path);
      expect(page.status, path).toBe(404);
      expect(text(page.doc.querySelector("h1")), path).toBe("Nothing here");
      expect(page.doc.querySelector('form[action="/join"] input[name="code"]'), path).not.toBeNull();
      expect(page.doc.querySelector('main a[href="/"]'), path).not.toBeNull();
    }
  });

  it("says at sign-up, beside the password, that a forgotten one can't be recovered", async () => {
    const page = await new Visitor({ signedOut: true }).open("/signup");
    const described = page.doc.querySelector("#password")?.getAttribute("aria-describedby") ?? "";
    const notes = described.split(/\s+/).map((id) => text(page.doc.getElementById(id))).join(" ");
    expect(notes).toContain("a forgotten password can't be recovered");
  });

  it("has one banner at the top of a page, so a screen reader hears one", async () => {
    const host = new Visitor();
    const hall = (await startSession(host, `Banner ${Date.now() % 100000}`)).url.pathname;
    for (const path of ["/", "/signin", "/help", "/privacy", "/account", "/no-such-page", hall, `${hall}/questions`, `${hall}/timeline`]) {
      const page = await host.open(path);
      // a header outside main, article, aside, nav and section is a banner
      const banners = [...page.doc.querySelectorAll("header")].filter((h) => !h.parentElement?.closest("main, article, aside, nav, section"));
      expect(banners.length, path).toBeLessThanOrEqual(1);
    }
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
