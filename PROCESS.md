# Process overview

## What I built

Hands Up is an anonymous question board for a class. People join with a
four-character code, ask without giving a name, and press "Me too" on
questions they also want answered.

Since crit 9 it is live: a question, a vote or a change by the host shows on
every open page within about a second. There is also a page for the projector,
and the host can mark a question answered or hide it.

## How I worked

I planned first and directed an AI coding agent. Before any code, `PLAN.md`
set what the app would not do: no names, not even for the host; no replies;
and one vote per person per question
([`763069e`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-1181278174/commit/763069e)).
`CLAUDE.md` turns these into rules for the agent. I kept crit 7's stack, Astro
with SQLite on the Fly volume, which I had deployed before
([decision record](docs/decisions/0001-stack.md)). The design came from studying
four similar Q&A apps
([`8107b18`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-1181278174/commit/8107b18)).

In crit 9 the part the spec asks for was on the live site before anything else
was built on it ([`34ac650`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-1181278174/commit/34ac650)), and the tests for each new part were
committed while they failed.

## The moments that mattered

**1. I had the tests written before the app code.**
*What happened:* the plan listed eight things a visitor should be able to do.
*What I did instead:* I had each one written as a test, and committed them
while all eight failed
([`0e40179`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-1181278174/commit/0e40179)).
*How I knew:* I ran the tests before every commit, and the failures went from
8 to 2, then 1, then 0
([`6588baf...26bfd52`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-1181278174/compare/6588baf...26bfd52)).

**2. I checked whether the test or the page was wrong.**
*What happened:* the test for the "Yours" label kept failing.
*What I did instead:* I printed the HTML and the text the test read.
The page had no space between "Yours" and the time, and the test joined
paragraphs without a space. I fixed both without changing what the test checks
([`fa0a5af`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-1181278174/commit/fa0a5af),
[`26bfd52`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-1181278174/commit/26bfd52)).
*How I knew:* the label was in the HTML, but the test's text joined it to the
question.

**3. I approved a decision before I understood it.**
*What happened:* a vote can change the order of the list on everyone's screen.
The agent gave me two options and recommended one. I picked the other, that
every screen reorders straight away, without understanding either. The plan
recorded it with a reason the agent had written
([`ccf62ed`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-1181278174/commit/ccf62ed)).
*What I did instead:* when I was asked to explain the decision, I could not. I
had the options explained again and tried the app: I pressed "Me too" on my
phone, and the question moved to the top on my laptop. I kept the decision and
wrote my own reason: anyone can see straight away which question the class
wants most.
*How I knew:* I saw the question move on my own two devices
([`979c16b`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-1181278174/commit/979c16b)).

**4. I used the app myself and could not find where to ask.**
*What happened:* I opened the projector page on my laptop and thought it was
the app. It has no box for asking and had no link to the page that has one.
All the tests passed.
*What I did instead:* I had a link added, "Ask from this device", with a test.
*How I knew:* I found it by using the page, not from a test
([`c2a0bc8`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-1181278174/commit/c2a0bc8)).

All 29 tests pass on my machine and on GitHub. The tests cannot see a page
change, so that was checked in two browser windows and on my own phone and
laptop, where the QR code scanned. I have not tested with more than two
devices, with only a keyboard, or with a screen reader.
