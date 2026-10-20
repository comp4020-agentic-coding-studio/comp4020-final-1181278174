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

  // one line per request, after it is answered: the path without its query,
  // since a query can hold what someone typed
  const id = requestId();
  const started = performance.now();
  const response = await next();
  const took = Math.round(performance.now() - started);
  write(id, `${context.request.method} ${context.url.pathname} ${response.status} ${took}ms`, { person: tag(person) });
  return response;
});
