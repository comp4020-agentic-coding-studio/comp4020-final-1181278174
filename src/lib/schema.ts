import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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
    // when the lecture's recording started, as the host gave it, so the
    // timeline can say how far into the recording each minute is
    recordingAt: integer("recording_at", { mode: "timestamp_ms" }),
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
    // set by the host: answered questions sink below the open ones, hidden
    // ones are listed for nobody else. The migration holds the three values
    // with a CHECK on the column.
    state: text("state", { enum: ["open", "answered", "hidden"] })
      .notNull()
      .default("open"),
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

// Every hand raised in a session: by whom, when, and when it came down. A hand
// with no `lowered_at` that is younger than HAND_MS is up. Kept after it comes
// down, so the session has a record of when the room was lost.
export const hands = sqliteTable(
  "hands",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: integer("session_id")
      .notNull()
      .references(() => sessions.id),
    person: text("person").notNull(),
    raisedAt: integer("raised_at", { mode: "timestamp_ms" }).notNull(),
    loweredAt: integer("lowered_at", { mode: "timestamp_ms" }),
    // put down by the person, or down by itself after HAND_MS
    ended: text("ended", { enum: ["lowered", "expired"] }),
  },
  (t) => [
    index("hands_by_session").on(t.sessionId, t.raisedAt),
    // one hand up per person: a second raise, however close in time, has nowhere to go
    uniqueIndex("hands_one_up").on(t.sessionId, t.person).where(sql`lowered_at IS NULL`),
  ],
);

// How many people had a session open in each minute: the most at once, and how
// many were left after the minute's last change. A count, never who: the
// timeline's "out of how many". A minute with no row kept the last count.
export const presence = sqliteTable(
  "presence",
  {
    sessionId: integer("session_id")
      .notNull()
      .references(() => sessions.id),
    // minutes since 1970, UTC
    minute: integer("minute").notNull(),
    most: integer("most").notNull(),
    last: integer("last").notNull(),
  },
  (t) => [primaryKey({ columns: [t.sessionId, t.minute] })],
);

// The host's marks on the timeline: a moment, and the part of the lecture
// that starts there ("Part 3: proofs"), so the timeline says what was being taught.
export const marks = sqliteTable(
  "marks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: integer("session_id")
      .notNull()
      .references(() => sessions.id),
    at: integer("at", { mode: "timestamp_ms" }).notNull(),
    label: text("label").notNull(),
  },
  (t) => [index("marks_by_session").on(t.sessionId, t.at), check("marks_label_length", sql`length(${t.label}) BETWEEN 1 AND 60`)],
);

// Each time the host says they are going over it. Kept apart from part marks:
// these moments neither start a new part nor change anyone's raised hand.
export const goingOvers = sqliteTable(
  "going_overs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: integer("session_id")
      .notNull()
      .references(() => sessions.id),
    at: integer("at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("going_overs_by_session").on(t.sessionId, t.at)],
);

// Each class held under a session's code: the host starts it and ends it,
// and hands can go up only while one is on. The same code can hold a class
// every week, so a session keeps every class it has had.
export const classes = sqliteTable(
  "classes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: integer("session_id")
      .notNull()
      .references(() => sessions.id),
    startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
    // null while the class is on
    endedAt: integer("ended_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    index("classes_by_session").on(t.sessionId, t.startedAt),
    // at most one class on at a time, even when two presses arrive together
    uniqueIndex("classes_one_on").on(t.sessionId).where(sql`ended_at IS NULL`),
  ],
);

// People who have signed up: a username and a password, nothing else. No
// email and no real name. The username is shown to nobody but its owner; to
// everyone else the app shows what people did, never who did it.
export const accounts = sqliteTable(
  "accounts",
  {
    // random, like the browser ids before sign-in; this is the person the rest of the app counts
    id: text("id").primaryKey(),
    // as it was typed, to show back to its owner
    username: text("username").notNull(),
    // lower-cased, so "Song" and "song" are the same account
    usernameKey: text("username_key").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [check("accounts_username_length", sql`length(${t.username}) BETWEEN 3 AND 30`)],
);

// A signed-in browser: the hash of the random token in its cookie, never the
// token itself, so a copy of the database can't be used to sign in.
export const signIns = sqliteTable(
  "sign_ins",
  {
    tokenHash: text("token_hash").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    // set when the person signs out; the token stops working at once
    endedAt: integer("ended_at", { mode: "timestamp_ms" }),
  },
  (t) => [index("sign_ins_by_account").on(t.accountId)],
);

// Who asked a question, sealed to the auditor's public key: the app writes it
// and cannot read it back. Only the auditor's private key, kept off the server,
// opens it, one question at a time (scripts/reveal.ts).
export const sealedAuthors = sqliteTable("sealed_authors", {
  questionId: integer("question_id")
    .primaryKey()
    .references(() => questions.id),
  keyVersion: integer("key_version").notNull(),
  envelope: text("envelope").notNull(),
});

// "This should not be here": one report per account per question. A report
// shows nobody who asked; it marks the question for the host and keeps it for
// the auditor.
export const reports = sqliteTable(
  "reports",
  {
    questionId: integer("question_id")
      .notNull()
      .references(() => questions.id),
    // a tag made from the account, not the account id
    reporter: text("reporter").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.questionId, t.reporter] })],
);

// Each time the auditor opened a sealed author: which question, when, and why.
export const reveals = sqliteTable("reveals", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  questionId: integer("question_id").notNull(),
  at: integer("at", { mode: "timestamp_ms" }).notNull(),
  reason: text("reason").notNull(),
});

// Secrets the server makes for itself at first boot and keeps on the volume,
// such as the key the tags are made with.
export const secrets = sqliteTable("secrets", {
  name: text("name").primaryKey(),
  value: text("value").notNull(),
});
