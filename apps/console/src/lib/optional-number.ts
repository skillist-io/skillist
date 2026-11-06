/**
 * Reads a number field where blank means "not set". A plain Number() turns blank
 * into 0, and for a policy threshold 0 is a real value that switches the rule on.
 */
export function parseOptionalNumber(value: string): number | undefined {
  return value.trim() === "" ? undefined : Number(value);
}
