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
the session on a 390 px phone, the home page, and the projector.

Decided 7 October, 04:18: bold and playful, so asking feels low-stakes.

- Sunflower `#FFD43B` for the header band and the home page, ink `#121212`,
  electric blue `#2F5BFF` for a pressed "Me too", tomato `#FF5A3C` for Ask,
  warm white `#FFF9E8` behind white cards.
- Bricolage Grotesque for headings, codes and counts; Instrument Sans for
  everything else; the system's Chinese font for Chinese text.
- 2 px ink outlines, 16 to 20 px corners, hard offset shadows. A pressed
  "Me too" turns blue and sinks into its shadow.
- The mark is a raised hand (Lucide's hand icon, ISC licence), on the "Me
  too" button too.
- Taken from the study: the code in a dark chip at the top of every phone; a
  join rail with the code and a QR code on the projector (Slido, Pigeonhole);
  Popular | Recent with a count (Slido); a "Yours" tag (Mentimeter); no
  names, no downvotes, no replies.

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
- Forms post back to the page they are on: starting a session to `/`, asking
  and voting to `/s/[code]` (a vote sends the question and `want` 1 or 0, so a
  double click can't undo itself). Success redirects back with a 303; a
  refused question or name renders the same page again, with a 422, the text
  kept and the reason. Joining is a GET to `/join?code=` (decided 7 October,
  04:10: a page can show its own form again; a separate endpoint can only
  redirect).

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

## Crit 9: all at once

Crit 9 brief: make the final project real-time, then decide how it behaves when
several people use it at once, and write down why. Cutoff Wednesday 14 October
2026, 08:30.

### The decision

Decided 13 October, 23:20: when votes change the order, every open screen
reorders straight away, phones included.

- The other option was to update counts and add new questions live but leave
  the order alone on a phone until its owner asks for the new order, and
  reorder live only on the projector.
- Why: README.md says good means the questions most people want answered come
  first. With this choice that is true on every screen all the time, and
  everyone in the room sees the same list as the person at the front.
- What it costs: a card can move just as someone is about to press it, so a
  "Me too" can land on the wrong question. Slido's staff call jumping
  questions distracting. A wrong vote can be taken back, and a card slides to
  its new place instead of jumping, so the eye can follow it.

The full record, with the options, goes in `docs/decisions/0002-live-order.md`.

### How a change travels

- `GET /s/[code]/events` is a server-sent events stream. The session page and
  the projector page name it in their HTML, and the tests read it from there.
- Asking, voting and the host's actions still go through the forms. After the
  database write, the server tells every open stream for that session. Changes
  less than 100 ms apart go out as one event.
- Every event is the whole state, not a change: how many people are here, and
  each question's id, vote count and state, in Popular order. Everyone in a
  session is sent the same event, and it has no person's id in it. A phone
  that was asleep or lost its connection reconnects and is sent the current
  state; there is nothing to replay.
- The page moves cards and changes counts from the event. When the event has a
  question the page has never seen, the page fetches itself and takes the new
  card from the server's HTML, so "Yours" is still worked out on the server.
- A comment line every 20 seconds keeps the connection open through Fly's
  proxy.
- Without JavaScript the pages work as they did in crit 8.

### Built this week, in this order

The first part is what the crit 9 spec asks for. Each later part is added on
its own and leaves `main` working, so the work can stop after any of them.

1. Live updates: counts, new questions and the order, on every open session
   page within about a second.
2. Asking and voting without a page reload. A count that changes jumps
   briefly. The page says "Live" or "Reconnecting".
3. The projector page, `/s/[code]/present`, as drawn on the canvas in crit 8:
   the code, where to join, and the top questions in type big enough for the
   back row. No buttons. A QR code if there is time.
4. "N here": how many people have the session open. People are counted, not
   tabs, and only the number is sent.
5. The host can mark a question answered or hide it, and everyone sees it
   straight away. An answered question says "Answered" and sits below the
   open ones in Popular. A hidden question is only listed for the host, who
   can show it again. A new migration adds `state` to `questions`: `open`,
   `answered` or `hidden`.

The host is still the browser that started the session, so at the crit the
session is started on my own device and the room's screen only opens the
projector page. `HAND` has no host, so nobody can hide or mark anything
there. A host link for a second device, "answering now" and written answers
are not this week.

### Tests (`spec/`)

New tests, red first, alongside crit 8's:

- someone with the stream open is sent a question another person asks, within
  a second
- and a vote, with the new count, within a second; when the vote changes the
  order, the event lists the questions in the new order
- nothing in the stream carries who asked
- the stream of an unknown code is a 404
- with each later part: the projector page shows the code and the questions in
  Popular order and has no forms; two people listening are counted as two, and
  as one after one leaves; only the host is offered Answered and Hide, anyone
  else who sends them is refused, a hidden question is gone from everyone
  else's page and from the stream, and an answered one says so

The tests read the stream over HTTP, so they show the server sends a change
within a second. That a page on a phone moves is checked by hand: two windows
side by side at 390 px and 1920 px, then two devices on the live app.

### Order of work

1. this plan
2. the live tests, red
3. the stream, and the publish after each write; tests green; push and try the
   stream on the live app before building on it
4. the page script: counts, new cards, reordering
5. 150 streams against a local server, to measure delay and memory; the
   decision record and the README change, as drafts
6. parts 2 to 5 above, one at a time, each with its tests
7. code stops at 06:30; two devices on the live app, preflight
8. 07:00 to 08:00: I read the drafts, write PROCESS.md and
   `reflections/crit-9.md`, and ship

If time runs short, drop from the end: answered and hidden, then the QR code,
then "N here", then the projector page. Live updates, their tests, the
decision record and the reflection stay.

### After the first night on the live app

Decided 14 October, 01:38, after measuring the live app and reading the cost of
the decision again. Three changes, in this order:

1. The time on a question keeps itself up to date. Pages no longer reload, so
   a question asked ten minutes ago still said "just now".
2. A new question is sent to the open pages with its words, so they can draw
   the card without fetching the page. On the live server, 150 pages fetching
   at once took about 0.8 seconds, which is close to the one-second limit. The
   person who asked is not sent this message: their pages still fetch, so that
   "Yours" is worked out on the server and never travels in a message.
3. Two guards against a "Me too" landing on the wrong question, which is the
   cost of reordering live. While a finger or the mouse button is down, the
   list waits and reorders on release. A card that has just moved cannot be
   pressed for 0.4 seconds. The order is still live on every screen; this does
   not change the decision.

The first two have tests. The third only happens in a browser, so it is checked
by hand in two windows and the decision record says so.
