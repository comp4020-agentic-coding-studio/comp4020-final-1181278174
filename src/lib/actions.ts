import { isHost, type Session, setState, setVote, STATES } from "./board.ts";
import { publish } from "./live.ts";
import { addMark, atCanberra, MAX_MARK, setRecording } from "./record.ts";

// What a form sent to either part of a session does, where both parts take the
// same form: "Me too" is on the questions page and on the hall's three most
// wanted. Each returns the question to come back to, or the status to refuse with.

type Log = (what: string, fields?: Record<string, string | number | undefined>) => void;
type Done = { ok: true; question: number } | { ok: false; status: number };

/** "Me too", or taking it back: `want` 1 or 0, never "toggle". */
export function vote(session: Session, person: string, form: FormData, log: Log): Done {
  // a question this person can't see takes no vote, and is a 404 to them
  const id = Number(form.get("question"));
  const want = form.get("want") === "1";
  const done = Number.isInteger(id) ? setVote(session, id, person, want) : "no-such-question";
  if (done === "changed" || done === "unchanged") {
    const what = done === "unchanged" ? "vote_unchanged" : want ? "vote_given" : "vote_taken_back";
    log(what, { session: session.code, question: id });
    return { ok: true, question: id };
  }
  log("refused", { action: "vote", session: session.code, question: Number.isInteger(id) ? id : undefined, reason: done });
  return { ok: false, status: 404 };
}

/** The host's buttons on a question. Anyone else who sends this is refused. */
export function mark(session: Session, person: string, form: FormData, log: Log): Done {
  const id = Number(form.get("question"));
  const to = STATES.find((state) => state === form.get("to"));
  if (Number.isInteger(id) && to && setState(session, id, person, to)) {
    log("question_marked", { session: session.code, question: id, to });
    return { ok: true, question: id };
  }
  const reason = !to ? "no-such-state" : isHost(session, person) ? "no-such-question" : "not-host";
  log("refused", { action: "mark", session: session.code, question: Number.isInteger(id) ? id : undefined, reason });
  return { ok: false, status: to ? 403 : 422 };
}

/** The host marks the start of a part of the lecture, now. Anyone else is refused. */
export function timelineMark(session: Session, person: string, form: FormData, log: Log): { ok: true } | { ok: false; status: number } {
  const label = String(form.get("label") ?? "").trim();
  if (!isHost(session, person)) {
    log("refused", { action: "timeline_mark", session: session.code, reason: "not-host" });
    return { ok: false, status: 403 };
  }
  if ([...label].length > MAX_MARK) {
    log("refused", { action: "timeline_mark", session: session.code, reason: "too-long" });
    return { ok: false, status: 422 };
  }
  addMark(session.id, label);
  log("timeline_marked", { session: session.code });
  publish(session.id);
  return { ok: true };
}

/** The host says when the recording started, as a time of day on the day `ref` falls on. */
export function recordingStart(session: Session, person: string, form: FormData, log: Log, ref: Date): { ok: true } | { ok: false; status: number } {
  if (!isHost(session, person)) {
    log("refused", { action: "recording", session: session.code, reason: "not-host" });
    return { ok: false, status: 403 };
  }
  const at = atCanberra(ref, String(form.get("at") ?? ""));
  if (!at) {
    log("refused", { action: "recording", session: session.code, reason: "no-such-time" });
    return { ok: false, status: 422 };
  }
  setRecording(session.id, at);
  log("recording_set", { session: session.code });
  publish(session.id);
  return { ok: true };
}
