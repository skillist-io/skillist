/**
 * Regex-based PII redaction for the platform agent. Lightweight and
 * conservative — it records a COUNT of redactions (for the audit log), not
 * stable hashes.
 *
 * Applied before persisting to the agent's durable memory (`agent_memory`) so a
 * user can't accidentally save an email/phone/SSN/card into long-term store,
 * and can be reused wherever the agent's text is surfaced to others.
 *
 * Pattern order matters: the specific SSN/phone shapes run BEFORE the loose
 * credit-card matcher (a 13-19 digit run) so they're tokenized on their own
 * terms rather than being swallowed by the card pattern.
 */
const PATTERNS: Array<{ name: string; rx: RegExp; replacement: string }> = [
  {
    name: "email",
    rx: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
    replacement: "[email]",
  },
  {
    name: "ssn",
    rx: /\b\d{3}-\d{2}-\d{4}\b/g,
    replacement: "[ssn]",
  },
  {
    // Conservative US-ish phone shapes (555-555-5555, (555) 555-5555,
    // +1 555-555-5555). Won't catch every international format — a deliberate
    // tradeoff for fewer false positives.
    name: "phone",
    rx: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    replacement: "[phone]",
  },
  {
    // 13-19 digit runs with optional spaces/dashes. Loose by design; a false
    // positive is harmless since the replacement is benign.
    name: "credit_card",
    rx: /\b(?:\d[ -]*?){13,19}\b/g,
    replacement: "[card]",
  },
];

export type RedactionMatch = { name: string; count: number };
export type RedactionResult = { text: string; matches: RedactionMatch[] };

/**
 * Replace PII in `input` with placeholder tokens. Returns the cleaned text plus
 * a tally of how many of each pattern was redacted, so the caller can emit an
 * audit event or warn the user.
 */
export function redactPII(input: string): RedactionResult {
  if (!input || typeof input !== "string") {
    return { text: input ?? "", matches: [] };
  }
  let text = input;
  const matches: RedactionMatch[] = [];
  for (const { name, rx, replacement } of PATTERNS) {
    let count = 0;
    text = text.replace(rx, () => {
      count++;
      return replacement;
    });
    if (count > 0) matches.push({ name, count });
  }
  return { text, matches };
}
