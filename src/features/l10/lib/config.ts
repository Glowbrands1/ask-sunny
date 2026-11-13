// Copied from the Leadership Hub (src/lib/meetings/config.ts); keep in step with it. See src/features/l10/README.md.
/**
 * Lovable's per-meeting configuration (lib/access.ts), carried over as it was:
 * the meetings and the agenda. (The people in each meeting come from the Hub at request time: see `Roster`.)
 */
export type MeetingKey = "leadership" | "stc-dm" | "bcs-dm" | "bcs-gm" | "maintenance";

export const MEETING_KEYS: readonly MeetingKey[] = ["leadership", "stc-dm", "bcs-dm", "bcs-gm", "maintenance"];

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
/** What each person shares in the segue: "Business Best", except the STC DM L10's "AI Best Practice". */
export function segueName(key: string): string {
  return key === "stc-dm" ? "AI Best Practice" : "Business Best";
}

export function agendaFor(key: string): AgendaSection[] {
  if (key === "leadership") return AGENDA.filter((a) => a.key !== "headlines" && a.key !== "todos").map((a) => (a.key === "ids" ? { ...a, minutes: 70 } : a));
  if (key === "stc-dm")
    return AGENDA.filter((a) => a.key !== "headlines").map((a) =>
      a.key === "ids" ? { ...a, minutes: 65 } : a.key === "business-best" ? { ...a, title: `Segue · ${segueName(key)}` } : a,
    );
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
  ids: "Identify, Discuss, Solve. Work each issue through, then press Solve.",
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
