import { asc, eq, sql } from "drizzle-orm";
import { db } from "./db.ts";
import { HAND_MS } from "./hall.ts";
import { hands, presence } from "./schema.ts";

// The hall's record: when the room was lost. Every hand is kept with when it
// went up and came down (src/lib/room.ts), and every minute keeps how many
// people had the session open. The timeline is worked out from those two:
// how many hands were up in each minute, out of how many people. Counts only:
// nothing here says whose hand, and nothing leaves here but numbers.

const MINUTE = 60_000;
// a quiet spell longer than this starts a new sitting: the next lecture, or the marker's second visit
const GAP_MINUTES = 20;
// how many sittings the timeline shows, newest first
const SHOWN = 5;

/** Count the people here now in this minute's row. */
export function notePresence(sessionId: number, here: number, at = Date.now()): void {
  const minute = Math.floor(at / MINUTE);
  db.insert(presence)
    .values({ sessionId, minute, most: here, last: here })
    .onConflictDoUpdate({
      target: [presence.sessionId, presence.minute],
      set: { most: sql`max(${presence.most}, ${here})`, last: here },
    })
    .run();
}

/** One minute of the timeline: when it starts, how many were here, and how many of them had a hand up. */
export type Minute = { at: Date; here: number; lost: number };
/** A stretch of time with someone in the session, with no quiet spell longer than GAP_MINUTES. */
export type Sitting = { from: Date; to: Date; minutes: Minute[]; most: number; mostLost: number };

/** The newest sittings first, each minute by minute. `hereNow` is how many have it open at this moment. */
export function sittings(sessionId: number, hereNow: number, now = Date.now()): Sitting[] {
  const rows = db.select().from(presence).where(eq(presence.sessionId, sessionId)).orderBy(asc(presence.minute)).all();
  if (rows.length === 0) return [];
  const byMinute = new Map(rows.map((row) => [row.minute, row]));
  const nowMinute = Math.floor(now / MINUTE);
  const lastRow = rows[rows.length - 1];
  const end = hereNow > 0 ? nowMinute : lastRow.minute;

  // every minute from the first row on, with the count carried over a minute that has no row
  const counted: { minute: number; here: number }[] = [];
  let carry = 0;
  // a long quiet spell is skipped over rather than walked minute by minute
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const next = i + 1 < rows.length ? rows[i + 1].minute : end + 1;
    counted.push({ minute: row.minute, here: row.most });
    carry = row.last;
    if (carry > 0) {
      for (let m = row.minute + 1; m < next && m <= end; m++) counted.push({ minute: m, here: carry });
    }
  }
  const occupied = counted.filter((c) => c.here > 0);
  if (occupied.length === 0) return [];

  // split into sittings at quiet spells
  const groups: { minute: number; here: number }[][] = [];
  for (const c of occupied) {
    const group = groups.at(-1);
    if (group && c.minute - group[group.length - 1].minute <= GAP_MINUTES) group.push(c);
    else groups.push([c]);
  }
  const shown = groups.slice(-SHOWN).reverse();

  // the hands that could fall in these sittings, each as the stretch it was up
  const from = shown.at(-1)![0].minute * MINUTE;
  const raised = db
    .select({ person: hands.person, raisedAt: hands.raisedAt, loweredAt: hands.loweredAt })
    .from(hands)
    .where(sql`${hands.sessionId} = ${sessionId} AND ${hands.raisedAt} >= ${from - HAND_MS}`)
    .all()
    .map((h) => ({
      person: h.person,
      up: h.raisedAt.getTime(),
      down: Math.min(h.loweredAt?.getTime() ?? h.raisedAt.getTime() + HAND_MS, h.raisedAt.getTime() + HAND_MS, now),
    }));

  return shown.map((group) => {
    // fill the short gaps inside a sitting, so its minutes are continuous
    const first = group[0].minute;
    const last = group[group.length - 1].minute;
    const here = new Map(group.map((c) => [c.minute, c.here]));
    const minutes: Minute[] = [];
    for (let m = first; m <= last; m++) {
      const start = m * MINUTE;
      const people = new Set(raised.filter((h) => h.up < start + MINUTE && h.down > start).map((h) => h.person));
      // someone without the page's script has a hand but no stream open: they were here too
      minutes.push({ at: new Date(start), here: Math.max(here.get(m) ?? 0, people.size), lost: people.size });
    }
    return {
      from: new Date(first * MINUTE),
      to: new Date((last + 1) * MINUTE),
      minutes,
      most: Math.max(...minutes.map((m) => m.here)),
      mostLost: Math.max(...minutes.map((m) => m.lost)),
    };
  });
}
