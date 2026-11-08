import { asc, desc, eq } from "drizzle-orm";
import { db } from "./db.ts";
import { GOING_OVER_MS } from "./hall.ts";
import { goingOvers } from "./schema.ts";

/** How long the current banner has been showing, in ms, or null after two minutes. */
export function goingOverAge(sessionId: number): number | null {
  const row = db.select({ at: goingOvers.at }).from(goingOvers)
    .where(eq(goingOvers.sessionId, sessionId)).orderBy(desc(goingOvers.at)).get();
  if (!row) return null;
  const age = Math.max(0, Date.now() - row.at.getTime());
  return age < GOING_OVER_MS ? age : null;
}

/** Record a new moment only if the previous banner has ended. No hand is changed. */
export function recordGoingOver(sessionId: number): boolean {
  // Take the write lock before checking: two simultaneous presses cannot both
  // see an expired banner and insert, even through separate DB connections.
  return db.transaction((tx) => {
    const now = new Date();
    const last = tx.select({ at: goingOvers.at }).from(goingOvers)
      .where(eq(goingOvers.sessionId, sessionId)).orderBy(desc(goingOvers.at)).get();
    if (last && now.getTime() - last.at.getTime() < GOING_OVER_MS) return false;
    tx.insert(goingOvers).values({ sessionId, at: now }).run();
    return true;
  }, { behavior: "immediate" });
}

/** The saved moments, oldest first; no part labels or person identifiers. */
export function goingOversOf(sessionId: number): { at: Date }[] {
  return db.select({ at: goingOvers.at }).from(goingOvers)
    .where(eq(goingOvers.sessionId, sessionId)).orderBy(asc(goingOvers.at), asc(goingOvers.id)).all();
}
