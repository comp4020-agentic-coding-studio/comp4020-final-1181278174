# Hands Up

Hands Up is an anonymous question board for a class. The person teaching
starts a session and shows its four-letter code on the screen. Everyone else
opens the session on their phone, asks without giving a name, and presses "Me
too" on the questions they also want answered. There are no accounts and
nothing to install.

To try it, open [HAND](https://comp4020-final-1181278174.fly.dev/s/HAND), a
board for questions about this app. Ask something there, then come back later:
your question will still be marked "Yours".

## Why I built this

In a lecture or a crit, most questions come from the few people who are happy
to ask out loud. My guess is that many more people have questions they never
ask. Apps for this already exist. I looked at Slido, Mentimeter, Pigeonhole
Live and Vevox. They are made for conferences and companies, so they come with
names, accounts, polls, quizzes and moderation. Hands Up is for one class: 20
to 150 people with phones and one person at the front.

## What good means here (first version)

Good means more people ask their questions, and the questions most people want
answered come first.

- **Asking is quick.** No account, no name and no app. You type the code, in
  upper or lower case, and the question box is the first thing on the page.
- **Nobody can see who asked, including the host.** Each browser gets a random
  id in a cookie. The app uses it to allow one vote per person on each
  question and to mark your own questions "Yours", but never puts it in a page.
- **Votes decide the order, but new questions are easy to find.** Popular
  shows the most "Me too" first; Recent shows the newest first.
- **Questions stay.** They are still there after a reload, a server restart or
  a redeploy.
- **It works on a phone, with a keyboard and without JavaScript.** Every action
  is a normal HTML form.

The tests in `spec/` check most of these points against the running app, for
example that two votes sent at the same moment count once, and that the
asker's id is missing from pages sent to anyone else. I checked by hand that
questions are still there after a redeploy. Whether more people really ask,
and whether the pages are easy to read, I have to judge. I drew the screens in
a design tool first and compared the result at phone width and on a laptop. I
have not yet tried it with only a keyboard or on real phones.

## What I chose not to build

- **Replies**, because the board would turn into a chat.
- **Downvotes.** A question nobody wants answered just gets no votes.
- **Names, accounts and profile pictures**, because asking should stay quick
  and anonymous.
- **Polls and quizzes.** Other apps do these well.
- **Approving questions before they appear.** The host will be able to hide a
  question afterwards instead.

One choice I am not sure about: Hacker News hides comment scores so that people
don't just vote the way everyone else did. Hands Up shows the count, because
the person at the front needs to see what most people want answered. I will
look at this again once counts update live.

## Not built yet

Live updates are next, so that a new question or vote appears on every open
phone within about a second. Hiding questions and a page for the projector come
after that.

## Limits

The app treats each browser as one person. If you clear your cookies or switch
phones, it sees you as someone new: your questions lose "Yours", and you can
vote again. That is fine for one class, but not for anything that must be
counted fairly. The server knows which browser asked each question, so it can
show "Yours", but it never shows this to anyone else.

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
