/**
 * Prior coaching on a corrective action, when PRIOR_COACHING_OPTIONAL_ENABLED
 * is on.
 *
 * A finalized Form Monitoring record is used. A manager's typed note is used
 * when no finalized record exists. Otherwise the line stays blank. A draft is
 * not evidence. Creation is not refused because the line is empty.
 *
 * Off, the proposal text is returned unchanged.
 */

export const PRIOR_COACHING_OPTIONAL_RULES = `PRIOR COACHING DOES NOT BLOCK A CORRECTIVE ACTION

- Earlier coaching usually lives in the personnel file, not in this app.
- When a manager asks for a corrective action, do not refuse because Form Monitoring has no prior coaching form.
- Use a finalized coaching or corrective action record when one is listed. Ignore drafts.
- When the manager types a note, such as "coached verbally in July", use that note.
- When they say nothing about earlier coaching, leave the prior-coaching line blank and continue.`;

export interface PriorCoachingRecord {
  readonly status: string;
  readonly line: string;
}

const TYPED_NOTE = /\bcoached verbally in [a-z]+\b|\b(?:prior|previous) coaching\b[^.\n]*/i;

/** The manager's own words for earlier coaching, or null when they gave none. */
export function typedPriorCoachingNote(text: string): string | null {
  const match = TYPED_NOTE.exec(text);
  return match ? match[0].trim() : null;
}

function withoutPriorCoachingHold(content: string): string {
  return content
    .replace(/You'll set any prior coaching or corrective action on the form — I won't guess at it\.\n?/g, "")
    .replace(/ and any prior coaching or corrective action/g, "")
    .replace(/any prior coaching or corrective action and /g, "")
    .replace(
      /You'll set the verbal\/written warning level on the form — I won't guess at them\./g,
      "You'll set the verbal/written warning level on the form — I won't guess at it.",
    )
    .replace(/^.*Whether the employee has previously received coaching and\/or corrective action.*\n?/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function applyOptionalPriorCoaching(
  content: string,
  input: {
    readonly enabled: boolean;
    readonly records: readonly PriorCoachingRecord[];
    readonly managerText: string;
  },
): string {
  if (!input.enabled) return content;
  const base = withoutPriorCoachingHold(content);
  if (/Prior coaching (?:is optional|on file|note:)/.test(base)) return base;

  const finalized = input.records.filter((record) => record.status === "finalized").map((record) => record.line);
  const note = typedPriorCoachingNote(input.managerText);
  let addition: string;
  if (finalized.length > 0) {
    addition = `Prior coaching on file (finalized only): ${finalized.join("; ")}. Drafts are not used. The draft can still be created.`;
  } else if (/On file in Form Monitoring/i.test(base)) {
    addition = "Prior coaching already listed from Form Monitoring stays on the form. Drafts are not used. The draft can still be created.";
  } else if (note) {
    addition = `Prior coaching note: ${note}. No finalized record was required. The draft can still be created.`;
  } else {
    addition =
      "Prior coaching is optional. No finalized record is in this app and no note was given, so the line stays blank. The draft can still be created.";
  }
  return `${base}\n\n${addition}`;
}
