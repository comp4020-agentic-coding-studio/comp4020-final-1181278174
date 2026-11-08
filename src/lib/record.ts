import { asc, eq, sql } from "drizzle-orm";
import { db } from "./db.ts";
import { classesOf, latestClass } from "./classes.ts";
import { goingOversOf } from "./going-over.ts";
import { HAND_MS } from "./hall.ts";
import { hands, marks, presence, sessions } from "./schema.ts";

// The hall's record: when the room was lost. Every hand is kept with when it
// went up and came down (src/lib/room.ts), and every minute keeps how many
// people had the session open. The timeline is worked out from those two:
// how many hands were up in each minute, out of how many people. Counts only:
// nothing here says whose hand, and nothing leaves here but numbers.

const MINUTE = 60_000;
// A dropped stream or a restart must not leave its last count here all night.
const CARRY_MINUTES = 2;
// a quiet spell longer than this starts a new sitting: the next lecture, or the marker's second visit
const GAP_MINUTES = 20;
// how many sittings the timeline shows, newest first
const SHOWN = 5;

/** Who started a session: the host, whose hands the record never counts. */
const hostOf = (sessionId: number): string | null =>
  db.select({ host: sessions.host }).from(sessions).where(eq(sessions.id, sessionId)).get()?.host ?? null;

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

/** Keep a row each minute even when an open session has no changes. Returns a way to stop the heartbeat. */
export function startPresenceHeartbeat(current: () => Iterable<readonly [sessionId: number, here: number]>): () => void {
  const timer = setInterval(() => {
    const at = Date.now();
    for (const [sessionId, here] of current()) notePresence(sessionId, here, at);
  }, MINUTE);
  timer.unref();
  return () => clearInterval(timer);
}

/** One minute of the timeline: when it starts, how many were here, and how many of them had a hand up. */
export type Minute = { at: Date; here: number; lost: number };
/** A stretch of time with someone in the session, with no quiet spell longer than GAP_MINUTES. */
export type Sitting = { from: Date; to: Date; minutes: Minute[]; most: number; mostLost: number };

/** The newest sittings first, each minute by minute. `hereNow` is how many have it open at this moment. */
export function sittings(sessionId: number, hereNow: number, now = Date.now()): Sitting[] {
  const rows = db.select().from(presence).where(eq(presence.sessionId, sessionId)).orderBy(asc(presence.minute)).all();
  // the host's own moments: Going over it, and each class's start and end
  const eventMinutes = [
    ...goingOversOf(sessionId).map((event) => event.at),
    ...classesOf(sessionId).flatMap((c) => (c.endedAt ? [c.startedAt, c.endedAt] : [c.startedAt])),
  ].map((at) => Math.floor(at.getTime() / MINUTE)).sort((a, b) => a - b);
  if (rows.length === 0 && eventMinutes.length === 0) return [];
  const nowMinute = Math.floor(now / MINUTE);
  const end = hereNow > 0 ? nowMinute : Math.max(rows.at(-1)?.minute ?? 0, eventMinutes.at(-1) ?? 0);

  // A missing row gets at most two minutes of grace. Longer gaps are quiet,
  // including after a restart that never got to write a final zero.
  const counted: { minute: number; here: number }[] = [];
  // a long quiet spell is skipped over rather than walked minute by minute
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const next = i + 1 < rows.length ? rows[i + 1].minute : end + 1;
    counted.push({ minute: row.minute, here: row.most });
    if (row.last > 0) {
      const carriedTo = Math.min(next - 1, end, row.minute + CARRY_MINUTES);
      for (let m = row.minute + 1; m <= carriedTo; m++) counted.push({ minute: m, here: row.last });
    }
  }
  // A host can press Going over it, or start or end a class, without a student
  // stream open. Keep that minute in the record too, without counting the host
  // as someone here.
  const activity = new Map(counted.filter((c) => c.here > 0).map((c) => [c.minute, c]));
  for (const minute of eventMinutes) {
    if (!activity.has(minute)) activity.set(minute, { minute, here: 0 });
  }
  const occupied = [...activity.values()].sort((a, b) => a.minute - b.minute);
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
    // the host teaches and has no hand: a row of theirs, however it got there, is not counted
    .filter((h) => h.person !== hostOf(sessionId))
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
  // the zone's offset at that moment, e.g. "GMT+11:00" in summer
  const offset = (ms: number): number => {
    const name =
      new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", timeZoneName: "longOffset" })
        .formatToParts(new Date(ms))
        .find((part) => part.type === "timeZoneName")?.value ?? "";
    const o = /GMT([+-])(\d{2}):?(\d{2})?/.exec(name);
    return o ? (o[1] === "-" ? -1 : 1) * (Number(o[2]) * 60 + Number(o[3] ?? 0)) : 0;
  };
  /** That time of day on the day `day` falls on, in Canberra. */
  const on = (day: Date): Date => {
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit" }).format(day);
    const guess = Date.parse(`${date}T${m[1].padStart(2, "0")}:${m[2]}:00Z`);
    return new Date(guess - offset(guess) * MINUTE);
  };
  // A recording can't start later than now: a time still to come today is
  // yesterday's, as when "23:55" is given at five past midnight.
  const today = on(ref);
  return today.getTime() > ref.getTime() + 5 * MINUTE ? on(new Date(ref.getTime() - 24 * 60 * MINUTE)) : today;
}

/** How many people had a hand up in each of the last `minutes` minutes, oldest first, this minute last. */
export function recentLost(sessionId: number, minutes = 15, now = Date.now()): number[] {
  const end = Math.floor(now / MINUTE);
  const start = end - minutes + 1;
  const raised = db
    .select({ person: hands.person, raisedAt: hands.raisedAt, loweredAt: hands.loweredAt })
    .from(hands)
    .where(sql`${hands.sessionId} = ${sessionId} AND ${hands.raisedAt} >= ${start * MINUTE - HAND_MS}`)
    .all()
    // the host teaches and has no hand: a row of theirs, however it got there, is not counted
    .filter((h) => h.person !== hostOf(sessionId))
    .map((h) => ({
      person: h.person,
      up: h.raisedAt.getTime(),
      down: Math.min(h.loweredAt?.getTime() ?? h.raisedAt.getTime() + HAND_MS, h.raisedAt.getTime() + HAND_MS, now),
    }));
  return Array.from({ length: minutes }, (_, i) => {
    const from = (start + i) * MINUTE;
    return new Set(raised.filter((h) => h.up < from + MINUTE && h.down > from).map((h) => h.person)).size;
  });
}

/** The part of the class the host is teaching: where it starts, its mark, and its minute with the most hands up. */
export type PartSoFar = { from: Date; label: string | null; most: Minute | null };

/**
 * For the host's next pause: the part so far, since the last mark in this class
 * or since the class started, and its minute with the most hands up (the later
 * one when two tie). Hands that have come down since still count in the minutes
 * they were up. Null while no class is on.
 */
export function partSoFar(sessionId: number, hereNow: number, now = Date.now()): PartSoFar | null {
  const lesson = latestClass(sessionId);
  if (!lesson || lesson.endedAt) return null;
  const mark = marksOf(sessionId).filter((m) => m.at >= lesson.startedAt).at(-1);
  const from = mark?.at ?? lesson.startedAt;
  const start = Math.floor(from.getTime() / MINUTE) * MINUTE;
  // every sitting in the part, not only the newest: the room may have been empty a while
  const minutes = sittings(sessionId, hereNow, now)
    .flatMap((s) => s.minutes)
    .filter((m) => m.at.getTime() >= start)
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    // the part's first minute counts only the hands that were up after the part began
    .map((m) => (m.at.getTime() === start ? { ...m, lost: lostWithin(sessionId, from.getTime(), start + MINUTE, now) } : m))
    .filter((m) => m.lost > 0);
  const most = minutes.reduce<Minute | null>((best, m) => (!best || m.lost >= best.lost ? m : best), null);
  return { from, label: mark?.label ?? null, most };
}

/** How many people had a hand up at some moment from `from` until `to`: a count, never who. */
function lostWithin(sessionId: number, from: number, to: number, now: number): number {
  const host = hostOf(sessionId);
  const rows = db
    .select({ person: hands.person, raisedAt: hands.raisedAt, loweredAt: hands.loweredAt })
    .from(hands)
    .where(sql`${hands.sessionId} = ${sessionId} AND ${hands.raisedAt} < ${to} AND ${hands.raisedAt} >= ${from - HAND_MS}`)
    .all();
  const up = rows.filter((h) => {
    const down = Math.min(h.loweredAt?.getTime() ?? h.raisedAt.getTime() + HAND_MS, h.raisedAt.getTime() + HAND_MS, now);
    return h.person !== host && h.raisedAt.getTime() < to && down > from;
  });
  return new Set(up.map((h) => h.person)).size;
}

/** The class that ended, for the host until the next one starts: when, and its minutes with the most hands up. */
export type ClassRecap = { from: Date; to: Date; busiest: Minute[] };

/**
 * The newest class, once it has ended: its minutes with the most hands up,
 * most first (the earlier one when two tie), at most three. Null while a class
 * is on or before the first one.
 */
export function classRecap(sessionId: number, hereNow: number, now = Date.now()): ClassRecap | null {
  const lesson = latestClass(sessionId);
  if (!lesson?.endedAt) return null;
  const from = Math.floor(lesson.startedAt.getTime() / MINUTE) * MINUTE;
  const to = lesson.endedAt.getTime();
  const minutes = sittings(sessionId, hereNow, now)
    .flatMap((s) => s.minutes)
    .filter((m) => m.at.getTime() >= from && m.at.getTime() < to && m.lost > 0);
  const busiest = minutes.sort((a, b) => b.lost - a.lost || a.at.getTime() - b.at.getTime()).slice(0, 3);
  return { from: lesson.startedAt, to: lesson.endedAt, busiest };
}
