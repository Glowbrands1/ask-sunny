// Copied from the Leadership Hub (src/lib/meetings/bloom.ts); keep in step with it. See src/features/l10/README.md.
// Small helpers for the meeting pages laid out like Bloom Growth's (the DM L10s; see config.ts bloomStyle).

/** "MM-DD-YYYY", as Bloom shows dates. A plain date ("2026-11-03") is taken as it is; a time is read in Central. */
export function mmddyyyy(value: string | null | undefined): string {
  if (!value) return "";
  const plain = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (plain) return `${plain[2]}-${plain[3]}-${plain[1]}`;
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  if (slash) return `${slash[1].padStart(2, "0")}-${slash[2].padStart(2, "0")}-${slash[3]}`;
  const t = Date.parse(value);
  if (Number.isNaN(t)) return value;
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(t));
  const get = (k: string) => parts.find((p) => p.type === k)?.value ?? "";
  return `${get("month")}-${get("day")}-${get("year")}`;
}

/** Up to two initials from a full name ("Avery Quill" → "AQ"). */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((n) => n[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/** "1h 5m" / "42m" / "—". */
export function durationLabel(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return "—";
  const m = Math.round(seconds / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}
