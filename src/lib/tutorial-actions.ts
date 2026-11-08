import { randomInt } from "node:crypto";
import { and, asc, count, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { accountRefusal } from "./abuse.ts";
import { isHost, type Session, UNSHOWABLE } from "./board.ts";
import { beginClass, classState, finishClass } from "./classes.ts";
import { db } from "./db.ts";
import { publish } from "./live.ts";
import type { Fields } from "./log.ts";
import { tutorialRequests, tutorialSessions } from "./schema.ts";
import { tutorialFor } from "./tutorial.ts";

type Log = (what: string, fields?: Fields) => void;
export type TutorialResult = { ok: true } | { ok: false; status: number; error: string; retryAfter?: number };
export const MAX_EXERCISE = 80;
export const MAX_MINUTES = 120;
const MAX_REQUESTS = 1000;
const intents = ["tutorial-join", "tutorial-leave", "tutorial-call", "tutorial-finish", "tutorial-exercise", "tutorial-clear-exercise", "class-start", "class-end"] as const;
type Intent = typeof intents[number];

/** Forms post here only after the page has checked the account is signed in. */
export function tutorialAction(session: Session, person: string, form: FormData, log: Log): TutorialResult {
  const raw = form.get("intent");
  const intent = intents.find((candidate) => candidate === raw);
  const refuse = (status: number, reason: string, error: string): TutorialResult => {
    // An unrecognised intent, like an exercise label, is never copied to logs.
    log("refused", { action: intent ?? "tutorial", session: session.code, reason });
    return { ok: false, status, error };
  };
  const tutorial = tutorialFor(session.id);
  if (!tutorial) return refuse(404, "not-tutorial", "This session has no tutorial room.");
  if (!intent) return refuse(422, "no-such-action", "That action isn't available. Refresh the page and try again.");
  const host = isHost(session, person);
  const studentAction = intent === "tutorial-join" || intent === "tutorial-leave";
  if (studentAction && host) return refuse(403, "host-request", "The tutor helps the room and cannot join its help queue.");
  if (!studentAction && !host) return refuse(403, "not-host", "Only the tutor can use that control.");
  if (intent !== "class-start" && intent !== "class-end" && intent !== "tutorial-leave" && classState(session) !== "on") {
    return refuse(422, "class-not-on", "The tutorial isn't running. Help requests and exercises open when the tutor starts it.");
  }
  const allowance = studentAction ? "hand" : intent.startsWith("class-") ? "class" : "mark";
  const limited = accountRefusal(person, allowance, log, session.code);
  if (limited) return { ...limited, error: "Too many changes just now. Wait a moment and try again." };

  // The version changes in the same transaction as the action. A shared
  // event carries only this version and the exercise, never the queue.
  const changeVersion = () => db.update(tutorialSessions)
    .set({ revision: sql`${tutorialSessions.revision} + 1` })
    .where(eq(tutorialSessions.sessionId, session.id)).run();
  const finish = (changed: boolean, action: Intent = intent): TutorialResult => {
    log(changed ? action.replaceAll("-", "_") : `${action.replaceAll("-", "_")}_unchanged`, { session: session.code });
    if (changed) publish(session.id);
    return { ok: true };
  };
  const inSession = eq(tutorialRequests.sessionId, session.id);

  if (intent === "class-start" || intent === "class-end") {
    const changed = db.transaction(() => {
      const changedClass = intent === "class-start"
        ? beginClass(session.id, new Date())
        : finishClass(session.id, new Date()) !== null;
      if (!changedClass) return false;
      db.delete(tutorialRequests).where(inSession).run();
      db.update(tutorialSessions).set({ exercise: null, endsAt: null }).where(eq(tutorialSessions.sessionId, session.id)).run();
      changeVersion();
      return true;
    });
    return finish(changed);
  }

  if (intent === "tutorial-join") {
    const result = db.transaction(() => {
      const existing = db.select({ id: tutorialRequests.id }).from(tutorialRequests)
        .where(and(inSession, eq(tutorialRequests.person, person))).get();
      if (existing) return "unchanged";
      const total = db.select({ n: count() }).from(tutorialRequests).where(inSession).get()!.n;
      if (total >= MAX_REQUESTS) return "full";
      // Retry the rare ticket collision. The unique account key also means
      // repeated requests, including two tabs, hold just one place.
      for (;;) {
        const made = db.insert(tutorialRequests).values({
          sessionId: session.id,
          person,
          ticket: String(randomInt(1000, 10000)),
          requestedAt: new Date(),
        }).onConflictDoNothing().run();
        if (made.changes === 0) continue;
        changeVersion();
        return "joined";
      }
    });
    if (result === "full") return refuse(422, "queue-full", "The help queue is full. Please ask the tutor directly.");
    return finish(result === "joined");
  }

  if (intent === "tutorial-leave") {
    const changed = db.transaction(() => {
      const removed = db.delete(tutorialRequests).where(and(inSession, eq(tutorialRequests.person, person))).run().changes > 0;
      if (removed) changeVersion();
      return removed;
    });
    return finish(changed);
  }

  if (intent === "tutorial-call") {
    const changed = db.transaction(() => {
      const called = db.select({ id: tutorialRequests.id }).from(tutorialRequests)
        .where(and(inSession, isNotNull(tutorialRequests.calledAt))).get();
      if (called) return false;
      const next = db.select({ id: tutorialRequests.id }).from(tutorialRequests)
        .where(and(inSession, isNull(tutorialRequests.calledAt))).orderBy(asc(tutorialRequests.id)).get();
      if (!next) return false;
      db.update(tutorialRequests).set({ calledAt: new Date() }).where(eq(tutorialRequests.id, next.id)).run();
      changeVersion();
      return true;
    });
    return finish(changed);
  }

  if (intent === "tutorial-finish") {
    const given = String(form.get("request") ?? "");
    const request = Number(given);
    if (!/^[1-9]\d*$/.test(given) || !Number.isSafeInteger(request)) {
      return refuse(422, "no-request", "Refresh the page to finish the ticket being called.");
    }
    const changed = db.transaction(() => {
      const removed = db.delete(tutorialRequests)
        .where(and(inSession, eq(tutorialRequests.id, request), isNotNull(tutorialRequests.calledAt))).run().changes > 0;
      if (removed) changeVersion();
      return removed;
    });
    // An old finish cannot remove the next person, even if the old ticket's
    // four digits happen to be reused later. The row number is never reused.
    if (!changed) return refuse(404, "no-such-request", "That ticket is no longer being called. Refresh to see the current request.");
    return finish(changed);
  }

  if (intent === "tutorial-exercise") {
    const label = String(form.get("label") ?? "").trim();
    const given = String(form.get("minutes") ?? "").trim();
    const minutes = Number(given);
    if (!label) return refuse(422, "empty-exercise", "Give the exercise a short name.");
    if (UNSHOWABLE.test(label) || [...label].length > MAX_EXERCISE) {
      return refuse(422, "invalid-exercise", `Use up to ${MAX_EXERCISE} visible characters for the exercise name.`);
    }
    if (!/^\d+$/.test(given) || !Number.isInteger(minutes) || minutes < 1 || minutes > MAX_MINUTES) {
      return refuse(422, "invalid-minutes", `Choose a whole number of minutes from 1 to ${MAX_MINUTES}.`);
    }
    db.transaction(() => {
      db.update(tutorialSessions).set({ exercise: label, endsAt: new Date(Date.now() + minutes * 60_000) })
        .where(eq(tutorialSessions.sessionId, session.id)).run();
      changeVersion();
    });
    return finish(true);
  }

  // A stale stop button must not stop a newer exercise. Queue changes do not
  // invalidate this button: the expected deadline, not the revision, guards it.
  const given = String(form.get("endsAt") ?? "");
  const endsAt = Number(given);
  if (!/^\d+$/.test(given) || !Number.isSafeInteger(endsAt)) {
    return refuse(422, "no-exercise", "Refresh the page to clear the current exercise.");
  }
  const changed = db.transaction(() => {
    const cleared = db.update(tutorialSessions).set({ exercise: null, endsAt: null })
      .where(and(eq(tutorialSessions.sessionId, session.id), eq(tutorialSessions.endsAt, new Date(endsAt)))).run().changes > 0;
    if (cleared) changeVersion();
    return cleared;
  });
  if (!changed) return refuse(422, "exercise-changed", "The exercise changed. Refresh before clearing it.");
  return finish(changed);
}
