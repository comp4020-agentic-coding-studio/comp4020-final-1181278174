import type { APIRoute } from "astro";
import { endSignIn, SIGNIN_COOKIE } from "../lib/accounts.ts";

export const POST: APIRoute = ({ cookies, locals, redirect }) => {
  endSignIn(cookies.get(SIGNIN_COOKIE)?.value);
  cookies.delete(SIGNIN_COOKIE, { path: "/" });
  locals.log("signed_out");
  return redirect("/", 303);
};

export const ALL: APIRoute = () => new Response("Use the Sign out button.\n", { status: 405, headers: { allow: "POST" } });
