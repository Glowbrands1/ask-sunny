import type { VideoCategory } from "@/types";

/**
 * THE CANONICAL VIDEO CATEGORIES, as data rather than as a TypeScript union.
 *
 * `VideoCategory` is a type, and a type does not exist at runtime — so a server
 * route cannot check a request against it. That gap is exactly how
 * `parseCreateRequest` came to accept any non-empty string: it validated the
 * SHAPE of the field and nothing about its value, so a crafted request could
 * persist `category: "made_up_category"` and the library would then render a
 * record whose category no filter matches and no label exists for.
 *
 * WHY NOT IMPORT `VIDEO_CATEGORIES` FROM `@/data/demo/videos`. The vocabulary
 * is a product fact, not seeded content, and a server route reaching into the
 * demo data module to validate a live request would tie live behaviour to a
 * file whose whole purpose is to be replaceable. The list lives here; the demo
 * module keeps the labels it needs for presentation.
 *
 * `satisfies` is what keeps the two in agreement: adding a member to the
 * `VideoCategory` union without adding it here is a type error at build time.
 */
export const VIDEO_CATEGORY_IDS = [
  "sales",
  "leadership",
  "equipment",
  "cleaning",
  "troubleshooting",
  "operations",
  "training",
] as const satisfies readonly VideoCategory[];

export function isVideoCategory(value: unknown): value is VideoCategory {
  return (
    typeof value === "string" &&
    (VIDEO_CATEGORY_IDS as readonly string[]).includes(value)
  );
}
