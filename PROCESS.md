# Process overview

## What I built

Hands Up lets a student signal confusion without writing a question or showing
their name to the class. Everyone sees the room's aggregate response. A question
board supports more specific questions, while a timeline, pause card and recap
help the lecturer respond. Small tutorials have a separate help queue.

## How I directed the work

I used AI coding tools to implement and review the application, while I set its
purpose, priorities and acceptance criteria. I recorded decisions in `PLAN.md`
and translated them into rules in `CLAUDE.md`: public views must not identify
question authors, counts need a denominator, and basic actions must work without
JavaScript. Tests turn the checkable parts into requirements for future changes
([`93254e9`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-1181278174/commit/93254e9)).

I kept Astro on Node and SQLite from crit 7 because I already had a working
deployment on the supplied 256 MB Fly machine. Changing frameworks would have
taken time from the interaction design. SQLite avoids a separate database
service, but ties this version to one machine and volume. Server-sent events fit
the communication: actions are form posts, and updates travel from server to
browser. WebSockets would add a two-way channel I did not need; frequent polling
would create repeated requests. The [stack decision record](https://github.com/comp4020-agentic-coding-studio/comp4020-final-1181278174/blob/20ca1e7/docs/decisions/0001-stack.md)
records the alternatives and costs
([`20ca1e7`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-1181278174/commit/20ca1e7)).

I introduced a second model to challenge assumptions and compare proposals.
Claude Code maintained the project; GPT through Codex provided another review
perspective and developed alternatives on branches. My role was to decide which
directions were worth pursuing. This produced more choices and exposed missed
problems, but also required repeated review and integration. Agreement between
models was useful input to my decisions; tests and my own use supplied further
evidence.

I made the workflow easier to supervise by requiring bounded tasks, explanations
of failures, and something I could try between steps. A new regression test had
to demonstrate the unwanted behaviour before the fix. These rules made progress
reviewable and gave me opportunities to correct the direction before more work
accumulated, as recorded in `CLAUDE.md`.

## Decisions that changed the project

### Making confusion visible to the room

By crit 10, I had a working question board, but tools such as Ed and Echo360
already supported classroom questions. I wanted to address the earlier moment
when a student feels lost but cannot yet formulate a question. Reading about
[pluralistic ignorance](https://www.frontiersin.org/journals/social-psychology/articles/10.3389/frsps.2023.1260896/full)
helped explain another obstacle: everyone else's silence can make a student
think they alone are confused.

I made a wordless hand the main interaction and kept the question board for
specific questions. Showing the aggregate to students as well as the lecturer
was essential to that reasoning
([`aa80057`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-1181278174/commit/aa80057),
[`29f0a7c`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-1181278174/commit/29f0a7c)).
The 3D hall expresses people being present together, at the cost of extra browser
work. I therefore kept the button and written count usable without it. One-click
signalling and shared counts satisfy my interaction criteria; whether they
encourage participation remains a classroom evaluation question.

I also tightened what the count could claim: it reports people who say they are
lost, with the number present alongside it. An empty count must not imply that
everyone understands. This distinction connects my design argument to concrete
wording rules and tests
([`93254e9`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-1181278174/commit/93254e9)).

### Keeping attention on the class

Comparing four visual proposals, I found the projector views lacked a clear
information hierarchy. I asked for the confusion count to be most prominent,
followed by joining instructions and questions, with the 3D scene supporting
the count. I combined the palette, interface and capsule tabs I preferred from
different proposals
([`3cfc9dd`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-1181278174/commit/3cfc9dd),
[`8ab00c6`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-1181278174/commit/8ab00c6)).

I also questioned whether a lecturer could reasonably watch a changing number
while teaching. That changed the workflow: a pause card summarises feedback
when the lecturer has an opportunity to respond, and a recap supports review
after class. The floating window leaves screen space for teaching materials and
notes. I accepted the browser-support constraint because this arrangement
better matched the classroom activity I wanted to support
([`78a6efd`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-1181278174/commit/78a6efd),
[`70ce752`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-1181278174/commit/70ce752),
[`aff1c44`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-1181278174/commit/aff1c44)).
For smaller tutorials, I chose a separate help queue to fit individual assistance
([`aad9f98`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-1181278174/commit/aad9f98)).

### Reconsidering accounts and anonymity

Initially I avoided accounts to reduce the barrier to participation. I later
decided that teachers needed controls across devices, a participant needed a
consistent identity across browsers, and harmful questions needed a route to
account-level accountability. I chose to add login despite the models'
recommendation to defer it. This meant accepting registration friction and extra
work close to the deadline
([`78a60ad`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-1181278174/commit/78a60ad)).

I kept usernames out of classroom views. The app encrypts a question's author
with a public key; the corresponding private key opens that record for auditing
([`649510e`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-1181278174/commit/649510e)).
This identifies an account, without verifying a real person or preventing
multiple accounts. For marking, the private key is published in `auditor/` and
excluded from the deployment image. Anyone with that key and a sealed record
can decrypt it; a real deployment would require private custody of the key
([`ce84b3f`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-1181278174/commit/ce84b3f)).

## What verification changed

A review exposed a gap despite 165 passing checks: after an account change in
another tab, an existing page could retain host-only information. This made the
limits of the test suite concrete for me. The correction included regression
tests that execute the actual page script in jsdom and fail on the old behaviour.
Pages now reload when their sign-in changes, preserving unfinished questions;
the stream also identifies its sign-in on initial connection
([`a3d215a`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-1181278174/commit/a3d215a),
[`a59d65c`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-1181278174/commit/a59d65c)).
The lasting improvement was adding the missing scenario to the checks.

Another failure showed why local success was insufficient. After tutorial
integration, GitHub's container network hit the registration limit while local
tests passed. The fix recognises private addresses as local only outside Fly,
preserving production address handling and adding a regression check
([`f0b13b4`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-1181278174/commit/f0b13b4)).
For me, this reinforced that readiness includes the deployment environment.
The failure and its cause are now recorded in `CLAUDE.md`, so the next working
session can use that knowledge
([`93254e9`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-1181278174/commit/93254e9)).

I personally tried most features on both my computer and phone, alongside
automated checks and scripted browser testing. My visual comparisons and device
use informed my judgement of the interface. I have not evaluated the app in a
real class or with a screen reader. Whether students participate more and
lecturers respond at useful moments remains unproven by these checks.
