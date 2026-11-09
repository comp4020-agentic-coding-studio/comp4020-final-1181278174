# Hands Up

Hands Up lets students press **I'm lost** without writing a question or showing
their identity to the class. Everyone sees the count; a question board adds
**Me too**.

## Try it

1. [Open the app](https://comp4020-final-1181278174.fly.dev/), create a
   username/password account, choose **Lecture**, start a session and press
   **Start class**.
2. In another browser profile, create another account and join using the
   four-character code.
3. Press **I'm lost** as the student: both screens update within a second.
   **End class** opens the lecturer's recap.

[HAND](https://comp4020-final-1181278174.fly.dev/s/HAND) stays open for a quick look.

## Why this design

I hear fewer questions in lectures than tutorials. Fear of negative evaluation
(Downing et al., 2020) and difficulty formulating questions (Miyake and Norman,
1979) suggest an anonymous, wordless first action.

Slido's anonymous Q&A hides names but still requires written questions.
Echo360's confusion flag already sends wordless feedback to the lecturer.
I make counts visible to students to address **pluralistic ignorance**:
mistaking classmates' silence for understanding and assuming only you are
struggling (Miller, 2023). Shared reports of difficulty might challenge that
assumption. Crowd Feedback already displayed nonverbal feedback publicly
(Teevan et al., 2012); I use that precedent for clarification requests rather
than like/dislike ratings.

One press sacrifices detail, so questions and **Me too** remain an optional
second step. FireFlies observed frustration when public signals received no
immediate response (Sellier and An, 2020). A pause card, **Going over it** and a
timeline offer acknowledgement and later review. I omit replies, downvotes and polls to keep
attention on asking for help.

## What good means here

- **Help starts with one press.** Counts include their denominator.
  `spec/hall.test.ts` checks wordless submission, counting and updates within
  a second.
- **Classroom anonymity with accountability.** Students and lecturers are not
  shown others' account identities. Students can report questions; lecturers
  can hide them. Hybrid public-key encryption (X25519 and AES-256-GCM) seals
  authors: the server uses the public key to encrypt records; an auditor keeps
  the matching private key off-server to decrypt them. The auditor's tool
  records a reason before revealing an individual question's author.
  `spec/rules-privacy.test.ts` checks exposure; `spec/escrow.test.ts` checks
  decryption, wrong keys, tampering and mismatched questions.
- **Easy to use, with attention on the class.** Interaction should be brief.
  A small floating window keeps controls accessible and leaves the main
  workspace for slides, recordings and notes. This is judged: the floating
  window, keyboard use and both sizes (1920×1080 and 390×844) were checked in
  Chrome while building, not by a test in `spec/`.
- **Feedback lecturers can act on.** The pause card shows the minute in the
  current part with the most hands up, next to the most wanted open question.
  `spec/checkpoint.test.ts` and `spec/timeline.test.ts` check summaries and
  recording offsets.
- **A mode for small tutorials.** A separate **Tutorial** mode provides private
  tickets for tutor visits and a shared exercise timer. `spec/tutorial.test.ts`
  checks mode separation, queue order, permissions and consistent deadlines.

## Limits

This coursework prototype does not integrate Echo360. I wanted students to
watch live lectures or recordings alongside feedback, and lecturers to locate
difficult moments. Video stays separate; timeline offsets use a manually
supplied recording start time.

[Document Picture-in-Picture](https://developer.mozilla.org/en-US/docs/Web/API/Document_Picture-in-Picture_API)
lacks support in mainstream mobile browsers. A mobile equivalent needs
adaptation and testing across systems and device models and might require a
native app, outside this project's scope. Phones use the ordinary page;
desktop floating windows require a supported browser and the source tab open.

Email verification and ANU email sign-in are unimplemented, so accounts do not
verify identity or university membership. Operators can link activity to
accounts; small groups may infer who signalled. Whoever holds the auditor's key
can open any sealed author: the key itself needs no report and no recorded
reason; only the tool asks for them
([privacy details](https://comp4020-final-1181278174.fly.dev/privacy)).

There has been no real-class trial. Improved participation, ease of use,
reduced distraction and lecturers' responses at pauses remain unverified.

## Checked and judged

Further checks cover account and vote limits (`spec/accounts.test.ts`,
`spec/board.test.ts`) and that hands go up only between Start class and End class, while HAND is
always open (`spec/class.test.ts`).
The cited checks do not verify auditor conduct, timed hand expiry or survival
across restarts and redeploys.

Classroom evaluation would observe whether students can signal and return to
materials or notes with little interruption, and whether lecturers respond at
pauses, then ask about distraction and willingness to participate.

## Sources

- Downing, V. R., et al. (2020). [Fear of negative evaluation and student anxiety in community college active-learning science courses](https://doi.org/10.1187/cbe.19-09-0186).
- Miyake, N., & Norman, D. A. (1979). [To ask a question, one must know enough to know what is not known](https://doi.org/10.1016/S0022-5371(79)90200-7).
- Miller, D. T. (2023). [A century of pluralistic ignorance: what we have learned about its origins, forms, and consequences](https://www.frontiersin.org/journals/social-psychology/articles/10.3389/frsps.2023.1260896/full).
- Cisco. [Ask a question in a Q&A session in Slido](https://help.webex.com/en-us/article/nyrj2u9).
- Echo360. [EchoVideo: Flagging and Bookmarking Content](https://support.echo360.com/hc/en-us/articles/11077695519885-EchoVideo-Flagging-and-Bookmarking-Content).
- Teevan, J., et al. (2012). [Displaying mobile feedback during a presentation](https://doi.org/10.1145/2371574.2371633).
- Sellier, N., & An, P. (2020). [How peripheral interactive systems can support teachers with differentiated instruction: Using FireFlies as a probe](https://doi.org/10.1145/3357236.3395497).
