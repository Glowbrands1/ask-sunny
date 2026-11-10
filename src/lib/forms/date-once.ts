import { dateOnceEnabled } from "@/lib/config/chat-quality-flags";

/**
 * ============================================================================
 * THE INCIDENT DATE IS WRITTEN ONCE: IN THE DATE FIELD
 * ============================================================================
 *
 * DATE_ONCE_ENABLED (QA's backlog B7; HR's report of 21 Oct 2026, replayed 3 Nov 2026; same flag in both apps; default
 * off). "create verbal ca for <name>, she was late … 15 minutes on 10-1-26. no payroll deduct": the form's Date held
 * 10/01/2026 and the Observation said it again ("… on 10-1-26"). On: a drafted account field that names the form's own
 * date drops it — "on 10-1-26", "(10/1/26)", "on October 1st, 2026" — and keeps everything else it says. Another date,
 * or the date in a field that would be left empty without it, is kept. Pure.
 */

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const NUMERIC = String.raw`(\d{1,2})[-/](\d{1,2})(?:[-/](\d{2,4}))?`;
const NAMED = String.raw`(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?`;
const MENTION = new RegExp(String.raw`(\s*,?\s*\b(?:on|dated)\s+|\s*\(\s*|\b)(?:${NUMERIC}|${NAMED})\b(\s*\))?`, "gi");

function sameDay(iso: string, month: number, day: number, year: string | undefined): boolean {
  const [y, m, d] = iso.split("-").map(Number);
  if (m !== month || d !== day) return false;
  if (!year) return true;
  return (year.length === 2 ? 2000 + Number(year) : Number(year)) === y;
}

export function withoutFormDate(text: string, formDateIso: string): string {
  const out = text.replace(MENTION, (whole, lead: string, m1, d1, y1, mon, d2, y2, close: string | undefined) => {
    const isNumeric = m1 !== undefined;
    const month = isNumeric ? Number(m1) : MONTHS.indexOf(String(mon).toLowerCase().slice(0, 3)) + 1;
    const day = Number(isNumeric ? d1 : d2);
    if (!sameDay(formDateIso, month, day, isNumeric ? y1 : y2)) return whole;
    // "(10/1/26)" goes with its brackets; "on 10-1-26" with its "on"; a bare date only when brackets or "on" lead it.
    if (lead.includes("(") && !close) return whole;
    if (!/\b(?:on|dated)\b|\(/i.test(lead)) return whole;
    return "";
  });
  return out.replace(/\s+([.,;:!?])/g, "$1").replace(/[ \t]{2,}/g, " ").trim();
}

export function withFormDateOnce(
  values: Readonly<Record<string, string>>,
  formDateIso: string | null | undefined,
  accountKeys: ReadonlySet<string>,
): Record<string, string> {
  if (!dateOnceEnabled() || !formDateIso || !/^\d{4}-\d{2}-\d{2}$/.test(formDateIso)) return { ...values };
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => {
      if (!accountKeys.has(key) || typeof value !== "string") return [key, value];
      const stripped = withoutFormDate(value, formDateIso);
      return [key, stripped.replace(/[^\p{L}\d]/gu, "").length >= 10 ? stripped : value];
    }),
  );
}
