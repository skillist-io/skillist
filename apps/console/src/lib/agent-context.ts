import { useRouterState } from "@tanstack/react-router";
import { useBreadcrumbs } from "./breadcrumbs";

/**
 * What the agent is told about where the user is standing.
 *
 * Deliberately small: the page, the entities named in the URL, and nothing
 * else. It costs no extra fetch, and it is the difference between "what's
 * drifting?" being answerable and being a guess.
 *
 * On-screen numbers are *not* included. Routes would each have to publish their
 * own state, and a stale or half-loaded readout in the prompt is worse than no
 * readout — the agent has tools and should call them for live values.
 */
export type AgentContext = {
  /** Human label for the current page, e.g. "Coverage". */
  page: string;
  pathname: string;
  /** Org in the URL, when the route names one. */
  orgId?: string;
  /** `{org}/{repo}` when on a skill route. */
  skillRef?: string;
  projectId?: string;
};

export function useAgentContext(): AgentContext {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const crumbs = useBreadcrumbs();
  const segments = pathname.split("/").filter(Boolean);

  const page = crumbs.at(-1)?.label ?? "Console";
  const context: AgentContext = { page, pathname };

  if (segments[0] === "orgs" && segments[1]) {
    context.orgId = segments[1];
    if (segments[2] === "skills" && segments[3]) {
      context.skillRef = `${segments[1]}/${segments[3]}`;
    }
    if (segments[2] === "projects" && segments[3]) {
      context.projectId = segments[3];
    }
  }

  return context;
}

/** Short label for the context chip in the composer. */
export function describeContext(context: AgentContext): string {
  if (context.skillRef) return `${context.page} · ${context.skillRef}`;
  return context.page;
}

/**
 * The line prepended to a message when context is attached.
 *
 * It is plain readable text, and the UI renders it back to the user as a chip
 * on their own message — so what the agent receives is exactly what the sender
 * can see. No hidden preamble.
 */
export const CONTEXT_PREFIX = "[context]";

export function formatContext(context: AgentContext): string {
  const parts = [`page: ${context.page}`, `path: ${context.pathname}`];
  if (context.orgId) parts.push(`org: ${context.orgId}`);
  if (context.skillRef) parts.push(`skill: ${context.skillRef}`);
  if (context.projectId) parts.push(`project: ${context.projectId}`);
  return `${CONTEXT_PREFIX} ${parts.join(", ")}`;
}

/**
 * Splits a stored message back into its context line and the text the user
 * actually typed, so the transcript can render them differently.
 */
export function splitContext(text: string): { context: string | null; body: string } {
  if (!text.startsWith(CONTEXT_PREFIX)) return { context: null, body: text };
  const newline = text.indexOf("\n");
  if (newline === -1) return { context: text.slice(CONTEXT_PREFIX.length).trim(), body: "" };
  return {
    context: text.slice(CONTEXT_PREFIX.length, newline).trim(),
    body: text.slice(newline + 1).trimStart(),
  };
}
