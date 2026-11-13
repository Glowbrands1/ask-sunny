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
export function agendaFor(key: string): AgendaSection[] {
  if (key !== "leadership") return AGENDA;
  return AGENDA.filter((a) => a.key !== "headlines" && a.key !== "todos").map((a) => (a.key === "ids" ? { ...a, minutes: 70 } : a));
}

/** Lovable's one-line hint under each section title. */
export const SECTION_HINTS: Record<AgendaKey, string> = {
  "business-best": "Round-robin: each person shares one business best, then you check them off.",
  scorecard: "Any metric off track from goal for two weeks becomes an issue.",
  rocks: "Quarterly rocks by owner: status, milestones and notes.",
  headlines: "Customer and employee headlines to share with the team.",
  todos: "Weekly commitments. Open to-dos carry forward.",
  ids: "Identify, Discuss, Solve. Rank your top three, then work them in order.",
  conclude: "Recap, cascade the message and rate the meeting.",
};
