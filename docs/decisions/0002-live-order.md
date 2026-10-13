# 2. When votes change the order, every screen reorders straight away

Date: 13 October 2026. Status: accepted.

## Context

From crit 9 the app is live: a new question or a vote shows on every open page
within about a second, without a reload. The Popular list is sorted by votes,
so one person's vote can change the order of the list on everyone else's
screen. That can happen while someone is reading the list, or just as they are
about to press "Me too".

I had to decide what an open page does when the order changes.

`README.md` says good means that more people ask their questions, and that the
questions most people want answered come first.

## Options

- **Every screen reorders straight away.** The order on every phone and on the
  projector is always the real order, and everyone in the room sees the same
  list as the person at the front. The cost is that a question can move just
  as someone presses, so a "Me too" can go to the wrong question.
- **A phone keeps its order until its owner asks for the new one.** Counts and
  new questions still arrive live, and only the projector reorders by itself.
  A button on the phone says the order has changed. Nothing moves under a
  finger. The cost is that the list on a phone can be out of date, two people
  can be looking at different orders, and there is one more button to press.
  Slido's staff describe questions that jump around as distracting, which is
  an argument for this option.

## Decision

Every screen reorders straight away.

A question that gets votes moves up at once, so anyone looking at any screen
can see straight away which question the class wants most, without pressing
anything. I tried it before settling on this reason: I asked two questions on
my laptop, pressed "Me too" on the second one on my phone, and watched its card
slide to the top on the laptop.

The agent recommended the other option. I first picked this one without really
understanding either, and only worked out my reason when I had to explain it.

To make the cost smaller:

- A card slides to its new place in about a third of a second, so it is easy
  to see where it went. If the device asks for reduced motion, it moves at once.
- A count that changes gets briefly bigger, so a change made by someone else
  is noticed.
- If the keyboard focus is on a button when its card moves, the focus stays on
  that button.
- A "Me too" shows clearly when it is pressed, and pressing it again takes the
  vote back.
- The Recent list is sorted by time, so votes never reorder it. Someone who
  wants a list that only changes when a question is added can use Recent.
- While a finger is on the screen, or the mouse button is down, the list on
  that device does not move. It changes to the newest order a moment after the
  finger or the button is lifted.
- A card that has just moved cannot be pressed for 0.4 seconds. A press that
  arrives in that time was aimed at the card that was there before, so it is
  ignored and the person has to press again. The keyboard is not affected, because
  the keyboard focus moves with the card.

These last two only happen in a browser, so the tests in `spec/` do not cover
them. They were checked by hand in two browser windows.

## Consequences

- A "Me too" can still go to the wrong question. I have not measured how often
  this happens. With four people it should be rare. In a class of 150, with
  votes arriving every second, the top of the list will move a lot, and this
  needs to be tried in a real lecture.
- Everyone sees the same order, so the person at the front can say "the second
  one" and the class knows which question that is.
- The server sends the whole list of question ids, vote counts and states
  after every change, not only what changed. A phone that was asleep or lost
  its connection gets the current list when it reconnects, and the server
  does not have to remember what each phone has seen.
- Changes less than 100 milliseconds apart are sent as one message, so a
  change takes at least that long to arrive.
- A new question is sent to the open pages with its words, and they draw the
  card themselves. In the first version every open page requested the whole
  page again instead, which was 150 page requests at once in a class of 150.
  The person who asked is not sent the message. Their own pages still request
  the page, so that "Yours" is decided on the server and is never in a message.
- A press that is ignored because of the 0.4 second rule looks like nothing
  happened. I think
  that is better than a vote for the wrong question, but I have not tested it
  with other people.

## What I measured

All of this was measured from one computer opening many connections, not from
real phones.

- On the live app, with 150 connections open to one session, a vote reached
  every connection in about 0.12 seconds.
- On the live app, a connection with nothing to send stayed open for 70
  seconds. The server sends a short line every 20 seconds to keep it open.
- In the first version, a new question made every open page request the page
  again.
  On the live app, 150 requests for the session page at the same moment took
  about 0.8 seconds to be answered, which is close to the one-second limit.
  After the change, with 150 connections open, a new question's words reached
  every connection in about 0.04 seconds and the list that includes it in
  about 0.14 seconds, and the other pages made no request for the page.
- The live server had about 98 MB of memory free out of 212 MB, both with 150
  connections open and with none.
- In two browser windows on the live app, a question asked in one showed in
  the other after about 0.2 seconds, and a vote reordered the other after
  about 0.4 seconds.
