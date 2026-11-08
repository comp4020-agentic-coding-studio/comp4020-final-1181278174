import type { AstroCookies } from "astro";
import { and, eq } from "drizzle-orm";
import type { Account } from "./accounts.ts";
import { db } from "./db.ts";
import type { Fields } from "./log.ts";
import { accountGuides } from "./schema.ts";

export type GuideRole = "student" | "host";
type GuideContext = {
  account: Account | null;
  cookies: AstroCookies;
  url: URL;
  log: (what: string, fields?: Fields) => void;
};
type GuideResult = { ok: true } | { ok: false; status: 422; message: string };

const COOKIE = "hands_up_guide";
const YEAR = 60 * 60 * 24 * 365;
const ROLES: GuideRole[] = ["student", "host"];

// This cookie is only a display preference. It grants no permission and
// carries no identity; an absent or malformed value shows the guides again.
function browserGuides(cookies: AstroCookies): GuideRole[] {
  const value = cookies.get(COOKIE)?.value;
  if (value === "student" || value === "host") return [value];
  return value === "student,host" ? [...ROLES] : [];
}

export function guideDone(context: Pick<GuideContext, "account" | "cookies">, role: GuideRole): boolean {
  if (!context.account) return browserGuides(context.cookies).includes(role);
  return Boolean(db.select({ completedAt: accountGuides.completedAt }).from(accountGuides)
    .where(and(eq(accountGuides.accountId, context.account.id), eq(accountGuides.role, role))).get());
}

/**
 * Handle intent=guide; the caller chooses the role from the page's identity,
 * and redirects back to that page with 303 on success. "all" can reset both
 * preferences together. GET never changes a remembered preference.
 */
export function handleGuide(form: FormData, context: GuideContext, role: GuideRole | "all"): GuideResult {
  const action = form.get("guide_action");
  if (!["finish", "skip", "reset"].includes(String(action)) || (role === "all" && action !== "reset")) {
    context.log("refused", { action: "guide", reason: "no-such-guide-action" });
    return { ok: false, status: 422, message: "Choose Got it, Skip or Show the guide again." };
  }

  const roles = role === "all" ? ROLES : [role];
  if (context.account) {
    const accountId = context.account.id;
    if (action === "reset") {
      const match = role === "all"
        ? eq(accountGuides.accountId, accountId)
        : and(eq(accountGuides.accountId, accountId), eq(accountGuides.role, role));
      db.delete(accountGuides).where(match).run();
    } else {
      db.insert(accountGuides).values({ accountId, role: roles[0], completedAt: new Date() })
        .onConflictDoNothing().run();
    }
  } else {
    const completed = browserGuides(context.cookies);
    const next = ROLES.filter((item) => action === "reset"
      ? completed.includes(item) && !roles.includes(item)
      : completed.includes(item) || roles.includes(item));
    if (next.length === 0) {
      context.cookies.delete(COOKIE, { path: "/" });
    } else {
      context.cookies.set(COOKIE, next.join(","), {
        httpOnly: true,
        sameSite: "lax",
        secure: context.url.protocol === "https:",
        path: "/",
        maxAge: YEAR,
      });
    }
  }

  const event = action === "reset" ? "guide_reopened" : action === "skip" ? "guide_skipped" : "guide_finished";
  context.log(event, { role });
  return { ok: true };
}
