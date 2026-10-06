# Process overview

## What I built

Hands Up is an anonymous question board for a class. People join with a
four-character code, ask without giving a name, and press "Me too" on
questions they also want answered.

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

All ten tests pass on my machine, and a question on the live site was still
there after a redeploy. I have not tested on real phones, with only a
keyboard, or with a screen reader.
