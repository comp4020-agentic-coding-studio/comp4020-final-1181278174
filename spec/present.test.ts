import { describe, expect, it } from "vitest";
import { ask, meToo, startSession, type Page, Visitor } from "./visitor.ts";

// The projector page: the session for the screen at the front of the room.
// It is found the way a person finds it, by the link on the session page.
const tag = (): string => Math.random().toString(36).slice(2, 8);

async function projector(who: Visitor, session: Page): Promise<Page> {
  const link = [...session.doc.querySelectorAll("a")].find((a) => /projector/i.test(a.textContent ?? ""));
  expect(link, "no link to the projector page on the session page").toBeDefined();
  return who.open(new URL(link!.getAttribute("href")!, session.url));
}

describe("the projector page", () => {
  it("shows the code and the questions with the most votes first, and has nothing to press", async () => {
    const session = await startSession(new Visitor(), `Lecture ${tag()}`);
    const path = session.url.pathname;
    const code = path.split("/").filter(Boolean).pop()!;
    const first = `Asked first ${tag()}`;
    const second = `Asked second ${tag()}`;
    await ask(new Visitor(), path, first);
    await ask(new Visitor(), path, second);
    await meToo(new Visitor(), path, second);

    const screen = new Visitor();
    const page = await projector(screen, await screen.open(path));
    expect(page.status).toBe(200);
    expect(page.doc.body.textContent).toContain(code);

    const shown = [...page.doc.querySelectorAll('[aria-label="Top questions"] > li')].map((li) => li.textContent ?? "");
    expect(shown).toHaveLength(2);
    expect(shown[0]).toContain(second);
    expect(shown[0]).toMatch(/1\s*vote\b/);
    expect(shown[1]).toContain(first);
    expect(shown[1]).toMatch(/0\s*votes\b/);

    expect(page.doc.querySelectorAll("form, button, input, textarea")).toHaveLength(0);
  });

  it("has a QR code that opens the session", async () => {
    const screen = new Visitor();
    const session = await startSession(screen, `Lecture ${tag()}`);
    const page = await projector(screen, session);
    const qr = page.doc.querySelector('[role="img"][aria-label*="QR"]');
    expect(qr, "no QR code on the projector page").not.toBeNull();
    expect(qr!.getAttribute("aria-label")).toContain(session.url.pathname);
    expect(qr!.querySelector("svg path")).not.toBeNull();
    // the address it opens is printed next to it, for anyone who can't scan
    expect(page.doc.body.textContent).toContain(session.url.host);
  });

  it("follows the same live stream as the session page", async () => {
    const screen = new Visitor();
    const session = await startSession(screen, `Lecture ${tag()}`);
    const page = await projector(screen, session);
    // the same address; the projector's may add a note that it is a screen, not a person
    const named = (p: Page): string | undefined =>
      p.doc.querySelector("[data-live]")?.getAttribute("data-live")?.split("?")[0];
    expect(named(page)).toBeTruthy();
    expect(named(page)).toBe(named(session));
  });

  it("is a 404 for an unknown code", async () => {
    const screen = new Visitor();
    const session = await startSession(screen, `Lecture ${tag()}`);
    const page = await projector(screen, session);
    const code = session.url.pathname.split("/").filter(Boolean).pop()!;
    // no session can have "0000": codes have no 0
    const missing = await screen.open(page.url.pathname.replace(code, "0000"));
    expect(missing.status).toBe(404);
  });
});
