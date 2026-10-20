# Process overview

## What I built

Hands Up is an anonymous question board for a class. People join with a
four-character code, ask without giving a name, and press "Me too" on
questions they also want answered.

Since crit 9 it is live: a question, a vote or a change by the host shows on
every open page within about a second. There is also a page for the projector,
and the host can mark a question answered or hide it.

Since crit 10 the server logs who did what, one line for each action, with a
short tag for each person. What each person may see and change is checked on
the server: for example, only the host can hide a question.

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
committed while they failed. In crit 10 the decision about the logs was in
`PLAN.md` before any code ([`ce5c77f`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-1181278174/commit/ce5c77f)).

Until crit 10 I let the agent work through many steps on its own and accepted
its reports. Then I found that I could not follow what had been built, so the
agent now explains one step at a time and gives me something to try before the
next.

## The moments that mattered

**1. I accepted a plan that put the tests first.**
*What happened:* the agent's plan listed eight things a visitor should be able
to do, as tests to write before the app code.
*What I did:* I accepted it. The agent committed the eight tests while all of
them failed
([`0e40179`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-1181278174/commit/0e40179)).
*How I knew:* the agent ran the tests before every commit, and the failures
went from 8 to 2, then 1, then 0
([`6588baf...26bfd52`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-1181278174/compare/6588baf...26bfd52)).

**2. The agent found that the test and the page were both wrong.**
*What happened:* the test for the "Yours" label kept failing.
*What the agent did:* it printed the HTML and the text the test read. The page
had no space between "Yours" and the time, and the test joined paragraphs
without a space. It fixed both without changing what the test checks
([`fa0a5af`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-1181278174/commit/fa0a5af),
[`26bfd52`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-1181278174/commit/26bfd52)).
*How it knew:* the label was in the HTML, but the test's text joined it to the
question. I only learned about it from the agent's report.

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

**5. I changed one of my own rules.**
*What happened:* since crit 8 a rule in `CLAUDE.md` said that nothing logged
may tie a question to a browser ([`0baf778`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-1181278174/commit/0baf778)). The crit 10 spec asks for
logs that say who did what.
*What I did instead:* after the agent showed me five example log lines, I chose
to log who asked too: by a short tag, never by the cookie, and with nothing
anyone typed ([`ce5c77f`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-1181278174/commit/ce5c77f), [`cf04364...dad4bff`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-1181278174/compare/cf04364...dad4bff)). I changed the rule in `CLAUDE.md` to match
([`7bf28a1`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-1181278174/commit/7bf28a1)). Leaving the tag off
that line would not hide who asked, because the asker's page loads again
straight after, with their tag. The cost is that whoever runs the server can
see which tag asked which question, which the database already held.
*How I knew:* the agent searched the local and the live logs for the cookies it
had used, and found none. I have not yet tried it in two windows myself.

**6. The agent broke a rule, so I had a check added.**
*What happened:* `CLAUDE.md` says never to run the tests against the live app,
because they write. The agent did it anyway, following the course's setup
steps, and left 63 test sessions in the live database.
*What I did instead:* I had a check added, so that the tests that write fail at
once on a fly.dev address ([`60c84e1`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-1181278174/commit/60c84e1)).
*How I knew:* run against the live app again, they failed before any test ran,
and the live log showed three pages opened and no forms sent.

All 30 tests pass on my machine and on GitHub. One added in crit 10 showed that
a vote for a hidden question was counted, before the fix ([`2973e4a`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-1181278174/commit/2973e4a),
[`b5261ef`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-1181278174/commit/b5261ef)). The tests cannot see a page change, so that was checked in two
browser windows and on my own phone and laptop, where the QR code scanned. The
log was checked as moment 5 says. I have not tested with more than two devices,
with only a keyboard, or with a screen reader.
