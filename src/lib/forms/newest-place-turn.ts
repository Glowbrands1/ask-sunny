import { PRODUCTION_SALONS } from "@/data/salons";

import { readPlaceState } from "./place-state";
import { labelledSalonIds } from "./salon-cue";

type SalonRow = { readonly id: string; readonly name: string };

const CHANGE_PLACE_TO =
  /\b(?:change|switch|move|update|set|correct)\b[^.\n]*?\b(?:salon|store|location)\b[^.\n]*?\bto\s+([^\n]+)/i;

/*
 * NEWEST_PLACE_TURN_ENABLED. The newest manager turn that names exactly one
 * salon decides it: "change salon location to grand island, ne" after "at
 * Kearney, NE" is NE Grand Island on that turn and on every later one that
 * names none (ported from the sibling app, conv_mvnsstvq2cywp78 /
 * conv_mvnu3j932gpohx4, 25 Oct 2026). A field label, "<place>, <state>" or
 * "change … to <place>" counts as a naming. A turn naming two salons stops
 * the read, and the caller grounds the salon as before. Pure.
 */
export function newestManagerTurnSalon(
  turnsNewestFirst: readonly string[],
  salons: readonly SalonRow[] = PRODUCTION_SALONS,
): { id: string; name: string; ambiguous: readonly SalonRow[] } | null {
  for (const raw of turnsNewestFirst) {
    if (!raw.trim()) continue;
    const change = CHANGE_PLACE_TO.exec(raw);
    const turn = change ? `at ${change[1]!.trim()}` : raw;
    let ids = labelledSalonIds(turn);
    if (ids.length === 0) {
      const place = readPlaceState(turn);
      if (place.kind === "one") ids = [place.salon.id];
    }
    if (ids.length > 1) return null;
    if (ids.length === 0) continue;
    const row = salons.find((salon) => salon.id === ids[0]);
    return row ? { id: row.id, name: row.name, ambiguous: [] } : null;
  }
  return null;
}
