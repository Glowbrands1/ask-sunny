// Copied from the Leadership Hub (src/lib/meetings/when.ts); keep in step with it. See src/features/l10/README.md.
const BUSINESS_TIME_ZONE = "America/Chicago";

/** "Mon, Oct 26, 2026, 3:00 PM CDT": a saved time in the company's time zone. */
export function formatCentral(iso: string | null | undefined): string {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return "an unknown time";
  return new Intl.DateTimeFormat("en-US", { timeZone: BUSINESS_TIME_ZONE, weekday: "short", year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(d);
}
