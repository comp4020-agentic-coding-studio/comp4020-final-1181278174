// Wording the server and the page's script both use, so a count the script
// changes reads the same as one the server rendered.

export const votesLabel = (n: number): string => `Me too, ${n} ${n === 1 ? "vote" : "votes"}`;

export const howMany = (n: number): string => `${n} ${n === 1 ? "question" : "questions"}`;

/** How many people have the session open. */
export const hereLabel = (n: number): string => `${n} here`;

/** "just now", "4 min ago", "2 h ago", else the date. */
export function ago(when: Date, now = new Date()): string {
  const minutes = Math.floor((now.getTime() - when.getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} h ago`;
  return when.toLocaleDateString("en-AU", { day: "numeric", month: "short", timeZone: "Australia/Sydney" });
}

/**
 * How many of the people here have a hand up, as what they said: "3 of 12 here
 * say they're lost". A hand is a report, so with none up the line says only
 * that no hand is up: silence is not understanding.
 */
export const lostLabel = (lost: number, here: number): string =>
  lost === 0
    ? `${here} here. No hands up right now.`
    : `${lost} of ${here} here ${lost === 1 ? "says they're" : "say they're"} lost`;

/** Said under the count while no hand is up: what silence does not show. */
export const SILENCE = "That doesn't mean everyone follows. Lost? Raise yours, no words needed.";

/** The same, short enough for the projector and the small window. */
export const SILENCE_SHORT = "That doesn't mean everyone follows.";

/** Why a hand can't go up now: the class hasn't started, or has ended. */
export const classNote = (state: "before" | "on" | "over"): string =>
  state === "before" ? "The class hasn't started. Hands open when the host starts it." : state === "over" ? "The class has ended." : "";

/** The lecturer's acknowledgement, without claiming what it changed. */
/** A refusal for going too fast, saying how long to wait. */
export function tooFast(seconds = 60): string {
  const wait = seconds < 90 ? `${seconds} ${seconds === 1 ? "second" : "seconds"}` : `${Math.ceil(seconds / 60)} minutes`;
  return `Too many in a row. Try again in ${wait}.`;
}

/** What a refused press says: why, in a few words, and what to do next if anything. */
export function refusal(intent: string, status: number): string {
  if (status === 403) return intent === "hand" ? "The host teaches and has no hand." : "Only the host can do that.";
  if (status === 404) return intent === "unreport" ? "There's no report of yours to take back." : "That question isn't here any more.";
  if (status === 422 && intent === "unreport") return "A report can only be taken back within a minute.";
  if (status === 422 && intent === "report") return "This session has no host to report to.";
  return "That didn't work. Reload the page and try again.";
}

export const GOING_OVER_MESSAGE = "The lecturer is going over it.";
export const GOING_OVER_NOTE = "Shows on every screen for 2 minutes.";

/** The time a raised hand comes down by itself, as the clock in the room shows it: "14:08". */
export const clock = (when: Date): string =>
  when.toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Australia/Sydney" });

/** What the hand button's note says: with the hand up, when it comes down by itself. */
export const handNote = (until: Date | undefined): string =>
  until
    ? `Your hand is up. It comes down by itself at ${clock(until)}. Press again to put it down sooner; if you're still lost then, raise it again.`
    : "One press, no words. A hand comes down by itself after 3 minutes.";

/** A day as the room says it: "Monday 9 November". */
export const day = (when: Date): string =>
  when.toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long", timeZone: "Australia/Sydney" });

/** A time today ("14:02"), or on another day ("14:02 on Monday 2 November"). */
export const moment = (when: Date, now = new Date()): string =>
  day(when) === day(now) ? clock(when) : `${clock(when)} on ${day(when)}`;
