/**
 * A grouped read of Sales Totals, the Comp Report, or Google reviews.
 *
 * Only dimensions those tables actually store are offered. Product, category,
 * employee, and a summed week are named as missing. Nothing here adds daily
 * rows together. Off, callers do not use this.
 */

export type BreakdownKind = "none" | "unavailable" | "sales" | "comp" | "reviews";

export interface BreakdownPlan {
  readonly kind: BreakdownKind;
  readonly report: "Sales Totals" | "Comp Report" | "Google Reviews" | null;
  readonly metric: string | null;
  readonly groupBy: "day" | "month" | "salon" | "rating" | null;
  readonly rating: "1" | "2" | "3" | "4" | "5" | null;
  readonly compare: "prior-period" | "last-year" | null;
  readonly unavailable: string | null;
  readonly note: string;
}

const NONE: BreakdownPlan = {
  kind: "none",
  report: null,
  metric: null,
  groupBy: null,
  rating: null,
  compare: null,
  unavailable: null,
  note: "",
};

const BREAKDOWN =
  /\b(?:break\s*down|breakdown|by day|by week|by month|by salon|by product|by category|by employee|which products|which packages|top salons|vs\.? last|versus last|compared with last|compared to last)\b/i;

export function planReportBreakdown(question: string): BreakdownPlan {
  const text = question ?? "";
  const star = /\b([1-5])\s*[- ]?\s*stars?\b/i.exec(text);
  if (star && /\breviews?\b/i.test(text)) {
    return {
      kind: "reviews",
      report: "Google Reviews",
      metric: "rating",
      groupBy: /\bby salon\b|\bper salon\b|\btop salons\b/i.test(text) ? "salon" : "rating",
      rating: star[1] as BreakdownPlan["rating"],
      compare: null,
      unavailable: null,
      note: "Counts come from the review feed for this account's listings. They are not estimated.",
    };
  }
  if (!BREAKDOWN.test(text)) return NONE;

  if (/\b(?:by product|which products|which packages|by category|by employee)\b/i.test(text)) {
    const dimension = /\bby employee\b/i.test(text)
      ? "employee"
      : /\bby category\b/i.test(text)
        ? "category"
        : "product";
    return {
      kind: "unavailable",
      report: null,
      metric: null,
      groupBy: null,
      rating: null,
      compare: null,
      unavailable: dimension,
      note: `Sales Totals and the Comp Report do not store a ${dimension} dimension. No ${dimension} breakdown was invented.`,
    };
  }
  if (/\bby week\b/i.test(text)) {
    return {
      kind: "unavailable",
      report: null,
      metric: null,
      groupBy: null,
      rating: null,
      compare: null,
      unavailable: "week",
      note: "Daily Sales Totals rows are not added together into a week. Ask for the days, or use a stored month-to-date row.",
    };
  }

  const compare = /\bvs\.? last year\b|\bversus last year\b|\blast year\b/i.test(text)
    ? "last-year"
    : /\bvs\.? last\b|\bversus last\b|\bcompared (?:with|to) last\b/i.test(text)
      ? "prior-period"
      : null;
  const groupBy = /\bby day\b/i.test(text)
    ? "day"
    : /\bby month\b|\bmtd\b/i.test(text)
      ? "month"
      : "salon";
  const reviews = /\breviews?\b/i.test(text);
  if (reviews) {
    return {
      kind: "reviews",
      report: "Google Reviews",
      metric: "rating",
      groupBy: groupBy === "day" ? "rating" : "salon",
      rating: null,
      compare: null,
      unavailable: null,
      note: "Review rows are this account's listings only.",
    };
  }

  const comp = /\bcomp report\b|\bunique tanners\b|\beft revenue\b/i.test(text) || (/\befts?\b/i.test(text) && /\bcomp\b/i.test(text));
  if (comp || /\bunique tanners\b|\btop salons\b/i.test(text)) {
    const metric = /\bunique tanners\b/i.test(text)
      ? "unique_tanners"
      : /\beft/i.test(text)
        ? "eft_revenue"
        : /\brevenue\b/i.test(text)
          ? "total_revenue"
          : "total_revenue";
    return {
      kind: "comp",
      report: "Comp Report",
      metric,
      groupBy: groupBy === "day" ? "salon" : groupBy === "month" ? "month" : "salon",
      rating: null,
      compare,
      unavailable: groupBy === "day" ? "day" : null,
      note:
        groupBy === "day"
          ? "The Comp Report is stored by period, not by day. No daily comp rows were invented."
          : compare === "prior-period"
            ? "A prior calendar month is used only when another stored period is in the result. Last year is the row's basis year, not a figure computed here."
            : "One stored Comp Report period. Rows are not summed across periods.",
    };
  }

  const metric = /\befts?\b/i.test(text)
    ? "efts"
    : /\btanners?\b/i.test(text)
      ? "tans"
      : /\bnew customers?\b/i.test(text)
        ? "new_customers"
        : "grand_total";
  return {
    kind: "sales",
    report: "Sales Totals",
    metric,
    groupBy: groupBy === "month" ? "month" : groupBy === "day" ? "day" : "salon",
    rating: null,
    compare,
    unavailable: null,
    note:
      groupBy === "day"
        ? "Each line is one stored daily row. Daily rows are not added into a week."
        : metric === "efts"
          ? "Sales Totals EFTs are counts, not EFT revenue. A prior month is not computed unless another stored report date is listed."
          : "Month-to-date is the stored mtd row for one report date, not a sum of daily rows.",
  };
}

export interface BreakdownRow {
  readonly label: string;
  readonly when: string;
  readonly value: string;
}

const ROW_CAP = 40;

export function formatBreakdown(plan: BreakdownPlan, rows: readonly BreakdownRow[], asOf: string | null): string {
  if (plan.kind === "none") return "";
  if (plan.kind === "unavailable" || plan.unavailable) {
    const title = plan.report ?? "REPORT BREAKDOWN";
    return `${title}\n\n${plan.note}`;
  }
  const capped = rows.slice(0, ROW_CAP);
  const when = asOf ? `As of ${asOf}.` : "No as-of date was stored on these rows.";
  const body =
    capped.length === 0
      ? "No stored rows matched this account and filter."
      : capped.map((row) => `- ${row.label} (${row.when}): ${row.value}`).join("\n");
  const more = rows.length > ROW_CAP ? `\n\n${rows.length - ROW_CAP} more rows were not listed.` : "";
  return `${plan.report}\n\n${when} ${plan.note}\n${body}${more}`;
}
