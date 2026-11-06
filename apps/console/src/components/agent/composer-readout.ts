export type ConnState = "connecting" | "connected" | "disconnected";

/** Below this a paste is ordinary typing, and a size readout would only be noise. */
const LONG_LINES = 20;
const LONG_CHARS = 2000;

function size(text: string): string | null {
  const lines = text.split("\n").length;
  if (lines < LONG_LINES && text.length < LONG_CHARS) return null;
  const chars =
    text.length >= 1000 ? `${Math.round(text.length / 1000)}k chars` : `${text.length} chars`;
  return `${lines} ${lines === 1 ? "line" : "lines"} · ${chars}`;
}

/**
 * The one line under the field: what Enter will do right now, and why not when it
 * won't. Pure, so every state is testable without a socket.
 */
export function composerReadout({
  connState,
  terminal,
  busy,
  held,
  text,
  touch = false,
  waiting = 0,
}: {
  connState: ConnState;
  /** The connection was refused and won't come back on its own. */
  terminal: boolean;
  busy: boolean;
  /** Enter was pressed during a reply, so the text is waiting. */
  held: boolean;
  text: string;
  /** No Shift key to speak of, so the keyboard hint has to say something else. */
  touch?: boolean;
  /** Decisions waiting in this conversation. */
  waiting?: number;
}): string {
  const measured = size(text);
  const withSize = (line: string) => (measured ? `${measured} · ${line}` : line);

  if (terminal) return withSize("Disconnected · your draft is kept");
  if (connState !== "connected") return withSize("Reconnecting · keep typing");
  if (held) return withSize("Not sent · send again when the reply ends · Esc to stop");
  if (busy) return withSize("Replying · Esc to stop");
  if (waiting > 0 && !touch) return withSize(`${waiting} waiting · ⌥A to review · Enter send`);
  return withSize(touch ? "Return sends" : "Enter send · Shift+Enter new line");
}
