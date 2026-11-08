import { describe, expect, it } from "vitest";
import { ask, formWithButton, type Page, questionsPath, startSession, Visitor } from "./visitor.ts";

const tag = (): string => Math.random().toString(36).slice(2, 8);
const text = (el: Element): string => el.textContent?.replace(/\s+/g, " ").trim() ?? "";

/** Read both roles, with a question to vote on and a hand in the record. */
async function pages(): Promise<{ name: string; page: Page }[]> {
  const host = new Visitor();
  const student = new Visitor();
  const hall = await startSession(host, `Controls ${tag()}`);
  const path = hall.url.pathname;
  const posted = await ask(student, questionsPath(hall), `Which step comes next? ${tag()}`);
  expect(posted.status).toBe(200);
  const studentHall = await student.open(path);
  const raised = await student.submit(studentHall, formWithButton(studentHall, /i'm lost/i));
  expect(raised.status).toBe(200);

  const visits: [name: string, who: Visitor, path: string][] = [
    ["a fresh home page", new Visitor(), "/"],
    ["the host's home page", host, "/"],
    ["the student's hall", student, path],
    ["the host's hall", host, path],
    ["the student's questions", student, questionsPath(hall)],
    ["the host's questions", host, questionsPath(hall)],
    ["the student's timeline", student, `${path}/timeline`],
    ["the host's timeline", host, `${path}/timeline`],
    ["the student's projector page", student, `${path}/present`],
    ["the host's projector page", host, `${path}/present`],
  ];
  const read = await Promise.all(visits.map(async ([name, who, path]) => ({ name, page: await who.open(path) })));
  return [...read, { name: "the question's confirmation", page: posted }];
}

describe("the controls the server sends", () => {
  it("gives every visible field, button and link a name", async () => {
    for (const { name, page } of await pages()) {
      expect(page.status, name).toBe(200);
      // HTTP can check hidden attributes and hidden inputs; it cannot check
      // browser layout or controls added later by the page's script.
      const visible = (el: Element): boolean => !el.closest("[hidden]") && !el.matches('input[type="hidden"]');
      const fields = [...page.doc.querySelectorAll("input, textarea, select")].filter(visible);
      for (const field of fields) {
        const label = [...page.doc.querySelectorAll("label[for]")].find(
          (label) => field.id !== "" && label.getAttribute("for") === field.id && text(label) !== "",
        );
        const named = Boolean(field.getAttribute("aria-label")?.trim() || label);
        expect(named, `${name}: unnamed ${field.outerHTML}`).toBe(true);
      }
      const actions = [...page.doc.querySelectorAll("button, a[href]")].filter(visible);
      expect(actions.length, `${name}: no controls were checked`).toBeGreaterThan(0);
      for (const action of actions) {
        const nameOf = action.getAttribute("aria-label")?.trim() || text(action);
        expect(nameOf, `${name}: unnamed ${action.outerHTML}`).not.toBe("");
      }
    }
  });

  it("has no embedded pages, extra text fields, replies, downvotes, polls, quizzes or accounts", async () => {
    // Keep both the field's name and its kind: a password field must not
    // pass just because someone gave it the name of an allowed text field.
    const known = new Set([
      "input:code:code:text",
      "input:title:title:text",
      "textarea:body:body:textarea",
      "input:mark-label:label:text",
      "input:recording-at:at:time",
    ]);
    for (const { name, page } of await pages()) {
      expect(page.status, name).toBe(200);
      expect(page.doc.querySelectorAll("iframe, embed"), name).toHaveLength(0);
      for (const field of page.doc.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")) {
        if (!["text", "password", "textarea", "time"].includes(field.type)) continue;
        const key = `${field.localName}:${field.id}:${field.name}:${field.type}`;
        expect(known.has(key), `${name}: unexpected field ${field.outerHTML}`).toBe(true);
      }
      for (const action of page.doc.querySelectorAll("button, a[href]")) {
        expect(text(action), `${name}: ${action.outerHTML}`).not.toMatch(/^(reply|downvote|poll|quiz|log in|sign up)$/i);
        expect(action.getAttribute("aria-label")?.trim() ?? "", `${name}: ${action.outerHTML}`)
          .not.toMatch(/^(reply|downvote|poll|quiz|log in|sign up)$/i);
      }
    }
  });
});
