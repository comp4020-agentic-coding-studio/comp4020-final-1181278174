import type { AstroCookies } from "astro";
import { endSignIn, SIGNIN_COOKIE, SIGNIN_SECONDS, startSignIn } from "./accounts.ts";

/** A return address stays on this site, including when a browser normalises it. */
export function returnPath(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(value)) return "/";
  const base = "https://hands-up.invalid";
  const parsed = new URL(value, base);
  // Removing dot segments can leave a leading double slash. Returning that
  // as a Location header would turn a same-site URL into a different host.
  if (parsed.origin !== base || parsed.pathname.startsWith("//")) return "/";
  return parsed.pathname + parsed.search + parsed.hash;
}

export function authLink(action: "signin" | "signup", path: string): string {
  return `/${action}?return=${encodeURIComponent(returnPath(path))}`;
}

/**
 * Rotate this browser's sign-in: start a new one, then end the one it had.
 * False when the password changed after it was checked (`verifiedHash`).
 */
export function completeSignIn(accountId: string, cookies: AstroCookies, url: URL, verifiedHash?: string): boolean {
  const token = startSignIn(accountId, verifiedHash);
  if (!token) return false;
  endSignIn(cookies.get(SIGNIN_COOKIE)?.value);
  cookies.set(SIGNIN_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: url.protocol === "https:",
    path: "/",
    maxAge: SIGNIN_SECONDS,
  });
  return true;
}
