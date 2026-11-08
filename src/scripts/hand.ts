import { HAND_MS } from "../lib/hall.ts";
import { handNote, lostLabel } from "../lib/words.ts";

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
 * `recent` is how many were lost in each of the last 15 minutes, this one last.
 */
export type Hall = { here: number; others: number[]; mine: number | null; recent: number[] };

type Board = { here: number; hands: number[] };

/** The picture most recently sent, for whatever starts drawing after the first one. */
export let lastHall: Hall | undefined;

const line = document.querySelector<HTMLElement>("[data-lost][data-room]");
if (line) watch(line);

function watch(line: HTMLElement): void {
  const first = JSON.parse(line.dataset.room ?? "{}") as { here?: number; hands?: number[]; mine?: number | null; recent?: number[] };
  // the most lost at once in each minute, by minutes since 1970: the server's last 15, then what this page sees
  const minute = (): number => Math.floor(Date.now() / 60_000);
  const history = new Map<number, number>((first.recent ?? []).map((n, i, all) => [minute() - (all.length - 1 - i), n]));
  let here = first.here ?? 0;
  const start = performance.now();
  // when each hand went up, this person's among them if it is up
  let hands = (first.hands ?? []).map((ms) => start - ms);
  let mine: number | null = first.mine === null || first.mine === undefined ? null : start - first.mine;
  let pressing = false;
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
    const text = lostLabel(lost, Math.max(here, lost));
    for (const el of document.querySelectorAll<HTMLElement>("[data-lost]")) {
      if (el.textContent?.trim() !== text) el.textContent = text;
    }
    const until = mine === null ? undefined : new Date(Date.now() + HAND_MS - (now - mine));
    for (const form of forms()) {
      const field = form.querySelector<HTMLInputElement>("input[name='up']");
      if (field) field.value = mine === null ? "1" : "0";
      form.querySelector("button")?.setAttribute("aria-pressed", String(mine !== null));
      const note = form.querySelector<HTMLElement>("[data-hand-note]");
      const said = problem ? `${problem} ${handNote(until)}` : handNote(until);
      if (note && note.textContent?.trim() !== said) note.textContent = said;
    }
    const m = minute();
    history.set(m, Math.max(history.get(m) ?? 0, lost));
    const recent = Array.from({ length: 15 }, (_, i) => history.get(m - 14 + i) ?? 0);
    lastHall = { here: Math.max(here, lost), others: rest, mine, recent };
    document.dispatchEvent(new CustomEvent<Hall>("hands-up:hall", { detail: lastHall }));
  }

  document.addEventListener("hands-up:board", (event) => {
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
    hands = kept;
    const near = (since: number): number => hands.findIndex((h) => Math.abs(h - since) < 3000);
    if (pressing && lowered !== null && near(lowered) >= 0) {
      // the server has not had the press that put this hand down yet
      hands.splice(near(lowered), 1);
    }
    if (mine !== null && near(mine) < 0) {
      // not listed: the server has not had the press yet, or the hand was put
      // down in another tab of this browser, or its time ran out
      if (pressing) hands.push(mine);
      else mine = null;
    }
    render();
  });

  /** This person's hand as the server has it: when it went up, null if down; undefined if the server can't be reached. */
  async function askServer(): Promise<number | null | undefined> {
    try {
      const res = await fetch(location.href, { headers: { accept: "text/html" } });
      if (!res.ok) return undefined;
      const doc = new DOMParser().parseFromString(await res.text(), "text/html");
      const room = JSON.parse(doc.querySelector<HTMLElement>("[data-lost][data-room]")?.dataset.room ?? "null") as { mine?: number | null } | null;
      if (!room) return undefined;
      return room.mine === null || room.mine === undefined ? null : performance.now() - room.mine;
    } catch {
      return undefined;
    }
  }

  // The form posts on its own without script. Here it is sent in the
  // background: the hand goes up at once, and the stream confirms it.
  document.addEventListener(
    "submit",
    (event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement) || !form.matches("form[data-hand]")) return;
      event.preventDefault();
      // the page's other script sends every other form; this one is the hand's
      event.stopPropagation();
      if (pressing) return;
      const body = new URLSearchParams();
      for (const [name, value] of new FormData(form)) body.append(name, String(value));
      const want = body.get("up") === "1";
      const before = mine;
      const now = performance.now();
      pressing = true;
      if (want) {
        mine = now;
        hands.push(now);
      } else {
        lowered = mine;
        mine = null;
        if (lowered !== null) hands = hands.filter((since) => since !== lowered);
      }
      problem = "";
      render();
      fetch(form.action || location.href, { method: "POST", body, headers: { accept: "text/html" } })
        .then((res) => {
          if (!res.ok) throw new Error(`the server answered ${res.status}`);
        })
        .catch(async () => {
          // No answer. The press may still have reached the server, so ask it
          // what this person's hand is now, rather than guess or press again.
          const real = await askServer();
          mine = real === undefined ? before : real;
          if (real === undefined || (mine !== null) !== want) problem = "Couldn't confirm. Retry.";
        })
        .finally(() => {
          pressing = false;
          lowered = null;
          render();
        });
    },
    true,
  );

  // a hand nobody touches still comes down when its time is up
  setInterval(render, 1000);
  render();
}
