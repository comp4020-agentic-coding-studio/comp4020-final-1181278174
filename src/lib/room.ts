import { and, eq, gt, inArray, isNull, lte, sql } from "drizzle-orm";
import { db } from "./db.ts";
import { HAND_MS } from "./hall.ts";
import { hands } from "./schema.ts";

// The hall: whose hand is up. How many hands are up, and how long each has
// been up, are all that leave this module: never whose hand it is, and no
// seat, since there are no seats on the server: each screen places its own
// figures. Telling the room is src/lib/live.ts's job.

/** What a press of "I'm lost" did. */
export type Hand = "raised" | "lowered" | "unchanged";

/** Put this person's hand up (want) or down. Up twice is still one hand; the index on `hands` holds that. */
export function setHand(sessionId: number, person: string, want: boolean): Hand {
  const now = new Date();
  return db.transaction((tx) => {
    // a hand older than HAND_MS came down by itself, at the moment it ran out
    tx.update(hands)
      .set({ loweredAt: sql`${hands.raisedAt} + ${HAND_MS}`, ended: "expired" })
      .where(
        and(
          eq(hands.sessionId, sessionId),
          eq(hands.person, person),
          isNull(hands.loweredAt),
          lte(hands.raisedAt, new Date(now.getTime() - HAND_MS)),
        ),
      )
      .run();
    if (want) {
      const { changes } = tx.insert(hands).values({ sessionId, person, raisedAt: now }).onConflictDoNothing().run();
      return changes > 0 ? "raised" : "unchanged";
    }
    const { changes } = tx
      .update(hands)
      .set({ loweredAt: now, ended: "lowered" })
      .where(and(eq(hands.sessionId, sessionId), eq(hands.person, person), isNull(hands.loweredAt)))
      .run();
    return changes > 0 ? "lowered" : "unchanged";
  });
}

const upNow = (sessionId: number, now: number) =>
  and(eq(hands.sessionId, sessionId), isNull(hands.loweredAt), gt(hands.raisedAt, new Date(now - HAND_MS)));

/** How many ms this person's hand has been up, or undefined if it is down. For their own page only. */
export function handOf(sessionId: number, person: string): number | undefined {
  const now = Date.now();
  const row = db
    .select({ raisedAt: hands.raisedAt })
    .from(hands)
    .where(and(upNow(sessionId, now), eq(hands.person, person)))
    .get();
  return row ? now - row.raisedAt.getTime() : undefined;
}

/** The hands up now among these people: how many ms each has been up, shortest first. No person, no seat. */
export function handsUp(sessionId: number, people: readonly string[]): number[] {
  if (people.length === 0) return [];
  const now = Date.now();
  return db
    .select({ raisedAt: hands.raisedAt })
    .from(hands)
    .where(and(upNow(sessionId, now), inArray(hands.person, [...people])))
    .all()
    .map((row) => now - row.raisedAt.getTime())
    .sort((a, b) => a - b);
}
