import type { VideoCategory } from "@/types";

/**
 * ============================================================================
 * THE ONE RUNTIME CATEGORY VOCABULARY
 * ============================================================================
 *
 * Ids AND labels, in one product-level module that the live server route, the
 * live UI and the demo UI all read. There were two sources: this file held ids
 * for server validation while the dialog and the library read
 * `VIDEO_CATEGORIES` out of `@/data/demo/videos`. Two runtime lists of the same
 * vocabulary drift, and the drift is silent — a category added for the UI would
 * have been rejected by a server that never heard of it.
 *
 * A LIVE SERVER ROUTE MUST NOT DEPEND ON SEEDED DEMO RECORDS. The demo module's
 * job is to be replaceable; the category vocabulary is a product fact. So the
 * definition lives here and `@/data/demo/videos` re-exports it for the call
 * sites that already import from there.
 *
 * EXHAUSTIVENESS IS ENFORCED BY THE MAP, NOT BY `satisfies`.
 * `satisfies readonly VideoCategory[]` — what this file used before — proves
 * every LISTED id is a member of the union. It does NOT prove the list contains
 * every member, so dropping one would have compiled and quietly made that
 * category unselectable and un-postable. `Record<VideoCategory, string>` is the
 * construct that actually checks: TypeScript requires a key for every member of
 * the union, so a new category is a build error until it is labelled here.
 */
const CATEGORY_LABELS: Record<VideoCategory, string> = {
  sales: "Sales",
  leadership: "Leadership",
  equipment: "Equipment",
  cleaning: "Cleaning",
  troubleshooting: "Troubleshooting",
  operations: "Operations",
  training: "Training",
};

/**
 * Every category, in display order.
 *
 * Derived from the map rather than written out a second time — a hand-kept
 * parallel array is the same drift risk one file down.
 */
export const VIDEO_CATEGORIES: readonly { id: VideoCategory; label: string }[] =
  (Object.keys(CATEGORY_LABELS) as VideoCategory[]).map((id) => ({
    id,
    label: CATEGORY_LABELS[id],
  }));

export const VIDEO_CATEGORY_LABEL: Record<VideoCategory, string> = CATEGORY_LABELS;

export const VIDEO_CATEGORY_IDS: readonly VideoCategory[] = VIDEO_CATEGORIES.map(
  (entry) => entry.id,
);

/**
 * The runtime check a server route needs, since a type does not exist at
 * runtime.
 *
 * `Object.hasOwn`, NOT the `in` operator. `in` walks the prototype chain, so
 * `"toString" in CATEGORY_LABELS` and `"constructor" in CATEGORY_LABELS` are
 * both true — this function returned true for them, and a crafted request could
 * have persisted `category: "toString"`. Which is precisely the class of defect
 * the category allowlist exists to prevent, arriving through the allowlist
 * itself.
 */
export function isVideoCategory(value: unknown): value is VideoCategory {
  return typeof value === "string" && Object.hasOwn(CATEGORY_LABELS, value);
}
