import { AGENT_DRAFT_PREFIX } from "@skillist/ui";
import { useCallback, useState } from "react";

function read(key: string): string {
  try {
    return window.sessionStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function write(key: string, value: string): void {
  try {
    if (value) window.sessionStorage.setItem(key, value);
    else window.sessionStorage.removeItem(key);
  } catch {
    /* Full or unavailable: the draft still lives in component state. */
  }
}

/**
 * The composer's unsent text, kept outside the transcript component so it outlives
 * closing the drawer, switching chats, and reloading.
 *
 * Keyed per org rather than per chat on purpose. New chat mints an id that never
 * reaches the history list until something is sent, so a draft keyed to it would
 * be stranded with no way back. One draft per org can't be lost, and it stays
 * visible in the composer wherever the person goes.
 *
 * sessionStorage rather than localStorage: drafts are often pasted logs that can
 * hold secrets, so they end with the tab and are purged on sign-out.
 */
export function useAgentDraft(orgId: string) {
  const key = `${AGENT_DRAFT_PREFIX}${orgId}`;
  const [draft, setState] = useState(() => read(key));
  const setDraft = useCallback(
    (value: string) => {
      setState(value);
      write(key, value);
    },
    [key],
  );
  return [draft, setDraft] as const;
}
