import { MEETING_KEYS, type MeetingKey } from "./config";

/**
 * Only a meeting's attendees open it (the owner, 27 Nov 2026: "make sure only attendees of that meeting can access that
 * page, if not attendee it will show "you are not an attendee of this meeting""); admins open every meeting (same day:
 * "should admins be able to open every meeting? - yes for all 3 apps").
 *
 * The Leadership Hub's database decides, for the verified signed-in person, on every read (its attendees, and hub admins);
 * a page, panel or AI reader it refuses says exactly NOT_ATTENDEE and shows nothing of the meeting. Pure.
 */
export const NOT_ATTENDEE = "You are not an attendee of this meeting";

/** What an AI reader returns for a meeting the person may not open: the exact words, and no detail. */
export const NOT_ATTENDEE_FOR_MODEL = `${NOT_ATTENDEE}. Tell the manager exactly that, and share nothing about this meeting: not its time, attendees or content.`;

/** "the STC DM L10", "Leadership" -> letters and digits only. */
const squash = (s: string) => s.toLowerCase().replace(/\bthe\b|\bl10s?\b/g, "").replace(/[^a-z0-9]/g, "");

/** The one real meeting a question names by its key ("STC DM", "leadership"), whether or not this person may open it. */
export function meetingNamed(named: string | undefined | null): MeetingKey | null {
  const q = named ? squash(named) : "";
  if (!q) return null;
  const exact = MEETING_KEYS.find((k) => squash(k) === q);
  if (exact) return exact;
  const partial = MEETING_KEYS.filter((k) => squash(k).includes(q));
  return partial.length === 1 ? partial[0]! : null;
}
