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
