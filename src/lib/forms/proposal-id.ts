/**
 * A chat card's id as the browser sends it: opaque, short, URL-safe. The
 * server only ever compares it for equality with an id it recorded itself, so
 * anything else is treated as no id at all.
 */
export function isProposalId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}
