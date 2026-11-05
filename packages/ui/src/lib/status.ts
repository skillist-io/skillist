import { useSyncExternalStore } from "react";

export type StatusKind = "success" | "error" | "info";

export type StatusMessage = {
  id: number;
  kind: StatusKind;
  text: string;
};

/**
 * Successes clear themselves because the page already shows the new state.
 * Errors stay until dismissed: a failure that times out while someone is
 * looking elsewhere is the silent failure this store exists to prevent, and
 * WCAG 2.2.1 rules out a timer on anything the reader still has to act on.
 */
const AUTO_DISMISS_MS = 6000;

let messages: StatusMessage[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function dismissStatus(id: number): void {
  messages = messages.filter((message) => message.id !== id);
  emit();
}

/**
 * Report the outcome of an action. A plain module store rather than context so
 * the query client, which is created outside React, can report too.
 */
export function notify(kind: StatusKind, text: string): void {
  // A retry that fails the same way shouldn't stack identical rows.
  if (messages.some((message) => message.kind === kind && message.text === text)) return;
  const id = nextId++;
  messages = [...messages, { id, kind, text }];
  emit();
  if (kind !== "error") setTimeout(() => dismissStatus(id), AUTO_DISMISS_MS);
}

export function getStatusMessages(): StatusMessage[] {
  return messages;
}

export function useStatusMessages(): StatusMessage[] {
  return useSyncExternalStore(subscribe, getStatusMessages, getStatusMessages);
}
