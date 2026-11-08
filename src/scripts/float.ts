import { HAND_MS } from "../lib/hall.ts";
import { classNote, clock, GOING_OVER_MESSAGE, GOING_OVER_NOTE, lostLabel, SILENCE_SHORT } from "../lib/words.ts";
import { goingOverBusy, goingOverLeft } from "./going-over.ts";
import { type Hall, lastHall } from "./hand.ts";

// A small window that stays above every other window (Chrome and Edge on a
// computer: Document Picture-in-Picture), so the hall is in view while
// someone watches Echo360, follows the slides or teaches from them.
//
// - On the hall, a student's window: how many are lost in large type, the
//   last 15 minutes, "I'm lost" with when the hand comes down, and a question
//   asked without a name. The host's: the count, Going over it, the question
//   the room most wants answered, and a mark for a new part. A small window
//   keeps only the count and the button (src/styles.css).
// - On the timeline: the newest sitting's chart, to keep beside the recording.
//
// The window holds its own copies of these, drawn from the page's state
// ("hands-up:hall" from src/scripts/hand.ts); its buttons press the page's
// own forms. Where the browser can't open one, the "Pop out" button stays hidden.

type Pip = { requestWindow(options?: { width?: number; height?: number }): Promise<Window>; window: Window | null };
const pip = (window as unknown as { documentPictureInPicture?: Pip }).documentPictureInPicture;

for (const button of document.querySelectorAll<HTMLButtonElement>("button[data-pop]")) {
  if (!pip) continue;
  const control = button.closest<HTMLElement>(".pop-control");
  // the timeline's can pop out once there is a sitting, which can arrive while the page is open
  const show = (): void => {
    const ready = button.dataset.pop !== "timeline" || document.querySelector(".sitting") !== null;
    button.hidden = !ready;
    if (control) control.hidden = !ready;
  };
  show();
  if (button.dataset.pop === "timeline") document.addEventListener("hands-up:timeline", show);
  button.addEventListener("click", () => {
    if (pip.window) {
      pip.window.focus();
      return;
    }
    tell(button, "");
    const opening = button.dataset.pop === "timeline" ? popTimeline() : popHall();
    // A browser can refuse the window, for one already open in another tab or
    // a press it doesn't trust: say so beside the button, rather than nothing.
    opening.catch((error: unknown) => {
      if (pip.window) throw error;
      tell(button, "The floating window didn't open. Try again.");
    });
  });
}

/** A line under the pop-out button saying the window didn't open, or none. */
function tell(button: HTMLButtonElement, text: string): void {
  const control = button.closest<HTMLElement>(".pop-control") ?? button.parentElement!;
  let note = control.querySelector<HTMLElement>(".pop-problem");
  if (!text) {
    note?.remove();
    return;
  }
  if (!note) {
    note = document.createElement("p");
    note.className = "alert pop-problem";
    note.setAttribute("role", "alert");
    control.append(note);
  }
  note.textContent = text;
}

/** Copy the page's styles into the window, so it looks like the page. */
function styled(win: Window): void {
  // the window reads in the page's language, for a screen reader too
  win.document.documentElement.lang = document.documentElement.lang;
  for (const sheet of document.styleSheets) {
    try {
      const style = win.document.createElement("style");
      style.textContent = [...sheet.cssRules].map((rule) => rule.cssText).join("\n");
      win.document.head.append(style);
    } catch {
      if (!sheet.href) continue;
      const link = win.document.createElement("link");
      link.rel = "stylesheet";
      link.href = sheet.href;
      win.document.head.append(link);
    }
  }
  win.document.body.classList.add("float");
}

// Whether the page's stream is connected, so a window opened later knows too.
let live = true;
document.addEventListener("hands-up:live", (event) => {
  live = (event as CustomEvent<boolean>).detail;
});

/** A line that says when the window's numbers may be old: the page lost its connection. */
function liveNote(win: Window, box: HTMLElement): void {
  const note = win.document.createElement("p");
  note.className = "float-live";
  note.setAttribute("role", "status");
  note.textContent = "Reconnecting: this may be out of date.";
  note.hidden = live;
  box.prepend(note);
  const show = (event: Event): void => {
    note.hidden = (event as CustomEvent<boolean>).detail;
  };
  document.addEventListener("hands-up:live", show);
  win.addEventListener("pagehide", () => document.removeEventListener("hands-up:live", show), { once: true });
}

/** Keep the lifetime of the window, and of a hand where there is one, clear beside its controls. */
function lifetimeNote(box: HTMLElement, hand = false): void {
  const note = box.ownerDocument.createElement("p");
  note.className = "float-lifetime";
  note.textContent = hand ? "Closes if the hall tab closes. A raised hand still comes down by itself." : "Closes if the hall tab closes.";
  box.append(note);
}

/** The hall in a small window: the count in large type, the last 15 minutes, and what this person can do from here. */
async function popHall(): Promise<void> {
  const hosting = document.querySelector("form.hall-mark") !== null;
  const handForm = document.querySelector<HTMLFormElement>("form[data-hand]");
  const win = await pip!.requestWindow({ width: 340, height: hosting ? 430 : 350 });
  styled(win);
  const doc = win.document;
  doc.title = "Hands Up";
  const box = doc.createElement("main");
  box.className = "float-box";
  // The large number is for a glance across the screen; the sentence says the
  // same in words, with its denominator, and is what a screen reader hears.
  box.innerHTML = `
    <div class="float-head">
      <p class="float-big" aria-hidden="true"><strong></strong></p>
      <p class="float-words" aria-hidden="true"></p>
      <p class="float-count float-hidden" aria-live="polite"></p>
    </div>
    <p class="float-going-over" role="status" hidden></p>
    <p class="float-silence" hidden></p>
    <div class="float-trend">
      <div class="float-chart" aria-hidden="true"></div>
      <p class="float-axis" aria-hidden="true"><span></span><span>now</span></p>
    </div>
  `;
  doc.body.append(box);
  liveNote(win, box);
  const big = box.querySelector<HTMLElement>(".float-big")!;
  const words = box.querySelector<HTMLElement>(".float-words")!;
  const count = box.querySelector<HTMLElement>(".float-count")!;
  const silence = box.querySelector<HTMLElement>(".float-silence")!;
  silence.textContent = SILENCE_SHORT;
  const chart = box.querySelector<HTMLElement>(".float-chart")!;
  const chartStart = box.querySelector<HTMLElement>(".float-axis span")!;

  let press: HTMLButtonElement | undefined;
  let handLine: HTMLElement | undefined;
  let goingPress: HTMLButtonElement | undefined;
  let goingProblem: HTMLElement | undefined;
  const stop: (() => void)[] = [];
  if (hosting) {
    goingPress = doc.createElement("button");
    goingPress.type = "button";
    goingPress.className = "button ink";
    goingPress.textContent = "Going over it";
    goingPress.setAttribute("aria-describedby", "float-going-over-note");
    goingPress.addEventListener("click", () => document.querySelector<HTMLFormElement>("form[data-going-over-form]")?.requestSubmit());
    const note = doc.createElement("p");
    note.id = "float-going-over-note";
    note.className = "float-said";
    note.textContent = GOING_OVER_NOTE;
    goingProblem = doc.createElement("p");
    goingProblem.className = "float-said";
    goingProblem.setAttribute("role", "status");
    goingProblem.hidden = true;
    box.append(goingPress, note, goingProblem);
    stop.push(topQuestion(box));
    box.append(markForm(doc));
  } else if (handForm) {
    // "I'm lost": presses the hall's own button, so the page and the window agree
    press = doc.createElement("button");
    press.type = "button";
    press.className = "button tomato lost-button";
    press.setAttribute("aria-describedby", "float-hand");
    // the same hand icon as the page's button
    const icon = handForm.querySelector("button svg");
    if (icon) press.append(doc.importNode(icon, true));
    press.append(" I'm lost");
    press.addEventListener("click", () => handForm.requestSubmit());
    // whose hand is up, until when; why the button is off; why a press didn't go through
    handLine = doc.createElement("p");
    handLine.id = "float-hand";
    handLine.className = "float-said float-hand";
    handLine.setAttribute("role", "status");
    box.append(press, handLine, askForm(win));
  }
  lifetimeNote(box, press !== undefined);

  const draw = (hall: Hall): void => {
    const lost = hall.others.length + (hall.mine === null ? 0 : 1);
    const sentence = lostLabel(lost, hall.here);
    count.textContent = sentence;
    // "3" large, then "of 12 here say they're lost"; with no hand up, "0", then "12 here. No hands up right now."
    big.querySelector("strong")!.textContent = String(lost);
    big.classList.toggle("is-zero", lost === 0);
    words.textContent = lost > 0 ? sentence.replace(/^\d+ /, "") : sentence;
    silence.hidden = lost > 0;
    const now = Date.now();
    const from = Math.max(hall.startedAt, now - 15 * 60_000);
    chartStart.textContent = now - hall.startedAt < 15 * 60_000 ? `since ${clock(new Date(hall.startedAt))}` : "15 min ago";
    const firstMinute = Math.floor(now / 60_000) - hall.recent.length + 1;
    // a bar is as wide as the part of its minute the chart covers: the first
    // and last are cut short, so sixteen minutes make fifteen
    const shown = hall.recent.map((n, i) => {
      const at = (firstMinute + i) * 60_000;
      return { n, duration: Math.min(at + 60_000, now) - Math.max(at, from) };
    }).filter(({ duration }) => duration > 0);
    while (chart.children.length < shown.length) chart.append(doc.createElement("span"));
    while (chart.children.length > shown.length) chart.lastElementChild?.remove();
    const top = Math.max(1, hall.here, ...shown.map(({ n }) => n));
    shown.forEach(({ n, duration }, i) => {
      const bar = chart.children[i] as HTMLElement;
      bar.style.height = `${n === 0 ? 0 : Math.max(8, (n / top) * 100)}%`;
      bar.style.flexGrow = String(duration);
      bar.classList.toggle("now", i === shown.length - 1);
    });
    if (press && handLine) {
      press.setAttribute("aria-pressed", String(hall.mine !== null));
      // outside a class the button can't put a hand up, as on the page
      press.disabled = hall.lesson !== "on" && hall.mine === null;
      const until = hall.mine === null ? undefined : new Date(Date.now() + HAND_MS - (performance.now() - hall.mine));
      const said = hall.problem
        || (press.disabled ? classNote(hall.lesson) : until ? `Your hand is up until ${clock(until)}. Press again to put it down.` : "");
      handLine.textContent = said;
      handLine.hidden = !said;
    }
  };
  const listen = (event: Event): void => draw((event as CustomEvent<Hall>).detail);
  const goingLine = box.querySelector<HTMLElement>(".float-going-over")!;
  let goingTimer: number | undefined;
  const drawGoing = (): void => {
    win.clearTimeout(goingTimer);
    const left = goingOverLeft();
    goingLine.hidden = left === 0;
    goingLine.textContent = left > 0 ? GOING_OVER_MESSAGE : "";
    if (goingPress) goingPress.disabled = left > 0 || goingOverBusy();
    if (goingProblem) {
      const problem = document.querySelector<HTMLElement>("[data-going-over-problem]");
      goingProblem.hidden = !problem || problem.hidden;
      goingProblem.textContent = problem?.textContent ?? "";
    }
    // The floating window has its own expiry, even when its parent tab is in the background.
    if (left > 0) goingTimer = win.setTimeout(drawGoing, Math.ceil(left));
  };
  if (lastHall) draw(lastHall);
  drawGoing();
  document.addEventListener("hands-up:hall", listen);
  document.addEventListener("hands-up:going-over", drawGoing);
  win.addEventListener("pagehide", () => {
    win.clearTimeout(goingTimer);
    document.removeEventListener("hands-up:hall", listen);
    document.removeEventListener("hands-up:going-over", drawGoing);
    for (const end of stop) end();
  });
}

/** Send a form's fields to a page, and say in `said` what came of it. */
function send(path: string, body: URLSearchParams, said: HTMLElement, done: string, failed: string): Promise<boolean> {
  return fetch(path, { method: "POST", body, headers: { accept: "text/html" } })
    .then(async (res) => {
      if (!res.ok && res.status < 500) {
        // a refusal the server explained: say why, and keep the words
        const page = new DOMParser().parseFromString(await res.text(), "text/html");
        const why = page.querySelector("#mark-problem, [role='alert']")?.textContent?.trim();
        said.textContent = why ? `${failed} ${why}` : failed;
        return false;
      }
      if (!res.ok) throw new Error(String(res.status));
      said.textContent = done;
      return true;
    })
    .catch(() => {
      // no answer: it may still have been saved, so don't say it wasn't
      said.textContent = "Couldn't confirm it. Check the page before trying again.";
      return false;
    });
}

/** The host's mark for a new part: the hall's own form, sent from the window. */
function markForm(doc: Document): HTMLFormElement {
  const form = doc.createElement("form");
  form.className = "float-mark";
  form.innerHTML = `
    <label class="float-hidden" for="float-mark">Name for the mark</label>
    <input id="float-mark" name="label" type="text" maxlength="60" placeholder="Next part" />
    <button class="button ink" type="submit">Mark</button>
    <p class="float-said" role="status"></p>
  `;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = form.querySelector("input")!;
    const said = form.querySelector<HTMLElement>(".float-said")!;
    const label = input.value;
    const at = new Date().toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit", hour12: false });
    void send(location.pathname, new URLSearchParams({ intent: "timeline_mark", label }), said, `Marked ${label.trim() || "a new part"} at ${at}`, "Not marked.")
      .then((ok) => {
        // clear only the mark just sent, never a new draft typed meanwhile
        if (ok && input.value === label) input.value = "";
      });
  });
  return form;
}

/**
 * A question asked from the window, without a name: what someone wonders in the
 * middle of a slide is gone by the time the lecturer asks for questions.
 * Opening it makes the window taller, where the browser allows that.
 */
function askForm(win: Window): HTMLElement {
  const doc = win.document;
  const details = doc.createElement("details");
  details.className = "float-ask";
  details.innerHTML = `
    <summary>Ask without your name</summary>
    <form>
      <label class="float-hidden" for="float-ask-body">Your question</label>
      <textarea id="float-ask-body" name="body" rows="2" maxlength="240" required placeholder="What do you want to ask?"></textarea>
      <button class="button ink" type="submit">Ask</button>
      <p class="float-said" role="status"></p>
    </form>
  `;
  const grow = 120;
  details.addEventListener("toggle", () => {
    try {
      win.resizeBy(0, details.open ? grow : -grow);
    } catch {
      // a browser that won't resize the window scrolls it instead
    }
    if (details.open) details.querySelector("textarea")?.focus();
  });
  const form = details.querySelector("form")!;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const area = form.querySelector("textarea")!;
    const button = form.querySelector("button")!;
    const said = form.querySelector<HTMLElement>(".float-said")!;
    const words = area.value;
    button.disabled = true;
    void send(`${location.pathname.replace(/\/$/, "")}/questions`, new URLSearchParams({ intent: "ask", body: words }), said,
      "Asked, without your name. It's on the questions page.", "Not asked.")
      .then((ok) => {
        if (ok && area.value === words) area.value = "";
      })
      .finally(() => {
        button.disabled = false;
      });
  });
  return details;
}

/**
 * For the host: the question the room most wants answered, taken from the
 * hall's own list as it changes, to answer at the next pause without leaving
 * the slides. Returns a way to stop following the list.
 */
function topQuestion(box: HTMLElement): () => void {
  const line = box.ownerDocument.createElement("p");
  line.className = "float-top";
  line.innerHTML = `<span class="float-top-label"></span> <span class="float-top-body"></span>`;
  box.append(line);
  const draw = (): void => {
    const first = document.querySelector('ol[aria-label="Most wanted"] > li');
    const body = first?.querySelector(".body")?.textContent?.trim() ?? "";
    const votes = first?.querySelector(".me-too .n")?.textContent?.trim() ?? "0";
    line.hidden = !body;
    line.querySelector(".float-top-label")!.textContent = `Most wanted · ${votes} Me too`;
    line.querySelector(".float-top-body")!.textContent = body;
  };
  draw();
  const list = document.querySelector("[data-board]");
  const watching = new MutationObserver(draw);
  if (list) watching.observe(list, { childList: true, subtree: true, characterData: true });
  return () => watching.disconnect();
}

/** The newest sitting's chart in a small window, to keep beside the recording. */
async function popTimeline(): Promise<void> {
  if (!document.querySelector(".sitting")) return;
  const win = await pip!.requestWindow({ width: 480, height: 360 });
  styled(win);
  win.document.title = "When the room was lost";
  const box = win.document.createElement("main");
  box.className = "float-box float-timeline";
  const draw = (): void => {
    const sitting = document.querySelector<HTMLElement>(".sitting");
    const opened = new Set([...box.querySelectorAll("details[open]")].map((detail) => detail.id));
    const focused = box.contains(win.document.activeElement) ? win.document.activeElement?.id : undefined;
    const copy = sitting ? win.document.importNode(sitting, true) : null;
    if (copy) {
      for (const detail of copy.querySelectorAll("details")) detail.open = opened.has(detail.id);
    }
    const note = box.querySelector(".float-live");
    box.replaceChildren(...(note ? [note] : []), ...(copy ? [copy] : []));
    lifetimeNote(box);
    if (focused) win.document.getElementById(focused)?.focus({ preventScroll: true });
  };
  win.document.body.append(box);
  liveNote(win, box);
  draw();
  document.addEventListener("hands-up:timeline", draw);
  win.addEventListener("pagehide", () => document.removeEventListener("hands-up:timeline", draw), { once: true });
}
