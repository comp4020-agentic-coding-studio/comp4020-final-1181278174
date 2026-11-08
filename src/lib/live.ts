import { and, eq, ne } from "drizzle-orm";
import { db } from "./db.ts";
import { goingOverAge } from "./going-over.ts";
import { GOING_OVER_MS } from "./hall.ts";
import { popularOrder, voteCount } from "./order.ts";
import { notePresence, startPresenceHeartbeat } from "./record.ts";
import { handHolders, handsUp } from "./room.ts";
import { questions, sessions } from "./schema.ts";

// Live updates: every open page holds one server-sent events stream
// (src/pages/s/[code]/events.ts), and a write to a session tells its streams.
// There is one machine and one process, so the list of who is listening can
// live in memory. Nothing else does: counts are read from the database for
// every event.

/**
 * What every open page of a session is sent: how many people have it open,
 * and each question's id, vote count and state, in Popular order. A hidden
 * question is left out, for the host too: the host's own page lists those.
 * Then the hall: the hands up among the people here, each as how many ms it
 * has been up. Never whose hand it is: each screen places its own figures.
 */
export type Board = {
  here: number;
  questions: [id: number, votes: number, state: "open" | "answered"][];
  hands: number[];
  goingOver: number | null;
};

/** One open stream. `person` is null for a signed-out viewer or projector. */
type Listener = {
  person: string | null;
  send: (event: string) => void;
  // the sign-in it was opened under (its token's digest), and how to end it
  signIn?: string;
  end?: () => void;
};

const listeners = new Map<number, Set<Listener>>();
const waiting = new Map<number, ReturnType<typeof setTimeout>>();
const goingOverTimers = new Map<number, ReturnType<typeof setTimeout>>();
startPresenceHeartbeat(() => [...listeners.keys()].map((id) => [id, here(id)] as const));

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
  const present = [...people(sessionId)];
  const goingOver = goingOverAge(sessionId);
  // A connection opened after a restart also schedules the remaining time.
  // Only one expiry is needed per session, however often its state changes.
  if (goingOver !== null && !goingOverTimers.has(sessionId)) {
    const timer = setTimeout(() => {
      goingOverTimers.delete(sessionId);
      publish(sessionId);
    }, GOING_OVER_MS - goingOver);
    timer.unref();
    goingOverTimers.set(sessionId, timer);
  } else if (goingOver === null) {
    clearTimeout(goingOverTimers.get(sessionId));
    goingOverTimers.delete(sessionId);
  }
  return {
    here: present.length,
    questions: rows.map((q) => [q.id, Number(q.votes), q.state === "answered" ? "answered" : "open"]),
    hands: handsUp(sessionId, present),
    goingOver,
  };
}

// Who started each session: the host teaches, so they are not one of the
// people "here" and have no hand. A host can be changed on the server (HAND's
// was), so read the current host each time.
function hostOf(sessionId: number): string | null {
  const row = db.select({ host: sessions.host }).from(sessions).where(eq(sessions.id, sessionId)).get();
  return row?.host ?? null;
}

/**
 * Everyone with the session open, and everyone whose hand is still up, the
 * host left out. A hand stays in the room until it comes down, whether or not
 * its page is open: a hand that vanished when a phone locked and came back
 * when it woke would show whose it was. Never sent anywhere: only how many.
 */
export function people(sessionId: number): Set<string> {
  const host = hostOf(sessionId);
  const found = new Set<string>(handHolders(sessionId));
  for (const { person } of listeners.get(sessionId) ?? []) if (person) found.add(person);
  if (host) found.delete(host);
  return found;
}

/** How many people have the session open. People, not tabs; only the number ever leaves here. */
export function here(sessionId: number): number {
  return people(sessionId).size;
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
  // the timeline's "out of how many" (src/lib/record.ts)
  notePresence(sessionId, here(sessionId));
  publish(sessionId);
  return () => {
    if (!room.delete(listener)) return;
    if (room.size === 0) {
      listeners.delete(sessionId);
      clearTimeout(goingOverTimers.get(sessionId));
      goingOverTimers.delete(sessionId);
    }
    notePresence(sessionId, here(sessionId));
    publish(sessionId);
  };
}

/** A sign-in ended: its open streams end too, so they stop counting or standing for that account. */
export function endStreamsOf(signIn: string): void {
  for (const room of listeners.values()) {
    for (const listener of [...room]) if (listener.signIn === signIn) listener.end?.();
  }
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

/**
 * A report, or a report taken back. Only the host's pages show the count and
 * only the reporter's own pages show "You reported", so only those are told,
 * and each fetches its own page again. Everyone else hears nothing, not even
 * that something happened.
 */
export function nudge(sessionId: number, person: string): void {
  const told = new Set([hostOf(sessionId), person]);
  for (const listener of listeners.get(sessionId) ?? []) {
    if (listener.person !== null && told.has(listener.person)) listener.send("event: refresh\ndata: {}\n\n");
  }
}

/** Tell every open page again after `ms`: when a hand runs out, the pages are told it is down. */
export function publishAfter(sessionId: number, ms: number): void {
  setTimeout(() => publish(sessionId), ms);
}
