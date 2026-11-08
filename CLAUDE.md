# COMP4020 final project — Hands Up

A hand any signed-in student can raise without words, which the whole room
sees: a host starts a session with a four-character code; in the hall
(`/s/CODE`) a student presses "I'm lost" and every screen shows how many of the
people here say they're lost, in words and in a 3D lecture hall. The second
part (`/s/CODE/questions`) is an anonymous question board with "Me too". The
timeline (`/s/CODE/timeline`) keeps how many said they were lost in each
minute. Astro server with SQLite (Drizzle) on the `/data` volume, three.js for
the hall, deployed to Fly at https://comp4020-final-1181278174.fly.dev/.

This repo runs from crit 8 to the final project deadline, Monday 9 November
2026, 12:00. Crit cutoffs are Wednesdays at 08:30: crit 8 on 7 October, crit 9
on 14 October, crit 10 on 21 October. By each cutoff: pushed, live, that
crit's `reflections/crit-N.md` in the repo, checks green. Markers start at
`/readme/`, then use the app for about ten minutes: two sessions side by side,
both viewports (1920×1080 and 390×844), a resize, a keyboard pass, and the
promises `spec/` names, tried live.

The design is `PLAN.md`. When this file and `PLAN.md` disagree, stop and ask.

## Commands

- `pnpm dev` — local server on 8080, database in `.data/`.
- `pnpm build && pnpm start` — the built server on 8080, as CI runs it.
- `pnpm check` — `astro check`, then every `spec/*.test.ts` against the app
  running at `APP_URL` (default `http://localhost:8080`). Start the app first.
  Run before every commit. Never point it at the live app: the tests write, so
  `spec/visitor.ts` makes them fail at once on a fly.dev address.
- `scripts/smoke.sh` — after a deploy, read-only checks that may run against the live
  app, unlike `pnpm check`: the pages answer, the live stream sends the room's state.
- `pnpm check:evidence` — this file, a crit reflection, `PROCESS.md` without
  its template comment, every cited commit resolves. Run before `/ship`.
- `pnpm db:generate --name <what>` — a migration from `src/lib/schema.ts`.
  Commit the migration with the schema change.
- The repo is public, so every push to `main` runs the checks on GitHub and, if
  they pass, deploys. A deploy by hand uploads the working tree, uncommitted
  drafts included, so only from a clean tree:
  `mise exec -- flyctl deploy --remote-only --ha=false -a comp4020-final-1181278174`.
- `mise exec -- flyctl logs -a comp4020-final-1181278174` — the live app's log as it
  is written; `--no-tail` prints the recent lines and stops. Read it first when the live
  app misbehaves, and paste the lines rather than describe them.
- Installing or adding a package: `mise exec -- pnpm …`, never plain `pnpm`.
- `/preflight` before `/ship`. `/ship` tags the crit's cutoff state. It only
  happens on my word.

## What is fixed and what is mine

Fixed, do not edit: `fly.toml`, `.github/workflows/checks.yml`,
`spec/invariants.test.ts`, `spec/global-setup.ts`, `scripts/check-evidence.ts`,
the `security` block in `astro.config.ts`. The `Dockerfile` may change, but the
image must serve on `0.0.0.0:$PORT` and keep its database on `/data`.

Mine: `src/`, `drizzle/`, `public/`, `spec/board.test.ts`, `spec/visitor.ts`
and any other spec file I add, `docs/`, `PLAN.md`, `README.md`, `PROCESS.md`,
`reflections/`, this file.

## Working with me

The marked thing is my directing. A fix I never saw is not evidence.

- **One bounded task, then report.** Anything else you noticed goes under "next".
- **A red check you can explain in one sentence:** fix it and list it under "fixed
  silently". Anything else: stop, paste the failure, say what you think went wrong, offer
  (a) fix the code, (b) a rule here, (c) a tighter check, (d) throw the attempt away.
- **Two attempts, then stop.** Report what you tried, what you saw, what you now think.
- **Design decisions are mine.** More than one reasonable answer: at most two options
  with a recommendation, then wait. The decision goes into `PLAN.md` with the date.
- **The report ends with evidence:** commands and output, `git diff --numstat`, what you
  saw at 1920 and 390 (or "no UI yet"), what you did not verify, fixed silently, next.
- **Never quote me unless you are quoting me.**
- **Written documents are drafts until I accept them:** `README.md`, `PROCESS.md`, the
  reflections and this file stay uncommitted until I have read them.
- **Adding to this file:** after I corrected you on the same thing twice, or a check caught
  you unexpectedly. One commit per rule.

## The loop

1. **Explore** — read the relevant source and checks first.
2. **Plan** — the change, its boundary, how it will be verified.
3. **Implement** — one bounded change. A second change gets its own commit.
4. **Verify** — `git diff --numstat`; `pnpm check`; the page at both widths.

**"Done" is a claim**: it comes with what you ran, what it printed, and what you did not
verify. **A new test is shown failing first**: break what it guards, watch it go red, put
it back.

## Commits

- **One decision, one commit.** If a title needs "and", it is two commits.
- **Shape:** lowercase, `topic: what changed`, one line, under 60 characters. A second
  paragraph only when the reason is not obvious.
- **Plain words, English.** No adjectives like robust or comprehensive, no metaphors.
- `pnpm check` before each commit. A test red on purpose is named in the message.
- Push to `main` after each part unless I say hold.

Good: `hand: an open session for strangers, seeded at boot`
Good: `spec: read page text with paragraphs kept apart`
Bad: `Implement comprehensive anonymous voting system`

## Rules for this app

### Who asked

- Who asked a question is never sent to a browser, the host's included. "Yours" is
  worked out on the server. A query that hands `asker` to a page is a bug;
  `spec/board.test.ts` and `spec/rules-privacy.test.ts` check the pages and the stream
  a host and a guest are sent.
- A person is an account: a username and a password, nothing else; no email and no
  real name (`src/lib/accounts.ts`). A browser that is not signed in can look at every
  page and change nothing. A username is shown to nobody but its owner.
- Who asked is kept as a tag (`src/lib/tags.ts`) and as the author sealed to the
  auditor's public key (`src/lib/escrow.ts`): the app writes the sealed author and can't
  read it back. The private key never enters the repo, the image or the server;
  `spec/escrow.test.ts` checks the repo. Opening one is `scripts/reveal.ts`, by the
  auditor, one question at a time, with a reason that is recorded first.

### The hall

- A hand needs no words: the hall's form has no text field, and never will.
- No one, the host included, is shown whose hand it is. What leaves
  the server about hands is how many are up and how long each has been up:
  never a person, never a seat. Each screen places its own figures. A query
  that hands `hands.person` to a page or the stream is a bug;
  `spec/hall.test.ts` and `spec/rules-privacy.test.ts` check the stream and every
  session page a host and a guest are sent.
- Say the limits, never more than is true: whoever runs the server can tie a
  hand, a vote or a question to a browser through the database and the logs;
  in a very small room a count can show whose hand it is; and anyone who sees
  your screen sees your own hand and your "Yours". Pages say what the app
  does ("no one is shown whose hand is up"), never what nobody could work out.
- A hand counts as here until it comes down, page open or not: a hand that
  vanished with a locked phone and came back could show whose it was.
- A count says what people said, with its denominator: "3 of 12 here say
  they're lost", never "3 lost". With no hand up it says only that, and that
  silence does not mean everyone follows.
- The host teaches: they have no hand and are not counted among the people
  here, live or in the timeline. Only the host marks a part of the lecture or
  sets when the recording started; anyone else is refused and the refusal
  logged.
- The hall shows now: a hand comes down by itself after `HAND_MS`
  (`src/lib/hall.ts`). The record keeps it: the timeline holds counts per
  minute, never who.
- The 3D view and the floating window add to the page, never replace it.
  Everything the hall shows is said in words beside it, and the button works
  without script, WebGL or three.js. A floating window's button stays hidden
  where the browser can't open one. Colours and sizes of the 3D hall live in
  the constants at the top of `src/scripts/hall.ts`.

### Classes and the lecturer

- A hand goes up only while the host's class is on: Start class opens hands, End class
  takes every hand down and refuses new ones until the next class (`src/lib/classes.ts`,
  `spec/class.test.ts`). HAND is always open. Questions can be asked at any time.
- The host of a lecture gets the lecturer's page at `/s/CODE` and `/s/CODE/teach`;
  everyone else gets the student's room. A student never reaches the lecturer's page or
  its forms: 403 and a log line (`spec/teaching.test.ts`).
- The lecturer is never asked to watch the count. What they see at a pause and after
  class is counts per minute with how many were here, never who (`partSoFar` and
  `classRecap` in `src/lib/record.ts`, `spec/checkpoint.test.ts`).

### Tutorials

- A tutorial has no hand and no 3D hall: in a room of 10 to 30, a count can show whose
  hand it is. A help request has no words and no seat; its ticket number shows on the
  student's own screen, and to the tutor only when it is called. The projector never
  shows tickets, queue counts or questions (`src/lib/tutorial.ts`,
  `spec/tutorial.test.ts`). A tutorial's `/teach` leads to its room.

### Logs

- Every request writes one line (`src/middleware.ts`, the path without its query), and so
  does every thing a person does and every refusal, through `locals.log`
  (`src/lib/log.ts`). A new action or refusal comes with its line.
- A line names a person by their tag from `src/lib/log.ts`, never by the cookie: the
  cookie is enough to act as that person, as the host too. Nothing anyone typed goes in a
  line; a question is its number. No IP addresses, no browser names.

### Votes

- One vote per person per question is held by the primary key of `votes`. Never count
  votes in a page or in memory.
- A vote sends `want` 1 or 0, never "toggle": two presses that arrive together must not
  cancel out.

### Pages

- Every page renders on the server. Starting, asking, voting, a hand and the host's
  buttons are plain forms: POST back to their page, 303 on success, 422 with the text kept
  on a refusal, 403 for someone not allowed, 404 for something that isn't there. Joining is a GET form to `/join`. Script may
  only add to them.
- At 390 px: one column, no sideways scroll. Buttons, fields and links that stand on
  their own are at least 44 px tall; a link inside a sentence is as tall as its text.
  Every control has a label. A pressed "Me too" says so with `aria-pressed`, not colour
  alone.
- A page made for one sign-in never stays on screen after the browser's sign-in
  changes: the page carries its account's mark, the live stream says which sign-in it
  is for, and the page loads again, keeping a half-written question to copy
  (`src/scripts/live.ts`, `spec/live-account.test.ts`, `spec/stream-sign-in.test.ts`).
- A first visit shows a short guide; Got it and Skip are plain forms, remembered per
  account, or in a cookie while signed out. After it the small text it taught is hidden,
  but these stay on the page: no one is shown whose hand is up, no hand up doesn't mean
  everyone follows, and every count comes with how many are here (`spec/guide.test.ts`).
- The look is in `PLAN.md` ("The look, from four proposals") and the tokens at the top of
  `src/styles.css`, light and dark. A new screen is drawn on the design canvas before it
  is built.
- Every page is in English; what people type (a title, a question, a mark) can be in any
  language. Chinese stays in chat.

### Promises

- A promise added to `README.md` comes with a check in `spec/`, or the README says it is
  judged.
- Not in this app: replies, downvotes, real names, email addresses, polls, quizzes, and
  other sites shown inside it (Echo360 included). If one seems needed, say so and stop.

## Facts about this repo that bite

An entry earns its place after it has cost time here. Shape: what is true, how it was
measured. Delete it when it stops being true.

### Every push to `main` deploys

The repo has been public since crit 8, so both jobs in `.github/workflows/checks.yml` run
on every push, one deploy at a time, about four minutes each. A commit with tests that are
red on purpose is pushed together with the commit that turns them green, or the run fails
and nothing deploys. Measured 2026-10-13: run 38399933367 deployed `34ac650`.

### Plain `pnpm` here is newer than the pinned one

`mise.toml` and the `Dockerfile` pin pnpm 11.9.0, but plain `pnpm` on this machine is
11.20.0, which writes the lockfile differently: adding one package changed 97 lines. Use
`mise exec -- pnpm add …`; the same change was then 8 lines. Measured 2026-10-13.

### The first visit after a quiet spell is slow, and can fail

`fly.toml` (fixed) stops the machine when nobody has the app open. The next request starts
it again. Measured 2026-10-14 03:55, a few minutes after a deploy: two requests failed
outright and a stream took 36 seconds to open; after that every page answered in 0.05
seconds. An open session page keeps the machine running: two streams stayed open for 330
quiet seconds. Before a crit, open the app a minute early and leave one tab on it.
Measured again 2026-11-08 21:35 in the Fly log: the stopped machine started in 0.7 seconds
and answered after 2.4 seconds.

### flyctl only has the token through mise

The Fly token is in `mise.local.toml`, so a plain `flyctl` says "no access token". Use
`mise exec -- flyctl …`. Measured 2026-10-07 03:02.

### Astro's HTML compression joins text across tags

Whitespace between tags is dropped, so side-by-side labels run together: the session page
read "Yoursjust now" and "Me too0". Put an explicit `{" "}` between them. Measured
2026-10-07 04:06.

### The checks on GitHub run the app in Docker

On GitHub the app runs in a container, so the checks' requests come from the
container's private network address, not from 127.0.0.1. On 9 November that put the
checks under the limit of 400 sign-ups per network in 10 minutes: 15 checks failed with
429 on GitHub while all passed on this machine (run 42529886070). Away from Fly, a private
address now counts as local (`f0b13b4`). Measured 2026-11-09 09:25.

### One server takes one full run of the checks

The checks sign up 451 accounts, and a server allows 600 sign-ups in 10 minutes. A second
full run on the same server within 10 minutes, or screenshots that sign up after one,
fails with 429. Start a fresh server with an empty database. Measured 2026-11-09 with 253
checks.

