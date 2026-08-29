/**
 * Client-side id generation for prototype records.
 *
 * Only ever called from event handlers / effects (never during render), so it
 * cannot introduce a server-client hydration mismatch.
 */
let counter = 0;

export function createId(prefix: string): string {
  counter += 1;
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${random}`;
}
