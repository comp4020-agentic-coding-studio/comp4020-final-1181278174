import { randomBytes } from "node:crypto";
import { defineMiddleware } from "astro:middleware";
import { findAccount, SIGNIN_COOKIE } from "./lib/accounts.ts";
import { requestId, tag, write } from "./lib/log.ts";

// Keep the original browser id so sessions hosted before sign-in can be
// claimed. Signed-in activity belongs to the account, across browsers.
const COOKIE = "hands_up_person";
const SHAPE = /^[A-Za-z0-9_-]{22}$/;
const YEAR = 60 * 60 * 24 * 365;

export const onRequest = defineMiddleware(async (context, next) => {
  let browser = context.cookies.get(COOKIE)?.value;
  if (!browser || !SHAPE.test(browser)) {
    browser = randomBytes(16).toString("base64url");
    context.cookies.set(COOKIE, browser, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: YEAR,
      secure: context.url.protocol === "https:",
    });
  }
  context.locals.browser = browser;
  context.locals.account = findAccount(context.cookies.get(SIGNIN_COOKIE)?.value);
  const person = context.locals.account?.id ?? browser;
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
  // Every page reads a POST as a form. A body sent any other way, or a form that
  // can't be read, is refused here with a 400 instead of failing in the page.
  if (context.request.method === "POST") {
    const type = context.request.headers.get("content-type") ?? "";
    let readable = /^(application\/x-www-form-urlencoded|multipart\/form-data)\b/i.test(type);
    if (readable) {
      try {
        await context.request.clone().formData();
      } catch {
        readable = false;
      }
    }
    if (!readable) {
      context.locals.log("refused", { reason: "not-a-form" });
      line(400);
      return new Response("Send this as a form.\n", { status: 400, headers: { "content-type": "text/plain; charset=utf-8" } });
    }
  }
  try {
    const response = await next();
    // Pages include private account controls and the owner's username. Keep
    // them out of shared caches; streams retain their own no-transform rule.
    if (!response.headers.get("content-type")?.includes("text/event-stream")) {
      response.headers.set("cache-control", "private, no-store");
    }
    // No other site may show these pages in a frame, so nobody can be tricked
    // into pressing "I'm lost" or "Report" on a page laid under something else.
    response.headers.set("x-frame-options", "DENY");
    response.headers.set("content-security-policy", "frame-ancestors 'none'");
    response.headers.set("x-content-type-options", "nosniff");
    response.headers.set("referrer-policy", "same-origin");
    line(response.status);
    return response;
  } catch (error) {
    // Astro answers with a 500 and prints where it happened just after this line
    line(500, JSON.stringify(error instanceof Error ? error.message : String(error)));
    throw error;
  }
});
