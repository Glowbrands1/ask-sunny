/**
 * Dates and labels for the Woven screens. Central time, because that is where
 * the salons are, and every stamp says so rather than leaving the reader to
 * guess which clock a sync ran on.
 */

const STAMP = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const DAY = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });

/** An instant, in Central time. */
export function when(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? "—" : STAMP.format(new Date(parsed));
}

/** A calendar date (YYYY-MM-DD) as Woven stated it. No time zone applies. */
export function day(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = Date.parse(`${value.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(parsed) ? "—" : DAY.format(new Date(parsed));
}

/** `location_access_added` → "location access added". Codes stay recognisable. */
export function label(code: string | null | undefined): string {
  return code ? code.replaceAll("_", " ") : "—";
}

/** A change's before or after value, as one short line. Never a nested dump. */
export function describeValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value !== "object") return String(value);
  const record = value as Record<string, unknown>;
  const preferred = [
    "positionName",
    "primaryLocationName",
    "locationName",
    "employmentStatus",
    "emailAddress",
  ];
  const parts: string[] = [];
  for (const key of preferred) {
    const v = record[key];
    if (typeof v === "string" && v.length > 0) parts.push(v);
  }
  if (typeof record.expiresOn === "string") parts.push(`expires ${day(record.expiresOn)}`);
  if (typeof record.terminationDate === "string") parts.push(`on ${day(record.terminationDate)}`);
  if (parts.length > 0) return parts.join(" · ");
  const ids = ["positionId", "primaryLocationId", "wovenLocationId", "id"].map((k) => record[k]).filter((v) => typeof v === "string");
  return ids.length > 0 ? String(ids[0]) : "—";
}
