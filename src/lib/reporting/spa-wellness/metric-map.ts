/**
 * ============================================================================
 * SPA WELLNESS — THE MEASURES, AND THE ONE RULE THAT GOVERNS ALL OF THEM
 * ============================================================================
 *
 * THE CRITICAL RULE: A ZERO OR BLANK EQUIPMENT CELL MEANS THE EQUIPMENT IS NOT
 * INSTALLED. It does not mean an installed unit took no sessions.
 *
 * This is the difference between a report that says "eleven of JB's fifteen
 * salons have a Beauty Shaper, and they run 37% below the peers who also have
 * one" and a report that says "JB's Beauty Shaper usage is 95% below the
 * chain" — the second being what you get by treating thirty-one equipment
 * columns as thirty-one installed units per salon and averaging over the
 * absences. In the August 2026 workbook 6,620 of the 7,688 equipment cells are
 * blank, which is 86% of them; a rule applied to 86% of the data is not a
 * detail.
 *
 * The rule has three consequences, all enforced in code rather than trusted:
 *
 *   1. AN ABSENT CELL PRODUCES NO FACT. Not a zero-valued fact — no row at
 *      all. There is nothing to store about equipment that does not exist, and
 *      a zero row would be counted by any later `avg()`.
 *   2. A SALON WITH NO USE OF AN EQUIPMENT TYPE IS NOT IN THAT TYPE'S
 *      COMPARISON, on either side. It is not a weak performer and it is not a
 *      peer.
 *   3. THE PEER AVERAGE IS OVER INSTALLED PEERS ONLY. Averaging over every
 *      salon in the chain would divide by 248 when 197 have a Hydromassage,
 *      and every salon that owns one would look like a star.
 *
 * The source is explicit that this is the intended reading: its own summary
 * rows are `Filtered Average` and `Comp Average`, computed with SUBTOTAL(1),
 * which skips blanks. We are matching the report's arithmetic, not inventing a
 * kinder one.
 *
 * WHY EQUIPMENT IS NOT AN ENUM. The workbook lists thirty-one equipment columns
 * in August 2026 and the set changes as the estate changes — `SPA Plunge Max`,
 * `SPA PolarWave Dry Plunge`, `SPA RedZone Sauna` and `SPA Contrast Therapy`
 * sit at the end of the block, appended after the alphabetical run, which is
 * what a recently-added column looks like. Equipment types are therefore DATA:
 * discovered from the header row and upserted at ingestion. A new spa product
 * appearing next month needs no deployment.
 */

/** The three windows this workbook reports, keyed by its own sheet names. */
export const SPA_WELLNESS_SHEETS: readonly {
  readonly sheet: string;
  readonly id: SpaWellnessWindow;
  readonly label: string;
  readonly grain: "mtd" | "ytd" | "ltm";
  readonly description: string;
}[] = [
  {
    sheet: "MTD",
    id: "mtd",
    label: "Month to Date",
    grain: "mtd",
    description: "The first of the month through the report date.",
  },
  {
    sheet: "YTD",
    id: "ytd",
    label: "Year to Date",
    grain: "ytd",
    description: "1 January through the report date.",
  },
  {
    sheet: "LTM",
    id: "ltm",
    label: "Last Twelve Months",
    grain: "ltm",
    description: "The twelve months ending on the report date.",
  },
];

export type SpaWellnessWindow = "mtd" | "ytd" | "ltm";

/**
 * The DESCRIPTOR headers on the salon block's header row.
 *
 * Their job is to say where the equipment block BEGINS: the equipment columns
 * are everything between the last of these and the `Total SPA Sessions (Active
 * Beds)` column. Matching on a fixed list of descriptor names rather than on
 * "starts with SPA" matters, because `SPA Equipment First Use`, `SPA Products
 * Net Sales` and `SPA % of Total Visits` all start with "SPA " and none of them
 * is a piece of equipment.
 */
export const SPA_WELLNESS_DESCRIPTOR_HEADERS: readonly string[] = [
  "salon",
  "district",
  "region",
  "spa equipment first use",
  "first use date",
  "newest use date",
  "oldest last use",
  "newest last use",
  "count of spa equipment",
  "comp",
  "company",
];

/**
 * The column that CLOSES the equipment block.
 *
 * Everything to its right is retail product revenue (`BOT`, `PKT`, `KIT`,
 * `EYE`, `MISC`, `NT` prefixes, in dollars) and then a long tail of membership
 * and visit measures. Reading past it would turn `BOT Cypher Face` — $31,442 of
 * face cream — into a spa equipment type with 31,442 sessions.
 */
export const SPA_WELLNESS_TOTAL_HEADER = "total spa sessions (active beds)";

/**
 * The catch-all bucket the source puts at the end of the equipment block.
 *
 * It is a real column and it is summed into the total, so it is parsed. It is
 * NOT a peer-comparable equipment type: it aggregates whatever did not map to a
 * named type, so JB's "Other" and another company's "Other" are not the same
 * machine. `isComparable` on the parsed type carries that distinction so the
 * comparison layer cannot forget it.
 */
export const SPA_WELLNESS_OTHER_HEADER = "other";

export interface SpaWellnessMeasure {
  readonly code: string;
  readonly label: string;
  readonly unit: "count" | "percent";
  readonly higherIsBetter: boolean | null;
  readonly note: string;
}

export const SPA_WELLNESS_MEASURES: readonly SpaWellnessMeasure[] = [
  {
    code: "spa_sessions_total",
    label: "Total Spa Sessions",
    unit: "count",
    higherIsBetter: true,
    note: "Sessions across every installed spa unit, from the source's own `Total SPA Sessions (Active Beds)` column. Reconciled against the sum of the equipment columns on every row.",
  },
  {
    code: "spa_equipment_pieces",
    label: "Active Spa Equipment",
    unit: "count",
    higherIsBetter: null,
    note: "Installed spa UNITS, from `Count of SPA Equipment`. Larger than the number of equipment TYPES wherever a salon has two of something.",
  },
  {
    code: "spa_equipment_types",
    label: "Equipment Types",
    unit: "count",
    higherIsBetter: null,
    note: "How many distinct equipment types the salon used in the period. Counted from the non-zero equipment columns, so it is a count of installed-and-used types.",
  },
  {
    code: "spa_equipment_sessions",
    label: "Sessions",
    unit: "count",
    higherIsBetter: true,
    note: "Sessions on one equipment type at one salon. Absent — never zero — where the salon does not have that equipment.",
  },
  {
    code: "spa_equipment_peer_delta",
    label: "vs Peer Average",
    unit: "percent",
    higherIsBetter: true,
    note: "This salon's sessions on this equipment against the average across every OTHER salon that also used the same equipment in the same period. Like-for-like installed equipment only.",
  },
];

export const SPA_WELLNESS_MEASURES_BY_CODE: Readonly<Record<string, SpaWellnessMeasure>> =
  Object.fromEntries(SPA_WELLNESS_MEASURES.map((measure) => [measure.code, measure]));

/**
 * A stable code for an equipment type, derived from its header text.
 *
 * Derived rather than assigned, because the set is open: a type first seen next
 * month needs a code without a migration. `SPA Revive Pro IR Double-Lounge`
 * becomes `spa_revive_pro_ir_double_lounge`, which satisfies the schema's
 * `^[a-z][a-z0-9_]*$` shape.
 *
 * The transformation must be STABLE, because the code is the key facts are
 * stored under. It lowercases, replaces every run of non-alphanumerics with a
 * single underscore, trims underscores, and prefixes a letter if the result
 * would start with a digit.
 */
export function spaEquipmentCode(header: string): string {
  const slug = header
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (slug.length === 0) return "spa_unnamed";
  return /^[a-z]/.test(slug) ? slug : `spa_${slug}`;
}

/** `SPA Revive Pro IR Lounge` -> `Revive Pro IR Lounge`, for a chart axis. */
export function spaEquipmentShortLabel(header: string): string {
  return header.replace(/^\s*SPA\s+/i, "").replace(/\s+/g, " ").trim() || header.trim();
}
