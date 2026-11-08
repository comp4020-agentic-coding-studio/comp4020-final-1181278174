import { clock, GOING_OVER_MESSAGE, GOING_OVER_NOTE, lostLabel, SILENCE_SHORT } from "../lib/words.ts";
import { goingOverBusy, goingOverLeft } from "./going-over.ts";
import { type Hall, lastHall } from "./hand.ts";

// A small window that stays above every other window (Chrome and Edge on a
// computer: Document Picture-in-Picture), so the hall is in view while
// someone watches Echo360, follows the slides or teaches from them.
//
// - On the hall, a student's window: how many are lost, the last 15 minutes,
//   and "I'm lost". The host's: the count, Going over it, and a mark for a new part.
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
    void (button.dataset.pop === "timeline" ? popTimeline() : popHall());
  });
}

/** Copy the page's styles into the window, so it looks like the page. */
function styled(win: Window): void {
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

/** Keep the lifetime of the window and of a hand clear beside its controls. */
function lifetimeNote(box: HTMLElement): void {
  const note = box.ownerDocument.createElement("p");
  note.className = "float-lifetime";
  note.textContent = "Closes if the hall tab closes. A raised hand still comes down by itself.";
  box.append(note);
}

/** The hall in a small window: the count, the last 15 minutes, and the button or the host's mark. */
async function popHall(): Promise<void> {
  const hosting = document.querySelector("form.hall-mark") !== null;
  const win = await pip!.requestWindow({ width: 320, height: hosting ? 435 : 320 });
  styled(win);
  const doc = win.document;
  doc.title = "Hands Up";
  const box = doc.createElement("main");
  box.className = "float-box";
  box.innerHTML = `
    <p class="float-count" aria-live="polite"></p>
    <p class="float-going-over" role="status" hidden></p>
    <p class="float-silence" hidden></p>
    <div class="float-chart" aria-hidden="true"></div>
    <p class="float-axis" aria-hidden="true"><span></span><span>now</span></p>
  `;
  doc.body.append(box);
  const count = box.querySelector<HTMLElement>(".float-count")!;
  const silence = box.querySelector<HTMLElement>(".float-silence")!;
  silence.textContent = SILENCE_SHORT;
  const chart = box.querySelector<HTMLElement>(".float-chart")!;
  const chartStart = box.querySelector<HTMLElement>(".float-axis span")!;

  let press: HTMLButtonElement | undefined;
  let goingPress: HTMLButtonElement | undefined;
  let goingProblem: HTMLElement | undefined;
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
    // the host's mark: the hall's own form, sent from here
    const form = doc.createElement("form");
    form.className = "float-mark";
    form.innerHTML = `
      <label class="float-hidden" for="float-mark">Name for the mark</label>
      <input id="float-mark" name="label" type="text" maxlength="60" placeholder="Next part" />
      <button class="button ink" type="submit">Mark</button>
      <p class="float-said" role="status"></p>
    `;
    box.append(form);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const input = form.querySelector("input")!;
      const said = form.querySelector<HTMLElement>(".float-said")!;
      const label = input.value;
      const body = new URLSearchParams({ intent: "timeline_mark", label });
      fetch(location.pathname, { method: "POST", body, headers: { accept: "text/html" } })
        .then((res) => {
          if (!res.ok) throw new Error(String(res.status));
          said.textContent = `Marked ${label.trim() || "a new part"} at ${new Date().toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit", hour12: false })}`;
          // clear only the mark just sent, never a new draft typed meanwhile
          if (input.value === label) input.value = "";
        })
        .catch(() => {
          said.textContent = "Not marked: no answer from the server.";
        });
    });
  } else {
    // "I'm lost": presses the hall's own button, so the page and the window agree
    press = doc.createElement("button");
    press.type = "button";
    press.className = "button tomato lost-button";
    // the same hand icon as the page's button
    const icon = document.querySelector("form[data-hand] button svg");
    if (icon) press.append(doc.importNode(icon, true));
    press.append(" I'm lost");
    press.addEventListener("click", () => document.querySelector<HTMLFormElement>("form[data-hand]")?.requestSubmit());
    box.append(press);
  }
  lifetimeNote(box);

  const draw = (hall: Hall): void => {
    const lost = hall.others.length + (hall.mine === null ? 0 : 1);
    count.textContent = lostLabel(lost, hall.here);
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
    press?.setAttribute("aria-pressed", String(hall.mine !== null));
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
  });
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
    box.replaceChildren(...(copy ? [copy] : []));
    lifetimeNote(box);
    if (focused) win.document.getElementById(focused)?.focus({ preventScroll: true });
  };
  win.document.body.append(box);
  draw();
  document.addEventListener("hands-up:timeline", draw);
  win.addEventListener("pagehide", () => document.removeEventListener("hands-up:timeline", draw), { once: true });
}
