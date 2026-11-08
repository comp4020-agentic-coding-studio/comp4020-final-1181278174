// A session's tabs share only an invalidation, never a person's identity or
// state. Each listener asks its own page for the server's view of this browser.
const listeners = new Set<() => void>();
const live = document.querySelector<HTMLElement>("[data-live]")?.dataset.live;
const code = live ? new URL(live, location.href).pathname.match(/^\/s\/([^/]+)\/events$/)?.[1] : undefined;
let channel: BroadcastChannel | undefined;

function changed(): void {
  for (const listener of listeners) listener();
}

function connect(): void {
  if (channel || !code || !("BroadcastChannel" in window)) return;
  try {
    channel = new BroadcastChannel(code);
    channel.onmessage = (event: MessageEvent<unknown>) => {
      if (event.data === "changed") changed();
    };
  } catch {
    // A browser that blocks channels still catches up when its tab is shown.
  }
}

export function announceSessionChange(): void {
  channel?.postMessage("changed");
}

export function onSessionChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

let hidden = document.visibilityState === "hidden";
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") hidden = true;
  else if (hidden) {
    hidden = false;
    changed();
  }
});
window.addEventListener("pagehide", () => {
  channel?.close();
  channel = undefined;
});
window.addEventListener("pageshow", (event) => {
  connect();
  if (event.persisted) changed();
});
connect();
