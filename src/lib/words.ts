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

/** How many of the people here have a hand up: "3 of 12 here are lost". */
export const lostLabel = (lost: number, here: number): string =>
  `${lost} of ${here} here ${lost === 1 ? "is" : "are"} lost`;

/** The time a raised hand comes down by itself, as the clock in the room shows it: "14:08". */
export const clock = (when: Date): string =>
  when.toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Australia/Sydney" });

/** What the hand button's note says: with the hand up, when it comes down by itself. */
export const handNote = (until: Date | undefined): string =>
  until
    ? `Your hand is up. It comes down by itself at ${clock(until)}, or press again once you've caught up.`
    : "One press, no words.";
