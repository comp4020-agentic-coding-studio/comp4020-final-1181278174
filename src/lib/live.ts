import { and, eq, ne } from "drizzle-orm";
import { db } from "./db.ts";
import { popularOrder, voteCount } from "./order.ts";
import { questions } from "./schema.ts";

// Live updates: every open page holds one server-sent events stream
// (src/pages/s/[code]/events.ts), and a write to a session tells its streams.
// There is one machine and one process, so the list of who is listening can
// live in memory. Nothing else does: counts are read from the database for
// every event.

/**
 * What every open page of a session is sent: how many people have it open,
 * and each question's id, vote count and state, in Popular order. A hidden
 * question is left out, for the host too: the host's own page lists those.
 */
export type Board = { here: number; questions: [id: number, votes: number, state: "open" | "answered"][] };

/** One open stream. `person` is null for a screen nobody is asking from (the projector page). */
type Listener = { person: string | null; send: (event: string) => void };

const listeners = new Map<number, Set<Listener>>();
const waiting = new Map<number, ReturnType<typeof setTimeout>>();

// Changes this close together go out as one event.
const GATHER_MS = 100;

/** The whole state, not a change: a page that missed events needs nothing replayed. */
export function board(sessionId: number): Board {
  const rows = db
    .select({ id: questions.id, votes: voteCount, state: questions.state })
    .from(questions)
    .where(and(eq(questions.sessionId, sessionId), ne(questions.state, "hidden")))
    .orderBy(...popularOrder)
    .all();
  return {
    here: here(sessionId),
    questions: rows.map((q) => [q.id, Number(q.votes), q.state === "answered" ? "answered" : "open"]),
  };
}

/** How many people have the session open. People, not tabs; only the number ever leaves here. */
export function here(sessionId: number): number {
  const people = new Set<string>();
  for (const { person } of listeners.get(sessionId) ?? []) if (person) people.add(person);
  return people.size;
}

/** A new question as the open pages are sent it: enough to draw the card, and no person. */
export type Added = { id: number; body: string; at: number };

/**
 * A question was asked: send it to the open pages, so they can draw it without
 * fetching. Everyone it is sent to gets the same text. The person who asked is
 * left out: their pages see an id they don't know in the next state and fetch
 * the page, where the server marks the question theirs. That way "Yours" never
 * travels in a message.
 */
export function announce(sessionId: number, question: Added, asker: string): void {
  const event = `event: question\ndata: ${JSON.stringify(question)}\n\n`;
  for (const listener of listeners.get(sessionId) ?? []) {
    if (listener.person !== asker) listener.send(event);
  }
}

/** One event as it goes down the wire. The same text is sent to everyone: it has no person in it. */
export const asEvent = (state: Board): string => `data: ${JSON.stringify(state)}\n\n`;

/** Listen to a session; the returned function stops listening. Both tell the others, since the count changed. */
export function listen(sessionId: number, listener: Listener): () => void {
  let room = listeners.get(sessionId);
  if (!room) listeners.set(sessionId, (room = new Set()));
  room.add(listener);
  publish(sessionId);
  return () => {
    if (!room.delete(listener)) return;
    if (room.size === 0) listeners.delete(sessionId);
    publish(sessionId);
  };
}

/** Something in this session changed: tell every open page, soon. */
export function publish(sessionId: number): void {
  if (waiting.has(sessionId) || !listeners.has(sessionId)) return;
  waiting.set(
    sessionId,
    setTimeout(() => {
      waiting.delete(sessionId);
      const room = listeners.get(sessionId);
      if (!room) return;
      const event = asEvent(board(sessionId));
      for (const listener of room) listener.send(event);
    }, GATHER_MS),
  );
}
