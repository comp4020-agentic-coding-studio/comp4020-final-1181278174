// Tutorial forms stay ordinary POSTs. The public stream carries only the
// exercise and a revision; private queue details are fetched as this viewer's
// server-rendered HTML, never broadcast to the room.
export {};
type Exercise = { label: string | null; endsAt: number | null; revision: number; serverNow: number };
type TutorialBoard = { tutorial?: Exercise; classState: "before" | "on" | "over"; questions: unknown[] };
const timers = [...document.querySelectorAll<HTMLElement>("[data-tutorial-timer]")];
const main = document.querySelector<HTMLElement>("[data-live]");
const room = document.querySelector<HTMLElement>("[data-tutorial-room]");
const clocks = new WeakMap<HTMLElement, { remaining: number; received: number }>();

function remember(timer: HTMLElement, endsAt: number | null, serverNow: number): void {
  timer.dataset.endsAt = endsAt === null ? "" : String(endsAt);
  clocks.set(timer, { remaining: endsAt === null ? 0 : endsAt - serverNow, received: performance.now() });
}

function tick(): void {
  for (const timer of timers) {
    const timing = clocks.get(timer);
    if (!timing) continue;
    const active = timer.dataset.endsAt !== "";
    const seconds = Math.max(0, Math.ceil((timing.remaining - (performance.now() - timing.received)) / 1000));
    const display = `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
    const digits = timer.querySelector<HTMLElement>("[data-exercise-remaining]");
    if (digits && digits.textContent !== display) digits.textContent = display;
    const clock = timer.querySelector<HTMLElement>("[data-exercise-clock]");
    if (clock) clock.hidden = !active;
    const expired = timer.querySelector<HTMLElement>("[data-exercise-expired]");
    if (expired) expired.hidden = !active || seconds > 0;
  }
}

function showExercise(state: Exercise): void {
  for (const timer of timers) {
    remember(timer, state.endsAt, state.serverNow);
    const title = timer.querySelector<HTMLElement>("[data-exercise-label]");
    if (title) title.textContent = state.label ?? "Room to work together";
    const note = timer.querySelector<HTMLElement>("[data-exercise-note]");
    if (note) note.textContent = state.label
      ? "Keep working with your group. The timer is a guide to when to regroup."
      : "The tutor can set an exercise and a time to regroup.";
    const time = timer.querySelector<HTMLTimeElement>("[data-exercise-deadline] time");
    if (time && state.endsAt !== null) {
      time.dateTime = new Date(state.endsAt).toISOString();
      time.textContent = new Intl.DateTimeFormat("en-AU", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Australia/Sydney" }).format(state.endsAt);
    }
  }
  tick();
}

for (const timer of timers) remember(timer, timer.dataset.endsAt ? Number(timer.dataset.endsAt) : null, Number(timer.dataset.serverNow));
if (timers.length > 0) {
  tick();
  setInterval(tick, 1000);
}

let connected = false;
let stale = false;
let fetching = false;
let again = false;
let seen = false;
let touching = false;
let pending = false;
let revision = Number(room?.dataset.revision);
let retry: number | undefined;
let changingAccount = false;
// Main's Layout and the stream's private "who" event use the same page mark.
// A different signed-in account is a change too, even if both are signed in.
function accountChanged(mark: string | null): boolean {
  if ((document.body.getAttribute("data-signed-in") ?? "-") === (mark ?? "-")) return false;
  if (!changingAccount) {
    changingAccount = true;
    location.reload();
  }
  return true;
}
const status = document.querySelector<HTMLElement>("[data-live-status]");
function connection(): void {
  // The questions page's existing script owns its connection message.
  if (!status || main?.querySelector("[data-board]")) return;
  status.hidden = false;
  status.textContent = connected && !stale ? "Live" : "Reconnecting. Refresh for the latest queue and timer.";
}

async function refresh(): Promise<void> {
  if (!room || changingAccount) return;
  if (touching) { pending = true; return; }
  if (fetching) { again = true; return; }
  fetching = true;
  clearTimeout(retry);
  try {
    do {
      again = false;
      const response = await fetch(location.href, { headers: { accept: "text/html" }, cache: "no-store" });
      if (!response.ok) throw new Error("Could not refresh the tutorial");
      const doc = new DOMParser().parseFromString(await response.text(), "text/html");
      const fresh = doc.querySelector<HTMLElement>("[data-tutorial-room]");
      if (!fresh) throw new Error("No tutorial in the response");
      if (accountChanged(doc.body.getAttribute("data-signed-in"))) return;
      if (touching) { pending = true; return; }
      for (const target of room.querySelectorAll<HTMLElement>("[data-tutorial-refresh]")) {
        const replacement = fresh.querySelector<HTMLElement>(`[data-tutorial-refresh="${target.dataset.tutorialRefresh}"]`);
        if (!replacement || replacement.innerHTML === target.innerHTML) continue;
        const active = document.activeElement instanceof HTMLElement && target.contains(document.activeElement) ? document.activeElement : null;
        const activeId = active?.id;
        target.replaceChildren(...replacement.childNodes);
        if (active) (activeId ? document.getElementById(activeId) ?? target : target).focus({ preventScroll: true });
      }
      revision = Number(fresh.dataset.revision);
      room.dataset.revision = fresh.dataset.revision;
      room.dataset.class = fresh.dataset.class;
      const start = room.querySelector<HTMLButtonElement>("[data-exercise-start]");
      if (start) start.disabled = fresh.dataset.class !== "on";
      const timer = fresh.querySelector<HTMLElement>("[data-tutorial-timer]");
      if (timer) showExercise({
        label: timer.dataset.endsAt ? timer.querySelector("[data-exercise-label]")?.textContent ?? null : null,
        endsAt: timer.dataset.endsAt ? Number(timer.dataset.endsAt) : null,
        revision,
        serverNow: Number(timer.dataset.serverNow),
      });
    } while (again);
    stale = false;
    connection();
  } catch {
    stale = true;
    connection();
    retry = window.setTimeout(() => void refresh(), 3000);
  } finally {
    fetching = false;
  }
}

function state(board: TutorialBoard): void {
  if (!board.tutorial || changingAccount) return;
  showExercise(board.tutorial);
  for (const n of document.querySelectorAll("[data-questions-n]")) n.textContent = String(board.questions.length);
  if (room && (!seen || stale || revision !== board.tutorial.revision || room.dataset.class !== board.classState)) void refresh();
  seen = true;
}

document.addEventListener("hands-up:board", (event) => state((event as CustomEvent<TutorialBoard>).detail));

if (room) {
  document.addEventListener("pointerdown", () => { touching = true; });
  const released = (): void => {
    touching = false;
    if (pending) { pending = false; window.setTimeout(() => void refresh(), 100); }
  };
  document.addEventListener("pointerup", released);
  document.addEventListener("pointercancel", released);
  window.addEventListener("blur", released);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) void refresh(); });
}

// Questions already has a stream; the tutorial room and projector need one.
if (timers.length > 0 && main?.dataset.live && !main.querySelector("[data-board]") && "EventSource" in window) {
  const url = main.dataset.live;
  let failures = 0;
  let stream: EventSource | undefined;
  let reconnect: number | undefined;
  let away = false;
  function connect(): void {
    clearTimeout(reconnect);
    stream?.close();
    const source = new EventSource(url);
    stream = source;
    let retrying = false;
    source.onopen = () => {
      connected = true;
      failures = 0;
      seen = false;
      connection();
    };
    source.onmessage = (event) => {
      state(JSON.parse(event.data) as TutorialBoard);
      if (!room) { stale = false; connection(); }
    };
    source.addEventListener("who", (event) => {
      accountChanged((event as MessageEvent<string>).data);
    });
    source.onerror = () => {
      if (away || source !== stream) return;
      connected = false;
      stale = true;
      connection();
      if (source.readyState === EventSource.CLOSED && !retrying) {
        retrying = true;
        source.close();
        reconnect = window.setTimeout(connect, Math.min(2000 * 2 ** failures++, 60_000));
      }
    };
  }
  connect();
  window.addEventListener("pagehide", () => {
    away = true;
    clearTimeout(reconnect);
    stream?.close();
    connected = false;
    stale = true;
    connection();
  });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) { away = false; connect(); }
  });
}
