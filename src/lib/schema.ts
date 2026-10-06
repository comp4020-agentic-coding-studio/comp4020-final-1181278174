import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

// The smallest schema that carries the core of it: a session, the questions
// asked in it, and who said "me too" to which. A person is not a table: it
// is the id in a browser's cookie (src/middleware.ts), stored only to tell
// people apart, and never sent back in a page.

export const sessions = sqliteTable(
  "sessions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    code: text("code").notNull().unique(),
    title: text("title").notNull(),
    // the person who started it; null for HAND, which nobody started
    host: text("host"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    closedAt: integer("closed_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    // four characters, none of them easy to misread (no 0/O, 1/I/L)
    check(
      "sessions_code_shape",
      sql`${t.code} GLOB '[2-9A-HJKMNP-Z][2-9A-HJKMNP-Z][2-9A-HJKMNP-Z][2-9A-HJKMNP-Z]'`,
    ),
    check("sessions_title_length", sql`length(${t.title}) BETWEEN 1 AND 80`),
  ],
);

export const questions = sqliteTable(
  "questions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: integer("session_id")
      .notNull()
      .references(() => sessions.id),
    body: text("body").notNull(),
    asker: text("asker").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    check("questions_body_length", sql`length(${t.body}) BETWEEN 1 AND 240`),
    index("questions_by_session").on(t.sessionId),
  ],
);

export const votes = sqliteTable(
  "votes",
  {
    questionId: integer("question_id")
      .notNull()
      .references(() => questions.id),
    person: text("person").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  // the key is what holds one vote per person per question: a second insert
  // from the same person, however close in time, has nowhere to go
  (t) => [primaryKey({ columns: [t.questionId, t.person] })],
);
