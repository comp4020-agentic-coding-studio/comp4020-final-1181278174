import { randomBytes } from "node:crypto";
import { defineMiddleware } from "astro:middleware";
import { requestId, tag, write } from "./lib/log.ts";

// A person is a browser: a random id in an httpOnly cookie, set on the first
// visit and kept for a year. It is how the app tells people apart (one vote
// each, "Yours"), and it never leaves the server in a page.
const COOKIE = "hands_up_person";
const SHAPE = /^[A-Za-z0-9_-]{22}$/;
const YEAR = 60 * 60 * 24 * 365;

export const onRequest = defineMiddleware(async (context, next) => {
  let person = context.cookies.get(COOKIE)?.value;
  if (!person || !SHAPE.test(person)) {
    person = randomBytes(16).toString("base64url");
    context.cookies.set(COOKIE, person, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: YEAR,
      secure: context.url.protocol === "https:",
    });
  }
  context.locals.person = person;

  // Every line from this request starts with the same id and names the same
  // person. Pages log what the person did with `locals.log`.
  const id = requestId();
  const who = tag(person);
  context.locals.log = (what, fields = {}) => write(id, what, { person: who, ...fields });

  // one line per request, after it is answered: the path without its query,
  // since a query can hold what someone typed
  const started = performance.now();
  const line = (status: number, error?: string): void => {
    const took = Math.round(performance.now() - started);
    write(id, `${context.request.method} ${context.url.pathname} ${status} ${took}ms`, { person: who, error });
  };
  try {
    const response = await next();
    line(response.status);
    return response;
  } catch (error) {
    // Astro answers with a 500 and prints where it happened just after this line
    line(500, JSON.stringify(error instanceof Error ? error.message : String(error)));
    throw error;
  }
});
