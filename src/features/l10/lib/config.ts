// Copied from the Leadership Hub (src/lib/meetings/config.ts); keep in step with it. See src/features/l10/README.md.
/**
 * Lovable's per-meeting configuration (lib/access.ts), carried over as it was:
 * the meetings and the agenda. (The people in each meeting come from the Hub at request time: see `Roster`.)
 */
export type MeetingKey = "leadership" | "stc-dm" | "bcs-dm" | "bcs-gm" | "maintenance" | StcSdKey;

/**
 * Ask Sunny: the three STC SD L10s, one meeting space per district (the owner, 17 Nov 2026: "Ask Sunny will need three
 * separate district meeting spaces ... Each district needs its own attendees, scorecard, to-dos, IDS list, and meeting
 * history"). Each is its own Hub meeting, so each has its own record, people, history and recaps. Which DM hosts which
 * is the Hub's (its name for the meeting, its people); this public repository keeps only the keys and the salons.
 */
export type StcSdKey = "stc-sd-one" | "stc-sd-two" | "stc-sd-three";
export const STC_SD_KEYS: readonly StcSdKey[] = ["stc-sd-one", "stc-sd-two", "stc-sd-three"];
export const isStcSd = (key: string): key is StcSdKey => (STC_SD_KEYS as readonly string[]).includes(key);

export const MEETING_KEYS: readonly MeetingKey[] = ["leadership", "stc-dm", "bcs-dm", "bcs-gm", "maintenance", ...STC_SD_KEYS];

export function isMeetingKey(value: string): value is MeetingKey {
  return (MEETING_KEYS as readonly string[]).includes(value);
}

/*
 * The Hub's meeting catalog (names, teams and descriptions of every meeting) and its picker are not copied: Ask Sunny
 * opens only the meetings the Hub lists for it, and their names come from the Hub with the meeting.
 */

/**
 * THE PEOPLE SIDE OF A MEETING IS NOT IN THIS REPOSITORY. The Hub's config holds who sits in each meeting (first
 * names, full names, who usually leads it, seat titles). Ask Sunny's repository is public, so the Hub serves that
 * at request time (the partner API's `meeting` operation) and the page passes it down as a `Roster`.
 */
export interface Roster {
  /** The round-robin, in the Hub's order: first name (the Hub's key), the name shown, and the seat title if any. */
  members: { first: string; name: string; role: string }[];
  /** Who usually leads the meeting (a name shown), or null. */
  leader: string | null;
  /** The Hub's agenda for this meeting (sections, titles, minutes). Absent: this copy's agendaFor. */
  agenda?: AgendaSection[];
  /** The Hub's one-line hint under each section title. Absent: this copy's sectionHintsFor. */
  hints?: Partial<Record<AgendaKey, string>>;
  /** Whether the meeting has the Reference views (Business Plan, Accountability Chart). Absent: this copy's hasReference. */
  reference?: boolean;
}

export const EMPTY_ROSTER: Roster = { members: [], leader: null };

export type AgendaKey = "business-best" | "scorecard" | "rocks" | "headlines" | "todos" | "ids" | "conclude";

export interface AgendaSection {
  key: AgendaKey;
  title: string;
  minutes: number;
}

export const AGENDA: AgendaSection[] = [
  { key: "business-best", title: "Segue · Business Best", minutes: 5 },
  { key: "scorecard", title: "Scorecard", minutes: 5 },
  { key: "rocks", title: "Rock Review", minutes: 5 },
  { key: "headlines", title: "Customer / Employee Headlines", minutes: 5 },
  { key: "todos", title: "To-Do List", minutes: 5 },
  { key: "ids", title: "IDS · Issues", minutes: 60 },
  { key: "conclude", title: "Conclude", minutes: 5 },
];

/**
 * The leadership meeting has no Headlines and no To-Do List; their 10 minutes go to IDS (70), so it is the 90 minutes
 * its cadence says ("Mondays · 90 min").
 */
/**
 * Whether a meeting shows the Reference views (Business Plan, Accountability Chart). The STC DM L10 does not (its
 * leader's request, 13 Nov 2026); the Hub's database also keeps them out of everything it sends for that meeting.
 */
export const hasReference = (key: string): boolean => key !== "stc-dm" && !isStcSd(key);

/** Reference views for this page: the Hub's word (served with the roster) when it gives one, and never where this copy says none. */
export const referenceFromRoster = (key: string, roster: Pick<Roster, "reference">): boolean => hasReference(key) && roster.reference !== false;

/** The meetings that run without rocks (17 Nov 2026: "We don't use rocks at the GM/SD level"): the STC SD L10s. */
export const hasRocks = (key: string): boolean => !isStcSd(key);

/**
 * The STC SD L10s' agenda (17 Nov 2026: "the agenda for both should be: 1. Segue 2. Scorecard 3. To-dos 4. IDS
 * 5. Conclude"). The Hub serves the agenda it runs with the roster, which wins; this is the page's own copy.
 */
export const NO_ROCKS_AGENDA: AgendaSection[] = [
  { key: "business-best", title: "Segue", minutes: 5 },
  { key: "scorecard", title: "Scorecard", minutes: 5 },
  { key: "todos", title: "To-dos", minutes: 5 },
  { key: "ids", title: "IDS", minutes: 60 },
  { key: "conclude", title: "Conclude", minutes: 5 },
];

/**
 * The salons on each district's SD scorecard (17 Nov 2026: "On the STC SD scorecard, please list each store
 * individually with its assigned DM"), by salon number (src/data/salons.ts) with the name the scorecard shows.
 */
export const SD_DISTRICT_SALONS: Record<StcSdKey, readonly { number: string; name: string }[]> = {
  "stc-sd-one": [
    { number: "0462", name: "Manhattan" },
    { number: "0311", name: "Lincoln O Street" },
    { number: "0310", name: "Lincoln 27th" },
    { number: "0312", name: "Lincoln Pine Lake" },
    { number: "0307", name: "Grand Island" },
    { number: "0309", name: "Kearney" },
  ],
  "stc-sd-two": [
    { number: "0313", name: "Omaha Maple" },
    { number: "0314", name: "Omaha Center" },
    { number: "0410", name: "Omaha Pacific" },
    { number: "0495", name: "St. Joseph" },
    { number: "0394", name: "Liberty" },
    { number: "0306", name: "Wornall" },
  ],
  "stc-sd-three": [
    { number: "0468", name: "Lawrence" },
    { number: "0476", name: "Overland Park" },
    { number: "0463", name: "Shawnee" },
  ],
};

/**
 * The metrics each salon carries on the SD scorecard (17 Nov 2026: "YOY Revenue, Club Close, PPTA, Spa per Unique,
 * SMS Opt-in %"). The units are this app's reading of the names; the goals are typed when the scorecard is set up.
 */
export const SD_SALON_METRICS: readonly { metric: string; format: "percent" | "currency" | "number" }[] = [
  { metric: "YOY Revenue", format: "percent" },
  { metric: "Club Close", format: "percent" },
  { metric: "PPTA", format: "currency" },
  { metric: "Spa per Unique", format: "currency" },
  { metric: "SMS Opt-in %", format: "percent" },
];

/** A meeting's salons for the per-salon scorecard (the STC SD L10s), else none. */
export const salonsFor = (key: string): readonly { number: string; name: string }[] => (isStcSd(key) ? SD_DISTRICT_SALONS[key] : []);

/** What each person shares in the segue: "Business Best", except the STC DM L10's "AI Best Practice". */
export function segueName(key: string): string {
  return key === "stc-dm" ? "AI Best Practice" : "Business Best";
}

/**
 * The STC DM L10 runs its Bloom Growth agenda exactly (the owner's request, 15 Nov 2026; Bloom meeting 1675): the same
 * titles, order and minutes, the Hub's own section keys. The Hub serves this with the roster; this copy is the fallback.
 */
const STC_DM_AGENDA: AgendaSection[] = [
  { key: "business-best", title: "AI Best Practice", minutes: 5 },
  { key: "scorecard", title: "Scorecard", minutes: 10 },
  { key: "rocks", title: "Rock Review", minutes: 8 },
  { key: "todos", title: "To-do List", minutes: 5 },
  { key: "ids", title: "IDS", minutes: 25 },
  { key: "conclude", title: "Conclude", minutes: 5 },
];

/**
 * The cadence line a meeting shows ("Tuesdays · 58 min"). For the STC DM L10 the minutes are the total of the agenda the
 * page runs (the Hub's, served with the roster), so the words cannot drift from it (QA, 15 Nov 2026). The Hub's copy
 * takes the total from its own config; same result. Display only.
 */
export function cadenceLabel(key: string, cadence: string, agenda: AgendaSection[] = agendaFor(key)): string {
  if (key !== "stc-dm" && !isStcSd(key)) return cadence;
  const total = agenda.reduce((t, a) => t + a.minutes, 0);
  return /\d+\s*min/.test(cadence) ? cadence.replace(/\d+\s*min/, `${total} min`) : `${cadence} · ${total} min`;
}

/** The meetings whose pages are laid out like Bloom Growth's (the owner's request, 15 Nov 2026): the STC DM L10, and the STC SD L10s (17 Nov 2026). */
export const bloomStyle = (key: string): boolean => key === "stc-dm" || isStcSd(key);

export function agendaFor(key: string): AgendaSection[] {
  if (key === "leadership") return AGENDA.filter((a) => a.key !== "headlines" && a.key !== "todos").map((a) => (a.key === "ids" ? { ...a, minutes: 70 } : a));
  if (key === "stc-dm") return STC_DM_AGENDA;
  if (isStcSd(key)) return NO_ROCKS_AGENDA;
  return AGENDA;
}

/** Lovable's one-line hint under each section title. */
export const SECTION_HINTS: Record<AgendaKey, string> = {
  "business-best": "Round-robin: each person shares one business best, then you check them off.",
  scorecard: "Any metric off track from goal for two weeks becomes an issue.",
  rocks: "Quarterly rocks by owner: status, milestones and notes.",
  headlines: "Customer and employee headlines to share with the team.",
  todos: "Weekly commitments. Open to-dos carry forward.",
  // Ask Sunny: no ranking on IDS (see RANKING in meeting/_components/Ids.tsx), so the hint does not mention it.
  ids: "Identify, Discuss, Solve. Number the issues 1, 2, 3 in the order to work them, then solve them in that order.",
  conclude: "Recap, cascade the message and rate the meeting.",
};

/** The one-line hints for a meeting (the STC DM L10's segue is an AI best practice). */
export function sectionHintsFor(key: string): Record<AgendaKey, string> {
  if (key !== "stc-dm") return SECTION_HINTS;
  return { ...SECTION_HINTS, "business-best": "Round-robin: each person shares one AI best practice, then you check them off." };
}

const AGENDA_KEYS = new Set<string>(AGENDA.map((a) => a.key));

/**
 * The agenda the page runs: the Hub's (served with the roster, so a change there reaches Ask Sunny without a deploy)
 * when it is well formed, else this copy's.
 */
export function agendaFromRoster(key: string, roster: Pick<Roster, "agenda">): AgendaSection[] {
  const a = roster.agenda;
  const ok = Array.isArray(a) && a.length > 0 && a.every((s) => s && AGENDA_KEYS.has(s.key) && typeof s.title === "string" && Number.isFinite(s.minutes) && s.minutes > 0);
  return ok ? a.map((s) => ({ key: s.key, title: s.title, minutes: s.minutes })) : agendaFor(key);
}

/** The hints the page shows: the Hub's where it sent one, else this copy's. */
export function hintsFromRoster(key: string, roster: Pick<Roster, "hints">): Record<AgendaKey, string> {
  const out = { ...sectionHintsFor(key) };
  for (const [k, v] of Object.entries(roster.hints ?? {})) if (AGENDA_KEYS.has(k) && typeof v === "string" && v.trim()) out[k as AgendaKey] = v;
  return out;
}
