// Copied from the Leadership Hub (src/lib/assistant/notes.ts); keep in step with it.
/**
 * Notes the assistant drafts and the person sends (a hub notification, the bell). Pure helpers shared by the
 * assistant's draftNote tool (server) and the note card (browser). The assistant never sends: the card's Send button
 * calls the server action, which calls the Hub (partner API "send-note"), which runs public.send_note's body as the signed-in person's Hub account.
 */

export interface NotePerson {
  id: string;
  name: string;
}

/** What the draftNote tool returns; the card renders it. Nothing has been sent when this exists. */
export interface NoteDraft {
  status: "draft_not_sent";
  meeting: { key: string; name: string };
  /** Names the assistant matched to exactly one person on the meeting's member list (real hub accounts). */
  to: NotePerson[];
  /** Names it could not match to exactly one person: the card asks the person to pick. */
  unclear: { asked: string; options: NotePerson[] }[];
  message: string;
  /** Everyone the note can go to (the meeting's member list), for the card's "Add person" picker. */
  people: NotePerson[];
}

export const NOTE_MAX = 500;
export const NOTE_MAX_PEOPLE = 10;

const norm = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/^@+/, "")
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();

/**
 * Matches the names the person said ("Avery", "bo lark", "@Cy") to people on the member list.
 * A full-name match wins; otherwise a name matches a person when it is their first name, any whole word of their name,
 * or the start of their full name. Exactly one candidate is a match; none or several are "unclear" (never guessed).
 */
export function resolveRecipients(asked: readonly string[], people: readonly NotePerson[]): Pick<NoteDraft, "to" | "unclear"> {
  const to: NotePerson[] = [];
  const unclear: NoteDraft["unclear"] = [];
  const seen = new Set<string>();
  for (const raw of asked) {
    const q = norm(raw);
    if (!q) continue;
    // Tiers, best first: the full name; a whole word of the name ("Avery", "Quill"); the start of a word ("Ave").
    const tiers = [
      (n: string) => n === q,
      (n: string) => n.split(" ").includes(q) || n.startsWith(`${q} `),
      (n: string) => q.length >= 3 && n.split(" ").some((w) => w.startsWith(q)),
    ];
    let candidates: readonly NotePerson[] = [];
    for (const test of tiers) {
      candidates = people.filter((p) => test(norm(p.name)));
      if (candidates.length) break;
    }
    if (candidates.length === 1) {
      const p = candidates[0];
      if (!seen.has(p.id)) {
        seen.add(p.id);
        to.push({ id: p.id, name: p.name });
      }
    } else {
      unclear.push({ asked: raw.trim(), options: candidates.slice(0, 6).map((p) => ({ id: p.id, name: p.name })) });
    }
  }
  return { to, unclear };
}

/** The draft's id for public.send_note: the tool call id, kept to [A-Za-z0-9_-], at most 60 characters. */
export function noteRef(toolCallId: string): string {
  const clean = toolCallId.replace(/[^A-Za-z0-9_-]/g, "").slice(-60);
  return clean || "note";
}

/** Narrow an unknown tool result to a draft (anything else is not rendered as a card). */
export function isNoteDraft(v: unknown): v is NoteDraft {
  const o = v as Partial<NoteDraft> | null;
  return (
    !!o &&
    o.status === "draft_not_sent" &&
    typeof o.message === "string" &&
    !!o.meeting &&
    typeof o.meeting.key === "string" &&
    Array.isArray(o.to) &&
    Array.isArray(o.people) &&
    Array.isArray(o.unclear)
  );
}

/** One line per recipient after Send. */
export function outcomeText(status: string): string {
  switch (status) {
    case "sent":
      return "Sent";
    case "already_sent":
      return "Already sent";
    case "muted":
      return "Not sent: they turned notes off";
    case "not_in_meeting":
      return "Not sent: not in this meeting";
    case "self":
      return "Skipped: that's you";
    default:
      return "Not sent";
  }
}
