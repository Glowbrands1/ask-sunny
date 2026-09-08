/**
 * ============================================================================
 * CANONICAL STORE IDENTITY ACROSS REPORT FAMILIES
 * ============================================================================
 *
 * The Spa Conversion Rate divides one report's spa sessions by another
 * report's tanning traffic, so the two reports have to agree on which salon is
 * which. None of the three new workbooks carries a salon number in its data
 * band:
 *
 *   Bed Usage        `Salon Name`  + `Company`
 *   Spa Wellness     `Salon`       + `Company`
 *   Spa Engagement   `Salon`       + `Ownership` (Corp/Fran — NOT the company)
 *
 * The salon NUMBER exists in exactly one place across the three files: the
 * `Roster` sheet of the Spa Engagement workbook, which maps `StoreLocation` to
 * a zero-padded `SalonNumber` and to the owning company. That is the only
 * bridge to `public.salons`, whose business key is that same text number, and
 * it is why the Roster is read at all.
 *
 * THE RULES, AND WHY EACH ONE IS A RULE RATHER THAN A PREFERENCE.
 *
 * 1. AN EXISTING CANONICAL SALON NUMBER ALWAYS WINS. The Roster is a
 *    convenience for resolving a name; it is never allowed to rename or
 *    renumber a salon that `public.salons` already knows. A franchise roster
 *    export is maintained by hand and is the least trustworthy of the three
 *    sources about identity.
 *
 * 2. MATCHING IS ON A NORMALIZED KEY, AND NORMALIZATION IS NARROW. Case,
 *    runs of whitespace, and the punctuation these exports differ on — that is
 *    all. `NE Omaha 132nd and Maple` matches `NE Omaha 132nd And Maple`, and
 *    `WC PA Stroudsburg` does NOT match `PA Stroudsburg`, because the `WC`
 *    prefix is a real distinction in this estate (a separately operated
 *    Wellness City site) and collapsing it would merge two stores.
 *
 * 3. NO FUZZY MATCHING. No edit distance, no token overlap, no "closest
 *    match". `KS Lawrence` and `KS Lawrenceburg` are two real salons eight
 *    characters apart, and `MO Kansas City Liberty` and `MO Kansas City
 *    Wornall` share a three-word prefix. A fuzzy join here does not produce an
 *    occasional wrong row; it produces a confident wrong row that nobody can
 *    see, in the denominator of the metric the whole report exists for.
 *
 * 4. AN ALIAS IS DATA, REVIEWED AND EXPLICIT. Known naming variations live in
 *    `STORE_NAME_ALIASES` below, each with the reason it exists. Adding one is
 *    a code review, which is the correct weight for a decision that merges two
 *    identities.
 *
 * 5. AN UNRESOLVED SALON IS A WARNING, NEVER A DISCARD AND NEVER A GUESS. The
 *    resolver returns the unmatched name so ingestion can report it and the
 *    dashboard can show `N/A` with a reason. A silently dropped salon is a
 *    number that is quietly too small; a silently guessed salon is a number
 *    that is quietly wrong. Both are worse than a visible gap.
 */

/**
 * The company whose salons this reporting slice is authorized to describe.
 *
 * The three source workbooks are chain-wide — 252 salons across thirty
 * companies in the August 2026 bed usage report — and Ask Sunny's recipient is
 * authorized for one of them. Named here once so the parsers, the ingestion
 * functions and the read layer cannot disagree about it.
 */
export const AUTHORIZED_COMPANY = "JB and Associates";

/**
 * Normalizes a company name for comparison.
 *
 * Case and whitespace only. `and` is NOT normalized to `&`: the exports write
 * this company consistently as "JB and Associates", and a rule that treated the
 * two as equal would also equate two genuinely different companies if one ever
 * appeared.
 */
export function normalizeCompany(name: string | null | undefined): string {
  return (name ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

/** True when a workbook row belongs to the authorized company. */
export function isAuthorizedCompany(name: string | null | undefined): boolean {
  return normalizeCompany(name) === normalizeCompany(AUTHORIZED_COMPANY);
}

/**
 * The comparison key for a store name.
 *
 * Deliberately conservative — see rule 2 above. What it does:
 *
 *   * collapses whitespace runs, including the non-breaking spaces these
 *     exports are full of, and trims;
 *   * lowercases;
 *   * removes the punctuation the three sources differ on: commas, periods,
 *     apostrophes and hyphens between words (`Lincoln O Street` /
 *     `Lincoln O. Street`, `Omaha 144th and Center` / `Omaha 144th & Center`);
 *   * normalizes ` & ` to ` and `, which is the one abbreviation observed to
 *     vary within a single store's name across these files.
 *
 * What it deliberately does NOT do: drop leading tokens, drop state prefixes,
 * strip digits, or remove any word. Every one of those would merge real stores.
 */
export function storeNameKey(name: string | null | undefined): string {
  return (name ?? "")
    .replace(/[\s   ]+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\s*&\s*/g, " and ")
    .replace(/[,.'’]/g, "")
    .replace(/\s*-\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * REVIEWED NAMING VARIATIONS, keyed on the normalized form of the variant.
 *
 * Empty as shipped, and that is a finding rather than an omission: all fifteen
 * authorized salons resolve by normalized name alone across the August 2026
 * bed usage report, the STC SPA Wellness Tracking workbook and the Spa
 * Engagement roster. The mechanism exists so the first genuine variation is a
 * reviewed one-line addition instead of a decision made under pressure — and so
 * that the alternative, a fuzzy matcher, never gets proposed as the fix.
 *
 * Each entry must carry the reason it was approved.
 */
export const STORE_NAME_ALIASES: Readonly<Record<string, { canonical: string; reason: string }>> =
  {};

/** The canonical store name for a possibly-variant one, plus how it resolved. */
export function resolveStoreAlias(name: string): {
  canonicalName: string;
  viaAlias: boolean;
} {
  const alias = STORE_NAME_ALIASES[storeNameKey(name)];
  if (alias) return { canonicalName: alias.canonical, viaAlias: true };
  return { canonicalName: name.replace(/\s+/g, " ").trim(), viaAlias: false };
}

/** One salon this application already knows about. */
export interface CanonicalSalon {
  readonly salonNumber: string;
  readonly storeName: string;
}

/** How a source row's salon name was matched — or why it was not. */
export type StoreMatchKind =
  /** Matched an existing canonical salon on the normalized name. */
  | "canonical_name"
  /** Matched an existing canonical salon through a reviewed alias. */
  | "canonical_alias"
  /** Matched a Roster row, which supplied the salon number. */
  | "roster"
  /** No match. NEVER guessed. */
  | "unresolved";

export interface StoreMatch {
  readonly sourceName: string;
  readonly kind: StoreMatchKind;
  /** Null only when `kind` is `unresolved`. */
  readonly salonNumber: string | null;
  readonly canonicalName: string | null;
}

/**
 * A resolver over one snapshot of canonical salons plus optional roster rows.
 *
 * Built once per ingestion or per page render and then asked about each row, so
 * the normalization work is done once per known salon rather than once per
 * lookup.
 *
 * AMBIGUITY IS REFUSED, NOT RESOLVED. Two roster rows normalizing to the same
 * key with different salon numbers make that name unresolvable, and it stays
 * unresolvable until somebody fixes the roster. Picking either one would be a
 * coin flip recorded as a fact.
 */
export class StoreResolver {
  private readonly canonical = new Map<string, CanonicalSalon>();
  private readonly roster = new Map<string, CanonicalSalon | null>();

  constructor(
    canonicalSalons: readonly CanonicalSalon[] = [],
    rosterRows: readonly CanonicalSalon[] = [],
  ) {
    for (const salon of canonicalSalons) {
      const key = storeNameKey(salon.storeName);
      if (key.length === 0) continue;
      // First one wins; a duplicate store name in `salons` is a data problem
      // upstream and is not this class's to resolve.
      if (!this.canonical.has(key)) this.canonical.set(key, salon);
    }
    for (const row of rosterRows) {
      const key = storeNameKey(row.storeName);
      if (key.length === 0 || row.salonNumber.trim().length === 0) continue;
      const existing = this.roster.get(key);
      if (existing === undefined) {
        this.roster.set(key, row);
      } else if (existing !== null && existing.salonNumber !== row.salonNumber) {
        // Two numbers for one name: mark the key permanently ambiguous.
        this.roster.set(key, null);
      }
    }
  }

  /** How many canonical salons this resolver was built over. */
  get canonicalCount(): number {
    return this.canonical.size;
  }

  resolve(sourceName: string): StoreMatch {
    const trimmed = (sourceName ?? "").replace(/\s+/g, " ").trim();
    if (trimmed.length === 0) {
      return { sourceName: trimmed, kind: "unresolved", salonNumber: null, canonicalName: null };
    }

    // 1. The canonical set, on the name as written.
    const direct = this.canonical.get(storeNameKey(trimmed));
    if (direct) {
      return {
        sourceName: trimmed,
        kind: "canonical_name",
        salonNumber: direct.salonNumber,
        canonicalName: direct.storeName,
      };
    }

    // 2. The canonical set, through a reviewed alias.
    const alias = resolveStoreAlias(trimmed);
    if (alias.viaAlias) {
      const viaAlias = this.canonical.get(storeNameKey(alias.canonicalName));
      if (viaAlias) {
        return {
          sourceName: trimmed,
          kind: "canonical_alias",
          salonNumber: viaAlias.salonNumber,
          canonicalName: viaAlias.storeName,
        };
      }
    }

    // 3. The roster, which is how a salon this application has never seen
    //    acquires a number in the first place. Never allowed to override
    //    steps 1 and 2 — see rule 1.
    const roster = this.roster.get(storeNameKey(trimmed)) ?? null;
    if (roster) {
      return {
        sourceName: trimmed,
        kind: "roster",
        salonNumber: roster.salonNumber,
        canonicalName: roster.storeName,
      };
    }

    return { sourceName: trimmed, kind: "unresolved", salonNumber: null, canonicalName: null };
  }

  /** The names this resolver could not place, in input order, de-duplicated. */
  unresolved(sourceNames: readonly string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const name of sourceNames) {
      const match = this.resolve(name);
      if (match.kind !== "unresolved") continue;
      const key = storeNameKey(name);
      if (key.length === 0 || seen.has(key)) continue;
      seen.add(key);
      out.push(match.sourceName);
    }
    return out;
  }
}
