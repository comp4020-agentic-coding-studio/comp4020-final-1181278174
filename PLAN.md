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
- Why (rewritten 14 October, after I tried it on my laptop and my phone): a
  question that gets votes moves up straight away, so anyone can see at once
  which question the class wants most, without pressing anything. The reason
  written here before was drafted for me, and I could not explain it.
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

Decided 14 October, 02:00: the projector page gets a link to the session page,
"Ask from this device". I opened the projector page on my laptop, took it for
the app itself and could not find where to ask. It still has no forms or
buttons.

## Crit 10: fly by instruments

Crit 10 brief: make the final project tell people apart, then hand two of the
pod only the URL. They use it side by side in separate Chrome profiles while I
narrate from the logs who did what. Cutoff Wednesday 21 October 2026, 08:30.

### Where it starts

The app already tells people apart: a browser is a person, by the random id in
its cookie. The server already checks what each person may do: one vote each,
held by the database key; "Yours" is worked out on the server; only the host
can mark a question answered or hide it; a hidden question is listed only for
the host. What is missing:

- The app logs nothing. `flyctl logs` shows the machine starting and stopping,
  and no requests.
- Who may see and change what is not written down in one place.
- A vote for a hidden question is counted. The page offers no button for it,
  but a page opened before the host hid the question still has one.

### The decision

Decided 21 October, 02:20: the logs say who did everything, asking included.

- A person shows in the logs as a short tag worked out from their cookie, never
  as the cookie itself. Anyone holding the cookie could act as that person, and
  as the host if they started the session.
- No line holds anything someone typed. A question is its number.
- The other option was to leave the person off the line that says a question
  was asked. It would not hide who asked: the asker's page loads itself again
  straight after, and that request has their tag.
- What it costs: whoever runs the server can see which tag asked which
  question. The database already holds which browser asked each question
  (that is how "Yours" works), so this was already true. The README will say
  so.
- Why: the other option would not hide who asked, as the second point says.

### What the logs say

Every line goes to standard output, where Fly collects it:
`mise exec -- flyctl logs -a comp4020-final-1181278174`.

- One line per request: the method, the path without its query, the status,
  the time it took and the person's tag. A request id at the front ties it to
  the other lines from the same request.
- One line for each thing a person does: started a session, opened it (with how
  many are here), left it, asked, voted, took a vote back, marked a question
  answered or not, hid it, showed it again.
- One line for each refusal, with the reason: not the host, an empty or too
  long question, a vote for a question that is hidden or not in the session.
- One line when the server starts: how many sessions, questions and votes the
  database holds, so a restart that lost something would show.
- One line for a server error: the request, and where in the code it happened.

Never logged: the cookie, anything typed, IP addresses, the browser.

The logging stays after the crit. It is what I, and an agent, read when the
deployed app misbehaves.

### Who may see and change what

- Anyone with the code sees the questions that are not hidden, their counts and
  how many are here. They can ask, and give each question one vote, which they
  can take back.
- The person who asked sees "Yours" on their question. They cannot change its
  words or delete it.
- The host, the browser that started the session, also sees the hidden
  questions, and can mark a question answered or not, hide it and show it
  again.
- Nobody sees who asked or who voted, or changes someone else's vote.
- HAND has no host.

The record, with the reasons, goes in
`docs/decisions/0003-who-may-see-and-change-what.md`.

### Tests (`spec/`)

- a vote for a hidden question, sent from a page opened before it was hidden,
  is refused, and nothing changes (red until built)

The logs have no test: the tests reach the app over HTTP and cannot see what
the server prints. They are checked by hand: two windows on a local server,
then a search of its output for each cookie value; then two windows on the
live app with `flyctl logs` open.

### Order of work

1. this plan
2. the hidden vote: the test, red, then the fix
3. the person's tag and the line per request
4. the lines for what people do and for refusals, then opening and leaving
5. the line at start, and errors
6. push, then two windows on the live app with the logs open
7. the decision record and the changes to README.md and CLAUDE.md, as drafts
8. a rehearsal: two Chrome profiles, the URL only, me reading the logs
9. I write PROCESS.md and `reflections/crit-10.md`, then preflight and ship

## Final: the hall

Deadline Monday 9 November 2026, 12:00. Showcase Wednesday 11 November, a room
full of people using it at once.

### Where it starts

What is live after crit 10 is a question board: anonymous questions, "Me too",
Popular and Recent, a projector page, live updates and logs. On 8 November I
looked at what students here already have. Ed has anonymous posts. Echo360
takes questions during a live stream, and has a "confused" flag whose count
only teaching staff see. A board that carries questions to the person at the
front is the answer anyone would build.

### The decision

Decided 8 November, 18:00: the main thing the app does becomes a hand anyone can
raise without words, which the whole room sees. The question board stays, as the
second part.

- Why: a lost student does not ask, because no other hand is up and each one
  thinks they alone are confused (Miller 2023, describing Miller and McFarland
  1987). Asking also needs you to know what you do not know (Miyake and Norman
  1979), so a board that needs words leaves out the people who are most lost.
  The tools students already have send "confused" to the lecturer only. Here
  the room sees it, so each person can see they are not alone.
- What it costs: a 3D view that has to run on phones (three.js), and a night of
  work before the deadline.

### Two parts

1. The hall, `/s/CODE`: a 3D lecture hall with a figure for each person here
   (everyone with the session open, and anyone whose hand is still up; never the
   host), an "I'm lost" button, "3 of 12 here say they're lost", and beside it
   (under it on a narrow screen) the three open questions with the most "Me too",
   which can be voted on there.
2. The questions, `/s/CODE/questions`: the board as it was. After asking it says
   "Question posted." with a link to the question and one back to the hall, and
   the host sees the room's count above the list.

The hall's record is at `/s/CODE/timeline`, the projector at `/s/CODE/present`.

### The hall

- One press, no words. A person has at most one hand up. It comes down when
  they press again, or by itself after 3 minutes, so the hall shows now.
- Every count has its denominator and says what people said: "3 of 12 here say
  they're lost". With no hand up it says "12 here. No hands up right now." and
  "That doesn't mean everyone follows."
- No one, the host included, is shown whose hand is up. Proposed 8 November,
  18:10, to be confirmed: the server sends how many hands are up and how long
  each has been up, never a seat or a person. Each screen places the figures
  itself. A student's screen puts its own person at the back in the middle, so
  the whole room is in front of them, and puts the other hands on figures it
  picks; the host's screen and the projector look from the front. The other
  option, a fixed seat per person, lets anyone who sees a phone pressed learn
  which seat is that person.
- The host teaches: they have no hand and are not counted, live or in the
  timeline. A hand sent from the host's browser is refused.
- A hand counts as here until it comes down, page open or not: a hand that left
  with a locked phone and came back could show whose it was.
- The figures are all the same and have no faces. The steps are the app's
  yellow, a raised hand is tomato, and your own figure is blue, on your screen
  only.
- The projector shows the hall from the front, so the room sees itself.
- The 3D hall has no screen of its own: the questions sit beside it in words,
  so the people fill the picture.
- A hand stays up until it is put down or its 3 minutes end; the note under the
  button says when. With reduced motion set, nothing moves except what changed.

### The record

- Every hand is kept: when it went up and when it came down. The timeline shows
  how many hands were up in each minute, against clock time, and it is still
  there the next day.
- The host can add a mark with a short label when the lecture moves on, such as
  "Part 3: proofs". Marks show on the timeline.
- The host can say when the recording started. Every minute from then on also
  says how far into the recording it is, so it can be found in Echo360. A link that
  starts an Echo360 recording at a given time is made by the video's owner in
  Echo360, so the app does not make one.
- A hand sent with no page listening, as a page without script sends it, is
  kept too.
- The timeline shows the newest five sittings; a quiet spell longer than 20
  minutes starts a new one.

### Floating windows

Chrome and Edge on a computer can keep a small window above every other window
(Document Picture-in-Picture). Three uses:

- a student's: the count, the button, and a chart of the minutes since the
  session started, at most the last 15
- the host's: the count, the same chart, Going over it and the mark
- after class: the newest sitting of the timeline beside the Echo360 recording,
  following the page as it changes

Where the browser cannot do it, the button is not shown. Next to it: "Keep this
tab open; you can switch to your slides." Each window says it closes if the
hall tab closes.

### Not building

Showing Echo360 inside the app: its pages need an ANU login a marker may not
have, Wattle refuses to be shown inside another site, and Safari blocks a login
inside one. Also not now: a line of words on a hand, an export, an "End
lecture" button. Figures modelled in Blender were tried on 8 November and left
out: at the size a phone draws them their detail can't be seen, and their style
did not match the rest.

### Going over it

Added 8 November, 19:50, in its smallest version: the host
has one "Going over it" button on the hall and in their floating window, with
the note "Shows on every screen for 2 minutes." It records a moment separately
from the numbered part marks. For two minutes the hall, questions, projector
and floating windows say "The lecturer is going over it." Pressing again
during those two minutes changes nothing; anyone else is refused and logged.
Students' hands stay as they were.

Pages opened during those two minutes render the banner on the server; the
stream sends its elapsed time or null. It expires on open pages with or without
script. The timeline gives each moment its own marker, legend entry and
every-minute entry. What happens afterwards is just the counts in the minutes
afterwards, with no claim that confusion was resolved or that it helped.

### Tests (`spec/`)

- a hand needs no words: the form sends `intent=hand` and `up=1`, nothing typed
- a raised hand reaches another open page within a second
- no page another person is sent and no event ties a hand to a person or a seat
- two raises from one person at once make one hand
- the person whose hand is up is told when it comes down by itself, 3 minutes
  on. The coming down itself is checked by hand: the checks in CI run the
  same image that deploys, so the 3 minutes cannot be shortened for them.
- the timeline lists hands that have come down
- only the host can add a mark or set the recording time
- the board's checks move to `/s/CODE/questions`

The 3D view, the floating windows and how the hall feels are checked by hand at
both widths. That the record survives a restart is checked by hand after a
deploy.

### Changed on the evening of 8 November

After the first version was live I had it reviewed, screen by screen, and
changed these. Each is in the code and, where HTTP can see it, in `spec/`.

- 19:47: the count says "say they're lost", not "are lost", because a raised
  hand reports what someone said, and no hand up is not everyone following.
- 19:47: a press that can't be confirmed asks the server what the hand is,
  rather than guess.
- 19:47: the host has no hand and is not counted, because they teach. From
  20:19 a hand sent from the host's browser is refused: before that, the host
  could put a hand up and make the timeline show a student lost.
- 20:19: a raised hand counts as here until it comes down, because a hand that
  left with a locked phone and came back could show whose it was.
- 20:19: the pages say who is shown ("No one, the host included, is shown whose
  hand is up"), not that nobody could work it out: whoever runs the server, a
  very small room and someone looking at your screen are limits.
- 20:19: a question that may have been saved keeps its draft and is never sent
  again by itself.
- 20:27: the 3D hall draws only the seats in use and caps its pixel density, so
  a phone draws it and stops.
- 20:31: two columns from 1100 px: the hall on the left, the questions and the
  host's controls on the right.
- 20:42: "Question posted." after asking, with the way back to the hall; the
  host's questions page shows the room's count; the small window's chart starts
  when the session did.
- 20:56: the host's controls in their own card, "For the host"; after a mark
  the hall says which part was marked and when.
- 21:06: after a dropped connection a page fetches its list again before it
  says "Live"; two tabs of one browser agree on its hand and votes.
- 21:13: a hand sent with no page listening is kept in the record.

### Sign-in, with who asked sealed for an auditor

Decided 9 November, 00:00. Privacy and security go together. Without sign-in a
lecturer's controls live in one browser, which makes the app hard for a
lecturer to use, and nothing stops one person with several browsers raising
several hands. The app keeps who did what from the lecturer and from other
students, but a question that says something dangerous must be traceable to
the account that asked it, by someone allowed to, for a reason.

- Who can do what, as separate permissions rather than a ladder:
  - a student, signed in: raise a hand (one per account), ask, Me too, report
  - a host: the controls of the sessions they started, from any browser they
    sign in on
  - the auditor: holds the private key, off the server; opens the sealed author
    of one reported question at a time, giving a reason, and every opening is
    recorded (`scripts/reveal.ts`)
  - whoever runs the server: can still work out the tags and read the logs, a
    limit the README states
- Sign-in is a username and a password: no email and no real name. Tonight a
  report reaches an account, not a verified person; checking an ANU email is
  the next step.
- Write-only: a question keeps a tag for its asker (an HMAC with a server
  secret), enough for "Yours", and its author sealed to the auditor's public key
  (`src/lib/escrow.ts`). The app can write the sealed author and cannot read it.
- Looking stays open: anyone can read the hall, the questions, the timeline and
  the projector without signing in. "Here" counts signed-in people.
- What it costs: a marker makes an account in each browser; a forgotten
  password can't be recovered, only a new account made; the server's operator
  is still a limit.
- Not tonight: checking ANU emails, splitting the key between two people,
  password recovery, a page for the auditor.
- 01:30: reporting is a small triangle beside Me too. Pressing it asks "Report
  to the host?" before anything is sent, and a report can be taken back for a
  minute (Undo). The host sees the triangle with how many reported it.
- 01:50: signing in no longer moves sessions that browser started before
  sign-in to the account. Those were test sessions; they keep the browser that
  started them, so no one can use their host controls now.
- 02:35: on the live app HAND's host is my account, so a report there reaches
  someone and a question there can be hidden. A new database still starts HAND
  with no host.

### A class: the host starts it and ends it

Decided 9 November, 05:00. A session used to be open all the time, so a hand
could go up at night, and the timeline had no start or end for a lecture.

- A hand goes up only while the host's class is on. Before the host presses
  **Start class** the button is off and says the class hasn't started.
- **End class** takes every hand down, and none can go up until the class is
  started again. Questions can be asked at any time.
- The same code can hold a class every week: start it again and the timeline
  shows each class's start and end, apart from the numbered parts.
- Starting the class also sets when the recording started, to that moment; the
  host can change it on the timeline.
- HAND is always open, with no class to start.

### Order of work

1. this plan
2. the design canvas: the hall, the timeline, the floating windows, the projector
3. the two parts and the hand, with their tests
4. the 3D hall
5. the record: the timeline, marks, the recording time
6. the floating windows
7. the projector, a push, then two Chrome profiles on the live app at both widths
8. the changes to CLAUDE.md, a decision record and README changes as drafts; I
   write README.md and PROCESS.md
