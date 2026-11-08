import { and, asc, desc, eq, isNull } from "drizzle-orm";
import type { Session } from "./board.ts";
import { db } from "./db.ts";
import { classes, hands } from "./schema.ts";

// A class: the host starts it, and hands can go up until the host ends it.
// End class and every hand comes down. The same code can hold a class every
// week; each one is kept, so the timeline can show when each began and ended.
// HAND, open to strangers and hosted by the maker of the app, is always on.

export type ClassState = "before" | "on" | "over";
/** One class: when it started, and when it ended (null while it is on). */
export type Class = { startedAt: Date; endedAt: Date | null };

/** The newest class in a session, if it has had one. */
export function latestClass(sessionId: number): Class | undefined {
  return db.select({ startedAt: classes.startedAt, endedAt: classes.endedAt }).from(classes)
    .where(eq(classes.sessionId, sessionId)).orderBy(desc(classes.startedAt), desc(classes.id)).get();
}

/** Every class in a session, oldest first. */
export function classesOf(sessionId: number): Class[] {
  return db.select({ startedAt: classes.startedAt, endedAt: classes.endedAt }).from(classes)
    .where(eq(classes.sessionId, sessionId)).orderBy(asc(classes.startedAt), asc(classes.id)).all();
}

/** Whether hands can go up: before the first class, while one is on, or after it ended. */
export function classState(session: Pick<Session, "id" | "code">): ClassState {
  if (session.code === "HAND") return "on";
  const latest = latestClass(session.id);
  return !latest ? "before" : latest.endedAt ? "over" : "on";
}

/** Start a class now. False when one is already on. */
export function beginClass(sessionId: number, at: Date): boolean {
  return db.transaction((tx) => {
    const on = tx.select({ id: classes.id }).from(classes)
      .where(and(eq(classes.sessionId, sessionId), isNull(classes.endedAt))).get();
    if (on) return false;
    tx.insert(classes).values({ sessionId, startedAt: at }).run();
    return true;
  });
}

/** End the class that is on and take every hand down. How many came down, or null when no class was on. */
export function finishClass(sessionId: number, at: Date): number | null {
  return db.transaction((tx) => {
    const ended = tx.update(classes).set({ endedAt: at })
      .where(and(eq(classes.sessionId, sessionId), isNull(classes.endedAt))).run().changes;
    if (ended === 0) return null;
    return tx.update(hands).set({ loweredAt: at, ended: "lowered" })
      .where(and(eq(hands.sessionId, sessionId), isNull(hands.loweredAt))).run().changes;
  });
}
