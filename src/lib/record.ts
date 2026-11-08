import { asc, eq, sql } from "drizzle-orm";
import { db } from "./db.ts";
import { HAND_MS } from "./hall.ts";
import { hands, marks, presence, sessions } from "./schema.ts";

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

/** The longest a mark's name can be. */
export const MAX_MARK = 60;

/** A mark on the timeline: when, and the part of the lecture that starts there. */
export type Mark = { at: Date; label: string };

/** Every mark in a session, oldest first. */
export function marksOf(sessionId: number): Mark[] {
  return db
    .select({ at: marks.at, label: marks.label })
    .from(marks)
    .where(eq(marks.sessionId, sessionId))
    .orderBy(asc(marks.at), asc(marks.id))
    .all();
}

/** Add a mark now. An empty name becomes "Part N". */
export function addMark(sessionId: number, label: string, at = new Date()): Mark {
  const name = label.trim() || `Part ${marksOf(sessionId).length + 1}`;
  db.insert(marks).values({ sessionId, at, label: name }).run();
  return { at, label: name };
}

/** When the lecture's recording started. */
export function setRecording(sessionId: number, at: Date): void {
  db.update(sessions).set({ recordingAt: at }).where(eq(sessions.id, sessionId)).run();
}

/** The part of the lecture a moment falls in: the last mark at or before it. */
export const partAt = (all: Mark[], at: Date): Mark | undefined => all.filter((m) => m.at.getTime() <= at.getTime() + MINUTE - 1).at(-1);

/** How far into the recording a moment is, in whole minutes; undefined before it started or with no recording. */
export function intoRecording(recordingAt: Date | null, at: Date): number | undefined {
  if (!recordingAt) return undefined;
  const minutes = Math.floor((at.getTime() - recordingAt.getTime()) / MINUTE);
  return minutes >= 0 ? minutes : undefined;
}

/** A time of day typed in the room ("14:02"), on the day `ref` falls on in Canberra, as a moment. */
export function atCanberra(ref: Date, hhmm: string): Date | undefined {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(hhmm.trim());
  if (!m) return undefined;
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit" }).format(ref);
  const guess = Date.parse(`${date}T${m[1].padStart(2, "0")}:${m[2]}:00Z`);
  // the zone's offset at that moment, e.g. "GMT+11:00" in summer
  const offset = (ms: number): number => {
    const name =
      new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", timeZoneName: "longOffset" })
        .formatToParts(new Date(ms))
        .find((part) => part.type === "timeZoneName")?.value ?? "";
    const o = /GMT([+-])(\d{2}):?(\d{2})?/.exec(name);
    return o ? (o[1] === "-" ? -1 : 1) * (Number(o[2]) * 60 + Number(o[3] ?? 0)) : 0;
  };
  return new Date(guess - offset(guess) * MINUTE);
}
