// The host's "At your next pause" card (src/pages/s/[code].astro): what the
// part so far looked like, for a lecturer who looks when they choose to, not
// every time a hand goes up. The server works it out; this keeps it current by
// fetching the page again after the room changes, at most every 15 seconds,
// and straight away after a mark from the floating window.

const card = document.querySelector<HTMLElement>("[data-checkpoint]");
const GAP = 15_000;

if (card) {
  // the page was just rendered: the first fetch can wait
  let last = Date.now();
  let timer: number | undefined;
  let fetching = false;
  // a change that came while a fetch was on its way: fetch again after it, now or at the gap
  let again: "now" | "later" | null = null;

  const fetchCard = async (): Promise<void> => {
    if (fetching) {
      again = again === "now" ? "now" : "later";
      return;
    }
    fetching = true;
    last = Date.now();
    try {
      const res = await fetch(location.pathname, { headers: { accept: "text/html" }, cache: "no-store" });
      if (!res.ok) return;
      const fresh = new DOMParser().parseFromString(await res.text(), "text/html").querySelector<HTMLElement>("[data-checkpoint]");
      if (!fresh) return;
      if (fresh.innerHTML !== card.innerHTML) card.replaceChildren(...[...fresh.childNodes].map((node) => document.adoptNode(node)));
      card.hidden = fresh.hidden;
    } catch {
      // the next change in the room tries again
    } finally {
      fetching = false;
      const next = again;
      again = null;
      if (next) soon(next === "now");
    }
  };

  const soon = (now = false): void => {
    if (timer !== undefined) return;
    const wait = now ? 0 : Math.max(0, last + GAP - Date.now());
    timer = window.setTimeout(() => {
      timer = undefined;
      void fetchCard();
    }, wait);
  };

  document.addEventListener("hands-up:board", () => soon());
  document.addEventListener("hands-up:marked", () => {
    if (fetching) {
      // the card on its way may be from before the mark
      again = "now";
      return;
    }
    window.clearTimeout(timer);
    timer = undefined;
    soon(true);
  });
}
