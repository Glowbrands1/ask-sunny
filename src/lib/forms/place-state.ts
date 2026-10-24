import { PRODUCTION_SALONS, type ProductionSalon } from "@/data/salons";

/**
 * "Dodge, NE" and "at empire, sd" — a place, then a roster state.
 *
 * One salon in that state whose name contains every place word is that salon.
 * None is an unknown store: the caller asks, and does not invent one.
 */

export type PlaceStateRead =
  | { readonly kind: "none" }
  | { readonly kind: "one"; readonly salon: ProductionSalon }
  | { readonly kind: "unknown"; readonly state: string };

export function readPlaceState(text: string): PlaceStateRead {
  const states = [...new Set(PRODUCTION_SALONS.map((salon) => salon.state.toUpperCase()))];
  if (states.length === 0) return { kind: "none" };
  const pattern = new RegExp(
    String.raw`\b(?:at|in|location\s+is)\s+([A-Za-z][A-Za-z'’.-]*(?:\s+[A-Za-z][A-Za-z'’.-]*){0,4}?)\s*,\s*(${states.join("|")})\b`,
    "gi",
  );
  const matches = [...text.matchAll(pattern)];
  if (matches.length === 0) return { kind: "none" };
  const match = matches[matches.length - 1]!;
  const place = match[1]!.replace(/\s+location$/i, "").trim();
  const state = match[2]!.toUpperCase();
  const salon = uniqueSalon(place, state);
  return salon ? { kind: "one", salon } : { kind: "unknown", state };
}

function uniqueSalon(place: string, state: string): ProductionSalon | null {
  const words = place.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 3);
  if (words.length === 0) return null;
  const hits = PRODUCTION_SALONS.filter((salon) => {
    if (salon.state.toUpperCase() !== state) return false;
    return words.every((word) => new RegExp(String.raw`\b${word}\b`, "i").test(salon.name));
  });
  return hits.length === 1 ? hits[0]! : null;
}
