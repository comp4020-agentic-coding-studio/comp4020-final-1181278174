import { describe, expect, it } from "vitest";
import { ask, formWithButton, hostPress, questions, questionsPath, startSession, Visitor } from "./visitor.ts";

const tag = (): string => Math.random().toString(36).slice(2, 8);
const text = (el: Element | null): string => el?.textContent?.replace(/\s+/g, " ").trim() ?? "";

describe("the student end", () => {
  it("puts the count and one-press hand ahead of the optional hall, with questions beside them", async () => {
    const hall = await startSession(new Visitor(), `Student end ${tag()}`);
    const student = new Visitor();
    await ask(student, questionsPath(hall), "Could you show that step again?");
    const page = await student.open(hall.url.pathname);
    const count = page.doc.querySelector("[data-lost]")!;
    const hand = formWithButton(page, /i'm lost/i);
    const view = [...page.doc.querySelectorAll("details")].find((el) => text(el.querySelector("summary")) === "View the hall");
    expect(view, "the room illustration is optional").toBeDefined();
    expect(view!.hasAttribute("open")).toBe(false);
    expect(count.compareDocumentPosition(view!) & 4).toBe(4);
    expect(hand.compareDocumentPosition(view!) & 4).toBe(4);
    expect(hand.querySelector('textarea, input:not([type="hidden"])')).toBeNull();
    expect(questions(page, "Most wanted").some((q) => q.text.includes("Could you show that step again?"))).toBe(true);
    expect(page.doc.querySelector('main a[href$="/questions"]')).not.toBeNull();
    expect(page.doc.querySelector('input[value="class-start"], input[value="class-end"], input[value="timeline_mark"], input[value="going-over"]')).toBeNull();
  });

  it("keeps operating help folded away while showing the current hand state", async () => {
    const hall = await startSession(new Visitor(), `Student help ${tag()}`);
    const student = new Visitor();
    const page = await student.open(hall.url.pathname);
    const help = [...page.doc.querySelectorAll("details")].find((el) => text(el.querySelector("summary")) === "How this works");
    expect(help).toBeDefined();
    expect(help!.hasAttribute("open")).toBe(false);
    expect(text(help!)).toContain("not attendance");
    const privacy = [...page.doc.querySelectorAll("p")].find(p => text(p).includes("No one, the host included, is shown whose hand is up."));
    expect(privacy?.closest("details")).toBeNull();
    const raised = await student.submit(page, formWithButton(page, /i'm lost/i));
    expect(raised.status).toBe(200);
    const note = raised.doc.querySelector("[data-hand-note]")!;
    expect(text(note)).toContain("Your hand is up.");
    expect(note.closest("details")).toBeNull();
    expect(raised.doc.querySelector('form[data-hand] button')?.getAttribute("aria-pressed")).toBe("true");
  });

  it("lets the lecturer preview the student end without a hand or private moderation content", async () => {
    const host = new Visitor();
    const hall = await startSession(host, `Student preview ${tag()}`);
    const body = `A hidden question ${tag()}`;
    await ask(new Visitor(), questionsPath(hall), body);
    await hostPress(host, questionsPath(hall), body, /^hide$/i);
    const preview = await host.open(`${hall.url.pathname}?view=student`);
    expect(preview.status).toBe(200);
    expect(text(preview.doc.querySelector("main"))).toContain("Student view");
    expect(preview.doc.querySelector("form[data-hand]")).toBeNull();
    expect(preview.doc.querySelector('input[value="class-start"], input[value="class-end"], input[value="timeline_mark"], input[value="going-over"]')).toBeNull();
    expect(preview.html).not.toContain(body);
    expect(preview.doc.querySelector('main a[href$="/teach"]')).not.toBeNull();
  });

  it("uses main's student guide and keeps its repeated captions gone after completion", async () => {
    const hall = await startSession(new Visitor(), `Student guide port ${tag()}`);
    const student = new Visitor();
    const first = await student.open(hall.url.pathname);
    const guide = first.doc.querySelector("[data-guide]")!;
    expect(text(guide.querySelector("h2"))).toBe("Student guide");
    expect(guide.querySelectorAll("ol > li")).toHaveLength(5);
    expect(formWithButton(first, /i'm lost/i).compareDocumentPosition(guide) & 4).toBe(4);
    expect(guide.closest("details, [hidden], dialog")).toBeNull();
    const form = formWithButton(first, /^Got it$/i);
    const button = [...form.querySelectorAll("button")].find(b => text(b) === "Got it")!;
    const finished = await student.submit(first, form, button);
    expect(finished.status).toBe(200);
    expect(finished.doc.querySelector("[data-guide]")).toBeNull();
    const illustration = finished.doc.querySelector("[data-student-hall]")!;
    expect(illustration.hasAttribute("open")).toBe(false);
    expect(text(finished.doc.querySelector("main"))).not.toContain("Seats and hands are placed at random on each screen.");
    expect(text(finished.doc.querySelector("main"))).not.toContain("For the screen at the front.");
    expect(text(finished.doc.querySelector("main"))).toContain("No one, the host included, is shown whose hand is up.");
  });

});
