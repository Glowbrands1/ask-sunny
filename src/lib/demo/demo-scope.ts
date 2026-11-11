import { PRODUCTION_SALONS } from "@/data/salons";

/**
 * WHOSE ROWS A DEMO ROLE SEES, decided in the browser.
 *
 * In a demo deployment the role switcher lives in the browser, and a server
 * page render does not know which role is being previewed. So demo screens
 * that should narrow to "my salon" or "my district" receive every seeded row
 * and narrow them here, against the previewed user's scope.
 *
 * The seeded DM and RM accounts carry invented area ids ("dist-1", "reg-a")
 * that are not production districts, so each demo district is read as one
 * production district. Regions and global accounts see every salon.
 *
 * Client-safe: the salon roster only, no seeded content.
 */
const DEMO_DISTRICT: Record<string, string> = {
  "dist-1": "dist-patterson-madeline",
  "dist-2": "dist-dugan-rachael",
  "dist-3": "dist-cotton-sarah",
};

/** The salon ids (`loc-0306`) a demo identity reads, or null for every salon. */
export function demoSalonScope(
  scope:
    | { level: string; primaryAreaId: string | null; alsoCoversAreaIds: readonly string[] }
    | null
    | undefined,
): string[] | null {
  if (!scope || scope.level === "global" || scope.level === "region") return null;
  const areas = [scope.primaryAreaId, ...scope.alsoCoversAreaIds].filter(
    (id): id is string => Boolean(id),
  );
  if (scope.level === "salon") return areas;
  const districts = new Set(areas.map((id) => DEMO_DISTRICT[id] ?? id));
  return PRODUCTION_SALONS.filter((salon) => districts.has(salon.districtId)).map((salon) => salon.id);
}
