/**
 * ============================================================================
 * A FINALIZED FORM'S EDIT HISTORY: WHY, WHICH REVISION, AND WHAT REPLACED IT
 * ============================================================================
 *
 * Behind `FORM_REVISIONS_ENABLED`. A finalized form is never changed in place:
 * an edit opens a revision that points back at it, and finalizing the revision
 * marks the original `revised` (see `reviseInstance`). What that left out was
 * the record of WHY, and any mark on paper. A superseded original printed like
 * a current record, and nothing on a revision said which document it replaced.
 *
 * This module is the shared, pure half: the wording, the reason rule, and the
 * marks read off a revision chain. The server builds the chain
 * (`revision-chain.ts`); the PDF, the form card, the form page and the
 * register row all print the same marks from it.
 *
 *   "Revised <date> (supersedes <ref>)"   on a finalized revision
 *   "Superseded <date> by <ref>"          on the form it replaced
 *   "Revision N of <ref>"                 with a link to the previous version
 *
 * `<ref>` is the eight-character reference the PDF footer already prints, so
 * a signed page in a binder can be matched to its record.
 *
 * No I/O, no company words: this file is the same in both apps.
 */

/** The `code` a refusal carries, so a client keys off it rather than the prose. */
export const REVISION_REASON_REQUIRED = "REVISION_REASON_REQUIRED";

/** Long enough for a sentence or two; the history is not a narrative field. */
export const REVISION_REASON_MAX_LENGTH = 500;

/** A reason has at least this many letters or digits: "x" or "." is not one. */
const REVISION_REASON_MIN_CHARACTERS = 3;

/**
 * Told to the manager when an edit arrives without a reason, by the server
 * and in the dialog. It says what the reason is for, and that the new
 * printout has to be signed again: signatures are paper-only, so nothing
 * carries over to the new version.
 */
export const REVISION_REASON_REQUIRED_MESSAGE =
  "Editing a finalized form needs a reason. Say why it is being changed: the reason is kept on the form's history. The new version prints with blank signature lines, so once it is finalized, print it and have it signed again.";

/** Shown with the reason box and after a revision opens. */
export const REVISION_RESIGN_NOTICE =
  "The new version prints with blank signature lines. Once it is finalized, print it and have it signed again: the signed copy of the old version no longer matches the record.";

/**
 * The reason, tidied, or null when there is none. Whitespace is collapsed and
 * the text capped; a value with fewer than three letters or digits is not a
 * reason.
 */
export function normalizeRevisionReason(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.replace(/\s+/g, " ").trim().slice(0, REVISION_REASON_MAX_LENGTH).trim();
  return text.replace(/[^\p{L}\p{N}]/gu, "").length >= REVISION_REASON_MIN_CHARACTERS ? text : null;
}

/** The reference printed in the PDF footer: the first eight characters of the id. */
export function referenceOf(id: string): string {
  return id.slice(0, 8);
}

export type RevisionStatus = "draft" | "finalized" | "revised";

/** One record in a chain, oldest first. */
export interface RevisionEntry {
  readonly id: string;
  readonly reference: string;
  readonly status: RevisionStatus;
  /** 0 for the original; 1 for its first revision, and so on. */
  readonly revisionNumber: number;
  /** How it was opened from the previous record; null for the original. */
  readonly kind: "revised" | "reevaluated" | null;
  /** The manager's reason, when the revision was opened with one. */
  readonly reason: string | null;
  readonly openedAt: string;
  readonly openedBy: string | null;
  readonly finalizedAt: string | null;
  /** When the record that replaced it was finalized. */
  readonly supersededAt: string | null;
}

export interface RevisionHistory {
  /** The record the history was asked about. */
  readonly instanceId: string;
  /** The chain, original first. Archived drafts and records the reader may not open are left out. */
  readonly entries: readonly RevisionEntry[];
}

/** Where a record sits in its chain. */
export interface RevisionPosition {
  readonly current: RevisionEntry;
  readonly root: RevisionEntry;
  readonly previous: RevisionEntry | null;
  readonly next: RevisionEntry | null;
}

export function positionIn(history: RevisionHistory): RevisionPosition | null {
  const index = history.entries.findIndex((entry) => entry.id === history.instanceId);
  if (index < 0) return null;
  return {
    current: history.entries[index]!,
    root: history.entries[0]!,
    previous: index > 0 ? history.entries[index - 1]! : null,
    next: history.entries[index + 1] ?? null,
  };
}

/**
 * A mark, kept structured so the PDF can format its date the way its footer
 * does and the screen the way the screen does.
 */
export type RevisionMark =
  | { readonly kind: "revised" | "reevaluated"; readonly date: string | null; readonly supersedes: string }
  | { readonly kind: "revision_draft"; readonly number: number; readonly of: string; readonly supersedes: string }
  | { readonly kind: "superseded"; readonly date: string | null; readonly by: string };

/** Calendar dates (YYYY-MM-DD) in the business timezone, from a timestamp. */
export type CalendarDateOf = (timestamp: string) => string;

/**
 * The marks a record carries: what it supersedes, and what superseded it. A
 * revision that was itself revised later carries both. An original nobody
 * revised carries none, and prints exactly as it did.
 */
export function revisionMarks(history: RevisionHistory, calendarDate: CalendarDateOf): RevisionMark[] {
  const position = positionIn(history);
  if (!position) return [];
  const { current, root, previous, next } = position;
  const on = (timestamp: string | null) => (timestamp ? calendarDate(timestamp) : null);
  const marks: RevisionMark[] = [];
  if (previous && current.revisionNumber > 0) {
    if (current.status === "draft") {
      marks.push({ kind: "revision_draft", number: current.revisionNumber, of: root.reference, supersedes: previous.reference });
    } else {
      marks.push({
        kind: current.kind === "reevaluated" ? "reevaluated" : "revised",
        date: on(current.finalizedAt),
        supersedes: previous.reference,
      });
    }
  }
  if (current.status === "revised" && next) {
    marks.push({ kind: "superseded", date: on(current.supersededAt ?? next.finalizedAt), by: next.reference });
  }
  return marks;
}

/** One mark as a line of text. `formatDate` takes a calendar date (YYYY-MM-DD). */
export function revisionMarkText(mark: RevisionMark, formatDate: (date: string) => string): string {
  const when = (date: string | null) => (date ? ` ${formatDate(date)}` : "");
  switch (mark.kind) {
    case "revised":
      return `Revised${when(mark.date)} (supersedes ${mark.supersedes})`;
    case "reevaluated":
      return `Re-evaluated${when(mark.date)} (supersedes ${mark.supersedes})`;
    case "revision_draft":
      return `Revision ${mark.number} of ${mark.of}, draft (supersedes ${mark.supersedes} once finalized)`;
    case "superseded":
      return `Superseded${when(mark.date)} by ${mark.by}`;
  }
}

/** "Revision 2 of 1a2b3c4d", or null for an original. */
export function revisionLabel(history: RevisionHistory): string | null {
  const position = positionIn(history);
  if (!position || position.current.revisionNumber === 0) return null;
  return `Revision ${position.current.revisionNumber} of ${position.root.reference}`;
}

/** 10/21/2026 from 2026-10-21; anything else is returned as it came. */
export function displayCalendarDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  return match ? `${match[2]}/${match[3]}/${match[1]}` : date;
}
