/**
 * Whether a typed confirmation authorises account deletion.
 *
 * Extracted so the gate is testable: this is the only thing standing between a
 * misclick and an irreversible cascade across sessions, OAuth links, passkeys,
 * org memberships, and any org the user is the sole member of.
 *
 * Case-insensitive and whitespace-trimmed, because requiring someone to match
 * the casing of their own email address is friction that teaches nothing — the
 * point is deliberate intent, not transcription accuracy. An empty account
 * email never confirms, so a session that has not loaded yet cannot arm the
 * button.
 */
export function confirmsAccountDeletion(typed: string, accountEmail: string): boolean {
  const email = accountEmail.trim().toLowerCase();
  if (!email) return false;
  return typed.trim().toLowerCase() === email;
}
