// Wording the server and the page's script both use, so a count the script
// changes reads the same as one the server rendered.

export const votesLabel = (n: number): string => `Me too, ${n} ${n === 1 ? "vote" : "votes"}`;

export const howMany = (n: number): string => `${n} ${n === 1 ? "question" : "questions"}`;

/** How many people have the session open. */
export const hereLabel = (n: number): string => `${n} here`;
