import type { APIRoute } from "astro";
import { findSession, isCode, normaliseCode } from "../../../lib/board.ts";
import { pageMark, SIGNIN_COOKIE, tokenHash } from "../../../lib/accounts.ts";
import { asEvent, board, here, listen } from "../../../lib/live.ts";
import { connections, networkAddress } from "../../../lib/limits.ts";
import { tutorialFor } from "../../../lib/tutorial.ts";

// The live stream of one session, as server-sent events. It opens with the
// current state and sends the state again after every change. A comment line
// goes out now and then so Fly's proxy doesn't close a quiet connection.
const BEAT_MS = 20_000;

// A HEAD request gets the stream's headers and nothing else: no place in the
// room and none of the allowance. Without this, Astro runs GET for it and
// drops the body without closing the stream, so the place is never given back.
export const HEAD: APIRoute = ({ params }) => {
  const code = normaliseCode(params.code ?? "");
  const session = isCode(code) ? findSession(code) : undefined;
  if (!session) return new Response(null, { status: 404 });
  return new Response(null, { status: 200, headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform" } });
};

export const GET: APIRoute = (context) => {
  const { params, request, url, locals, cookies } = context;
  const code = normaliseCode(params.code ?? "");
  const session = isCode(code) ? findSession(code) : undefined;
  if (!session) {
    locals.log("refused", { action: "stream", reason: "no-such-session" });
    return new Response("No such session.\n", { status: 404 });
  }

  // The account's tabs share one allowance, including its projector tabs.
  // The whole process also has a ceiling, even when browsers change ids.
  const limits = [{ key: "streams:anywhere", max: 2000 }];
  if (locals.account) limits.push({ key: `streams:account:${locals.account.id}`, max: 10 });
  else {
    limits.push({ key: `streams:browser:${locals.browser}`, max: 20 });
    const network = networkAddress(request, () => context.clientAddress);
    if (network !== null) limits.push({ key: `streams:network:${network}`, max: 1000 });
  }
  const release = connections.acquire(limits);
  if (!release) {
    locals.log("refused", { action: "stream", session: session.code, reason: "rate" });
    return new Response("Too many live pages are open. Close one and try again in a minute.\n", {
      status: 429,
      headers: { "retry-after": "60", "content-type": "text/plain; charset=utf-8" },
    });
  }

  const encoder = new TextEncoder();
  let leave = release;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      // the projector page asks with ?screen: it is not a person in the room
      const person = locals.account && !url.searchParams.has("screen") ? locals.person : null;
      const token = cookies.get(SIGNIN_COOKIE)?.value;
      const signIn = locals.account && token ? tokenHash(token) : undefined;
      const opened = Date.now();
      let stop: (() => void) | undefined;
      let beat: ReturnType<typeof setInterval> | undefined;
      let gone = false;
      const end = (): void => {
        leave();
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      leave = () => {
        if (gone) return;
        gone = true;
        clearInterval(beat);
        request.signal.removeEventListener("abort", end);
        release();
        if (stop) {
          stop();
          const stayed = `${Math.round((Date.now() - opened) / 1000)}s`;
          locals.log(person ? "session_left" : "screen_closed", { session: session.code, here: here(session.id), stayed });
        }
      };
      const send = (text: string): void => {
        if (gone) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          end();
        }
      };
      request.signal.addEventListener("abort", end, { once: true });
      if (request.signal.aborted) {
        end();
        return;
      }
      try {
        const questions = !(url.searchParams.has("screen") && tutorialFor(session.id));
        stop = listen(session.id, { person, send, signIn, end, questions });
        locals.log(person ? "session_joined" : "screen_opened", { session: session.code, here: here(session.id) });
        beat = setInterval(() => send(": still here\n\n"), BEAT_MS);
        // if the connection drops, the browser tries again after two seconds
        send("retry: 2000\n\n");
        // which sign-in this stream is for, as the page's own mark (src/layouts/Layout.astro),
        // so a page made for another account loads again; "-" when signed out
        send(`event: who\ndata: ${locals.account ? pageMark(locals.account) : "-"}\n\n`);
        if (!gone) send(asEvent(board(session.id)));
      } catch (error) {
        leave();
        throw error;
      }
    },
    cancel() {
      leave();
    },
  });

  return new Response(body, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
};
