import { ago, hereLabel, votesLabel } from "../lib/words.ts";

// Keeps an open session page up to date. The server sends the state of the
// session (src/lib/live.ts) when the page connects and after every change:
// how many people have it open, and each question's id and vote count, in
// Popular order. The script changes counts and moves cards to match. When the state has a question this page
// has never seen, the page fetches itself and takes the new card from the
// server's HTML, so "Yours" and the wording are still the server's.
// Asking and voting are still the page's forms; the script sends them in the
// background, so the page doesn't reload, and takes the list from the answer.
// Without this script the page works as plain forms.

type Board = { here: number; questions: [id: number, votes: number, state: "open" | "answered"][] };

const CARD = "li[id^='q-']";
const calm = window.matchMedia("(prefers-reduced-motion: reduce)");

const main = document.querySelector<HTMLElement>("[data-live]");
const holder = main?.querySelector<HTMLElement>("[data-board]");
if (main?.dataset.live && holder && "EventSource" in window) watch(main, main.dataset.live, holder);

function watch(main: HTMLElement, url: string, holder: HTMLElement): void {
  const cards = (): HTMLElement[] => [...holder.querySelectorAll<HTMLElement>(CARD)];

  /** Make a change to the list, keep the keyboard where it was, and slide each card to its new place. */
  function move(change: () => void): void {
    const before = new Map(cards().map((li) => [li.id, li.getBoundingClientRect().top]));
    const counted = new Map(cards().map((li) => [li.id, li.querySelector(".n")?.textContent]));
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const card = focused?.closest<HTMLElement>(CARD);
    const nth = card && focused ? [...card.querySelectorAll("button")].indexOf(focused as HTMLButtonElement) : -1;

    change();

    if (focused && card && document.activeElement !== focused) {
      // a card that moved loses the focus; one that was redrawn has a new button
      const buttons = document.getElementById(card.id)?.querySelectorAll<HTMLElement>("button");
      const again = focused.isConnected ? focused : (buttons?.[nth] ?? buttons?.[buttons.length - 1]);
      again?.focus({ preventScroll: true });
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

  /** The state the server sent: change counts and the order here, or fetch what this page hasn't got. */
  function show(board: Board): void {
    const here = document.querySelector<HTMLElement>("[data-here]");
    if (here) {
      here.hidden = false;
      here.textContent = hereLabel(board.here);
    }
    // The host's page also lists the hidden questions, which the server leaves
    // out of the state; they stay where the server put them, at the end.
    const hidden = cards().filter((li) => li.dataset.state === "hidden");
    const known = new Map(
      cards()
        .filter((li) => li.dataset.state !== "hidden")
        .map((li) => [Number(li.id.slice(2)), li]),
    );
    const same =
      board.questions.length === known.size &&
      board.questions.every(([id, , state]) => known.get(id)?.dataset.state === state);
    // the projector page shows only the top few, so it always asks the server which
    if (!same || holder.dataset.refresh !== undefined) {
      void refresh();
      return;
    }
    const list = holder.querySelector("ol");
    if (!list) return;
    move(() => {
      for (const [id, votes] of board.questions) setCount(known.get(id)!, votes);
      // Recent is newest first, which a vote doesn't change
      if (holder.dataset.sort === "popular") {
        arrange(list, [...board.questions.map(([id]) => known.get(id)!), ...hidden]);
      }
    });
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
          if (mine.innerHTML !== li.innerHTML) mine.replaceChildren(...li.childNodes);
          mine.dataset.state = (li as HTMLElement).dataset.state;
          return mine;
        });
        arrange(list, want);
      }
      const count = doc.querySelector("[data-count]")?.textContent;
      const label = document.querySelector("[data-count]");
      if (label && count) label.textContent = count;
    });
  }

  // One fetch at a time; a change that arrives during one is picked up by another straight after.
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
        const res = await fetch(location.href, { headers: { accept: "text/html" } });
        if (!res.ok) break;
        adopt(new DOMParser().parseFromString(await res.text(), "text/html"));
      } while (again);
    } catch {
      // offline: the stream reconnects and sends the state again
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
    const text = form.querySelector("textarea");

    // a pressed "Me too" shows at once; the count waits for the server
    const pressed = button?.getAttribute("aria-pressed");
    if (button && pressed) button.setAttribute("aria-pressed", pressed === "true" ? "false" : "true");
    form.setAttribute("aria-busy", "true");
    try {
      const res = await fetch(form.action, {
        method: "POST",
        body: fields,
        headers: { accept: "text/html" },
      });
      const doc = new DOMParser().parseFromString(await res.text(), "text/html");
      if (!doc.querySelector("[data-board]")) throw new Error(`the server answered ${res.status}`);
      adopt(doc);
      if (asking && text) {
        // a refused question comes back with the reason; an accepted one empties the box
        const reason = doc.querySelector("[data-ask] [role='alert']");
        form.querySelector("[role='alert']")?.remove();
        if (reason) text.after(document.adoptNode(reason));
        else text.value = "";
      }
    } catch {
      // no answer: put the button back and send the form the ordinary way
      if (button && pressed) button.setAttribute("aria-pressed", pressed);
      plain.add(form);
      form.requestSubmit(button);
    } finally {
      form.removeAttribute("aria-busy");
    }
  }

  const plain = new WeakSet<HTMLFormElement>();
  main.addEventListener("submit", (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || form.method !== "post" || plain.has(form)) return;
    event.preventDefault();
    // a second press while the first is on its way would send the same thing again
    if (form.getAttribute("aria-busy") === "true") return;
    void send(form, event.submitter);
  });

  // The page no longer reloads, so "just now" has to be kept true here.
  setInterval(() => {
    for (const time of holder.querySelectorAll<HTMLTimeElement>("time[datetime]")) {
      const text = ago(new Date(time.dateTime));
      if (time.textContent !== text) time.textContent = text;
    }
  }, 20_000);

  const status = document.querySelector<HTMLElement>("[data-live-status]");
  const say = (live: boolean): void => {
    if (!status) return;
    status.hidden = false;
    status.dataset.liveStatus = live ? "live" : "waiting";
    status.textContent = live ? "Live" : "Reconnecting";
  };

  function connect(): void {
    const source = new EventSource(url);
    source.onopen = () => say(true);
    source.onmessage = (event) => show(JSON.parse(event.data) as Board);
    source.onerror = () => {
      say(false);
      // The browser reconnects by itself after a dropped connection, but gives
      // up for good on an error page, which is what a redeploy answers with.
      if (source.readyState === EventSource.CLOSED) setTimeout(connect, 2000);
    };
  }
  connect();
}
