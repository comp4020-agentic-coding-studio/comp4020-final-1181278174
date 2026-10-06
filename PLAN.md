# Plan: Hands Up, an anonymous question board for one room

Crit 8 brief: it's alive! Ship the first working version of the final project,
and a first go at saying what good means for it. Cutoff Wednesday 7 October
2026, 08:30.

## The problem

In a lecture or a crit, one person talks and the room listens. The questions
that get asked are the ones from the few people comfortable asking out loud;
the rest go unasked, or get asked afterwards to whoever is nearest. Tools for
this exist (Slido, Mentimeter, Pigeonhole Live, Zoom's Q&A), made for
conferences and companies: accounts, polls, quizzes, dashboards.

Hands Up is made for one room in one course: a COMP4020 lecture or crit, 20 to
150 people with phones, one person at the front. The host opens a session and
puts its code on the screen; the room asks anonymously and says "me too" to the
questions it wants answered.

## What good looks like here (first version)

- Asking costs nothing: no account, no name, no app to install. A four-letter
  code or a QR scan opens the session with the ask box first.
- Nobody can find out who asked, the host included. The app still tells people
  apart, so each person has one vote per question and sees their own questions
  marked as theirs.
- The room decides the order: the questions most people want answered rise to
  the top, and a Recent view keeps new ones from being buried.
- Nothing disappears: questions and votes stay after the session, and coming
  back in the same browser finds yours still marked.
- It reads on a 390 px phone held in one hand and from the back of the room on
  a projector, and everything works by keyboard.

README.md argues this properly, with what was read, and says which of these
the checks enforce and which are judged.

## Not building

Replies or threads (they turn it into a chat room); downvotes; accounts,
profiles, names or avatars on questions; polls, quizzes and word clouds;
leaderboards; email; a dashboard of every session.

Not this week: live updates (crit 9), "answering now", answered and hidden
(crit 9), a host link for a second device, written answers after the session,
server-side logging (crit 10).

## The look

Drawn on the design canvas before it is built, from a study of how Slido,
Mentimeter, Pigeonhole Live and the others lay out a live Q&A. Three screens:
the session on a 390 px phone, the home page, and the projector. Decided once
the canvas has a direction.

## A person, a session

- A person is a browser: a random id in an httpOnly cookie, set on the first
  visit and kept for a year. It is how the app tells people apart (one vote
  each, "Yours"), and it never leaves the server.
- A session has a four-character code from `23456789ABCDEFGHJKMNPQRSTUVWXYZ`
  (no 0/O, 1/I/L), typed in any case. Whoever starts it is its host.
- `HAND` is seeded at boot if it is missing: an open session called "Questions
  for the maker of this app", linked from the home page, so a stranger can ask
  something the moment they arrive. The pod uses it at the crit.

## Schema (Drizzle, SQLite)

| table | columns |
|---|---|
| `sessions` | `id` PK, `code` (unique), `title`, `host` (the starter's person id), `created_at`, `closed_at` |
| `questions` | `id` PK, `session_id`, `body` (1 to 240 characters, a CHECK), `asker` (person id), `created_at` |
| `votes` | (`question_id`, `person`) PK, `created_at` |

The primary key on `votes` is what holds one vote per person per question, so
no code path can count a double click twice. The states answering, answered
and hidden arrive with crit 9, in their own migration.

## Pages

- `/`: join with a code (one big field), start a session (a title), the link
  to `HAND`, and About (`/readme/`).
- `/s/[code]`: the session. The ask box first, then the questions, Popular
  (most votes, then oldest) or Recent (newest first). Each question shows its
  vote count and a "Me too" button that shows when it is pressed and can be
  taken back; your own questions say "Yours". An unknown code is a 404 that
  offers the join box again.
- `/s/[code]/present`, if time: the code, a QR code and the top questions in
  type big enough for the back row.
- `/readme/`: README.md, rendered on the server.
- Form posts: `POST /start`, `POST /s/[code]/ask`, `POST /s/[code]/vote` (the
  question and `want` 1 or 0, so a double click can't undo itself). Each
  redirects back with a 303; a refused question renders the page again with
  the text kept and the reason.

## Stack

- Astro with server output and the Node adapter, as in crit 7: pages render
  per request from the database, the forms work without JavaScript, and
  `/readme/` is HTML the server sends.
- SQLite through better-sqlite3 and Drizzle, one file on the `/data` volume;
  migrations committed and applied at boot.
- Live updates in crit 9 with server-sent events: the server only has to push,
  and asking and voting stay ordinary form posts.
- The Dockerfile builds the server and serves on `0.0.0.0:$PORT` (8080).
- The reasons, and the alternatives weighed (Hono with htmx, SvelteKit,
  PocketBase, WebSockets), go in `docs/decisions/0001-stack.md`, which
  PROCESS.md links.

## Tests (`spec/`)

- a question asked by one person is on the session page for a stranger, and
  still there for the asker on a later visit (across a restart is checked by
  hand after the second deploy)
- the asker sees "Yours" on it; nobody else does
- the asker's id is in nothing the server sends anyone else, the host included
- two votes sent at once by one person count once; a second person makes it
  two; taking a vote back makes it one
- an empty question and one of 241 characters are refused; one of 240 Chinese
  characters is accepted
- Popular puts more votes first; Recent puts the newest first
- `/` links to `HAND`, and `HAND` is open
- an unknown code is a 404

They read the page the way a person does (the question text, its vote count,
the button's pressed state, the "Yours" label), not class names. They make
their own sessions and never write to `HAND`, and they run against a local
server or CI's throwaway container, never the live app. They start red.

## Harness (CLAUDE.md, first rules)

- who asked is never sent to a browser, the host's included; "Yours" is worked
  out on the server
- joining, starting, asking and voting are plain forms that work without
  JavaScript; script only adds to them
- one vote per person per question is held by the database key, not the page
- no replies, downvotes, accounts, names or polls: a change that adds one stops
  for a decision
- every page works at 390 px and by keyboard, with targets of at least 44 px
- a promise added to README.md comes with a check in `spec/`, or is marked as
  judged

## Order of work

1. plan; the study of similar products runs alongside
2. skeleton: Astro, the Dockerfile on 8080 with `/data`, `/readme/` from
   README.md; deploy it by hand once to prove the path
3. the tests above, red
4. schema, migration, the person cookie, start, join, ask and vote as forms,
   `HAND` seeded; the tests go green
5. the look, drawn on the canvas, then applied to the session page and home
6. deploy; check at 390 px and on a laptop, a keyboard pass, a second deploy
   to see `HAND` keep its questions
7. README.md, PROCESS.md with the stack decision record, CLAUDE.md,
   `reflections/crit-8.md`
8. preflight; ship by 08:00

If time runs short, drop these in order: the projector view, the QR code (the
code alone works), Recent, taking back a vote, the look beyond the session
page. Joining, asking, one vote each, "Yours", persistence, `HAND`, the tests,
the deploy and the README stay.
