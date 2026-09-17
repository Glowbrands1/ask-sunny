import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";
import { districtIdOf, regionIdOf } from "./area-ids";

/**
 * ============================================================================
 * WHICH SALONS AN AREA CONTAINS — ASKED OF REPORTING, NOT OF A FILE
 * ============================================================================
 *
 * THE EXPOSURE THIS CLOSES, stated plainly because it is an authorization one.
 *
 * District and region scopes used to resolve by iterating the checked-in
 * roster. A salon-level scope never did — `salonNumberOf` parses the number out
 * of the id and reads no file — so the roster only decided anything for the two
 * AREA levels. That asymmetry is the whole problem: if reporting moves a salon
 * from one manager to another and the checked-in file has not been updated, the
 * manager it LEFT keeps matching it, and keeps receiving its protected rows.
 * Every other kind of staleness fails closed; this one fails open, and no test
 * over the file could catch it, because the file is internally consistent and
 * simply disagrees with the world.
 *
 * So the area membership question is now put to the same data the reports are
 * drawn from. `salon_period_attributes` carries each salon's `district_label`
 * and `region_label` per period; the CURRENT assignment is the one on the most
 * recent period a salon appears in. A move takes effect the moment the next
 * delivery lands, with no deploy and nothing to remember.
 *
 * ============================================================================
 * IT FAILS CLOSED, IN EVERY DIRECTION
 * ============================================================================
 *
 *   THE QUERY FAILS -> empty allowlist. Not the static roster, and not
 *   unrestricted. A database blip must not hand somebody the estate, and the
 *   static file is exactly what this function exists not to trust.
 *
 *   THE AREA MATCHES NOTHING -> empty allowlist. A renamed district, a typo, a
 *   retired id: all produce no salons rather than all salons.
 *
 *   NOTHING HERE CAN RETURN `null`. Null means UNRESTRICTED in the allowlist
 *   contract, and it is reserved for a global scope decided before this runs.
 *   Getting that wrong is the single most dangerous confusion available, so
 *   this function's return type does not admit it.
 *
 * WHAT IS DELIBERATELY NOT HERE. Salon-level scopes do not call this. They
 * resolve from the id itself, which cannot drift, and adding a round trip to
 * them would mean a database outage could lock out the one account type that
 * never needed the database to be right.
 */

/** One salon's current area membership, as reporting last reported it. */
interface SalonArea {
  readonly salonNumber: string;
  readonly districtId: string;
  readonly regionId: string;
}

interface AttributeRow {
  period_id: string;
  district_label: string | null;
  region_label: string | null;
  salons: { salon_number: string } | null;
}

/**
 * Each salon's CURRENT district and region, from the newest period it appears
 * in.
 *
 * Newest-per-salon rather than a union across periods: a union would include
 * the district a salon has LEFT, which is the exposure this module closes.
 */
async function currentSalonAreas(): Promise<SalonArea[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("salon_period_attributes")
    .select("period_id, district_label, region_label, salons!inner(salon_number)")
    .is("superseded_by_ingestion_id", null)
    .order("period_id", { ascending: false });

  if (error) throw new Error(`Could not read salon areas: ${error.message}`);

  const seen = new Map<string, SalonArea>();
  for (const row of (data ?? []) as unknown as AttributeRow[]) {
    const salonNumber = row.salons?.salon_number;
    if (!salonNumber || seen.has(salonNumber)) continue;
    if (!row.district_label && !row.region_label) continue;
    seen.set(salonNumber, {
      salonNumber,
      districtId: row.district_label ? districtIdOf(row.district_label) : "",
      regionId: row.region_label ? regionIdOf(row.region_label) : "",
    });
  }

  return [...seen.values()];
}

/**
 * The salon numbers an area scope may read, from reporting.
 *
 * Returns an ARRAY always — possibly empty, never null. See the contract note
 * above: null is unrestricted and does not belong to this function.
 */
export async function areaSalonNumbersFromReporting(
  level: "district" | "region",
  areaIds: readonly string[],
): Promise<string[]> {
  if (areaIds.length === 0) return [];

  let areas: SalonArea[];
  try {
    areas = await currentSalonAreas();
  } catch {
    /*
     * FAIL CLOSED. The alternative — falling back to the checked-in roster —
     * would reinstate exactly the staleness this module exists to remove, and
     * would do it at the least observable moment.
     */
    return [];
  }

  const wanted = new Set(areaIds);
  const numbers = new Set<string>();
  for (const area of areas) {
    const id = level === "district" ? area.districtId : area.regionId;
    if (id && wanted.has(id)) numbers.add(area.salonNumber);
  }

  return [...numbers].sort();
}
