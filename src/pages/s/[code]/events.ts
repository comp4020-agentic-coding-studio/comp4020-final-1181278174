import type { APIRoute } from "astro";
import { findSession, isCode, normaliseCode } from "../../../lib/board.ts";
import { asEvent, board, listen } from "../../../lib/live.ts";

// The live stream of one session, as server-sent events. It opens with the
// current state and sends the state again after every change. A comment line
// goes out now and then so Fly's proxy doesn't close a quiet connection.
const BEAT_MS = 20_000;

export const GET: APIRoute = ({ params, request, url, locals }) => {
  const code = normaliseCode(params.code ?? "");
  const session = isCode(code) ? findSession(code) : undefined;
  if (!session) return new Response("No such session.\n", { status: 404 });

  const encoder = new TextEncoder();
  let leave = (): void => {};
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (text: string): void => {
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          leave();
        }
      };
      // the projector page asks with ?screen: it is not a person in the room
      const person = url.searchParams.has("screen") ? null : locals.person;
      const stop = listen(session.id, { person, send });
      const beat = setInterval(() => send(": still here\n\n"), BEAT_MS);
      leave = () => {
        clearInterval(beat);
        stop();
      };
      request.signal.addEventListener("abort", () => {
        leave();
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
      // if the connection drops, the browser tries again after two seconds
      send("retry: 2000\n\n");
      send(asEvent(board(session.id)));
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
