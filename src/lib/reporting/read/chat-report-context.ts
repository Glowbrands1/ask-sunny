import { parseReportFamily, type ReportFamilyId } from "./report-families";

/**
 * ============================================================================
 * "ASK SUNNY ABOUT THIS REPORT" — WHAT TRAVELS, AND WHAT CANNOT
 * ============================================================================
 *
 * A manager on a report tab clicks one button and lands in Chat already talking
 * about what they were looking at. The thing that makes that safe rather than
 * convenient is what this type CANNOT express.
 *
 * EVERY FIELD IS A POINTER AT ROWS. Which family, which period, which window,
 * which salons, which districts, which measure, which view. There is nowhere to
 * put a figure, so the browser cannot send a number and have it treated as
 * true. The server re-reads the report for itself and the prompt is told that
 * the freshly-read figures are the authority.
 *
 * That is not belt-and-braces. The screen renders numbers, a screen is not
 * evidence about money, and a request shape with a `grandTotal` field on it
 * would be one careless server edit away from quoting the browser back to
 * itself as a fact. `analysis/types.ts` made the same call for the Sales Totals
 * panel and says so at length; this is that rule generalised to five families.
 *
 * ============================================================================
 * NO `server-only`, AND THAT IS DELIBERATE
 * ============================================================================
 *
 * The report tabs are client components: they hold the current filter state and
 * they build the link. So the type and the bounds live here, importable from
 * both sides, and the SERVER-SIDE resolution — which period actually exists,
 * which salon numbers this delivery carries — stays in the loaders where the
 * database is.
 *
 * ============================================================================
 * WHY IT SURVIVES FOLLOW-UPS
 * ============================================================================
 *
 * "Why is #1 the biggest problem?" carries no report vocabulary at all, and the
 * keyword routing in `family-routing.ts` reads the question only. So the context
 * is what makes a follow-up work: the browser sends the same pointers with the
 * next question, the server reloads the same rows, and the conversation stays
 * about the report it started on. Carrying figures forward instead would mean
 * the fourth turn quoting the first turn's numbers after somebody re-ingested
 * the delivery.
 */

/** Longest any single pointer may be. A salon number, a metric code, a token. */
export const REPORT_CONTEXT_TOKEN_MAX = 64;

/**
 * How many salon and district pointers may travel.
 *
 * Far above the fifteen salons a delivery carries and the handful of districts
 * in it. The cap is here so a hand-made request cannot push a thousand
 * identifiers through the resolver, not to constrain a real selection.
 */
export const REPORT_CONTEXT_LIST_MAX = 300;

export interface ChatReportContext {
  /** Which of the five reports the manager was looking at. */
  readonly family: ReportFamilyId;
  /**
   * The period, as that family's dashboard writes it in its own URL.
   *
   * Deliberately an OPAQUE TOKEN here rather than a parsed date, because the
   * five families do not share a period vocabulary: bed and spa use
   * `grain:date`, Sales Totals uses an ISO report date, Salon Performance uses
   * a grain and a period end. Each loader parses its own, resolves it against
   * the periods that exist, and falls back to the newest while SAYING it fell
   * back. A stale bookmark quietly answering about a different month is the
   * failure being avoided.
   */
  readonly period: string | null;
  /**
   * The window within the period, where the family has one: `daily` or `mtd`
   * for Sales Totals, `mtd` / `ytd` / `ltm` for Spa Wellness, a comparison
   * token for Salon Performance. Null where the family has none.
   */
  readonly window: string | null;
  /** Selected salons, by the number or key the family's dashboard uses. */
  readonly salons: readonly string[];
  /** Selected districts, by the label the report carries. */
  readonly districts: readonly string[];
  /** The measure the reader had selected, by metric code. */
  readonly metric: string | null;
  /**
   * The view or sheet the reader had selected — a Comp Report sheet, an
   * equipment code, a named tab. Null where the family has one view.
   */
  readonly view: string | null;
}

/** A bounded, trimmed token, or null. Never throws: this arrives from a browser. */
function token(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > REPORT_CONTEXT_TOKEN_MAX) return null;
  return trimmed;
}

/**
 * A bounded list of tokens.
 *
 * Accepts an array or a single string, because a URL carries repeated
 * parameters and `URLSearchParams.getAll` gives an array while Next's
 * `searchParams` gives a string for a single occurrence. Anything not a usable
 * string is DROPPED rather than repaired — the only sane response to a
 * malformed pointer is to select nothing with it.
 */
function tokenList(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : value === undefined ? [] : [value];
  const out: string[] = [];
  for (const entry of raw) {
    const parsed = token(entry);
    if (parsed !== null) out.push(parsed);
    if (out.length >= REPORT_CONTEXT_LIST_MAX) break;
  }
  return out;
}

/**
 * A report context from anything untrusted, or null.
 *
 * NULL WHENEVER THE FAMILY IS NOT ONE OF THE FIVE, including when it is absent.
 * A context without a family names no rows, so there is nothing for the server
 * to reload and nothing honest to say about it — and inventing a default family
 * here would mean a malformed link silently briefing on the wrong report.
 */
export function parseChatReportContext(value: unknown): ChatReportContext | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;

  const family = parseReportFamily(raw.family);
  if (!family) return null;

  return {
    family,
    period: token(raw.period),
    window: token(raw.window),
    salons: tokenList(raw.salons),
    districts: tokenList(raw.districts),
    metric: token(raw.metric),
    view: token(raw.view),
  };
}

/** Query-string parameter names, so the link builder and the reader agree. */
export const REPORT_CONTEXT_PARAMS = {
  family: "report",
  period: "period",
  window: "window",
  salon: "salon",
  district: "district",
  metric: "metric",
  view: "view",
} as const;

/**
 * The context a `/chat` URL carries, or null.
 *
 * The parameters are repeated for lists — `salon=0123&salon=0456` — for the
 * reason `bed-spa/filter-state.ts` records: district and region values in these
 * reports are manager names written surname-first, so every one of them
 * contains a comma and a joined list parses back into halves that match
 * nothing.
 */
export function chatReportContextFromParams(
  params: URLSearchParams,
): ChatReportContext | null {
  return parseChatReportContext({
    family: params.get(REPORT_CONTEXT_PARAMS.family),
    period: params.get(REPORT_CONTEXT_PARAMS.period),
    window: params.get(REPORT_CONTEXT_PARAMS.window),
    salons: params.getAll(REPORT_CONTEXT_PARAMS.salon),
    districts: params.getAll(REPORT_CONTEXT_PARAMS.district),
    metric: params.get(REPORT_CONTEXT_PARAMS.metric),
    view: params.get(REPORT_CONTEXT_PARAMS.view),
  });
}

/** The `/chat` query string for a report context. The inverse of the above. */
export function chatReportContextToParams(context: ChatReportContext): URLSearchParams {
  const params = new URLSearchParams();
  params.set(REPORT_CONTEXT_PARAMS.family, context.family);
  if (context.period) params.set(REPORT_CONTEXT_PARAMS.period, context.period);
  if (context.window) params.set(REPORT_CONTEXT_PARAMS.window, context.window);
  for (const salon of context.salons) params.append(REPORT_CONTEXT_PARAMS.salon, salon);
  for (const district of context.districts) {
    params.append(REPORT_CONTEXT_PARAMS.district, district);
  }
  if (context.metric) params.set(REPORT_CONTEXT_PARAMS.metric, context.metric);
  if (context.view) params.set(REPORT_CONTEXT_PARAMS.view, context.view);
  return params;
}
