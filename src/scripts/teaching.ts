import { clock } from "../lib/words.ts";

// A quiet, optional comparison with an explicit check, never a claim to know
// when the lecturer looked. Only aggregate counts live in this tab's storage.
// Main supplies the checkpoint and recap; ordinary forms work without this file.
const workspace = document.querySelector<HTMLElement>("[data-teaching]");
if (workspace) enhance(workspace);

type Snapshot = { lost: number; here: number; at: number };
type State = { hands: number[]; here: number; classState?: string };

function enhance(workspace: HTMLElement): void {
  const room = JSON.parse(workspace.querySelector<HTMLElement>("[data-room]")?.dataset.room ?? "null") as State | null;
  if (!room) return;
  let current = { lost: room.hands.length, here: room.here };
  let lesson = workspace.dataset.lesson ?? "0";
  let classState = workspace.dataset.classState;
  const key = () => `hands-up:checked:${workspace.dataset.session}:${lesson}`;
  function readCheck(): Snapshot | null {
    try {
      const saved = JSON.parse(sessionStorage.getItem(key()) ?? "null") as Snapshot | null;
      if (saved && Number.isInteger(saved.lost) && Number.isInteger(saved.here) && saved.lost >= 0 && saved.here >= saved.lost
        && Number.isFinite(saved.at) && saved.at <= Date.now()) return saved;
    } catch { /* Storage is optional, including in private browsing. */ }
    return null;
  }
  let checked = readCheck();
  const initialCheck = Number(workspace.dataset.checkedAt);
  if (initialCheck > (checked?.at ?? 0)) {
    checked = { ...current, at: initialCheck };
    try { sessionStorage.setItem(key(), JSON.stringify(checked)); } catch { /* Optional storage. */ }
  }
  const checkControl = workspace.querySelector<HTMLFormElement>("[data-teaching-check]");
  const checkLine = workspace.querySelector<HTMLElement>("[data-check-difference]");
  function comparison(): void {
    if (!checkLine) return;
    if (!checked) {
      checkLine.textContent = "Check this at a pause in your explanation.";
      return;
    }
    const change = current.lost - checked.lost;
    const difference = change === 0 ? "Same number of hands" : `${Math.abs(change)} ${change > 0 ? "more" : "fewer"} ${Math.abs(change) === 1 ? "hand" : "hands"}`;
    checkLine.textContent = `${difference} since you checked at ${clock(new Date(checked.at))} (${checked.lost} of ${checked.here} then).`;
  }
  checkControl?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (checkControl.getAttribute("aria-busy") === "true") return;
    checkControl.setAttribute("aria-busy", "true");
    try {
      const response = await fetch(checkControl.action, { method: "POST", body: new URLSearchParams({ intent: "review" }), headers: { accept: "text/html" } });
      const doc = new DOMParser().parseFromString(await response.text(), "text/html");
      if (!response.ok) throw new Error(doc.querySelector('[role="alert"]')?.textContent?.trim() || "Could not save the check.");
      const at = Number(doc.querySelector<HTMLElement>("[data-teaching]")?.dataset.checkedAt);
      const snapshot = JSON.parse(doc.querySelector<HTMLElement>("[data-room]")?.dataset.room ?? "null") as State | null;
      if (!at || !snapshot) throw new Error("Could not confirm the check.");
      adopt(doc);
      checked = { lost: snapshot.hands.length, here: snapshot.here, at };
      try { sessionStorage.setItem(key(), JSON.stringify(checked)); } catch { /* Keep it in memory for this visit. */ }
      comparison();
    } catch (error) {
      if (checkLine) checkLine.textContent = error instanceof Error ? error.message : "Could not confirm the check. Try again.";
    } finally { checkControl.removeAttribute("aria-busy"); }
  });
  comparison();

  function elapsed(): void {
    const label = workspace.querySelector<HTMLElement>("[data-class-clock]");
    if (label) label.textContent = `${Math.max(0, Math.floor((Date.now() - Number(label.dataset.start)) / 60_000))} min`;
  }
  setInterval(elapsed, 30_000);
  elapsed();

  // Refresh class controls, main's ended-class recap and recording time.
  // checkpoint.ts alone owns [data-checkpoint], including its floating copy.
  function adopt(doc: Document): void {
    const fresh = doc.querySelector<HTMLElement>("[data-teaching]");
    if (!fresh) return;
    const nextLesson = fresh.dataset.lesson ?? "0";
    if (nextLesson !== lesson) {
      lesson = nextLesson;
      checked = readCheck();
      comparison();
    }
    classState = fresh.dataset.classState;
    workspace.dataset.classState = classState;
    const summaryLink = document.querySelector<HTMLElement>("[data-class-summary-link]");
    if (summaryLink) summaryLink.hidden = classState !== "over";
    for (const region of workspace.querySelectorAll<HTMLElement>("[data-teaching-refresh]")) {
      const next = fresh.querySelector<HTMLElement>(`[data-teaching-refresh="${region.dataset.teachingRefresh}"]`);
      if (!next || region.innerHTML === next.innerHTML) continue;
      // A recording corrected in another tab may update here, unless this
      // lecturer is editing it. Never replace an unsaved value or its error.
      if (region.querySelector('[role="alert"]') || (region.querySelector("input:not([type='hidden'])") && (
        region.contains(document.activeElement) || [...region.querySelectorAll<HTMLInputElement>("input:not([type='hidden'])")].some(input => input.value !== input.defaultValue)
      ))) continue;
      const open = [...region.querySelectorAll("details")].map(details => details.open);
      [...next.querySelectorAll("details")].forEach((details, i) => { if (open[i] !== undefined) details.open = open[i]; });
      // Keep a focused link or class button reachable when the region changes.
      const focused = region.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
      const name = focused?.tagName;
      const href = focused?.getAttribute("href");
      region.replaceChildren(...next.childNodes);
      if (focused) {
        const target = [...region.querySelectorAll<HTMLElement>(name ?? "a")].find(el => !href || el.getAttribute("href") === href);
        target?.focus({ preventScroll: true });
      }
    }
    elapsed();
  }
  document.addEventListener("hands-up:page", event => adopt((event as CustomEvent<Document>).detail));
  let fetching = false;
  let again = false;
  async function refresh(): Promise<void> {
    if (fetching) { again = true; return; }
    fetching = true;
    try {
      do {
        again = false;
        const response = await fetch(location.href, { headers: { accept: "text/html" }, cache: "no-store" });
        if (!response.ok) throw new Error("Workspace unavailable");
        const doc = new DOMParser().parseFromString(await response.text(), "text/html");
        if (!doc.querySelector("[data-teaching]")) throw new Error("Workspace unavailable");
        adopt(doc);
        const status = workspace.querySelector<HTMLElement>("[data-teaching-status]");
        if (status) status.hidden = true;
      } while (again);
    } catch {
      const status = workspace.querySelector<HTMLElement>("[data-teaching-status]");
      if (status) status.hidden = false;
    } finally { fetching = false; }
  }
  document.addEventListener("hands-up:board", event => {
    const board = (event as CustomEvent<State>).detail;
    current = { lost: board.hands.length, here: board.here };
    comparison();
    if (board.classState !== classState) void refresh();
  });
  // Refresh controls changed in another host tab, keeping unsaved fields.
  // Main checkpoint.ts handles its own faster checkpoint refresh.
  setInterval(() => { if (!document.hidden) void refresh(); }, 30_000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) void refresh(); });

  // Report links and moderation redirects can target a collapsed group.
  function revealQuestion(): void {
    if (!/^#q-\d+$/.test(location.hash)) return;
    const card = document.getElementById(location.hash.slice(1));
    if (!card) return;
    const group = card.closest<HTMLDetailsElement>("details");
    if (group) group.open = true;
    card.scrollIntoView({ block: "nearest" });
  }
  window.addEventListener("hashchange", revealQuestion);
  revealQuestion();
}
