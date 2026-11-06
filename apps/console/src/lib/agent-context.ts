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
  /** The open tab on a skill route, from the URL. "Why did this regress?" needs it. */
  tab?: string;
  projectId?: string;
};

export function useAgentContext(): AgentContext {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const search = useRouterState({ select: (s) => s.location.search as { tab?: unknown } });
  const crumbs = useBreadcrumbs();
  const segments = pathname.split("/").filter(Boolean);

  const page = crumbs.at(-1)?.label ?? "Console";
  const context: AgentContext = { page, pathname };

  if (segments[0] === "orgs" && segments[1]) {
    context.orgId = segments[1];
    if (segments[2] === "skills" && segments[3]) {
      context.skillRef = `${segments[1]}/${segments[3]}`;
      if (typeof search.tab === "string") context.tab = search.tab;
    }
    if (segments[2] === "projects" && segments[3]) {
      context.projectId = segments[3];
    }
  }

  return context;
}

/** Short label for the context chip in the composer. */
export function describeContext(context: AgentContext): string {
  if (!context.skillRef) return context.page;
  const tab = context.tab ? ` · ${capitalize(context.tab)}` : "";
  // On a skill page the ref starts with the org's UUID, which means nothing to
  // the reader, and what's left repeats the page name.
  const label = context.skillRef.replace(/^[0-9a-f]{8}-[0-9a-f-]{27}\//i, "");
  return `${label === context.page ? context.page : `${context.page} · ${label}`}${tab}`;
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * The line prepended to a message when context is attached.
 *
 * It is plain readable text, and the UI renders it back to the user as a chip
 * on their own message — so what the agent receives is exactly what the sender
 * can see. No hidden preamble.
 */
export const CONTEXT_PREFIX = "[context]";

/**
 * Marks a message that tells the agent a person approved a request. Same stance
 * as the context line: it travels in the message and is shown back to the sender.
 */
export const APPROVAL_PREFIX = "[approval]";

export function formatApproval(approvalId: string): string {
  return `${APPROVAL_PREFIX} id: ${approvalId}\nApproved. Run it.`;
}

export function formatContext(context: AgentContext): string {
  const parts = [`page: ${context.page}`, `path: ${context.pathname}`];
  if (context.orgId) parts.push(`org: ${context.orgId}`);
  if (context.skillRef) parts.push(`skill: ${context.skillRef}`);
  if (context.tab) parts.push(`tab: ${context.tab}`);
  if (context.projectId) parts.push(`project: ${context.projectId}`);
  return `${CONTEXT_PREFIX} ${parts.join(", ")}`;
}

/**
 * Splits a stored message back into its context line and the text the user
 * actually typed, so the transcript can render them differently.
 */
export function splitContext(text: string): { context: string | null; body: string } {
  const prefix = [CONTEXT_PREFIX, APPROVAL_PREFIX].find((p) => text.startsWith(p));
  if (!prefix) return { context: null, body: text };
  const newline = text.indexOf("\n");
  if (newline === -1) return { context: text.slice(prefix.length).trim(), body: "" };
  return {
    context: text.slice(prefix.length, newline).trim(),
    body: text.slice(newline + 1).trimStart(),
  };
}

/** The readable part of a stored context line: "page: Coverage, path: /x" → "Coverage". */
export function contextChip(context: string): string {
  const approval = context.match(/^id: (\S{1,8})/);
  if (approval) return `Approval ${approval[1]}`;
  const page = context.match(/^page: ([^,]+)/)?.[1]?.trim();
  const skill = context.match(/skill: [^/,]+\/([^,]+)/)?.[1]?.trim();
  if (!page) return context;
  const tab = context.match(/tab: ([^,]+)/)?.[1]?.trim();
  const label = skill && skill !== page ? `${page} · ${skill}` : page;
  return tab ? `${label} · ${capitalize(tab)}` : label;
}
