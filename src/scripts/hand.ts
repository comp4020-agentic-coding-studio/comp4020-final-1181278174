import { HAND_MS } from "../lib/hall.ts";
import { handNote, lostLabel } from "../lib/words.ts";
import { announceSessionChange, onSessionChange } from "./session-tabs.ts";

// "I'm lost" on an open page: the button, its note, and the sentence that says
// how many of the people here are lost. The server sends how many hands are up
// and how long each has been up with every state (src/lib/live.ts), never whose;
// src/scripts/live.ts passes each state on as a "hands-up:board" event. This
// page's own hand is the one thing it knows about itself: the server put how
// long it has been up in the page, and a press changes it here at once.
// Whatever draws the room (the 3D hall, a floating window) listens for
// "hands-up:hall" and gets the same picture: how many are here, when each
// other hand went up, and when this person's did.
// Without this script the button is a plain form and the page reloads.

/**
 * Sent on: what the room looks like now. Times are `performance.now()` times.
 * `recent` covers 16 calendar minutes, this one last, so the floating chart can
 * clip the outer bins to exactly 15 minutes. `startedAt` is epoch milliseconds.
 */
export type Hall = { here: number; others: number[]; mine: number | null; recent: number[]; startedAt: number };

type Board = { here: number; hands: number[] };

/** The picture most recently sent, for whatever starts drawing after the first one. */
export let lastHall: Hall | undefined;

const line = document.querySelector<HTMLElement>("[data-lost][data-room]");
if (line) watch(line);

function watch(line: HTMLElement): void {
  const hosting = line.hasAttribute("data-host");
  const first = JSON.parse(line.dataset.room ?? "{}") as { here?: number; hands?: number[]; mine?: number | null; recent?: number[]; startedAt?: number };
  const startedAt = first.startedAt ?? Date.now();
  // the most lost at once in each minute, by minutes since 1970: the server's last 16, then what this page sees
  const minute = (): number => Math.floor(Date.now() / 60_000);
  const history = new Map<number, number>((first.recent ?? []).map((n, i, all) => [minute() - (all.length - 1 - i), n]));
  let here = first.here ?? 0;
  const start = performance.now();
  // when each hand went up, this person's among them if it is up
  let hands = (first.hands ?? []).map((ms) => start - ms);
  let mine: number | null = first.mine === null || first.mine === undefined ? null : start - first.mine;
  // Keep the server's picture separate from the optimistic press. A lost
  // reply must not leave an extra hand up, or subtract someone else's hand.
  let confirmedHands = [...hands];
  let pressing = false;
  let optimistic = false;
  // A reply started before another tab's change (or our own press) cannot
  // overwrite a more recent picture. The next fetch takes that change too.
  let revision = 0;
  // Set when another tab of this browser changed something, or this tab comes
  // back from the background: until this tab has asked the server again, its
  // button may be out of date. Cleared once it has the server's picture.
  let doubt = false;
  // this person's hand while a press that puts it down is on its way
  let lowered: number | null = null;
  // what went wrong with the last press, said under the button until the next one
  let problem = "";

  const forms = (): HTMLFormElement[] => [...document.querySelectorAll<HTMLFormElement>("form[data-hand]")];

  /** The other people's hands: every hand, less the one closest in age to this person's own. */
  function others(now: number): number[] {
    const live = hands.filter((since) => now - since < HAND_MS);
    if (mine === null) return live;
    let closest = -1;
    for (let i = 0; i < live.length; i++) {
      if (closest < 0 || Math.abs(live[i] - mine) < Math.abs(live[closest] - mine)) closest = i;
    }
    return closest < 0 ? live : live.filter((_, i) => i !== closest);
  }

  function render(): void {
    const now = performance.now();
    if (mine !== null && now - mine >= HAND_MS) mine = null;
    const rest = others(now);
    const lost = rest.length + (mine === null ? 0 : 1);
    const waiting = hosting && here === 0;
    const text = waiting ? "Waiting for students to join." : lostLabel(lost, Math.max(here, lost));
    for (const el of document.querySelectorAll<HTMLElement>("[data-lost]")) {
      if (el.textContent?.trim() !== text) el.textContent = text;
    }
    // what silence does not show, while no hand is up
    for (const el of document.querySelectorAll<HTMLElement>("[data-silence]")) el.hidden = lost > 0 || waiting;
    const until = mine === null ? undefined : new Date(Date.now() + HAND_MS - (now - mine));
    for (const form of forms()) {
      if (pressing) form.setAttribute("aria-busy", "true");
      else form.removeAttribute("aria-busy");
      const field = form.querySelector<HTMLInputElement>("input[name='up']");
      if (field) field.value = mine === null ? "1" : "0";
      form.querySelector("button")?.setAttribute("aria-pressed", String(mine !== null));
      const note = form.querySelector<HTMLElement>("[data-hand-note]");
      const said = problem ? `${handNote(until)} ${problem}` : handNote(until);
      if (note && note.textContent?.trim() !== said) note.textContent = said;
    }
    const m = minute();
    history.set(m, Math.max(history.get(m) ?? 0, lost));
    const recent = Array.from({ length: 16 }, (_, i) => history.get(m - 15 + i) ?? 0);
    lastHall = { here: Math.max(here, lost), others: rest, mine, recent, startedAt };
    document.dispatchEvent(new CustomEvent<Hall>("hands-up:hall", { detail: lastHall }));
  }

  // how many states the stream has sent: a refresh it overtakes asks again
  let heard = 0;
  document.addEventListener("hands-up:board", (event) => {
    heard++;
    const board = (event as CustomEvent<Board>).detail;
    const now = performance.now();
    here = board.here;
    // keep the times already known for hands that are still up, so nothing jumps
    const sent = board.hands.map((ms) => now - ms);
    const kept: number[] = [];
    const pool = [...hands];
    for (const since of sent) {
      let best = -1;
      for (let i = 0; i < pool.length; i++) {
        if (Math.abs(pool[i] - since) < 3000 && (best < 0 || Math.abs(pool[i] - since) < Math.abs(pool[best] - since))) best = i;
      }
      kept.push(best < 0 ? since : pool.splice(best, 1)[0]);
    }
    confirmedHands = [...kept];
    hands = kept;
    const near = (since: number): number => hands.findIndex((h) => Math.abs(h - since) < 3000);
    if (optimistic && lowered !== null && near(lowered) >= 0) {
      // the server has not had the press that put this hand down yet
      hands.splice(near(lowered), 1);
    }
    if (mine !== null && near(mine) < 0) {
      // not listed: the server has not had the press yet, or the hand was put
      // down in another tab of this browser, or its time ran out
      if (optimistic) hands.push(mine);
      else mine = null;
    }
    render();
  });

  type OwnRoom = Board & { mine: number | null };

  function readRoom(html: string): OwnRoom | undefined {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const room = JSON.parse(doc.querySelector<HTMLElement>("[data-lost][data-room]")?.dataset.room ?? "null") as OwnRoom | null;
    if (!room || !Array.isArray(room.hands) || typeof room.here !== "number" || (room.mine !== null && typeof room.mine !== "number")) return undefined;
    const now = performance.now();
    return { here: room.here, hands: room.hands.map((ms) => now - ms), mine: room.mine === null ? null : now - room.mine };
  }

  function takeRoom(room: OwnRoom): void {
    here = room.here;
    hands = room.hands;
    mine = room.mine;
    confirmedHands = [...hands];
  }

  /** The room and this person's hand as the server has them; undefined if it can't be reached. */
  async function askServer(): Promise<OwnRoom | undefined> {
    try {
      const res = await fetch(location.href, { headers: { accept: "text/html" }, cache: "no-store" });
      if (!res.ok) return undefined;
      return readRoom(await res.text());
    } catch {
      return undefined;
    }
  }

  let refreshing = false;
  let refreshAgain = false;
  let tries = 0;
  async function refreshOwn(): Promise<void> {
    if (refreshing || pressing) {
      refreshAgain = true;
      return;
    }
    refreshing = true;
    tries = 0;
    try {
      do {
        refreshAgain = false;
        const began = revision;
        const since = heard;
        const room = await askServer();
        if (pressing || began !== revision || (since !== heard && ++tries < 3)) {
          refreshAgain = true;
          if (pressing) return;
          continue;
        }
        if (room) {
          takeRoom(room);
          doubt = false;
          render();
        }
      } while (refreshAgain);
    } finally {
      refreshing = false;
    }
  }

  onSessionChange(() => {
    revision++;
    doubt = true;
    void refreshOwn();
  });

  async function press(form: HTMLFormElement): Promise<void> {
    pressing = true;
    revision++;
    problem = "";
    render();
    try {
      // A tab that may have missed a change in another tab asks the server
      // for this browser's hand first, so it never sends a stale up or down.
      // Otherwise the press goes at once.
      if (doubt) {
        let room: OwnRoom | undefined;
        let began: number;
        do {
          began = revision;
          room = await askServer();
        } while (room && began !== revision);
        if (!room) {
          problem = "Couldn't check your hand. Try again when connected.";
          return;
        }
        takeRoom(room);
        doubt = false;
        render();
      }
      const want = mine === null;
      const before = mine;
      const body = new URLSearchParams();
      for (const [name, value] of new FormData(form)) body.append(name, String(value));
      body.set("up", want ? "1" : "0");
      const now = performance.now();
      optimistic = true;
      if (want) {
        mine = now;
        hands.push(now);
      } else {
        lowered = mine;
        mine = null;
        if (lowered !== null) hands = hands.filter((since) => since !== lowered);
      }
      render();
      try {
        const res = await fetch(form.action || location.href, { method: "POST", body, headers: { accept: "text/html" } });
        if (!res.ok) throw new Error(`the server answered ${res.status}`);
        const real = readRoom(await res.text());
        if (!real) throw new Error("No hand state in the response");
        takeRoom(real);
        announceSessionChange();
      } catch {
        // No answer. The press may still have reached the server, so ask it
        // what this person's hand is now, rather than guess or press again.
        const real = await askServer();
        if (real === undefined) {
          hands = [...confirmedHands];
          mine = before === null ? null : hands.find((since) => Math.abs(since - before) < 3000) ?? null;
        } else {
          takeRoom(real);
        }
        if (real === undefined || (mine !== null) !== want) problem = "Couldn't confirm the press. Try again when connected.";
        else announceSessionChange();
      }
    } finally {
      pressing = false;
      optimistic = false;
      lowered = null;
      render();
      if (refreshAgain) void refreshOwn();
    }
  }

  // The form posts on its own without script. Here the request stays in the
  // background and the button follows the server's state for this browser.
  document.addEventListener(
    "submit",
    (event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement) || !form.matches("form[data-hand]")) return;
      event.preventDefault();
      // the page's other script sends every other form; this one is the hand's
      event.stopPropagation();
      if (pressing) return;
      void press(form);
    },
    true,
  );

  // a hand nobody touches still comes down when its time is up
  setInterval(render, 1000);
  render();
}
