# Crit 8 — It's alive!

## The breakthrough

The breakthrough was deciding what the app would not do before deciding what
it would do. I went through several rounds of ideas, from 3D games to simple
tools, and picked the classroom question board from the last round. The idea
became clear once I decided three things it would not do: no names, not even
for the host; no replies; and no more than one vote per person on each
question. Each of these could be checked by a test against the running app,
so I had the tests written before the app code. All eight failed at first, and
I made them pass one change at a time.

## What it changed

The first test that kept failing had two causes. The page had no space between
the "Yours" label and the time next to it, so the text read "Yoursjust now".
The test also joined the text of separate paragraphs without a space, so it
could not find the label even where it was correct. Changing the test to
accept the page as it was would have made it pass, and both problems would
still be there. I found them by printing the page's HTML and then the exact
text the test was reading.

In crit 5 I learned that a passing test does not prove much on its own. This
week I learned that a failing test can also be wrong. Next time a test fails,
I want to check whether the code or the test is wrong before I change either
of them. I also want to write down early what an app should not do, because
this week those were the easiest things to test.
