# Hands Up

Hands Up is an anonymous question board for a class. The person teaching
starts a session and shows its four-letter code on the screen. Everyone else
opens the session on their phone, asks without giving a name, and presses "Me
too" on the questions they also want answered. New questions and votes show on
every open phone within about a second. There are no accounts and nothing to
install.

To try it, open [HAND](https://comp4020-final-1181278174.fly.dev/s/HAND), a
board for questions about this app. Ask something there, then come back later:
your question will still be marked "Yours". To see it update live, open HAND in
two windows, or open its
[projector page](https://comp4020-final-1181278174.fly.dev/s/HAND/present) next
to your phone.

## Why I built this

In a lecture or a crit, most questions come from the few people who are happy
to ask out loud. My guess is that many more people have questions they never
ask. Apps for this already exist. I looked at Slido, Mentimeter, Pigeonhole
Live and Vevox. They are made for conferences and companies, so they come with
names, accounts, polls, quizzes and moderation. Hands Up is for one class: 20
to 150 people with phones and one person at the front.

## What good means here (second version)

Good means more people ask their questions, and the questions most people want
answered come first.

- **Asking is quick.** No account, no name and no app. You type the code, in
  upper or lower case, and the question box is the first thing on the page.
- **Nobody can see who asked, including the host.** Each browser gets a random
  id in a cookie. The app uses it to allow one vote per person on each
  question and to mark your own questions "Yours", but never puts it in a page.
- **Votes decide the order, but new questions are easy to find.** Popular
  shows the most "Me too" first; Recent shows the newest first.
- **Everyone sees the same list at the same time.** A question, a vote or a
  change by the host shows on every open page within about a second, without a
  reload, and the order changes with it.
- **Questions stay.** They are still there after a reload, a server restart or
  a redeploy.
- **It works on a phone, with a keyboard and without JavaScript.** Every action
  is a normal HTML form. Without JavaScript the page does not update by itself,
  but asking, voting and reloading all work.

The tests in `spec/` check most of these points against the running app, for
example that two votes sent at the same moment count once, and that the
asker's id is missing from pages sent to anyone else. For live updates, the
tests open the same connection a page opens and check that the server sends a
new question, a vote and the new order within one second, and that nothing it
sends says who asked or voted. The tests do not run a browser, so they cannot
see a page change. That part was checked by hand, with two browser windows
side by side at phone width and on a laptop, and I tried it on my own phone and
laptop. I also checked by hand that questions are still there after a
redeploy. Whether more people really ask, and whether the pages are easy to
read, I have to judge. I drew the screens in a design tool first. I have not
yet tried it with a room of people or with a screen reader.

## How it behaves when several people use it at once

The list on every screen is sorted by votes, so one person's vote can change
the order for everyone. I decided that every open screen reorders straight
away, phones included. The other option was to keep the order still on a phone
until its owner asks for the new one. The cost of my choice is that a question
can move just as someone is about to press "Me too" on it. To make that less
likely, the list does not move while a finger is on the screen, and a question
that has just moved cannot be pressed for 0.4 seconds. These two were checked by
hand in a browser; the tests do not cover them. I chose live reordering
because anyone can then see straight away which question the class wants most.
The options and the cost are in
[the decision record](docs/decisions/0002-live-order.md).

- The page shows "Live" while it is connected and "Reconnecting" while it is
  not. When it reconnects, it is sent the current list, so nothing is missed.
- "3 here" is the number of people with the session open. Two tabs in one
  browser count as one person, and the projector page is not counted.
- The person who started a session can mark a question "Answered" or hide it.
  An answered question moves below the open ones. A hidden question is only
  listed for the host, who can show it again.
- The projector page shows the code, a QR code and the five open questions
  with the most votes, in large type. It has no buttons, only a link to the
  session page for someone who opened it on their own device.

The tests check the count of people, the host's actions and the projector
page. The "Live" label I checked by hand, by stopping the server and starting
it again with a page open.

## What I chose not to build

- **Replies**, because the board would turn into a chat.
- **Downvotes.** A question nobody wants answered just gets no votes.
- **Names, accounts and profile pictures**, because asking should stay quick
  and anonymous.
- **Polls and quizzes.** Other apps do these well.
- **Approving questions before they appear.** The host can hide a question
  afterwards instead.

One choice I am not sure about: Hacker News hides comment scores so that people
don't just vote the way everyone else did. Hands Up shows the count, because
the person at the front needs to see what most people want answered. Counts
now update live and the list reorders as votes arrive, so a question that is
already at the top is easier to vote for than before. I have not tried this
with a real class yet.

## Not built yet

- A way for the host to use a second device. The host is the browser that
  started the session, so a session started on the lecture computer cannot be
  managed from a phone.
- Marking the question that is being answered right now.
- Written answers after the session.
- Logging on the server, which is the next crit.

## Limits

The app treats each browser as one person. If you clear your cookies or switch
phones, it sees you as someone new: your questions lose "Yours", and you can
vote again. That is fine for one class, but not for anything that must be
counted fairly. The server knows which browser asked each question, so it can
show "Yours", but it never shows this to anyone else.

HAND has no host, so nobody can hide or mark a question there. The app runs on
one small server, and the list of open connections is kept in that server's
memory, so it cannot be spread over several servers.

## What I looked at

- Slido: [running a Q&A](https://community.slido.com/live-q-a-management-216/run-a-q-a-session-404),
  [sorting](https://community.slido.com/live-q-a-management-216/sort-your-audience-q-a-questions-426),
  [character limits](https://community.slido.com/frequently-asked-questions-70/what-are-the-character-limits-for-polls-and-q-a-1323),
  [anonymous or named](https://community.slido.com/security-privacy-essentials-224/participant-privacy-choose-anonymous-or-named-participation-1609)
- Mentimeter: [questions from the audience](https://help.mentimeter.com/en/articles/1501608-questions-from-audience-the-audience-perspective)
- Pigeonhole Live: [Q&A](https://help.pigeonholelive.com/hc/en-us/articles/360000956853-Q-A),
  [the projector panel](https://help.pigeonholelive.com/hc/en-us/articles/217586958-Using-the-Projector-Panel-in-an-Event-Pigeonhole)
- Vevox: [participant manual](https://help.vevox.com/hc/en-us/articles/360014327757-Participant-user-manual)
- Hacker News hiding comment scores:
  [hacker-news-undocumented](https://github.com/minimaxir/hacker-news-undocumented/blob/master/README.md)
