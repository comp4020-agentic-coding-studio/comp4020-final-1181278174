import { JSDOM } from "jsdom";
import { inject } from "vitest";

// One person with a browser: a cookie jar, and pages read the way a person
// reads them (text, labels, buttons and forms), never by class names. No
// script runs, so whatever these tests do works without JavaScript too.
const baseUrl = inject("baseUrl");

export type Page = { status: number; url: URL; html: string; doc: Document };

function page(status: number, url: URL, html: string): Page {
  return { status, url, html, doc: new JSDOM(html, { url: url.href }).window.document };
}

export class Visitor {
  private cookies = new Map<string, string>();

  /** The cookie values the app has given this person: what identifies them. */
  get secrets(): string[] {
    return [...this.cookies.values()].filter((value) => value.length >= 8);
  }

  private async send(url: URL, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.cookies.size > 0) {
      headers.set("cookie", [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "));
    }
    const res = await fetch(url, { ...init, headers, redirect: "manual" });
    for (const line of res.headers.getSetCookie()) {
      const pair = line.split(";")[0];
      const at = pair.indexOf("=");
      if (at > 0) this.cookies.set(pair.slice(0, at).trim(), pair.slice(at + 1).trim());
    }
    return res;
  }

  /** Open a page, following redirects as a browser does. */
  async open(path: string | URL): Promise<Page> {
    let url = new URL(path, baseUrl);
    for (let hops = 0; hops < 5; hops++) {
      const res = await this.send(url);
      const location = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && location) {
        url = new URL(location, url);
        continue;
      }
      return page(res.status, url, await res.text());
    }
    throw new Error(`too many redirects from ${path}`);
  }

  /** Submit a form as pressing `button` (else its first submit button) would. */
  async submit(from: Page, form: HTMLFormElement, button?: HTMLButtonElement): Promise<Page> {
    const data = new URLSearchParams();
    for (const el of form.querySelectorAll<HTMLInputElement>("input, textarea, select")) {
      if (!el.name || el.disabled || el.type === "submit") continue;
      if ((el.type === "checkbox" || el.type === "radio") && !el.checked) continue;
      data.append(el.name, el.value);
    }
    const submitter =
      button ?? form.querySelector<HTMLButtonElement>('button:not([type="button"]):not([type="reset"])');
    if (submitter?.name) data.append(submitter.name, submitter.value);

    const action = new URL(form.getAttribute("action") ?? "", from.url);
    if ((form.getAttribute("method") ?? "get").toLowerCase() === "get") {
      action.search = data.toString();
      return this.open(action);
    }
    const res = await this.send(action, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: new URL(baseUrl).origin,
      },
      body: data,
    });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      return this.open(new URL(location, action));
    }
    return page(res.status, action, await res.text());
  }
}

// Text the way it reads: separate paragraphs and labels stay separate words
// (textContent alone would run a question into the "Yours" after it).
function text(el: Element | null | undefined): string {
  if (!el) return "";
  const parts: string[] = [];
  const walker = el.ownerDocument.createTreeWalker(el, 4 /* NodeFilter.SHOW_TEXT */);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) parts.push(node.nodeValue ?? "");
  return parts.join(" ").replace(/\s+/g, " ").trim();
}
const nameOf = (el: Element): string => el.getAttribute("aria-label") ?? text(el);

/** The form holding a button whose name matches, e.g. /start/i. */
export function formWithButton(p: Page, name: RegExp): HTMLFormElement {
  for (const button of p.doc.querySelectorAll("button")) {
    const form = button.closest("form");
    if (form && name.test(nameOf(button))) return form;
  }
  throw new Error(`no form with a ${name} button on ${p.url.pathname}`);
}

/** Type into the first text field of a form (a textarea, else a text input). */
export function fill(form: HTMLFormElement, value: string): void {
  const field =
    form.querySelector<HTMLTextAreaElement>("textarea") ??
    form.querySelector<HTMLInputElement>('input:not([type]), input[type="text"], input[type="search"]');
  if (!field) throw new Error("the form has no text field");
  field.value = value;
}

export type Question = {
  text: string;
  votes: number;
  pressed: boolean;
  yours: boolean;
  meToo: HTMLButtonElement;
};

/** The questions on a session page, top to bottom: the list named "Questions". */
export function questions(p: Page): Question[] {
  const list = p.doc.querySelector('[aria-label="Questions"]');
  return [...(list?.querySelectorAll(":scope > li") ?? [])].map((li) => {
    const meToo = [...li.querySelectorAll("button")].find((b) => /me too/i.test(nameOf(b)));
    if (!meToo) throw new Error(`a question with no "Me too" button: ${text(li)}`);
    return {
      text: text(li),
      votes: Number(nameOf(meToo).match(/\d+/)?.[0] ?? Number.NaN),
      pressed: meToo.getAttribute("aria-pressed") === "true",
      yours: /\bYours\b/.test(text(li)),
      meToo,
    };
  });
}

export function question(p: Page, body: string): Question | undefined {
  return questions(p).find((q) => q.text.includes(body));
}

/** Start a session from the home page; returns its page, at /s/<code>. */
export async function startSession(host: Visitor, title: string): Promise<Page> {
  const home = await host.open("/");
  const form = formWithButton(home, /start/i);
  fill(form, title);
  return host.submit(home, form);
}

export async function ask(who: Visitor, sessionPath: string, body: string): Promise<Page> {
  const session = await who.open(sessionPath);
  const form = formWithButton(session, /^ask/i);
  fill(form, body);
  return who.submit(session, form);
}

/** Press "Me too" on a question: votes if it isn't pressed, takes it back if it is. */
export async function meToo(who: Visitor, sessionPath: string, body: string): Promise<Page> {
  const session = await who.open(sessionPath);
  const q = question(session, body);
  if (!q) throw new Error(`no question "${body}" on ${sessionPath}`);
  return who.submit(session, q.meToo.closest("form")!, q.meToo);
}
