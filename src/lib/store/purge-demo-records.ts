import {
  DEMO_CONVERSATION_IDS,
  DEMO_FORM_TEMPLATE_IDS,
  DEMO_GENERATED_FORM_IDS,
} from "./demo-record-ids";

/**
 * ============================================================================
 * SEEDED RECORDS THAT ARE ALREADY IN SOMEBODY'S BROWSER
 * ============================================================================
 *
 * Turning the seeds off stops NEW browsers being given demo content. It does
 * nothing for the ones that already have it, and that is most of them: the
 * store wrote its seeded state into IndexedDB on first load, unguarded, so a
 * real manager's machine holds two invented conversations and a dozen invented
 * coaching records right now. On their next visit the hydration path reads
 * those back — `if (stored.length > 0) setX(stored)` — and the demo content
 * returns, sourced from their own disk, indistinguishable from work they did.
 *
 * So the seeds have to be removed, once, from the stores that already hold
 * them.
 *
 * ============================================================================
 * IT DELETES BY EXACT ID AND BY NOTHING ELSE
 * ============================================================================
 *
 * This is the only destructive operation in the app that runs without anybody
 * asking for it, so the matching rule is the whole design:
 *
 *   IT MATCHES EXACT IDS FROM A FIXED LIST. Not a regex, not a prefix, not a
 *   shape. The list lives in `demo-record-ids.ts` — ids and nothing else, so
 *   the cleanup can run on a live deployment without that deployment shipping
 *   the seeded RECORDS — and `demo-record-ids.test.ts` pins it to the seeds
 *   themselves, so it cannot drift from what was actually shipped.
 *
 *   NOTHING ELSE IS EXAMINED. Not titles, not employee names, not timestamps,
 *   not "looks seeded". A real conversation that happens to be about Daily
 *   Stats, or a real coaching record for somebody with the same name as a
 *   seeded one, is untouched — because the only question asked is whether the
 *   id is in the shipped set.
 *
 * COLLISION IS STRUCTURALLY IMPOSSIBLE, which is what makes the above safe
 * rather than merely careful. Every seeded id is hyphenated and hand-written —
 * `conv-seed-1`, `form-2041`, `tpl-coaching`. Every record a user creates is
 * named by `createId(prefix)`, which joins with an UNDERSCORE and appends a
 * timestamp and a random suffix: `conv_m1x2y3abc123`. No value produced by
 * `createId` can equal a seeded id, so no real record can be caught by this.
 * `purge-demo-records.test.ts` asserts that property against both sets rather
 * than trusting the observation.
 *
 * ============================================================================
 * IT RUNS IN LIVE MODE ONLY, AND IT IS NOT A RESET
 * ============================================================================
 *
 * In demo mode the seeds are the point and this never runs. In live mode it
 * removes the seeded rows and LEAVES EVERYTHING ELSE, which is the difference
 * between this and `resetDemoData()`: that one is a deliberate wipe somebody
 * clicks, this one takes the fabricated records out from around real work that
 * has to survive.
 *
 * IT IS IDEMPOTENT AND CHEAP. A store with no seeded ids in it is not written
 * to at all — the pass is a read and a comparison — so this costs one list per
 * collection on every load and a write only on the first one that finds
 * anything.
 *
 * IT NEVER THROWS. A browser with storage blocked, a private window, a quota
 * error: the purge reports what it managed and the app carries on. Failing to
 * clean up must not cost somebody their session.
 */

/** A collection this purge knows how to clean, and the ids to remove from it. */
export interface PurgeTarget {
  readonly collection: "chat_conversations" | "generated_forms" | "form_templates";
  readonly ids: ReadonlySet<string>;
}

/**
 * The seeded ids, per collection.
 *
 * READ FROM `demo-record-ids.ts`, NOT FROM THE DEMO MODULES. This runs on a
 * live deployment, and a live bundle no longer imports `data/demo/*` — that
 * is the point of the split. So the ids live in a module that carries ids and
 * nothing else, and a test pins them to the seeds they came from.
 *
 * `knowledge_documents` and `videos` are no longer listed. Both were always
 * `DEMO_MODE`-guarded on the write side, so no correctly-behaving browser
 * holds them, and listing them here would mean shipping two more id lists to
 * clean up something nothing ever wrote.
 *
 * `permission_matrix` and `app_state` are absent on purpose: they hold a
 * keyed value and local UI state, not seeded records, and there is nothing in
 * either that belongs to a fabricated person.
 */
export function demoRecordIds(): PurgeTarget[] {
  return [
    { collection: "chat_conversations", ids: new Set(DEMO_CONVERSATION_IDS) },
    { collection: "generated_forms", ids: new Set(DEMO_GENERATED_FORM_IDS) },
    { collection: "form_templates", ids: new Set(DEMO_FORM_TEMPLATE_IDS) },
  ];
}

/** What a purge pass did, per collection. Empty when nothing was seeded. */
export interface PurgeReport {
  /** Ids actually removed, by collection. Collections with none are absent. */
  readonly removed: Readonly<Record<string, readonly string[]>>;
  /** True when anything at all was removed. */
  readonly changed: boolean;
}

/**
 * The minimum a store must offer for the purge to run against it.
 *
 * Narrower than `StorageProvider` so a test can supply a plain object and so
 * this module cannot reach for a capability it has no business using — there
 * is no `clearAll` here, and there will not be.
 */
export interface PurgeableStore {
  list<T>(collection: PurgeTarget["collection"]): Promise<T[]>;
  replace<T extends { id: string }>(
    collection: PurgeTarget["collection"],
    records: T[],
  ): Promise<void>;
}

/**
 * Remove the seeded records from a store, leaving everything else.
 *
 * Returns what it removed so the caller can drop the same ids from the state
 * it is holding in memory — the store and the React state have to agree, or
 * the purge is undone by the next persist effect writing the old array back.
 */
export async function purgeDemoRecords(
  store: PurgeableStore,
): Promise<PurgeReport> {
  const removed: Record<string, string[]> = {};

  for (const target of demoRecordIds()) {
    if (target.ids.size === 0) continue;
    try {
      const stored = await store.list<{ id: string }>(target.collection);
      const seeded = stored.filter((record) => target.ids.has(record.id));
      /*
       * NOTHING SEEDED, NOTHING WRITTEN. The common case by far once this has
       * run one time, and `replace` on an unchanged collection would be a
       * pointless write on every page load for the life of the app.
       */
      if (seeded.length === 0) continue;

      await store.replace(
        target.collection,
        stored.filter((record) => !target.ids.has(record.id)),
      );
      removed[target.collection] = seeded.map((record) => record.id);
    } catch {
      /*
       * One collection failing does not stop the others. A blocked store or a
       * quota error means the seeded rows stay for now and the next load tries
       * again; it must never propagate and cost the caller its hydration.
       */
      continue;
    }
  }

  return { removed, changed: Object.keys(removed).length > 0 };
}

/** Whether an id is one of the shipped seeded records, for any collection. */
export function isDemoRecordId(id: string): boolean {
  return demoRecordIds().some((target) => target.ids.has(id));
}

/** The same filter the purge applies, for state held in memory. */
export function withoutDemoRecords<T extends { id: string }>(
  records: readonly T[],
): T[] {
  return records.filter((record) => !isDemoRecordId(record.id));
}
