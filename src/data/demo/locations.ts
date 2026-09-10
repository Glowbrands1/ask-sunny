import type { Location } from "@/types";

/**
 * THE DEMO SALON ROSTER, WHICH IS NOW THE REAL ONE.
 *
 * It used to be twelve invented stores in Kentucky, Indiana and Tennessee
 * ("Riverbend Commons", "Hillcrest Station" and so on). That was a problem the
 * Google Reviews screen had already written down in its own header comment:
 * this file and Reporting were built on different rosters — twelve salons here,
 * fifteen there, no location in common — so a District Manager reading both
 * screens saw two different companies.
 *
 * The fifteen salons below are the estate Reporting already ingests, with the
 * same salon numbers, the same store names and the same three districts. A name
 * on the Reviews leaderboard is now a name that also appears in Salon
 * Performance, and "across 15 salons" means the same fifteen on both screens.
 *
 * WHAT IS STILL DEMO CONTENT. The names and numbers here are real; every metric
 * attached to them elsewhere in `src/data/demo` is not. Seeded review counts,
 * revenue, coaching forms and employee names remain invented, and each of those
 * files still says so. Only the roster changed.
 *
 * IDs ARE THE SALON NUMBER (`loc-0306`), not a sequence. The old `loc-101`
 * sequence carried no information and meant a reference had to be looked up to
 * know which salon it named.
 */
export const DEMO_LOCATIONS: Location[] = [
  /* ---------------------------------------- District 1 — Omaha & St Joseph -- */
  {
    id: "loc-0313",
    name: "NE Omaha 132nd and Maple",
    city: "Omaha",
    state: "NE",
    districtId: "dist-1",
    districtName: "District 1 — Omaha & St Joseph",
    regionId: "reg-a",
    regionName: "Region A — Nebraska & Northwest Missouri",
  },
  {
    id: "loc-0314",
    name: "NE Omaha 144th and Center",
    city: "Omaha",
    state: "NE",
    districtId: "dist-1",
    districtName: "District 1 — Omaha & St Joseph",
    regionId: "reg-a",
    regionName: "Region A — Nebraska & Northwest Missouri",
  },
  {
    id: "loc-0410",
    name: "NE Omaha Pacific",
    city: "Omaha",
    state: "NE",
    districtId: "dist-1",
    districtName: "District 1 — Omaha & St Joseph",
    regionId: "reg-a",
    regionName: "Region A — Nebraska & Northwest Missouri",
  },
  {
    id: "loc-0495",
    name: "MO St Joseph",
    city: "St Joseph",
    state: "MO",
    districtId: "dist-1",
    districtName: "District 1 — Omaha & St Joseph",
    regionId: "reg-a",
    regionName: "Region A — Nebraska & Northwest Missouri",
  },
  /* ------------------------------- District 2 — Lincoln & Central Nebraska -- */
  {
    id: "loc-0307",
    name: "NE Grand Island",
    city: "Grand Island",
    state: "NE",
    districtId: "dist-2",
    districtName: "District 2 — Lincoln & Central Nebraska",
    regionId: "reg-a",
    regionName: "Region A — Nebraska & Northwest Missouri",
  },
  {
    id: "loc-0309",
    name: "NE Kearney",
    city: "Kearney",
    state: "NE",
    districtId: "dist-2",
    districtName: "District 2 — Lincoln & Central Nebraska",
    regionId: "reg-a",
    regionName: "Region A — Nebraska & Northwest Missouri",
  },
  {
    id: "loc-0310",
    name: "NE Lincoln 27th Street",
    city: "Lincoln",
    state: "NE",
    districtId: "dist-2",
    districtName: "District 2 — Lincoln & Central Nebraska",
    regionId: "reg-a",
    regionName: "Region A — Nebraska & Northwest Missouri",
  },
  {
    id: "loc-0311",
    name: "NE Lincoln O Street",
    city: "Lincoln",
    state: "NE",
    districtId: "dist-2",
    districtName: "District 2 — Lincoln & Central Nebraska",
    regionId: "reg-a",
    regionName: "Region A — Nebraska & Northwest Missouri",
  },
  {
    id: "loc-0312",
    name: "NE Lincoln Pine Lake",
    city: "Lincoln",
    state: "NE",
    districtId: "dist-2",
    districtName: "District 2 — Lincoln & Central Nebraska",
    regionId: "reg-a",
    regionName: "Region A — Nebraska & Northwest Missouri",
  },
  /* --------------------------------- District 3 — Kansas & Kansas City, MO -- */
  {
    id: "loc-0306",
    name: "MO Kansas City Wornall",
    city: "Kansas City",
    state: "MO",
    districtId: "dist-3",
    districtName: "District 3 — Kansas & Kansas City",
    regionId: "reg-b",
    regionName: "Region B — Kansas & Kansas City",
  },
  {
    id: "loc-0394",
    name: "MO Kansas City Liberty",
    city: "Liberty",
    state: "MO",
    districtId: "dist-3",
    districtName: "District 3 — Kansas & Kansas City",
    regionId: "reg-b",
    regionName: "Region B — Kansas & Kansas City",
  },
  {
    id: "loc-0462",
    name: "KS Manhattan",
    city: "Manhattan",
    state: "KS",
    districtId: "dist-3",
    districtName: "District 3 — Kansas & Kansas City",
    regionId: "reg-b",
    regionName: "Region B — Kansas & Kansas City",
  },
  {
    id: "loc-0463",
    name: "KS Shawnee Mission Pkwy",
    city: "Shawnee",
    state: "KS",
    districtId: "dist-3",
    districtName: "District 3 — Kansas & Kansas City",
    regionId: "reg-b",
    regionName: "Region B — Kansas & Kansas City",
  },
  {
    id: "loc-0468",
    name: "KS Lawrence",
    city: "Lawrence",
    state: "KS",
    districtId: "dist-3",
    districtName: "District 3 — Kansas & Kansas City",
    regionId: "reg-b",
    regionName: "Region B — Kansas & Kansas City",
  },
  {
    id: "loc-0476",
    name: "KS Overland Park",
    city: "Overland Park",
    state: "KS",
    districtId: "dist-3",
    districtName: "District 3 — Kansas & Kansas City",
    regionId: "reg-b",
    regionName: "Region B — Kansas & Kansas City",
  },
];

/**
 * Three districts, not four.
 *
 * Reporting's own ingested estate splits these fifteen salons three ways, and a
 * fourth district here would be a district with nothing in it.
 */
export const DEMO_DISTRICTS = [
  { id: "dist-1", name: "District 1 — Omaha & St Joseph", regionId: "reg-a" },
  { id: "dist-2", name: "District 2 — Lincoln & Central Nebraska", regionId: "reg-a" },
  { id: "dist-3", name: "District 3 — Kansas & Kansas City", regionId: "reg-b" },
];

export const DEMO_REGIONS = [
  { id: "reg-a", name: "Region A — Nebraska & Northwest Missouri" },
  { id: "reg-b", name: "Region B — Kansas & Kansas City" },
];

export function locationById(id: string): Location | undefined {
  return DEMO_LOCATIONS.find((location) => location.id === id);
}

export function areaLabel(areaId: string | null): string {
  if (!areaId) return "All areas";
  const location = DEMO_LOCATIONS.find((entry) => entry.id === areaId);
  if (location) return location.name;
  const district = DEMO_DISTRICTS.find((entry) => entry.id === areaId);
  if (district) return district.name;
  const region = DEMO_REGIONS.find((entry) => entry.id === areaId);
  if (region) return region.name;
  return areaId;
}
