import { asc, desc, type SQL, sql } from "drizzle-orm";
import { questions, votes } from "./schema.ts";

// Popular order, shared by the pages (src/lib/board.ts) and the live stream
// (src/lib/live.ts), so a page and an event can never disagree about it.

/** A question's vote count, read from the votes table every time. */
export const voteCount = sql<number>`(SELECT count(*) FROM ${votes} WHERE ${votes.questionId} = ${questions.id})`;

/** The questions still to answer first, then the most votes, then the oldest. */
export const popularOrder: SQL[] = [
  asc(sql`CASE ${questions.state} WHEN 'open' THEN 0 WHEN 'answered' THEN 1 ELSE 2 END`),
  desc(voteCount),
  asc(questions.createdAt),
  asc(questions.id),
];
