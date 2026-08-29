import type { Location } from "@/types";

/**
 * Demo salon locations. Fictional store names and demo metrics — nothing here
 * represents real Sun Tan City performance.
 */
export const DEMO_LOCATIONS: Location[] = [
  {
    id: "loc-101",
    name: "Riverbend Commons",
    city: "Bowling Green",
    state: "KY",
    districtId: "dist-1",
    districtName: "District 1 — South Central",
    regionId: "reg-a",
    regionName: "Region A",
  },
  {
    id: "loc-102",
    name: "Maple Crossing",
    city: "Bowling Green",
    state: "KY",
    districtId: "dist-1",
    districtName: "District 1 — South Central",
    regionId: "reg-a",
    regionName: "Region A",
  },
  {
    id: "loc-103",
    name: "Hillcrest Station",
    city: "Elizabethtown",
    state: "KY",
    districtId: "dist-1",
    districtName: "District 1 — South Central",
    regionId: "reg-a",
    regionName: "Region A",
  },
  {
    id: "loc-104",
    name: "Cedar Point Plaza",
    city: "Owensboro",
    state: "KY",
    districtId: "dist-2",
    districtName: "District 2 — Western",
    regionId: "reg-a",
    regionName: "Region A",
  },
  {
    id: "loc-105",
    name: "Northgate Square",
    city: "Evansville",
    state: "IN",
    districtId: "dist-2",
    districtName: "District 2 — Western",
    regionId: "reg-a",
    regionName: "Region A",
  },
  {
    id: "loc-106",
    name: "Willow Park",
    city: "Evansville",
    state: "IN",
    districtId: "dist-2",
    districtName: "District 2 — Western",
    regionId: "reg-a",
    regionName: "Region A",
  },
  {
    id: "loc-107",
    name: "Stonebridge Market",
    city: "Clarksville",
    state: "TN",
    districtId: "dist-3",
    districtName: "District 3 — Mid-South",
    regionId: "reg-b",
    regionName: "Region B",
  },
  {
    id: "loc-108",
    name: "Harborview Landing",
    city: "Nashville",
    state: "TN",
    districtId: "dist-3",
    districtName: "District 3 — Mid-South",
    regionId: "reg-b",
    regionName: "Region B",
  },
  {
    id: "loc-109",
    name: "Sandalwood Corner",
    city: "Murfreesboro",
    state: "TN",
    districtId: "dist-3",
    districtName: "District 3 — Mid-South",
    regionId: "reg-b",
    regionName: "Region B",
  },
  {
    id: "loc-110",
    name: "Lakeshore Terrace",
    city: "Louisville",
    state: "KY",
    districtId: "dist-4",
    districtName: "District 4 — Northern",
    regionId: "reg-b",
    regionName: "Region B",
  },
  {
    id: "loc-111",
    name: "Brookside Village",
    city: "Louisville",
    state: "KY",
    districtId: "dist-4",
    districtName: "District 4 — Northern",
    regionId: "reg-b",
    regionName: "Region B",
  },
  {
    id: "loc-112",
    name: "Summit Row",
    city: "Lexington",
    state: "KY",
    districtId: "dist-4",
    districtName: "District 4 — Northern",
    regionId: "reg-b",
    regionName: "Region B",
  },
];

export const DEMO_DISTRICTS = [
  { id: "dist-1", name: "District 1 — South Central", regionId: "reg-a" },
  { id: "dist-2", name: "District 2 — Western", regionId: "reg-a" },
  { id: "dist-3", name: "District 3 — Mid-South", regionId: "reg-b" },
  { id: "dist-4", name: "District 4 — Northern", regionId: "reg-b" },
];

export const DEMO_REGIONS = [
  { id: "reg-a", name: "Region A" },
  { id: "reg-b", name: "Region B" },
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
