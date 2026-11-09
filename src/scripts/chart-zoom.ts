// Zoom a timeline chart along time only, and move along it with the sliding
// window under it. The scale on the left, the page and the browser's own zoom
// stay as they are.
// - Zoom: Ctrl + scroll or a trackpad pinch on the chart, or − + Fit.
// - Move: drag the box in the overview, press the overview where to look,
//   swipe the chart sideways, or the arrow keys on the box. Dragging an edge
//   of the box zooms to what the box covers.
// The live refresh replaces the sittings, so each chart's zoom and place are
// kept by sitting and put back afterwards.

// past this, a minute is wide enough for its own time under the axis
const FINE_PX = 44;
// zoomed in fully, one minute is this wide
const MAX_PX = 64;

type Place = { zoom: number; start: number };
const places = new Map<string, Place>();
const resizers = new Set<() => void>();

const timeOf = (bar: Element | undefined): string => (bar?.getAttribute("title") ?? "").split(": ")[0];

function wire(section: HTMLElement): void {
  const chart = section.querySelector<HTMLElement>("[data-chart]");
  const view = section.querySelector<HTMLElement>("[data-chart-view]");
  const box = section.querySelector<HTMLElement>("[data-chart-zoom]");
  const overview = box?.querySelector<HTMLElement>("[data-chart-overview]");
  const win = box?.querySelector<HTMLElement>("[data-chart-window]");
  if (!chart || !view || !box || !overview || !win || chart.dataset.zoomReady) return;
  chart.dataset.zoomReady = "1";
  zoomable(section, chart, view, box, overview, win);
}

function zoomable(section: HTMLElement, chart: HTMLElement, view: HTMLElement, box: HTMLElement, overview: HTMLElement, win: HTMLElement): void {
  const key = section.getAttribute("aria-labelledby") ?? "";
  const bars = [...chart.querySelectorAll(".chart-bar")];
  const minutes = Math.max(1, bars.length);
  const step = Number(chart.dataset.step) || 10;
  const button = (name: string): HTMLButtonElement => box.querySelector<HTMLButtonElement>(`[data-zoom="${name}"]`)!;
  const zoomIn = button("in");
  const zoomOut = button("out");
  const fit = button("fit");
  let zoom = 1;

  const most = (): number => Math.max(1, (minutes * MAX_PX) / Math.max(1, view.clientWidth));

  /** Where the chart is: the share of the sitting at the left edge, and how much shows. */
  function place(): { start: number; size: number } {
    const total = view.scrollWidth || 1;
    return { start: view.scrollLeft / total, size: Math.min(1, view.clientWidth / total) };
  }

  function show(): void {
    const { start, size } = place();
    win.style.left = `${start * 100}%`;
    win.style.width = `${size * 100}%`;
    const perMinute = view.scrollWidth / minutes;
    const level = zoom <= 1.01 ? "" : perMinute >= FINE_PX ? "fine" : perMinute * step >= FINE_PX ? "more" : "";
    if (level) chart.dataset.zoomed = level;
    else delete chart.dataset.zoomed;
    zoomOut.disabled = zoom <= 1.001;
    fit.disabled = zoomOut.disabled;
    zoomIn.disabled = zoom >= most() - 0.001;
    const first = Math.min(minutes - 1, Math.floor(start * minutes));
    const last = Math.min(minutes - 1, Math.max(first, Math.ceil((start + size) * minutes) - 1));
    win.setAttribute("aria-valuenow", String(size >= 1 ? 0 : Math.round((start / (1 - size)) * 100)));
    win.setAttribute("aria-valuetext", `${timeOf(bars[first])} to ${timeOf(bars[last])}`);
    places.set(key, { zoom, start });
  }

  /** Zoom to `next`, keeping the moment under `anchor` (a share of the view's width) where it is. */
  function zoomTo(next: number, anchor = 0.5): void {
    const width = view.clientWidth;
    const at = (view.scrollLeft + anchor * width) / (view.scrollWidth || 1);
    setPlace(next, at - anchor * (width / ((view.scrollWidth || 1) * (Math.min(most(), Math.max(1, next)) / zoom))));
  }

  /** Zoom to `next` with the share `start` of the sitting at the left edge. */
  function setPlace(next: number, start: number): void {
    zoom = Math.min(most(), Math.max(1, next));
    chart.style.setProperty("--zoom", String(zoom));
    view.scrollLeft = start * view.scrollWidth;
    show();
  }

  zoomIn.addEventListener("click", () => zoomTo(zoom * 2));
  zoomOut.addEventListener("click", () => zoomTo(zoom / 2));
  fit.addEventListener("click", () => setPlace(1, 0));
  view.addEventListener("scroll", show, { passive: true });

  // Ctrl + scroll, and a pinch on a trackpad (which arrives as Ctrl + scroll),
  // zoom the chart's time and not the page
  view.addEventListener(
    "wheel",
    (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const rect = view.getBoundingClientRect();
      // a mouse wheel's notch is about 100, a pinch a few at a time: about 1.35x a notch either way
      const delta = Math.max(-50, Math.min(50, event.deltaY));
      zoomTo(zoom * Math.exp(-delta * 0.006), (event.clientX - rect.left) / rect.width);
    },
    { passive: false },
  );
  // Safari's pinch
  let pinchFrom = 1;
  view.addEventListener("gesturestart", (event) => {
    event.preventDefault();
    pinchFrom = zoom;
  });
  view.addEventListener("gesturechange", (event) => {
    event.preventDefault();
    zoomTo(pinchFrom * ((event as Event & { scale?: number }).scale ?? 1));
  });

  // the box: drag it to move, drag an edge to zoom to what it covers,
  // or press the overview to move the box there
  let drag: { kind: "move" | "start" | "end"; x: number; start: number; size: number } | null = null;
  overview.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const rect = overview.getBoundingClientRect();
    const edge = (event.target as HTMLElement).closest<HTMLElement>("[data-edge]")?.dataset.edge;
    let { start, size } = place();
    if (!edge && !win.contains(event.target as Node)) {
      // jump: centre the box where the overview was pressed, then keep dragging it
      start = Math.min(1 - size, Math.max(0, (event.clientX - rect.left) / rect.width - size / 2));
      view.scrollLeft = start * view.scrollWidth;
    }
    drag = { kind: edge === "start" ? "start" : edge === "end" ? "end" : "move", x: event.clientX, start, size };
    overview.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  overview.addEventListener("pointermove", (event) => {
    if (!drag) return;
    const moved = (event.clientX - drag.x) / overview.getBoundingClientRect().width;
    const smallest = 1 / most();
    if (drag.kind === "move") {
      view.scrollLeft = Math.min(1 - drag.size, Math.max(0, drag.start + moved)) * view.scrollWidth;
    } else if (drag.kind === "start") {
      const end = drag.start + drag.size;
      const start = Math.min(end - smallest, Math.max(0, drag.start + moved));
      setPlace(1 / (end - start), start);
    } else {
      const end = Math.max(drag.start + smallest, Math.min(1, drag.start + drag.size + moved));
      setPlace(1 / (end - drag.start), drag.start);
    }
  });
  const stop = (): void => {
    drag = null;
  };
  overview.addEventListener("pointerup", stop);
  overview.addEventListener("pointercancel", stop);

  win.addEventListener("keydown", (event) => {
    const by = view.clientWidth / 4;
    if (event.key === "ArrowLeft") view.scrollLeft -= by;
    else if (event.key === "ArrowRight") view.scrollLeft += by;
    else if (event.key === "Home") view.scrollLeft = 0;
    else if (event.key === "End") view.scrollLeft = view.scrollWidth;
    else if (event.key === "+" || event.key === "=") zoomTo(zoom * 2);
    else if (event.key === "-") zoomTo(zoom / 2);
    else return;
    event.preventDefault();
  });

  const fits = (): void => {
    // a sitting of a few minutes already shows every minute wide enough
    box.hidden = most() <= 1.01;
    // after a resize the same share of the sitting stays at the left edge
    setPlace(Math.min(zoom, most()), places.get(key)?.start ?? 0);
  };
  resizers.add(() => {
    if (section.isConnected) fits();
  });
  const kept = places.get(key);
  fits();
  if (kept && !box.hidden) setPlace(kept.zoom, kept.start);
}

function wireAll(): void {
  for (const section of document.querySelectorAll<HTMLElement>(".sitting")) wire(section);
}

wireAll();
// the live refresh draws the sittings again: wire the new ones and put each back where it was
document.addEventListener("hands-up:timeline", () => {
  resizers.clear();
  wireAll();
});
window.addEventListener("resize", () => {
  for (const fit of resizers) fit();
});
