import { and, eq } from "drizzle-orm";
import { isHost, type Session, setState, setVote, STATES, UNSHOWABLE } from "./board.ts";
import { beginClass, finishClass } from "./classes.ts";
import { db } from "./db.ts";
import { here, nudge, publish } from "./live.ts";
import { recordGoingOver } from "./going-over.ts";
import { addMark, atCanberra, MAX_MARK, notePresence, setRecording } from "./record.ts";
import { questions, reports } from "./schema.ts";
import { tagFor } from "./tags.ts";
import { accountRefusal, type Refused } from "./abuse.ts";

// What a form sent to either part of a session does, where both parts take the
// same form: "Me too" is on the questions page and on the hall's three most
// wanted. Each returns the question to come back to, or the status to refuse with.

type Log = (what: string, fields?: Record<string, string | number | undefined>) => void;
type Done = { ok: true; question: number } | Refused;

/** The host is going over it now. Repeating this while active changes nothing. */
export function goingOver(session: Session, person: string, log: Log): { ok: true } | Refused {
  if (!isHost(session, person)) {
    log("refused", { action: "going_over", session: session.code, reason: "not-host" });
    return { ok: false, status: 403 };
  }
  const limited = accountRefusal(person, "going_over", log, session.code);
  if (limited) return limited;
  const changed = recordGoingOver(session.id);
  log(changed ? "going_over_started" : "going_over_unchanged", { session: session.code });
  if (changed) publish(session.id);
  return { ok: true };
}

/** "Me too", or taking it back: `want` 1 or 0, never "toggle". */
export function vote(session: Session, person: string, form: FormData, log: Log): Done {
  // a question this person can't see takes no vote, and is a 404 to them
  const id = Number(form.get("question"));
  // a vote says 1 or 0; anything else changes nothing, rather than taking a vote back
  const given = form.get("want");
  if (given !== "1" && given !== "0") {
    log("refused", { action: "vote", session: session.code, reason: "no-such-want" });
    return { ok: false, status: 422 };
  }
  const want = given === "1";
  const limited = accountRefusal(person, "vote", log, session.code);
  if (limited) return limited;
  const done = Number.isInteger(id) && id > 0 ? setVote(session, id, person, want) : "no-such-question";
  if (done === "changed" || done === "unchanged") {
    const what = done === "unchanged" ? "vote_unchanged" : want ? "vote_given" : "vote_taken_back";
    log(what, { session: session.code, question: id });
    return { ok: true, question: id };
  }
  log("refused", { action: "vote", session: session.code, question: Number.isInteger(id) ? id : undefined, reason: done });
  return { ok: false, status: 404 };
}

/** Report a visible question once per signed-in account; the pages enforce sign-in. */
export function report(session: Session, person: string, form: FormData, log: Log): Done {
  const id = Number(form.get("question"));
  const found = Number.isInteger(id)
    ? db.select({ state: questions.state }).from(questions)
      .where(and(eq(questions.id, id), eq(questions.sessionId, session.id))).get()
    : undefined;
  const reason = !found ? "no-such-question" : found.state === "hidden" ? "hidden" : undefined;
  if (reason) {
    log("refused", { action: "report", session: session.code, question: Number.isInteger(id) ? id : undefined, reason });
    return { ok: false, status: 404 };
  }
  // a session with no host has no one to receive a report
  if (session.host === null) {
    log("refused", { action: "report", session: session.code, question: id, reason: "no-host" });
    return { ok: false, status: 422 };
  }
  const limited = accountRefusal(person, "report", log, session.code);
  if (limited) return limited;
  const { changes } = db.insert(reports)
    .values({ questionId: id, reporter: tagFor("reporter", person), createdAt: new Date() })
    .onConflictDoNothing().run();
  log("question_reported", { session: session.code, question: id });
  if (changes > 0) nudge(session.id, person);
  return { ok: true, question: id };
}

/** How long after reporting a question the report can be taken back. */
export const UNDO_MS = 60_000;

/** Take back this account's report of a question, within UNDO_MS of making it. */
export function unreport(session: Session, person: string, form: FormData, log: Log, now = Date.now()): Done {
  const id = Number(form.get("question"));
  const reporter = tagFor("reporter", person);
  const found = Number.isInteger(id) && id > 0
    ? db.select({ at: reports.createdAt }).from(reports).innerJoin(questions, eq(questions.id, reports.questionId))
      .where(and(eq(reports.questionId, id), eq(reports.reporter, reporter), eq(questions.sessionId, session.id))).get()
    : undefined;
  if (!found) {
    log("refused", { action: "unreport", session: session.code, reason: "no-such-report" });
    return { ok: false, status: 404 };
  }
  if (now - found.at.getTime() > UNDO_MS) {
    log("refused", { action: "unreport", session: session.code, question: id, reason: "too-late" });
    return { ok: false, status: 422 };
  }
  const limited = accountRefusal(person, "unreport", log, session.code);
  if (limited) return limited;
  db.delete(reports).where(and(eq(reports.questionId, id), eq(reports.reporter, reporter))).run();
  log("report_taken_back", { session: session.code, question: id });
  nudge(session.id, person);
  return { ok: true, question: id };
}

/** The host's buttons on a question. Anyone else who sends this is refused. */
export function mark(session: Session, person: string, form: FormData, log: Log): Done {
  const id = Number(form.get("question"));
  const to = STATES.find((state) => state === form.get("to"));
  if (to && isHost(session, person)) {
    const limited = accountRefusal(person, "mark", log, session.code);
    if (limited) return limited;
  }
  if (Number.isInteger(id) && to && setState(session, id, person, to)) {
    log("question_marked", { session: session.code, question: id, to });
    return { ok: true, question: id };
  }
  const reason = !to ? "no-such-state" : isHost(session, person) ? "no-such-question" : "not-host";
  log("refused", { action: "mark", session: session.code, question: Number.isInteger(id) ? id : undefined, reason });
  return { ok: false, status: !to ? 422 : reason === "no-such-question" ? 404 : 403 };
}

/** The host marks the start of a part of the lecture, now. Anyone else is refused. */
export function timelineMark(session: Session, person: string, form: FormData, log: Log): { ok: true } | Refused {
  const label = String(form.get("label") ?? "").trim();
  if (!isHost(session, person)) {
    log("refused", { action: "timeline_mark", session: session.code, reason: "not-host" });
    return { ok: false, status: 403 };
  }
  if ([...label].length > MAX_MARK || UNSHOWABLE.test(label)) {
    log("refused", { action: "timeline_mark", session: session.code, reason: "too-long" });
    return { ok: false, status: 422 };
  }
  const limited = accountRefusal(person, "timeline_mark", log, session.code);
  if (limited) return limited;
  addMark(session.id, label);
  log("timeline_marked", { session: session.code });
  publish(session.id);
  return { ok: true };
}

/** The host says when the recording started, as a time of day on the day `ref` falls on. */
export function recordingStart(session: Session, person: string, form: FormData, log: Log, ref: Date): { ok: true } | Refused {
  if (!isHost(session, person)) {
    log("refused", { action: "recording", session: session.code, reason: "not-host" });
    return { ok: false, status: 403 };
  }
  const at = atCanberra(ref, String(form.get("at") ?? ""));
  if (!at) {
    log("refused", { action: "recording", session: session.code, reason: "no-such-time" });
    return { ok: false, status: 422 };
  }
  const limited = accountRefusal(person, "recording", log, session.code);
  if (limited) return limited;
  setRecording(session.id, at);
  log("recording_set", { session: session.code });
  publish(session.id);
  return { ok: true };
}

/**
 * The host starts the class: hands can go up from now, and the recording is
 * taken to start now (the host can change it on the timeline). Starting a
 * class that is on changes nothing.
 */
export function startClass(session: Session, person: string, log: Log): { ok: true } | Refused {
  if (!isHost(session, person)) {
    log("refused", { action: "class_start", session: session.code, reason: "not-host" });
    return { ok: false, status: 403 };
  }
  const limited = accountRefusal(person, "class", log, session.code);
  if (limited) return limited;
  const now = new Date();
  if (session.code === "HAND" || !beginClass(session.id, now)) {
    log("class_unchanged", { session: session.code });
    return { ok: true };
  }
  setRecording(session.id, now);
  log("class_started", { session: session.code });
  publish(session.id);
  return { ok: true };
}

/** The host ends the class: every hand comes down, and none can go up until a class starts again. */
export function endClass(session: Session, person: string, log: Log): { ok: true } | Refused {
  if (!isHost(session, person)) {
    log("refused", { action: "class_end", session: session.code, reason: "not-host" });
    return { ok: false, status: 403 };
  }
  const limited = accountRefusal(person, "class", log, session.code);
  if (limited) return limited;
  const lowered = session.code === "HAND" ? null : finishClass(session.id, new Date());
  if (lowered === null) {
    log("class_unchanged", { session: session.code });
    return { ok: true };
  }
  // the hands that came down no longer count their people as here
  notePresence(session.id, here(session.id));
  log("class_ended", { session: session.code, lowered });
  publish(session.id);
  return { ok: true };
}
