/**
 * ============================================================================
 * ONE EDITION OF A FILE
 * ============================================================================
 *
 * Two Woven records can be the same file. The 2025 JBA Policy Manual is in
 * the library twice, byte for byte: `ce6b00f1` is the copy that stays, and
 * `5c626f3c` is the duplicate. A later sync must not put the duplicate back
 * into search.
 *
 * Dedupe is by file hash (the SHA-256 the sync stores on the manifest). When
 * several items share a hash, the one with the newest Woven updated date
 * stays. The others stay superseded. A superseded document is never chosen
 * again, even when its updated date is later than the copy that is current.
 */

export interface HashEdition {
  /** Ask Sunny knowledge document id. */
  id: string;
  /** File hash. An empty hash is not a group. */
  contentHash: string | null;
  /** Woven's updated date, ISO when the source gave one. */
  sourceUpdatedAt: string | null;
  /** Already superseded. Never the copy that stays, and never brought back. */
  superseded: boolean;
}

export interface KeptEdition {
  hash: string;
  keepId: string;
  /** Document ids that stay superseded, or become superseded, by `keepId`. */
  supersede: string[];
}

function updatedTime(value: string | null): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

/**
 * Groups editions that share a file hash. The newest Woven updated date
 * stays, unless that copy is already superseded — a superseded copy is not
 * brought back. A date tie keeps the lower document id.
 */
export function planHashDedupe(editions: readonly HashEdition[]): KeptEdition[] {
  const groups = new Map<string, HashEdition[]>();
  for (const edition of editions) {
    const hash = edition.contentHash?.trim() ?? "";
    if (!edition.id || hash === "") continue;
    const group = groups.get(hash) ?? [];
    if (!group.some((row) => row.id === edition.id)) group.push(edition);
    groups.set(hash, group);
  }

  const plans: KeptEdition[] = [];
  for (const [hash, group] of groups) {
    if (group.length < 2) continue;
    const active = group.filter((edition) => !edition.superseded);
    if (active.length === 0) continue;
    const keep = [...active].sort((a, b) => {
      const delta = updatedTime(b.sourceUpdatedAt) - updatedTime(a.sourceUpdatedAt);
      if (delta !== 0) return delta;
      return a.id.localeCompare(b.id);
    })[0]!;
    const supersede = group.filter((edition) => edition.id !== keep.id).map((edition) => edition.id);
    if (supersede.length === 0) continue;
    plans.push({ hash, keepId: keep.id, supersede });
  }
  return plans;
}
