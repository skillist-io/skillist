/**
 * Composite Durable-Object instance-name scheme for the platform agent.
 *
 * The client addresses a conversation by `orgId::chatId` (see the web
 * `useAgent({ name })`). The Worker gate (src/index.ts) rewrites that segment to
 * `orgId::userId::chatId` — injecting the SESSION-verified userId the client
 * never supplies — before `routeAgentRequest` resolves the DO. So the DO
 * instance name a `SkillistAgent` sees is always the three-part form, and a
 * user can only ever reach their own chats because the userId comes from their
 * session, not the URL.
 */
export const AGENT_NAME_SEPARATOR = "::";

export type ParsedAgentName = {
  orgId: string;
  userId: string | null;
  chatId: string | null;
};

/**
 * Parse a DO instance name into its parts. The canonical (post-gate) form is
 * `orgId::userId::chatId`; the two-part `orgId::chatId` form (a value that has
 * not been through the gate) and the bare `orgId` form are tolerated so an
 * orgId is always recoverable. orgId/userId are opaque ids without `::`, so the
 * split is unambiguous.
 */
export function parseAgentName(name: string | null | undefined): ParsedAgentName {
  const parts = (name ?? "").split(AGENT_NAME_SEPARATOR);
  if (parts.length >= 3) {
    return {
      orgId: parts[0] ?? "",
      userId: parts[1] || null,
      chatId: parts.slice(2).join(AGENT_NAME_SEPARATOR) || null,
    };
  }
  if (parts.length === 2) {
    return { orgId: parts[0] ?? "", userId: null, chatId: parts[1] || null };
  }
  return { orgId: parts[0] ?? "", userId: null, chatId: null };
}

/** Compose the server-side DO instance name from its parts. */
export function composeAgentName(orgId: string, userId: string, chatId: string): string {
  return [orgId, userId, chatId].join(AGENT_NAME_SEPARATOR);
}

/**
 * Split the client-supplied instance segment `orgId::chatId`. The userId is
 * never present here — the gate injects it from the session. A bare `orgId`
 * (no `::`) yields a null chatId.
 */
export function parseClientInstance(segment: string): { orgId: string; chatId: string | null } {
  const idx = segment.indexOf(AGENT_NAME_SEPARATOR);
  if (idx === -1) return { orgId: segment, chatId: null };
  return {
    orgId: segment.slice(0, idx),
    chatId: segment.slice(idx + AGENT_NAME_SEPARATOR.length) || null,
  };
}

/**
 * True when an assistant turn is the FIRST one and the chat has no title yet —
 * the moment to generate a sidebar title. Extracted so the trigger is unit
 * testable without standing up a Durable Object.
 */
export function shouldGenerateTitle(userMessageCount: number, hasTitle: boolean): boolean {
  return userMessageCount <= 1 && !hasTitle;
}
