import { normalizeHeader } from "../cells";
import type { ParserWarning } from "../types";
import type { HeaderCell } from "./metric-map";

/**
 * THE DIMENSION BAND.
 *
 * The audited sheet carries salon descriptors in columns A–T, ahead of the
 * measure blocks. Resolution is by header text within that band, so an inserted
 * descriptor column shifts everything harmlessly.
 *
 * Two domain decisions are encoded here rather than left to a reader:
 *
 *   1. `salonNumber` is TEXT. Source values are zero-padded ('0468'), and
 *      reading one as a number drops the leading zero — after which the next
 *      report that reads it correctly creates a SECOND salon for the same store
 *      and silently splits its history. Nothing in this module coerces it.
 *   2. `districtLabel` and `regionLabel` hold a MANAGER'S PERSONAL NAME in the
 *      source, not a district code. They land in `salon_period_attributes`,
 *      scoped to the period, and are never promoted to an identifier or used as
 *      a join key. Managers get reassigned; last month's dashboard must not
 *      re-render under this month's org chart.
 */

/** Default width of the descriptor band: columns A–T inclusive. */
export const DIMENSION_BAND_END = 20;

export type DimensionTarget = "salon" | "attributes";
export type DimensionKind = "text" | "number" | "integer" | "boolean" | "date";

export interface DimensionField {
  /** Property on `ParsedSalon` or `ParsedSalonPeriodAttributes`. */
  property: string;
  target: DimensionTarget;
  kind: DimensionKind;
  /** A row is unusable without these. */
  required: boolean;
  /** Accepted header token sequences, most specific first. */
  aliases: string[][];
}

const SYNONYMS: Record<string, string> = {
  "#": "number",
  no: "number",
  num: "number",
  nbr: "number",
  avg: "average",
  dist: "distance",
  grp: "group",
  yr: "years",
  yrs: "years",
  year: "years",
  rev: "revenue",
  cnt: "count",
  qty: "count",
  pcs: "pieces",
  pc: "pieces",
  mkt: "market",
  nearst: "nearest",
};

const NOISE_TOKENS = new Set(["of", "the", "and", "is", "a"]);

/** Reduces a dimension header to comparison tokens. */
export function dimensionTokens(header: string): string[] {
  return normalizeHeader(header)
    .split(/[\s/]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
    .map((token) => SYNONYMS[token] ?? token)
    .filter((token) => !NOISE_TOKENS.has(token));
}

/**
 * The supported descriptors.
 *
 * Every field the checkpoint brief names as a minimum is here. Bare one-word
 * aliases such as `["age"]` and `["rank"]` are included but are matched only
 * after every longer alias, so "Avg Client Age" can never be consumed by the
 * salon-age field.
 */
export const DIMENSION_FIELDS: DimensionField[] = [
  {
    property: "salonNumber",
    target: "salon",
    kind: "text",
    required: true,
    aliases: [["salon", "number"], ["store", "number"], ["salon", "id"], ["location", "number"]],
  },
  {
    property: "storeName",
    target: "salon",
    kind: "text",
    required: true,
    aliases: [["store", "name"], ["salon", "name"], ["location", "name"], ["store"], ["salon"]],
  },
  {
    property: "ownerRef",
    target: "salon",
    kind: "text",
    required: false,
    aliases: [["ref", "owner"], ["owner", "ref"]],
  },
  {
    property: "ownerUid",
    target: "salon",
    kind: "text",
    required: false,
    aliases: [["ref", "uid"], ["owner", "uid"], ["uid"]],
  },
  {
    property: "openedAt",
    target: "salon",
    kind: "date",
    required: false,
    aliases: [
      ["open", "conversion", "date"],
      ["conversion", "date"],
      ["open", "date"],
      ["opened", "date"],
      ["date", "opened"],
      ["opened"],
    ],
  },
  {
    property: "districtLabel",
    target: "attributes",
    kind: "text",
    required: false,
    aliases: [["district", "manager"], ["district"]],
  },
  {
    property: "regionLabel",
    target: "attributes",
    kind: "text",
    required: false,
    aliases: [["regional", "manager"], ["region", "manager"], ["region"], ["regional"]],
  },
  {
    property: "company",
    target: "attributes",
    kind: "text",
    required: false,
    aliases: [["company"]],
  },
  {
    property: "ownershipGroup",
    target: "attributes",
    kind: "text",
    required: false,
    aliases: [["ownership", "group"], ["owner", "group"], ["ownership"]],
  },
  {
    property: "dma",
    target: "attributes",
    kind: "text",
    required: false,
    aliases: [["dma"]],
  },
  {
    property: "pricingPlan",
    target: "attributes",
    kind: "text",
    required: false,
    aliases: [["pricing", "plan"], ["price", "plan"], ["pricing"]],
  },
  {
    property: "isCompSalon",
    target: "attributes",
    kind: "boolean",
    required: false,
    aliases: [["comp", "salon"], ["comparable", "salon"], ["comp", "store"], ["comp"]],
  },
  {
    property: "spaPieces",
    target: "attributes",
    kind: "integer",
    required: false,
    aliases: [["spa", "pieces"], ["spa", "count"], ["spa", "equipment"]],
  },
  {
    property: "spaInstallDate",
    target: "attributes",
    kind: "date",
    required: false,
    aliases: [["spa", "install", "date"], ["spa", "install"], ["spa", "installed"]],
  },
  {
    property: "quintileGroup",
    target: "attributes",
    kind: "text",
    required: false,
    aliases: [["quintile", "group"], ["quintile"]],
  },
  {
    property: "revenueRank",
    target: "attributes",
    kind: "integer",
    required: false,
    aliases: [["revenue", "rank"], ["rank"]],
  },
  {
    property: "salonAgeYears",
    target: "attributes",
    kind: "number",
    required: false,
    aliases: [["salon", "age"], ["store", "age"], ["age", "years"], ["age"]],
  },
  {
    property: "avgClientAge",
    target: "attributes",
    kind: "number",
    required: false,
    aliases: [["average", "client", "age"], ["client", "age"], ["average", "age"]],
  },
  {
    property: "marketConsolidation",
    target: "attributes",
    kind: "text",
    required: false,
    aliases: [["market", "consolidation"], ["consolidation"]],
  },
  {
    property: "nearestCompetitorDistance",
    target: "attributes",
    kind: "number",
    required: false,
    aliases: [
      ["nearest", "competitor", "distance"],
      ["competitor", "distance"],
      ["nearest", "competitor"],
      ["distance", "competitor"],
    ],
  },
];

export interface ResolvedDimensionColumn {
  column: number;
  letter: string;
  header: string;
  field: DimensionField;
}

export interface DimensionResolution {
  /** Keyed by property name. */
  byProperty: Map<string, ResolvedDimensionColumn>;
  resolved: ResolvedDimensionColumn[];
  /** Headers in the band that matched no descriptor. Ignored. */
  unresolved: HeaderCell[];
  warnings: ParserWarning[];
}

interface Candidate {
  field: DimensionField;
  alias: string[];
}

/** Every (field, alias) pair, longest alias first so specific wins. */
function candidatesBySpecificity(): Candidate[] {
  const candidates: Candidate[] = [];
  for (const field of DIMENSION_FIELDS) {
    for (const alias of field.aliases) candidates.push({ field, alias });
  }
  return candidates.sort((a, b) => b.alias.length - a.alias.length);
}

function sameTokens(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((token, index) => token === b[index]);
}

/**
 * Resolves descriptor columns within the band.
 *
 * Matching is two-pass by alias specificity: every column is offered the
 * longest aliases first, so "Avg Client Age" binds to `avgClientAge` before the
 * bare `["age"]` alias of `salonAgeYears` can claim it. A field binds at most
 * once — a second column with the same header is left unresolved rather than
 * overwriting the first.
 */
export function resolveDimensionColumns(headers: HeaderCell[]): DimensionResolution {
  const byProperty = new Map<string, ResolvedDimensionColumn>();
  const takenColumns = new Set<number>();
  const warnings: ParserWarning[] = [];
  const candidates = candidatesBySpecificity();

  for (const candidate of candidates) {
    if (byProperty.has(candidate.field.property)) continue;
    for (const cell of headers) {
      if (takenColumns.has(cell.column)) continue;
      if (cell.header.trim().length === 0) continue;
      if (!sameTokens(dimensionTokens(cell.header), candidate.alias)) continue;
      byProperty.set(candidate.field.property, { ...cell, field: candidate.field });
      takenColumns.add(cell.column);
      break;
    }
  }

  const unresolved = headers.filter(
    (cell) => cell.header.trim().length > 0 && !takenColumns.has(cell.column),
  );

  for (const field of DIMENSION_FIELDS) {
    if (field.required && !byProperty.has(field.property)) {
      warnings.push({
        code: "missing_dimension_header",
        message: `No column in the descriptor band matched the required "${field.property}" field.`,
      });
    }
  }

  return {
    byProperty,
    resolved: [...byProperty.values()].sort((a, b) => a.column - b.column),
    unresolved,
    warnings,
  };
}
