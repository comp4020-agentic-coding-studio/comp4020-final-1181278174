# COMP4020 final project — Hands Up

An anonymous question board for one room: a host starts a session with a
four-character code, the room asks without names and presses "Me too" on what
it wants answered. Astro server with SQLite (Drizzle) on the `/data` volume,
deployed to Fly at https://comp4020-final-1181278174.fly.dev/.

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
  Run before every commit. Never point it at the live app: the tests write.
- `pnpm check:evidence` — this file, a crit reflection, `PROCESS.md` without
  its template comment, every cited commit resolves. Run before `/ship`.
- `pnpm db:generate --name <what>` — a migration from `src/lib/schema.ts`.
  Commit the migration with the schema change.
- Deploy by hand while the repo is private, from a clean working tree (the
  deploy uploads the working tree, uncommitted drafts included):
  `mise exec -- flyctl deploy --remote-only --ha=false -a comp4020-final-1181278174`.
- `/preflight` before `/ship`. `/ship` flips the repo public. That cannot be
  undone and only happens on my word.

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
- **My voice.** The message says what changed in the repo, as I would say it, and nothing
  about how the change was made.
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
  `spec/board.test.ts` checks every page another person is sent.
- A person is the random id in the `hands_up_person` cookie (`src/middleware.ts`). No
  names, no accounts, no other identifier, and nothing logged that ties a question to a
  browser.

### Votes

- One vote per person per question is held by the primary key of `votes`. Never count
  votes in a page or in memory.
- A vote sends `want` 1 or 0, never "toggle": two presses that arrive together must not
  cancel out.

### Pages

- Every page renders on the server. Joining, starting, asking and voting are plain forms:
  POST back to the same page, 303 on success, 422 with the text kept on a refusal.
  Script may only add to them.
- At 390 px: one column, no sideways scroll, tap targets at least 44 px. Every control has
  a label. A pressed "Me too" says so with `aria-pressed`, not colour alone.
- The look is in `PLAN.md` (The look) and `src/styles.css`. A new screen is drawn on the
  design canvas before it is built.
- Every page is in English. Chinese stays in chat.

### Promises

- A promise added to `README.md` comes with a check in `spec/`, or the README says it is
  judged.
- Not in this app: replies, downvotes, accounts, names, polls, quizzes. If one seems
  needed, say so and stop.

## Facts about this repo that bite

An entry earns its place after it has cost time here. Shape: what is true, how it was
measured. Delete it when it stops being true.

### CI does nothing while the repo is private

Both jobs in `.github/workflows/checks.yml` carry `if: !github.event.repository.private`.
Until `/ship`, the local `pnpm check` is the only gate and deploys are by hand. Measured by
reading the workflow.

### flyctl only has the token through mise

The Fly token is in `mise.local.toml`, so a plain `flyctl` says "no access token". Use
`mise exec -- flyctl …`. Measured 2026-10-07 03:02.

### Astro's HTML compression joins text across tags

Whitespace between tags is dropped, so side-by-side labels run together: the session page
read "Yoursjust now" and "Me too0". Put an explicit `{" "}` between them. Measured
2026-10-07 04:06.
