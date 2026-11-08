import { afterEach, describe, expect, it } from "vitest";
import { formWithButton, type Page, question, questionsPath, startSession, type Stream, Visitor } from "./visitor.ts";

// The questions page's way back to the hall, read over HTTP with no page
// script running.
const tag = (): string => Math.random().toString(36).slice(2, 8);
const text = (el: Element | null): string => el?.textContent?.replace(/\s+/g, " ").trim() ?? "";
const link = (page: Page, label: string): HTMLAnchorElement | undefined =>
  [...page.doc.querySelectorAll("a")].find((a) => text(a) === label);
const open: Stream[] = [];
afterEach(() => {
  for (const stream of open.splice(0)) stream.close();
});

describe("asking and returning to the hall", () => {
  it.each(["popular", "recent"])("redirects an accepted ask in %s to its confirmation and two working links, without raising a hand", async (sort) => {
    const hall = await startSession(new Visitor(), `Posted ${tag()}`);
    const path = questionsPath(hall);
    const asker = new Visitor();
    const before = await asker.open(sort === "recent" ? `${path}?sort=recent` : path);
    const form = formWithButton(before, /^ask$/i);
    expect(form.getAttribute("method")?.toLowerCase()).toBe("post");
    expect(form.querySelector("textarea[name='body']")).not.toBeNull();
    const body = `Where does this question go? ${tag()}`;

    const response = await asker.post(before.url, new URLSearchParams({ intent: "ask", body }));
    expect(response.status).toBe(303);
    const location = response.headers.get("location");
    expect(location, "the accepted ask needs a redirect target").not.toBeNull();
    await response.text();
    const destination = new URL(location!, before.url);
    expect(destination.pathname).toBe(path);
    expect(destination.searchParams.get("sort")).toBe(sort === "recent" ? "recent" : null);
    const posted = destination.searchParams.get("posted");
    expect(posted).toMatch(/^[1-9]\d*$/);

    const after = await asker.open(destination);
    expect(after.status).toBe(200);
    expect(text(after.doc.body)).toContain("Question posted.");
    expect(question(after, body)?.id).toBe(Number(posted));
    const card = after.doc.getElementById(`q-${posted}`);
    expect(card, "the posted question has no card anchor").not.toBeNull();
    expect(card!.closest('ol[aria-label="Questions"]'), "the posted card is outside the question list").not.toBeNull();
    const toQuestion = [...after.doc.querySelectorAll("a")].find((a) => a.getAttribute("href") === `#q-${posted}`);
    expect(toQuestion, "the confirmation has no link to the posted card").toBeDefined();
    expect(toQuestion!.closest("[hidden]")).toBeNull();
    const toHall = link(after, "Back to the hall");
    expect(toHall, "the confirmation has no way back to the hall").toBeDefined();
    expect(toHall!.getAttribute("href")).toBe(`${hall.url.pathname}#hall`);
    expect(toHall!.closest("[hidden]")).toBeNull();

    const back = await asker.open(new URL(toHall!.getAttribute("href")!, after.url));
    expect(back.status).toBe(200);
    expect(back.doc.getElementById("hall")).not.toBeNull();
    expect(formWithButton(back, /i'm lost/i).querySelector("button")?.getAttribute("aria-pressed")).toBe("false");
    const room = JSON.parse(back.doc.querySelector("[data-lost][data-room]")!.getAttribute("data-room")!);
    expect(room.mine).toBeNull();
    expect(room.hands).toEqual([]);
  });
});
