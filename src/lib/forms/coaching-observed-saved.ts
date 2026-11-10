import { coachingObservedSavedEnabled } from "@/lib/config/chat-quality-flags";
import { businessToday } from "@/lib/business-date";
import { managerWordsObservation } from "@/lib/forms/draft-never-blank";
import { datesInText } from "@/lib/forms/form-date-answer";
import { OBSERVED_LABEL } from "@/lib/forms/narrative-draft";

/**
 * ============================================================================
 * THE SAVED COACHING DETAILS ALWAYS HAVE AN "Observed:" WITH THE ACCOUNT (COACHING_OBSERVED_SAVED_ENABLED)
 * ============================================================================
 *
 * QA's P12 (10 Nov 2026, live in both apps): "make me a coaching form for <name> not hitting October numbers" →
 * Create saved Details of Coaching with no "Observed:" heading, or an empty one. The manager's few words are no account
 * the never-blank reader takes ("not hitting October numbers" has no verb it reads), so a model that wrote nothing left
 * the field blank; a model that wrote only the Expectation lost its empty "Observed:" to the guards; a model that wrote
 * plain sentences saved them with no heading.
 *
 * With the flag on, a coaching narrative field (the "observed_expectation" shape) about to be saved:
 *   - with text but no "Observed:" — the text is put under "Observed:";
 *   - with no "Observed:" text (blank, or only an Expectation) — "Observed:" is written first, with the manager's own
 *     words: what follows the employee's name in the request ("Not hitting October numbers."), else the never-blank
 *     reader's clause, without its date phrases (the form's Date holds the date, and a dated sentence of the manager's
 *     is protected from a later "make it about …" rewrite).
 * A field that already has an "Observed:" with text is left as it is. Pure.
 */

const HEADING = /^\s*(Observed|Expectation|Going Forward):/im;
const OBSERVED = /(^|\n)\s*Observed:[ \t]*\n?([\s\S]*?)(?=\n\s*(?:Expectation|Going Forward):|$)/i;

const POLICY_LINE = /^\s*Policy reference:[^\n]*$/i;

/** The field split into its own text and the app's "Policy reference: …" lines. */
function withoutPolicyLines(text: string): { body: string; policy: string } {
  const lines = text.split("\n");
  return {
    body: lines.filter((line) => !POLICY_LINE.test(line)).join("\n").replace(/\n{3,}/g, "\n\n").trim(),
    policy: lines.filter((line) => POLICY_LINE.test(line)).map((line) => line.trim()).join("\n"),
  };
}

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** What follows the employee's name in the request turn ("… for Brisa Talvenor not hitting October numbers"). */
export function requestAccount(notes: string, employeeName: string | null): string | null {
  if (!employeeName) return null;
  const turns = notes.split(/\n{2,}/).map((turn) => turn.trim()).filter(Boolean);
  const name = escaped(employeeName.trim()).replace(/\s+/g, "\\s+");
  for (const turn of [...turns].reverse()) {
    const after = new RegExp(`\\b${name}\\b[\\s,:;-]*(?:(?:for|about|on|because|regarding|due\\s+to)\\s+)?(.+)$`, "is").exec(turn)?.[1]?.trim();
    if (after && after.split(/\s+/).length >= 2) {
      const sentence = `${after.charAt(0).toUpperCase()}${after.slice(1)}`;
      return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
    }
  }
  return null;
}

/** The account without its date phrases ("on 10/10/26"): the form's Date holds the date. */
function withoutDatePhrases(text: string): string {
  let out = text;
  for (const date of [...datesInText(text, businessToday())].sort((a, b) => b.index - a.index)) {
    out = `${out.slice(0, date.index).replace(/(?:,?\s+(?:on|dated)|,)?\s*$/i, "")}${out.slice(date.end)}`;
  }
  return out.replace(/\s+([.,;:!?])/g, "$1").replace(/[ \t]{2,}/g, " ").trim();
}

function managerAccount(notes: string, employeeName: string | null): string | null {
  const account = rawAccount(notes, employeeName);
  return account ? withoutDatePhrases(account) || account : null;
}

function rawAccount(notes: string, employeeName: string | null): string | null {
  // What follows the name first: the never-blank reader's clause can carry the request's own lead ("Create a coaching form for …").
  const after = requestAccount(notes, employeeName);
  if (after) return after;
  const words = managerWordsObservation(notes, employeeName);
  return words ? words.replace(new RegExp(`^${escaped(OBSERVED_LABEL)}\\s*`), "").trim() : null;
}

export function withCoachingObservedSaved(input: {
  values: Record<string, unknown>;
  narrativeKeys: readonly string[];
  coaching: boolean;
  notes: string;
  employeeName: string | null;
}): Record<string, unknown> {
  if (!coachingObservedSavedEnabled() || !input.coaching || input.narrativeKeys.length === 0) return input.values;
  const key = input.narrativeKeys[0]!;
  const current = typeof input.values[key] === "string" ? (input.values[key] as string) : "";
  const observed = OBSERVED.exec(current);
  if (observed && observed[2]!.trim() !== "") return input.values;
  // The policy set-aside line ("Policy reference: …") is the app's, never the account: it stays after, and is never put
  // under "Observed:" (QA's #755 NO-GO: that made it the manager's protected account, and the later edit was refused).
  const { body, policy } = withoutPolicyLines(current);
  const after = (text: string) => [text, policy].filter(Boolean).join("\n\n");
  if (body !== "" && !HEADING.test(body)) {
    return { ...input.values, [key]: after(`${OBSERVED_LABEL}\n${body}`) };
  }
  const account = managerAccount(input.notes, input.employeeName);
  if (!account) return input.values;
  const rest = body.replace(/(^|\n)\s*Observed:[ \t]*\n?(?=\s*(?:\n|$|Expectation:|Going Forward:))/i, "$1").trim();
  return { ...input.values, [key]: after(`${OBSERVED_LABEL}\n${account}${rest ? `\n\n${rest}` : ""}`) };
}
