// Keep reading the session while its record is open. Only the sittings and
// saved marks are replaced: the host's inputs stay where they are, with
// anything being typed, their focus and their selection intact.
const main = document.querySelector<HTMLElement>("main.timeline[data-live]");
const url = main?.dataset.live;
const sittings = main?.querySelector<HTMLElement>("[data-sittings]");
if (main && url && sittings) watch(main, url, sittings);

function watch(main: HTMLElement, url: string, sittings: HTMLElement): void {
  const status = main.querySelector<HTMLElement>("[data-live-status]");
  const saved = main.querySelector<HTMLElement>("[data-timeline-status]");

  function adopt(doc: Document): void {
    const fresh = doc.querySelector("[data-sittings]");
    if (!fresh) return;
    const opened = new Set([...sittings.querySelectorAll("details[open]")].map((el) => el.id));
    const focused = sittings.contains(document.activeElement) ? document.activeElement?.id : undefined;
    for (const detail of fresh.querySelectorAll("details")) detail.open = opened.has(detail.id);
    sittings.replaceChildren(...fresh.childNodes);
    if (focused) document.getElementById(focused)?.focus({ preventScroll: true });
    const marks = main.querySelector<HTMLElement>("[data-marks]");
    const freshMarks = doc.querySelector<HTMLElement>("[data-marks]");
    if (marks && freshMarks) {
      marks.replaceChildren(...freshMarks.childNodes);
      marks.hidden = freshMarks.hidden;
    }
    document.dispatchEvent(new Event("hands-up:timeline"));
  }

  // One request at a time. A save or event arriving during a request always
  // gets another fetch afterwards, so an old response cannot win a race.
  let fetching = false;
  let again = false;
  async function refresh(): Promise<void> {
    if (fetching) {
      again = true;
      return;
    }
    fetching = true;
    try {
      do {
        again = false;
        const res = await fetch(location.href, { headers: { accept: "text/html" }, cache: "no-store" });
        if (!res.ok) break;
        adopt(new DOMParser().parseFromString(await res.text(), "text/html"));
      } while (again);
    } catch {
      // The next stream event or minute boundary tries again after an outage.
    } finally {
      fetching = false;
    }
  }

  main.addEventListener("submit", (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || !form.matches("[data-timeline-form]")) return;
    event.preventDefault();
    if (form.getAttribute("aria-busy") === "true") return;
    void save(form);
  });

  async function save(form: HTMLFormElement): Promise<void> {
    const body = new URLSearchParams();
    for (const [name, value] of new FormData(form)) body.append(name, String(value));
    const label = form.querySelector<HTMLInputElement>("input[name='label']");
    const submitted = label?.value;
    form.setAttribute("aria-busy", "true");
    if (saved) {
      saved.hidden = false;
      saved.textContent = "Saving…";
    }
    try {
      const res = await fetch(form.action, { method: "POST", body, headers: { accept: "text/html" } });
      const doc = new DOMParser().parseFromString(await res.text(), "text/html");
      if (!res.ok) {
        if (saved) saved.textContent = doc.querySelector("[data-timeline-status]")?.textContent?.trim() || "Could not save. Check the value and try again.";
        return;
      }
      if (!doc.querySelector("[data-sittings]")) throw new Error("No timeline in the response");
      // Clear only the mark just sent, never a new draft typed during the save.
      if (label && label.value === submitted) label.value = "";
      if (saved) saved.textContent = body.get("intent") === "recording" ? "Recording time saved." : "Mark saved.";
      void refresh();
    } catch {
      // A POST might have succeeded even if its reply was lost; do not send
      // the mark twice by automatically submitting the plain form again.
      if (saved) saved.textContent = "Could not confirm the save. Check the timeline before trying again.";
      void refresh();
    } finally {
      form.removeAttribute("aria-busy");
    }
  }

  function say(live: boolean): void {
    if (!status) return;
    status.hidden = false;
    status.dataset.liveStatus = live ? "live" : "waiting";
    status.textContent = live ? "Live" : "Reconnecting";
  }

  let source: EventSource | undefined;
  let minuteTimer: ReturnType<typeof setTimeout> | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let stopped = true;
  function connect(): void {
    source = new EventSource(url);
    source.onopen = () => say(true);
    source.onmessage = (event) => {
      const board = JSON.parse(event.data) as { questions: unknown[] };
      for (const count of document.querySelectorAll<HTMLElement>("[data-questions-n]")) count.textContent = String(board.questions.length);
      void refresh();
    };
    source.onerror = () => {
      say(false);
      if (source?.readyState === EventSource.CLOSED && !stopped) reconnectTimer = setTimeout(connect, 2000);
    };
  }

  function nextMinute(): void {
    minuteTimer = setTimeout(() => {
      void refresh();
      nextMinute();
    }, 60_000 - (Date.now() % 60_000));
  }

  function start(): void {
    if (!stopped) return;
    stopped = false;
    connect();
    nextMinute();
  }

  window.addEventListener("pagehide", () => {
    stopped = true;
    source?.close();
    clearTimeout(minuteTimer);
    clearTimeout(reconnectTimer);
  });
  window.addEventListener("pageshow", start);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void refresh();
  });
  start();
}
