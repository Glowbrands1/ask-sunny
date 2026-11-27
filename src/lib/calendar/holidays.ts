import { HOLIDAY_RULES, type HolidayKind, type HolidayRule } from "@/config/holidays";

/**
 * US holidays for a date range, worked out from the rules in src/config/holidays.ts (the owner, 27 Nov 2026: "can you also
 * add holidays in the calendar in all apps pls US holiday"). Pure: no network, no clock. Dates are calendar dates
 * (YYYY-MM-DD) with no time zone.
 */
export interface Holiday {
  readonly date: string;
  readonly name: string;
  readonly kind: HolidayKind;
  /** The weekday a weekend federal holiday is observed on. */
  readonly observed?: true;
}

const iso = (y: number, m: number, d: number) => {
  const t = new Date(Date.UTC(y, m - 1, d));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
};
const weekdayOf = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();
const addDays = (date: string, days: number) => {
  const [y, m, d] = date.split("-").map(Number);
  return iso(y!, m!, d! + days);
};

/** The nth (1-5) or last (-1) weekday (0 = Sunday) of a month. */
export function nthWeekday(year: number, month: number, weekday: number, n: number): string {
  if (n > 0) {
    const first = weekdayOf(iso(year, month, 1));
    return iso(year, month, 1 + ((weekday - first + 7) % 7) + (n - 1) * 7);
  }
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const last = weekdayOf(iso(year, month, lastDay));
  return iso(year, month, lastDay - ((last - weekday + 7) % 7));
}

/** Western (Gregorian) Easter Sunday: the anonymous Gregorian algorithm (Meeus/Jones/Butcher). */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return iso(year, month, day);
}

function dateOf(rule: HolidayRule, year: number, found: ReadonlyMap<string, string>): string | null {
  if ("fixed" in rule) return iso(year, rule.fixed.month, rule.fixed.day);
  if ("nth" in rule) return nthWeekday(year, rule.nth.month, rule.nth.weekday, rule.nth.n);
  if ("easter" in rule) return easterSunday(year);
  const base = found.get(rule.after.name);
  return base ? addDays(base, rule.after.days) : null;
}

/** Every holiday of one year, in date order; a weekend federal fixed-date holiday also gets its observed weekday. */
export function holidaysOfYear(year: number, rules: readonly HolidayRule[] = HOLIDAY_RULES): Holiday[] {
  const found = new Map<string, string>();
  const out: Holiday[] = [];
  for (const rule of rules) {
    const date = dateOf(rule, year, found);
    if (!date) continue;
    found.set(rule.name, date);
    out.push({ date, name: rule.name, kind: rule.kind });
    if (rule.kind === "federal" && "fixed" in rule) {
      const wd = weekdayOf(date);
      if (wd === 6) out.push({ date: addDays(date, -1), name: rule.name, kind: rule.kind, observed: true });
      if (wd === 0) out.push({ date: addDays(date, 1), name: rule.name, kind: rule.kind, observed: true });
    }
  }
  return out.sort((x, y) => x.date.localeCompare(y.date) || x.name.localeCompare(y.name));
}

/** The holidays from `from` to `to` (inclusive), across year ends (New Year's Day observed on Dec 31 included). */
export function holidaysBetween(from: string, to: string, rules: readonly HolidayRule[] = HOLIDAY_RULES): Holiday[] {
  const y0 = Number(from.slice(0, 4));
  const y1 = Number(to.slice(0, 4));
  const all: Holiday[] = [];
  for (let y = y0 - 1; y <= y1 + 1; y++) all.push(...holidaysOfYear(y, rules));
  return all.filter((h) => h.date >= from && h.date <= to).sort((x, y) => x.date.localeCompare(y.date) || x.name.localeCompare(y.name));
}

/** "Christmas Day (observed)", "Easter Sunday (observance)". */
export function holidayTitle(h: Holiday): string {
  return h.observed ? `${h.name} (observed)` : h.kind === "observance" ? `${h.name} (observance)` : h.name;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
export const holidayId = (prefix: string, h: Holiday) => `${prefix}:holiday:${h.date}:${slug(h.name)}${h.observed ? ":observed" : ""}`;
