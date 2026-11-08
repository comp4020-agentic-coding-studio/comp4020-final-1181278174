import { randomInt } from "node:crypto";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { db } from "./db.ts";
import { HAND_MS } from "./hall.ts";
import { announce, here, publish, publishAfter } from "./live.ts";
import { notePresence } from "./record.ts";
import { type Hand, setHand } from "./room.ts";
import { popularOrder, voteCount } from "./order.ts";
import { AUDIT_KEY_VERSION, seal } from "./escrow.ts";
import { questions, reports, sealedAuthors, sessions, votes } from "./schema.ts";
import { tagFor } from "./tags.ts";

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
  reported: boolean;
  reports: number;
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

/** How many of a host's sessions the home page lists. */
const HOSTED_SHOWN = 10;

/**
 * The sessions this browser started, newest first, so a lecturer can find
 * last week's timeline. A host is the browser's cookie, so another device, or
 * cleared cookies, has none of them; there are no accounts to recover them.
 */
export function sessionsHostedBy(person: string): Pick<Session, "code" | "title" | "createdAt">[] {
  return db
    .select({ code: sessions.code, title: sessions.title, createdAt: sessions.createdAt })
    .from(sessions)
    .where(eq(sessions.host, person))
    .orderBy(desc(sessions.createdAt), desc(sessions.id))
    .limit(HOSTED_SHOWN)
    .all();
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

/**
 * Ask a question; returns its number. The question keeps only a tag for who
 * asked, enough for "Yours"; who asked is sealed to the auditor's public key,
 * which the app can write and cannot read back. Both are written together or
 * not at all.
 */
export function askQuestion(session: Session, asker: string, body: string): number {
  const createdAt = new Date();
  const id = db.transaction((tx) => {
    const { id } = tx
      .insert(questions)
      .values({ sessionId: session.id, body, asker: tagFor("asker", asker), createdAt })
      .returning({ id: questions.id })
      .get();
    const envelope = seal({ account: asker, question: id, session: session.code, body, at: createdAt.getTime() });
    tx.insert(sealedAuthors).values({ questionId: id, keyVersion: AUDIT_KEY_VERSION, envelope }).run();
    return id;
  });
  announce(session.id, { id, body, at: createdAt.getTime() }, asker);
  publish(session.id);
  return id;
}

/**
 * What a vote did. "unchanged" is a vote that was already there, or already
 * taken back. The last two are refusals: this person can't see the question.
 */
export type Vote = "changed" | "unchanged" | "hidden" | "no-such-question";

/**
 * Say "me too" (want) or take it back. Saying it twice is still one vote.
 * Refused if the question is in another session, or hidden and this person is
 * not the host.
 */
export function setVote(session: Session, questionId: number, person: string, want: boolean): Vote {
  const found = db
    .select({ state: questions.state })
    .from(questions)
    .where(and(eq(questions.id, questionId), eq(questions.sessionId, session.id)))
    .get();
  if (!found) return "no-such-question";
  if (found.state === "hidden" && !isHost(session, person)) return "hidden";
  const { changes } = want
    ? db.insert(votes).values({ questionId, person, createdAt: new Date() }).onConflictDoNothing().run()
    : db.delete(votes).where(and(eq(votes.questionId, questionId), eq(votes.person, person))).run();
  publish(session.id);
  return changes > 0 ? "changed" : "unchanged";
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
  const hosting = isHost(session, viewer);
  const seen = hosting
    ? eq(questions.sessionId, session.id)
    : and(eq(questions.sessionId, session.id), ne(questions.state, "hidden"));
  return db
    .select({
      id: questions.id,
      body: questions.body,
      createdAt: questions.createdAt,
      votes: voteCount,
      // a question asked before tags held the browser's id itself
      yours: sql<number>`${questions.asker} IN (${tagFor("asker", viewer)}, ${viewer})`,
      voted: sql<number>`EXISTS (SELECT 1 FROM ${votes} WHERE ${votes.questionId} = ${questions.id} AND ${votes.person} = ${viewer})`,
      reported: sql<number>`EXISTS (SELECT 1 FROM ${reports} WHERE ${reports.questionId} = ${questions.id} AND ${reports.reporter} = ${tagFor("reporter", viewer)})`,
      reports: hosting ? sql<number>`(SELECT count(*) FROM ${reports} WHERE ${reports.questionId} = ${questions.id})` : sql<number>`0`,
      state: questions.state,
    })
    .from(questions)
    .where(seen)
    .orderBy(...order)
    .all()
    .map((q) => ({ ...q, votes: Number(q.votes), yours: Boolean(q.yours), voted: Boolean(q.voted), reported: Boolean(q.reported), reports: Number(q.reports) }));
}

/**
 * "I'm lost": put this person's hand up (want) or down, and tell the room. A
 * raised hand comes down by itself after HAND_MS, so the room is told again
 * then. Like a vote, the page sends up or down, never "toggle".
 */
export function raiseHand(session: Session, person: string, want: boolean): Hand {
  const done = setHand(session.id, person, want);
  // A hand counts its person as here, page open or not: note it in this
  // minute's row, so a hand sent without script reaches the timeline too.
  notePresence(session.id, here(session.id));
  if (done === "raised") publishAfter(session.id, HAND_MS + 100);
  publish(session.id);
  return done;
}
