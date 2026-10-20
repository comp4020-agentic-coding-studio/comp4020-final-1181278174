import { createHash, randomBytes } from "node:crypto";

// The app's log: a line for each request and for each thing a person does,
// written to standard output, where Fly collects it
// (`mise exec -- flyctl logs -a comp4020-final-1181278174`). A line names a
// person by a short tag worked out from their cookie, never by the cookie
// itself: anyone holding the cookie could act as that person. Nothing anyone
// typed is ever logged; a question is its number.

export type Fields = Record<string, string | number | undefined>;

/** The six characters that stand for a person in the logs. A browser always gets the same tag. */
export const tag = (person: string): string => createHash("sha256").update(person).digest("hex").slice(0, 6);

/** A new id for one request. Every line from that request starts with it. */
export const requestId = (): string => randomBytes(3).toString("hex");

/** Write one line, `[id] what key=value …`. A field with no value is left out. */
export function write(id: string, what: string, fields: Fields = {}): void {
  const pairs = Object.entries(fields).flatMap(([key, value]) => (value === undefined ? [] : [`${key}=${value}`]));
  console.log([`[${id}]`, what, ...pairs].join(" "));
}
