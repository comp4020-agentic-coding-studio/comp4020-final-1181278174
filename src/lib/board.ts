import { randomInt } from "node:crypto";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { db } from "./db.ts";
import { announce, publish } from "./live.ts";
import { popularOrder, voteCount } from "./order.ts";
import { questions, sessions, votes } from "./schema.ts";

export const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const MAX_QUESTION = 240;
export const MAX_TITLE = 80;

export type Session = typeof sessions.$inferSelect;
export type Sort = "popular" | "recent";
export type State = "open" | "answered" | "hidden";
export const STATES: readonly State[] = ["open", "answered", "hidden"];

/** A question as one viewer sees it: who asked never leaves this module. */
export type QuestionView = {
  id: number;
  body: string;
  createdAt: Date;
  votes: number;
  yours: boolean;
  voted: boolean;
  state: State;
};

/** A code as someone typed it: any case, spaces and dashes ignored. */
export function normaliseCode(typed: string): string {
  return typed.toUpperCase().replace(/[\s-]+/g, "");
}

export function isCode(code: string): boolean {
  return code.length === 4 && [...code].every((c) => ALPHABET.includes(c));
}

export function findSession(code: string): Session | undefined {
  return db.select().from(sessions).where(eq(sessions.code, code)).get();
}

/** Characters as a person counts them (and SQLite's length() does). */
export const length = (s: string): number => [...s].length;

export function checkTitle(title: string): string | undefined {
  if (title.length === 0) return "Give the session a name, so the room knows it's the right one.";
  if (length(title) > MAX_TITLE) return `A name can be up to ${MAX_TITLE} characters; this one is ${length(title)}.`;
}

export function startSession(title: string, host: string): string {
  for (;;) {
    const code = Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
    const made = db
      .insert(sessions)
      .values({ code, title, host, createdAt: new Date() })
      .onConflictDoNothing({ target: sessions.code })
      .run();
    if (made.changes === 1) return code;
  }
}

export function checkQuestion(body: string): string | undefined {
  if (body.length === 0) return "Write your question first.";
  if (length(body) > MAX_QUESTION) {
    return `A question can be up to ${MAX_QUESTION} characters; this one is ${length(body)}.`;
  }
}

export function askQuestion(session: Session, asker: string, body: string): void {
  const createdAt = new Date();
  const { id } = db
    .insert(questions)
    .values({ sessionId: session.id, body, asker, createdAt })
    .returning({ id: questions.id })
    .get();
  announce(session.id, { id, body, at: createdAt.getTime() }, asker);
  publish(session.id);
}

/** Say "me too" (want) or take it back. Saying it twice is still one vote. */
export function setVote(session: Session, questionId: number, person: string, want: boolean): void {
  const inSession = db
    .select({ id: questions.id })
    .from(questions)
    .where(and(eq(questions.id, questionId), eq(questions.sessionId, session.id)))
    .get();
  if (!inSession) return;
  if (want) {
    db.insert(votes).values({ questionId, person, createdAt: new Date() }).onConflictDoNothing().run();
  } else {
    db.delete(votes).where(and(eq(votes.questionId, questionId), eq(votes.person, person))).run();
  }
  publish(session.id);
}

/** The host is the browser that started the session. HAND has none. */
export function isHost(session: Session, person: string): boolean {
  return session.host !== null && session.host === person;
}

/** The host marks a question answered, hides it, or puts it back. False if this person is not the host. */
export function setState(session: Session, questionId: number, person: string, to: State): boolean {
  if (!isHost(session, person)) return false;
  db.update(questions)
    .set({ state: to })
    .where(and(eq(questions.id, questionId), eq(questions.sessionId, session.id)))
    .run();
  publish(session.id);
  return true;
}

/** The questions as one viewer sees them. Only the host is given the hidden ones. */
export function listQuestions(session: Session, viewer: string, sort: Sort): QuestionView[] {
  const order = sort === "recent" ? [desc(questions.createdAt), desc(questions.id)] : popularOrder;
  const seen = isHost(session, viewer)
    ? eq(questions.sessionId, session.id)
    : and(eq(questions.sessionId, session.id), ne(questions.state, "hidden"));
  return db
    .select({
      id: questions.id,
      body: questions.body,
      createdAt: questions.createdAt,
      votes: voteCount,
      yours: sql<number>`${questions.asker} = ${viewer}`,
      voted: sql<number>`EXISTS (SELECT 1 FROM ${votes} WHERE ${votes.questionId} = ${questions.id} AND ${votes.person} = ${viewer})`,
      state: questions.state,
    })
    .from(questions)
    .where(seen)
    .orderBy(...order)
    .all()
    .map((q) => ({ ...q, votes: Number(q.votes), yours: Boolean(q.yours), voted: Boolean(q.voted) }));
}
