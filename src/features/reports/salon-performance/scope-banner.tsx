/**
 * WHAT IS LEFT OF THE SCOPE BANNER: the period formatter the filter bar uses.
 *
 * The banner itself said the thing that still needs saying — this workbook is
 * one recipient's filtered copy, so any figure on the page is a figure about
 * those salons and never the chain's — and it now says it on the shared
 * freshness line at the top of all five tabs, in a manager's words. See the
 * note below.
 *
 * EVERY NUMBER IN THE SENTENCE COMES FROM THE DATABASE. The salon count and the
 * period are read from `comp_sales_report_scope`, which counts them from the
 * live facts rather than from a stored summary. Hard-coding "15 salons" would
 * make the banner a claim that could quietly stop being true; counting it makes
 * the banner a measurement that cannot.
 */

/** `2026-08-30` -> `Aug 30, 2026`, in UTC so the date never shifts. */
export function formatPeriodEnd(periodEnd: string): string {
  const [year, month, day] = periodEnd.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/*
 * ============================================================================
 * `scopeSentence`, `ScopeBanner` AND `SourceFreshness` ARE GONE
 * ============================================================================
 *
 * They carried the three phrasings the 14 September review asked to be
 * removed — "Recipient slice — not company-wide", "Loaded <time>" and a
 * timestamp rendered in UTC — and by then nothing rendered any of them: the
 * page had moved these facts into the band. Deleting them rather than rewording
 * them is the honest version of that, because a reworded copy of a component
 * nobody mounts is a second place for the wording to drift back.
 *
 * WHAT THEY SAID IS NOT LOST. All four facts — the period, how current it is,
 * how many salons are included and whether the delivery covered more — are on
 * `features/reports/freshness-line.tsx`, in one line, on all five tabs, in
 * Central Time and in a manager's words. The recipient-slice caveat survives as
 * "this delivery covered N salons across the chain", which is the same claim
 * without the internal noun.
 *
 * `formatPeriodEnd` stays: the filter bar labels its period menu with it.
 */
