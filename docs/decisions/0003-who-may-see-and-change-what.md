# 3. Who may see and change what

Date: 21 October 2026. Status: accepted.

## Context

Hands Up has no accounts. A person is a browser, by the random id in its
cookie, and the host is the browser that started the session. Crit 10 asks for
what each person may see and change to be checked on the server, and written
down with the reasons.

## Decision

- Anyone with the code sees the questions that are not hidden, their vote
  counts and how many people are here. They can ask, and give each question
  one vote, which they can take back.
- The person who asked a question sees "Yours" on it. They cannot change its
  words or delete it.
- The host also sees the hidden questions, and can mark a question answered or
  not, hide it and show it again.
- In the app nobody sees who asked or who voted, the host included, and nobody
  can change someone else's vote. Whoever runs the server can see in the log
  which tag did what (`PLAN.md`, Crit 10).
- HAND has no host, so nobody can mark or hide a question there.

## Why

- Only the host can mark or hide a question. If anyone could hide one, one
  person could hide everyone else's questions.
- A question cannot be changed or deleted once it is asked. Other people may
  already have pressed "Me too" on its words, and if the words changed, their
  votes would count for a different question. A question that should go can be
  hidden by the host.
- The host is whoever started the session. The app has no accounts and no
  passwords, so this is the only way it can tell who the host is.

## How the server checks it

Each rule is checked on the server for every request, not only by which buttons
a page shows:

- one vote per person per question: the primary key of `votes`
  (`src/lib/schema.ts`)
- "Yours": worked out in the query that lists the questions, so the asker's id
  never leaves `src/lib/board.ts`
- marking and hiding: `setState` in `src/lib/board.ts` does nothing for anyone
  but the host, and the page answers with a 403
- a vote for a hidden question from anyone but the host, or for a question in
  another session: `setVote` does nothing, and the page answers with a 404
- hidden questions: left out of everyone's list but the host's, and out of the
  live stream

The tests in `spec/` check all of these against the running app, except the
vote for a question in another session. Each request that is not allowed is
also a line in the log, with the reason.

## Two people at once

Two people cannot change the same thing at once. A question's words never
change, a vote belongs to one person, and only the host changes a question's
state. Two votes from one person that arrive together count once, because of
the key.

## Consequences

- Someone who clears their cookies, or opens a private window, is a new person
  and can vote again.
- The host is one browser: a session started on the lecture computer cannot be
  managed from a phone.
- An asker who regrets a question has to ask the host to hide it.
