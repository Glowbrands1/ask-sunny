// Ask Sunny only (not copied from the Leadership Hub): the DM L10's "Past meetings" list. See src/features/l10/README.md.
import type { RecapRow } from "./types";

/**
 * A meeting held before the DM L10 moved to the Hub, kept in the meeting document as `meetingHistory` (written by the
 * one-time Bloom Growth import; the Hub keeps unknown fields, so it survives every save).
 */
export interface ImportedMeeting {
  id: string;
  source: "bloom-growth";
  /** When it started and ended (ISO). */
  startedAt: string;
  endedAt: string | null;
  attendees: { name: string; rating: number | null }[];
  issuesSolvedCount: number;
}

/** One row of the Past meetings list, from either a recap (ended in Ask Sunny or the Hub) or the Bloom import. */
export interface PastMeeting {
  key: string;
  source: "l10" | "bloom-growth";
  /** When it was held (ISO): the recap's held_at, or the Bloom start time. */
  heldAt: string;
  durationSeconds: number | null;
  ratingAvg: number | null;
  /** Everyone listed for the meeting with their rating; null = did not rate. */
  attendees: { name: string; rating: number | null }[];
  issuesSolved: number;
  /** Solved issue titles, when known (recaps list them; the Bloom import only has the count). */
  solvedTitles: string[];
  /** The cascading message, when there was one. */
  cascade: string | null;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

/** The Bloom meetings stored in the document; anything malformed is skipped rather than shown wrong. */
export function importedMeetings(doc: Record<string, unknown>): ImportedMeeting[] {
  const raw = doc.meetingHistory;
  if (!Array.isArray(raw)) return [];
  const out: ImportedMeeting[] = [];
  for (const m of raw) {
    if (!m || typeof m !== "object") continue;
    const r = m as Record<string, unknown>;
    const startedAt = str(r.startedAt);
    if (!startedAt || Number.isNaN(Date.parse(startedAt)) || typeof r.id !== "string") continue;
    const endedAt = str(r.endedAt);
    const attendees = Array.isArray(r.attendees)
      ? (r.attendees as unknown[]).flatMap((a) => {
          const o = a as Record<string, unknown> | null;
          return o && typeof o.name === "string" ? [{ name: o.name, rating: num(o.rating) }] : [];
        })
      : [];
    out.push({ id: r.id, source: "bloom-growth", startedAt, endedAt: endedAt && !Number.isNaN(Date.parse(endedAt)) ? endedAt : null, attendees, issuesSolvedCount: num(r.issuesSolvedCount) ?? 0 });
  }
  return out;
}

function average(ratings: (number | null)[]): number | null {
  const given = ratings.filter((r): r is number => r !== null);
  return given.length ? Math.round((given.reduce((s, r) => s + r, 0) / given.length) * 10) / 10 : null;
}

/** Recaps and imported Bloom meetings together, newest first. Deleted recaps are left out. */
export function pastMeetings(recaps: RecapRow[], doc: Record<string, unknown>): PastMeeting[] {
  const fromRecaps: PastMeeting[] = recaps
    .filter((r) => !r.deleted_at)
    .map((r) => ({
      key: `recap-${r.id}`,
      source: "l10",
      heldAt: r.held_at,
      durationSeconds: r.duration_seconds || null,
      ratingAvg: r.rating_avg ?? average((r.attendees ?? []).map((a) => a.rating)),
      attendees: r.attendees ?? [],
      issuesSolved: (r.resolved_issues ?? []).length,
      solvedTitles: r.resolved_issues ?? [],
      cascade: str(r.cascade),
    }));
  const fromBloom: PastMeeting[] = importedMeetings(doc).map((m) => ({
    key: m.id,
    source: "bloom-growth",
    heldAt: m.startedAt,
    durationSeconds: m.endedAt ? Math.max(0, Math.round((Date.parse(m.endedAt) - Date.parse(m.startedAt)) / 1000)) : null,
    ratingAvg: average(m.attendees.map((a) => a.rating)),
    attendees: m.attendees,
    issuesSolved: m.issuesSolvedCount,
    solvedTitles: [],
    cascade: null,
  }));
  return [...fromRecaps, ...fromBloom].sort((a, b) => Date.parse(b.heldAt) - Date.parse(a.heldAt));
}
