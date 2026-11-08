import { ago, hereLabel, howMany, votesLabel } from "../lib/words.ts";
import { announceSessionChange, onSessionChange } from "./session-tabs.ts";

// Keeps an open session page up to date. The server sends the state of the
// session (src/lib/live.ts) when the page connects and after every change:
// how many people have it open, and each question's id, vote count and state,
// in Popular order. The script changes counts and moves cards to match. A
// question asked by someone else is also sent with its words, and the script
// draws it from the empty card in the page's <template>. For anything else it
// doesn't know (a question of this person's own, one asked while the page was
// offline, a change by the host) the page fetches itself and takes the cards
// from the server's HTML, so "Yours" is always the server's.
// Asking, voting and reporting are still the page's forms; the script sends them in the
// background, so the page doesn't reload, and takes the list from the answer.
// Without this script the page works as plain forms.

type Board = { here: number; questions: [id: number, votes: number, state: "open" | "answered"][]; hands: number[]; goingOver: number | null };
type Added = { id: number; body: string; at: number };

const CARD = "li[id^='q-']";
const calm = window.matchMedia("(prefers-reduced-motion: reduce)");

const main = document.querySelector<HTMLElement>("[data-live]");
const holder = main?.querySelector<HTMLElement>("[data-board]");
if (main?.dataset.live && holder && "EventSource" in window) watch(main, main.dataset.live, holder);

function watch(main: HTMLElement, url: string, holder: HTMLElement): void {
  const cards = (): HTMLElement[] => [...holder.querySelectorAll<HTMLElement>(CARD)];

  // how long a card that moved can't be pressed: the slide, and a little more
  const MOVED_MS = 400;
  const settling = new WeakMap<HTMLElement, number>();
  // Other status regions belong to the hand, connection or ask form. Keep
  // keyboard feedback beside this list, using the existing hidden-text style.
  const focusStatus = holder.querySelector<HTMLElement>("[role='status']:not([data-live-status])") ?? document.createElement("p");
  if (!focusStatus.isConnected) {
    focusStatus.className = "unseen";
    focusStatus.setAttribute("role", "status");
    holder.before(focusStatus);
  }
  let focusNotice = 0;

  // The controls in a card the keyboard can reach: its buttons and the report
  // triangle, but not a button inside a closed "Report to the host?".
  const controls = (li: HTMLElement): HTMLElement[] =>
    [...li.querySelectorAll<HTMLElement>("button, summary")].filter((el) => el.tagName === "SUMMARY" || !el.closest("details:not([open])"));
  // What a control does, so the same one can be found in a redrawn card: the
  // triangle, or a button by its form's intent (and the host's state it sets).
  const identity = (el: HTMLElement): string => {
    if (el.tagName === "SUMMARY") return "triangle";
    const intent = el.closest("form")?.querySelector<HTMLInputElement>("input[name='intent']")?.value ?? "";
    return `${intent}|${el instanceof HTMLButtonElement && el.name === "to" ? el.value : ""}`;
  };

  /** Make a change to the list, keep the keyboard where it was, and slide each card to its new place. */
  function move(change: () => void): void {
    const previous = cards();
    const before = new Map(previous.map((li) => [li.id, li.getBoundingClientRect().top]));
    const counted = new Map(previous.map((li) => [li.id, li.querySelector(".n")?.textContent]));
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const card = focused?.closest<HTMLElement>(CARD);
    const place = card ? previous.indexOf(card) : -1;
    const nth = card && focused ? controls(card).indexOf(focused) : -1;
    const was = focused ? identity(focused) : "";
    const action = focused instanceof HTMLButtonElement && focused.name === "to" && focused.form?.getAttribute("aria-busy") === "true"
      ? focused.value : null;

    change();

    if (focused && card && place >= 0 && document.activeElement !== focused) {
      // a card that moved loses the focus; one that was redrawn has a new button
      const remaining = cards();
      const same = remaining.find((li) => li.id === card.id);
      if (same) {
        const reachable = controls(same);
        // the same control if it is still there; after Undo, the triangle it gave back
        const again = focused.isConnected && reachable.includes(focused) ? focused
          : reachable.find((el) => identity(el) === was)
            ?? (was.startsWith("unreport|") ? reachable.find((el) => el.tagName === "SUMMARY") : undefined)
            ?? reachable[Math.min(nth, reachable.length - 1)]
            ?? same;
        if (again === same) same.tabIndex = -1;
        again.focus({ preventScroll: true });
      } else {
        // Use its old place, then the next surviving card (wrapping at the
        // end). Focusing the card itself also reads the new question's words.
        const next = remaining[place]
          ?? previous.slice(place + 1).map((li) => remaining.find((now) => now.id === li.id)).find(Boolean)
          ?? remaining[0];
        const empty = holder.querySelector<HTMLAnchorElement>("[data-empty]:not([hidden]) a[href]");
        const all = [...main.querySelectorAll<HTMLAnchorElement>("a[href]")].find((link) => link.textContent?.trim() === "All questions");
        const target = next ?? empty ?? all;
        if (next) next.tabIndex = -1;
        target?.focus({ preventScroll: true });
        const happened = action === "answered" ? "Question marked answered." : action === "hidden" ? "Question hidden." : "Question left this list.";
        const destination = next ? "Focus moved to the next question." : target ? `Focus moved to ${target.textContent?.trim()}` : "";
        clearTimeout(focusNotice);
        focusStatus.textContent = "";
        focusNotice = window.setTimeout(() => { focusStatus.textContent = `${happened} ${destination}`.trim(); }, 0);
      }
    }
    // A card that has just moved is under a finger that was aimed at another
    // one, so for a moment it can't be pressed (the stylesheet turns its
    // buttons off for the pointer; the keyboard is not affected).
    for (const li of cards()) {
      const was = before.get(li.id);
      if (was === undefined || Math.abs(was - li.getBoundingClientRect().top) <= 1) continue;
      li.dataset.moved = "";
      clearTimeout(settling.get(li));
      settling.set(
        li,
        window.setTimeout(() => delete li.dataset.moved, MOVED_MS),
      );
    }
    if (calm.matches) return;
    for (const li of cards()) {
      // a count that changed jumps, so a change made elsewhere is seen
      const n = li.querySelector<HTMLElement>(".n");
      if (n && counted.has(li.id) && counted.get(li.id) !== n.textContent) {
        n.animate([{ transform: "scale(1)" }, { transform: "scale(1.5)" }, { transform: "scale(1)" }], {
          duration: 350,
          easing: "ease-out",
        });
      }
      const was = before.get(li.id);
      const now = li.getBoundingClientRect().top;
      if (was === undefined) {
        li.animate(
          [
            { opacity: 0, transform: "translateY(10px)" },
            { opacity: 1, transform: "none" },
          ],
          { duration: 250, easing: "ease-out" },
        );
      } else if (Math.abs(was - now) > 1) {
        li.animate([{ transform: `translateY(${was - now}px)` }, { transform: "none" }], {
          duration: 300,
          easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
        });
      }
    }
  }

  /** Put the list's cards in this order, moving only the ones that are out of place. */
  function arrange(list: Element, want: Element[]): void {
    for (const li of [...list.children]) if (!want.includes(li)) li.remove();
    want.forEach((li, i) => {
      if (list.children[i] !== li) list.insertBefore(li, list.children[i] ?? null);
    });
  }

  function setCount(li: HTMLElement, votes: number): void {
    const button = li.querySelector<HTMLElement>(".me-too");
    const n = button?.querySelector<HTMLElement>(".n");
    if (!button || !n || n.textContent === String(votes)) return;
    n.textContent = String(votes);
    button.setAttribute("aria-label", votesLabel(votes));
  }

  // Every screen reorders as votes arrive, so a card can move just as someone
  // presses it. While a finger or the mouse button is down the list waits, and
  // takes the newest state a moment after the release, once the press has
  // landed where it was aimed.
  let fingers = 0;
  let mouse = false;
  let waiting: Board | undefined;
  // a nudge to fetch the page that came while a finger was down
  let nudged = false;
  const down = (): boolean => fingers > 0 || mouse;
  const released = (): void => {
    setTimeout(() => {
      if (down()) return;
      if (nudged) {
        // the page it fetches is newer than any state that waited
        nudged = false;
        waiting = undefined;
        void refresh();
        return;
      }
      if (!waiting) return;
      const board = waiting;
      waiting = undefined;
      redraw(board);
    }, 120);
  };
  const touched = (event: TouchEvent): void => {
    fingers = event.touches.length;
    if (fingers === 0) released();
  };
  for (const name of ["touchstart", "touchend", "touchcancel"] as const) {
    document.addEventListener(name, touched, { passive: true });
  }
  document.addEventListener("mousedown", () => {
    mouse = true;
  });
  const mouseUp = (): void => {
    if (!mouse) return;
    mouse = false;
    released();
  };
  document.addEventListener("mouseup", mouseUp);
  // a button let go outside the window sends no mouseup: notice when the mouse is back
  document.addEventListener("mousemove", (event) => {
    if (event.buttons === 0) mouseUp();
  });
  window.addEventListener("blur", () => {
    fingers = 0;
    mouseUp();
  });

  let lastQuestions = "";
  let connected = false;
  let cardsStale = false;
  /** The state the server sent. The labels change at once; the list waits for a finger to lift. */
  function show(board: Board): void {
    const here = document.querySelector<HTMLElement>("[data-here]");
    if (here) {
      here.hidden = false;
      here.textContent = hereLabel(board.here);
    }
    const count = document.querySelector("[data-count]");
    if (count && holder.dataset.refresh === undefined) count.textContent = howMany(board.questions.length);
    for (const n of document.querySelectorAll<HTMLElement>("[data-questions-n]")) n.textContent = String(board.questions.length);
    // a state sent because a hand went up or down leaves the questions as they were
    const questions = JSON.stringify(board.questions);
    if (questions === lastQuestions) return;
    lastQuestions = questions;
    // a refresh already on its way carries an older list: it fetches once more
    if (fetching) again = true;
    if (down()) {
      waiting = board;
    } else {
      // a state that was waiting is older than this one
      waiting = undefined;
      redraw(board);
    }
  }

  /** Change counts and the order here, or fetch what this page hasn't got. */
  function redraw(board: Board): void {
    // A failed or pending HTML refresh may contain changes the public state
    // cannot describe (including this person's pressed buttons).
    if (cardsStale) {
      void refresh();
      return;
    }

    // The host's page also lists the hidden questions, which the server leaves
    // out of the state; they stay where the server put them, at the end.
    const hidden = cards().filter((li) => li.dataset.state === "hidden");
    const known = new Map(
      cards()
        .filter((li) => li.dataset.state !== "hidden")
        .map((li) => [Number(li.id.slice(2)), li]),
    );
    const list = holder.querySelector("ol");
    const listed = new Set(board.questions.map(([id]) => id));
    const drawable = board.questions.every(([id, , state]) =>
      known.has(id) ? known.get(id)!.dataset.state === state : sent.has(id) && state === "open",
    );
    // The projector page shows only the top few, so it always asks the server
    // which. So does a page with a card the state no longer lists, or with a
    // question it was not sent the words of.
    if (holder.dataset.refresh !== undefined || !list || !drawable || [...known.keys()].some((id) => !listed.has(id))) {
      void refresh();
      return;
    }
    move(() => {
      const arrived: HTMLElement[] = [];
      for (const [id, votes] of board.questions) {
        let li = known.get(id);
        if (!li) {
          li = draw(sent.get(id)!);
          known.set(id, li);
          arrived.push(li);
        }
        sent.delete(id);
        setCount(li, votes);
      }
      if (holder.dataset.sort === "popular") {
        arrange(list, [...board.questions.map(([id]) => known.get(id)!), ...hidden]);
      } else {
        // Recent is newest first, which a vote doesn't change: new ones go on top
        for (const li of arrived) list.prepend(li);
      }
      const empty = holder.querySelector<HTMLElement>("[data-empty]");
      if (empty) empty.hidden = cards().length > 0;
    });
  }

  // New questions the server has sent the words of, until the state lists them.
  const sent = new Map<number, Added>();
  const blank = document.querySelector<HTMLTemplateElement>("template[data-card]");

  /** A card for a question someone else asked, copied from the page's empty one. */
  function draw(question: Added): HTMLElement {
    const li = blank!.content.firstElementChild!.cloneNode(true) as HTMLElement;
    li.id = `q-${question.id}`;
    li.querySelector(".body")!.textContent = question.body;
    for (const field of li.querySelectorAll<HTMLInputElement>("input[name='question']")) {
      field.value = String(question.id);
    }
    const time = li.querySelector("time");
    if (time) {
      const asked = new Date(question.at);
      time.dateTime = asked.toISOString();
      time.textContent = ago(asked);
    }
    return li;
  }

  /** Take the list from the server's own HTML for this person, keeping the cards already here. */
  function adopt(doc: Document): void {
    const fresh = doc.querySelector<HTMLElement>("[data-board]");
    if (!fresh) return;
    move(() => {
      const list = holder.querySelector("ol");
      const freshList = fresh.querySelector("ol");
      if (!list || !freshList) {
        holder.replaceChildren(...fresh.childNodes);
      } else {
        const old = new Map(cards().map((li) => [li.id, li]));
        const want = [...freshList.children].map((li) => {
          const mine = old.get(li.id);
          if (!mine) return document.adoptNode(li);
          // a "Report to the host?" left open stays open while the card is redrawn
          const asking = mine.querySelector<HTMLDetailsElement>("details[data-report]")?.open ?? false;
          if (mine.innerHTML !== li.innerHTML) mine.replaceChildren(...li.childNodes);
          const confirm = mine.querySelector<HTMLDetailsElement>("details[data-report]");
          if (asking && confirm) confirm.open = true;
          mine.dataset.state = (li as HTMLElement).dataset.state;
          return mine;
        });
        arrange(list, want);
      }
      const empty = holder.querySelector<HTMLElement>("[data-empty]");
      const freshEmpty = fresh.querySelector<HTMLElement>("[data-empty]");
      if (empty && freshEmpty && empty.innerHTML !== freshEmpty.innerHTML) empty.replaceChildren(...freshEmpty.childNodes);
      if (empty) empty.hidden = cards().length > 0;
      const count = doc.querySelector("[data-count]")?.textContent;
      const label = document.querySelector("[data-count]");
      if (label && count) label.textContent = count;
    });
  }

  // One fetch at a time; a change that arrives during one is picked up by another straight after.
  let fetching = false;
  let again = false;
  let retryTimer: number | undefined;
  async function refresh(retry = true): Promise<void> {
    if (fetching) {
      again = true;
      return;
    }
    clearTimeout(retryTimer);
    retryTimer = undefined;
    fetching = true;
    try {
      do {
        again = false;
        const res = await fetch(location.href, { headers: { accept: "text/html" }, cache: "no-store" });
        if (!res.ok) throw new Error(`the server answered ${res.status}`);
        const doc = new DOMParser().parseFromString(await res.text(), "text/html");
        if (!doc.querySelector("[data-board]")) throw new Error("No question list in the response");
        adopt(doc);
      } while (again);
      cardsStale = false;
      say(connected);
    } catch {
      // The cards are out of date: say so, and let an identical next state
      // still repair the list.
      cardsStale = true;
      lastQuestions = "";
      say(false);
      // One delayed retry per refresh, without waiting for another room change.
      if (retry) retryTimer = window.setTimeout(() => void refresh(false), 1000);
    } finally {
      fetching = false;
    }
  }

  /** Send a form in the background, as pressing `button` would, and show what the server answers. */
  async function send(form: HTMLFormElement, button: HTMLElement | null): Promise<void> {
    const fields = new URLSearchParams();
    for (const [name, value] of new FormData(form)) fields.append(name, String(value));
    if (button instanceof HTMLButtonElement && button.name) fields.append(button.name, button.value);
    const asking = form.matches("[data-ask]");
    const posted = asking ? main.querySelector<HTMLElement>("[data-question-posted]") : null;
    const text = form.querySelector("textarea");
    const submitted = text?.value;
    const action = form.action;
    // Only explicit desired states are safe to send again after a lost reply.
    const repeatable = !asking && (
      (fields.get("intent") === "vote" && ["0", "1"].includes(fields.get("want") ?? "")) ||
      fields.get("intent") === "report" ||
      (fields.get("intent") === "state" && ["open", "answered", "hidden"].includes(fields.get("to") ?? ""))
    );

    function problem(message: string): void {
      const alert = document.createElement("p");
      alert.className = "alert";
      alert.setAttribute("role", "alert");
      alert.textContent = message;
      if (asking && text) {
        form.querySelector("[role='alert']")?.remove();
        text.after(alert);
      } else {
        // Cards can be replaced by the stream while a request is pending.
        // Keep the problem beside the list so that refreshes cannot erase it.
        main.querySelector("[data-send-problem]")?.remove();
        alert.dataset.sendProblem = "";
        holder.before(alert);
      }
    }

    async function post(): Promise<{ doc: Document; ok: boolean }> {
      const res = await fetch(action, {
        method: "POST",
        body: fields,
        headers: { accept: "text/html" },
      });
      const doc = new DOMParser().parseFromString(await res.text(), "text/html");
      if (!doc.querySelector("[data-board]")) throw new Error(`the server answered ${res.status}`);
      return { doc, ok: res.ok };
    }

    // a pressed "Me too" shows at once; the count waits for the server
    const pressed = button?.getAttribute("aria-pressed");
    if (button && pressed) button.setAttribute("aria-pressed", pressed === "true" ? "false" : "true");
    form.setAttribute("aria-busy", "true");
    if (asking) {
      form.querySelector("[role='alert']")?.remove();
      if (posted) {
        posted.hidden = true;
        posted.replaceChildren();
      }
    }
    else main.querySelector("[data-send-problem]")?.remove();
    try {
      let reply;
      try {
        reply = await post();
      } catch (error) {
        if (!repeatable) throw error;
        // Retry the same vote, report or state once, in the background. A plain submission
        // could leave the page (and a question draft) on a browser error screen.
        reply = await post();
      }
      const { doc, ok } = reply;
      adopt(doc);
      if (ok && ["vote", "report"].includes(fields.get("intent") ?? "")) announceSessionChange();
      if (asking && text) {
        // a refused question comes back with the reason; an accepted one empties the box
        const reason = doc.querySelector("[data-ask] [role='alert']");
        if (reason) text.after(document.adoptNode(reason));
        else if (!ok) problem("Could not send the question. Check the list before trying again.");
        else {
          if (text.value === submitted) text.value = "";
          const confirmation = doc.querySelector<HTMLElement>("[data-question-posted]");
          if (posted && confirmation && !confirmation.hidden) {
            posted.replaceChildren(...confirmation.childNodes);
            posted.hidden = false;
          }
        }
      } else if (!ok) {
        problem(doc.querySelector("[role='alert']")?.textContent?.trim()
          || "Could not save that change. Check the list before trying again.");
      }
    } catch {
      if (button && pressed) button.setAttribute("aria-pressed", pressed);
      problem(asking
        ? "Your question may or may not have been sent. Check the list before sending again. Your draft is still here."
        : "Could not confirm that change. Check the list before trying again.");
      // An ask may already exist on the server. Keep its draft and look for it;
      // only the person asking can decide whether to send it again.
      void refresh();
    } finally {
      form.removeAttribute("aria-busy");
    }
  }

  main.addEventListener("submit", (event) => {
    const form = event.target;
    // a form marked data-plain posts the ordinary way, and the page reloads
    if (!(form instanceof HTMLFormElement) || form.method !== "post" || form.hasAttribute("data-plain")) return;
    event.preventDefault();
    // a second press while the first is on its way would send the same thing again
    if (form.getAttribute("aria-busy") === "true") return;
    void send(form, event.submitter);
  });

  // The stream has no person's choices. A sibling tab's press or a return
  // from the background needs this browser's own HTML, including aria-pressed.
  onSessionChange(() => { void refresh(); });

  // The page no longer reloads, so "just now" has to be kept true here.
  setInterval(() => {
    for (const time of holder.querySelectorAll<HTMLTimeElement>("time[datetime]")) {
      const text = ago(new Date(time.dateTime));
      if (time.textContent !== text) time.textContent = text;
    }
  }, 20_000);

  const status = document.querySelector<HTMLElement>("[data-live-status]");
  const say = (live: boolean): void => {
    const current = live && !cardsStale;
    // the floating windows say the same (src/scripts/float.ts)
    document.dispatchEvent(new CustomEvent<boolean>("hands-up:live", { detail: current }));
    if (!status) return;
    status.hidden = false;
    status.dataset.liveStatus = current ? "live" : "waiting";
    status.textContent = current ? "Live" : "Reconnecting";
  };

  let opened = false;
  // error pages in a row, for how long to wait before the next try
  let failures = 0;
  function connect(): void {
    const source = new EventSource(url);
    let retrying = false;
    source.onopen = () => {
      failures = 0;
      connected = true;
      // The public question signature cannot reveal every missed HTML change.
      if (opened || cardsStale) void refresh();
      else say(true);
      opened = true;
    };
    source.onmessage = (event) => {
      const board = JSON.parse(event.data) as Board;
      // the hand and the hall (src/scripts/hand.ts) take their part of the same state
      document.dispatchEvent(new CustomEvent("hands-up:board", { detail: board }));
      show(board);
    };
    source.addEventListener("question", (event) => {
      const question = JSON.parse((event as MessageEvent<string>).data) as Added;
      if (blank) sent.set(question.id, question);
    });
    // A report, or one taken back: only the host's pages and the reporter's own
    // are told (src/lib/live.ts `nudge`), and each fetches its own page again.
    source.addEventListener("refresh", () => {
      if (down()) nudged = true;
      else void refresh();
    });
    source.onerror = () => {
      connected = false;
      cardsStale = true;
      say(false);
      // The browser reconnects by itself after a dropped connection, but gives
      // up for good on an error page: a redeploy, or a refusal for too many open
      // pages. Then try again after 2 seconds, twice as long after each failure,
      // up to a minute, so a refused page doesn't knock without end.
      if (source.readyState === EventSource.CLOSED && !retrying) {
        retrying = true;
        setTimeout(connect, Math.min(2000 * 2 ** failures, 60_000));
        failures += 1;
      }
    };
  }
  connect();
}
