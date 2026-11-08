import { GOING_OVER_MS } from "../lib/hall.ts";
import { GOING_OVER_MESSAGE } from "../lib/words.ts";

// This state is independent of hands: an acknowledgement never lowers one.
// The stream supplies elapsed time, so reconnecting cannot restart two minutes.
let until: number | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let sending = false;
let revision = 0;

/** Remaining time for a floating window opened after the state arrived. */
export const goingOverLeft = (): number => until === null ? 0 : Math.max(0, until - performance.now());
export const goingOverBusy = (): boolean => sending;

function render(): void {
  const active = goingOverLeft() > 0;
  for (const line of document.querySelectorAll<HTMLElement>("[data-going-over]")) {
    // Once script is running, this deadline replaces the no-script CSS expiry.
    line.style.animation = "none";
    line.hidden = !active;
    line.textContent = active ? GOING_OVER_MESSAGE : "";
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>("form[data-going-over-form] button")) {
    button.disabled = active || sending;
  }
  document.dispatchEvent(new Event("hands-up:going-over"));
}

function show(age: number | null): void {
  revision++;
  clearTimeout(timer);
  until = age !== null && age >= 0 && age < GOING_OVER_MS ? performance.now() + GOING_OVER_MS - age : null;
  render();
  if (until !== null) timer = setTimeout(() => {
    until = null;
    render();
  }, goingOverLeft());
}

const first = document.querySelector<HTMLElement>("[data-going-over]")?.dataset.goingOverAge;
show(first === undefined || first === "" ? null : Number(first));

document.addEventListener("hands-up:board", (event) => {
  show((event as CustomEvent<{ goingOver: number | null }>).detail.goingOver);
});

// The hall's plain form is also what the host's floating button presses.
document.addEventListener("submit", (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || !form.matches("[data-going-over-form]")) return;
  event.preventDefault();
  event.stopPropagation();
  if (sending || goingOverLeft() > 0) return;
  void send(form);
}, true);

async function send(form: HTMLFormElement): Promise<void> {
  const body = new URLSearchParams();
  for (const [name, value] of new FormData(form)) body.append(name, String(value));
  const problem = form.querySelector<HTMLElement>("[data-going-over-problem]");
  if (problem) problem.hidden = true;
  sending = true;
  const before = revision;
  render();
  try {
    const res = await fetch(form.action, { method: "POST", body, headers: { accept: "text/html" } });
    const doc = new DOMParser().parseFromString(await res.text(), "text/html");
    if (!res.ok && res.status < 500) {
      // a refusal the server explained: show its words
      if (problem) {
        problem.hidden = false;
        problem.textContent = doc.querySelector('[role="alert"]')?.textContent?.trim() || "That didn't work. Reload the page and try again.";
      }
      return;
    }
    if (!res.ok) throw new Error(String(res.status));
    const age = doc.querySelector<HTMLElement>("[data-going-over]")?.dataset.goingOverAge;
    if (age === undefined) throw new Error("No acknowledgement in the response");
    // A newer stream state may already have arrived while this page was fetched.
    if (revision === before) show(age === "" ? null : Number(age));
  } catch {
    // A lost reply may follow a saved press. Do not submit it a second time.
    if (problem) {
      problem.hidden = false;
      problem.textContent = "Could not confirm. Check the banner before trying again.";
    }
  } finally {
    sending = false;
    render();
  }
}
