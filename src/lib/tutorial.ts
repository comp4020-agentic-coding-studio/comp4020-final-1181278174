import { and, count, eq, isNotNull, isNull, lt } from "drizzle-orm";
import type { Session } from "./board.ts";
import { db } from "./db.ts";
import { tutorialRequests, tutorialSessions } from "./schema.ts";

/** The only tutorial details included in the shared live stream. */
export type TutorialState = { label: string | null; endsAt: number | null; revision: number };
export type TutorialLive = TutorialState & { serverNow: number };

/** No row means lecture mode. No person or ticket is selected here. */
export function tutorialFor(sessionId: number): TutorialState | undefined {
  const row = db.select({ label: tutorialSessions.exercise, endsAt: tutorialSessions.endsAt, revision: tutorialSessions.revision })
    .from(tutorialSessions).where(eq(tutorialSessions.sessionId, sessionId)).get();
  return row ? { label: row.label, endsAt: row.endsAt?.getTime() ?? null, revision: row.revision } : undefined;
}

export type TutorialView = {
  tutorial: TutorialState;
  own: null | { ticket: string; request: number; position: number | null; ahead: number; waiting: number; called: boolean };
  queue: null | { waiting: number; total: number; called: null | { ticket: string; request: number } };
};

/**
 * Each viewer's own page: a student sees just their ticket and place; the
 * tutor sees counts and, after calling next, one ticket. A projector never
 * sees either, even when opened by the host. The account id is never selected.
 */
export function tutorialView(
  session: Pick<Session, "id" | "host">,
  person: string | null,
  { projector = false }: { projector?: boolean } = {},
): TutorialView | undefined {
  const tutorial = tutorialFor(session.id);
  if (!tutorial) return;
  const view: TutorialView = { tutorial, own: null, queue: null };
  if (projector || person === null) return view;
  const inSession = eq(tutorialRequests.sessionId, session.id);
  const waiting = db.select({ n: count() }).from(tutorialRequests)
    .where(and(inSession, isNull(tutorialRequests.calledAt))).get()!.n;
  if (person === session.host) {
    const total = db.select({ n: count() }).from(tutorialRequests).where(inSession).get()!.n;
    const called = db.select({ ticket: tutorialRequests.ticket, request: tutorialRequests.id })
      .from(tutorialRequests).where(and(inSession, isNotNull(tutorialRequests.calledAt))).get();
    view.queue = { waiting, total, called: called ? { ticket: called.ticket, request: called.request } : null };
    return view;
  }
  const own = db.select({ ticket: tutorialRequests.ticket, request: tutorialRequests.id, calledAt: tutorialRequests.calledAt })
    .from(tutorialRequests).where(and(inSession, eq(tutorialRequests.person, person))).get();
  if (!own) return view;
  const ahead = db.select({ n: count() }).from(tutorialRequests)
    .where(and(inSession, isNull(tutorialRequests.calledAt), lt(tutorialRequests.id, own.request))).get()!.n;
  view.own = {
    ticket: own.ticket,
    request: own.request,
    position: own.calledAt === null ? ahead + 1 : null,
    ahead,
    waiting,
    called: own.calledAt !== null,
  };
  return view;
}
