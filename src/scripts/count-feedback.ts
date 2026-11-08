// Presentation only: acknowledge the exact sentence after a confirmed change.
// Pending presses do not acknowledge success; bursts get at most two fades/s.
const seen = new WeakMap<HTMLElement, { text: string; next: number; timer?: number }>();

export function acknowledgeCount(element: HTMLElement, confirmed = true): void {
  const text = element.textContent?.trim() ?? "";
  const previous = seen.get(element);
  const view = element.ownerDocument.defaultView;
  if (!previous || !view) {
    seen.set(element, { text, next: 0 });
    return;
  }
  if (!confirmed) {
    view.clearTimeout(previous.timer);
    previous.timer = undefined;
    element.classList.remove("count-changed");
    return;
  }
  const changed = previous.text !== text;
  previous.text = text;
  const now = view.performance.now();
  if (!changed || now < previous.next || view.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  previous.next = now + 500;
  element.classList.add("count-changed");
  previous.timer = view.setTimeout(() => {
    element.classList.remove("count-changed");
    previous.timer = undefined;
  }, 140);
}
