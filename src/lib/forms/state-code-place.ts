import { stateCodeNotAPersonEnabled } from "@/lib/config/chat-quality-flags";

import type { BoundedContext } from "./bounded-context";
import { readEmployeeMentions, type EmployeeResolution } from "./proposal";

/**
 * Every US state's two-letter code, in any case: "NE", "ks", "Sd". Moved here
 * from `ai/remap-incident.ts`, which still reads it for "empire, sd".
 */
export const US_STATE_CODE =
  /^(?:A[LKZR]|C[AOT]|DE|FL|GA|HI|I[ADLN]|K[SY]|LA|M[ADEINOST]|N[CDEHJMVY]|O[HKR]|PA|RI|S[CD]|T[NX]|UT|V[AT]|W[AIVY])$/i;

/**
 * ============================================================================
 * "AT DODGE, NE" NAMES ONE PERSON (STATE_CODE_NOT_A_PERSON_ENABLED)
 * ============================================================================
 *
 * Production, 26 Oct 2026: "Create a CA for Odalys Merriweather at Dodge, NE.
 * She did not clock in on 10/22." showed the card, and Create was refused:
 * the conversation "names more than one person (Odalys Merriweather, NE)".
 * The create route re-reads who the conversation names
 * (`proposal-currency.ts`). "did not clock" reads "not clock" as somebody
 * the form is NOT for, which makes the turn a correction, and a correction
 * reads every comma clause of one or two words as a name. "NE" is such a
 * clause. "never", "didn't" and "no call" are not "not", so those turns were
 * created.
 *
 * With the flag on, a state code the reader took for a person is checked
 * against where the manager typed it. After a place and a comma ("Dodge,
 * NE", "grand island, ne", "the Kearney, NE salon") it is the place's state,
 * so that ", NE" is taken out and the turns are read again. Anybody else the
 * conversation names is still there, so two people are still two people.
 *
 * WHAT STAYS A NAME:
 *   - a state code that is not a candidate: "Ne Oakes" is one person, and
 *     "SD" (a job title) never reaches this;
 *   - a code after a candidate's own surname ("Odalys Merriweather, NE"):
 *     that is the shape of a list of people, so it is still a question;
 *   - "Dodge, Ne Oakes", "Dodge, Al did not …": a code in title case
 *     followed by a word is the start of a name.
 *
 * Off, the conversation is read as typed.
 */
export function stateCodePlaceContext(context: BoundedContext, resolution: EmployeeResolution): BoundedContext | null {
  if (!stateCodeNotAPersonEnabled()) return null;
  // What the reader took for a person, before any filter: GROUNDED_ENTITIES_ENABLED drops a roster
  // state from the people, but the clause it came from still decides the turn (a form's subject is
  // not the only person given), so it is looked for in every turn's own reading.
  const candidates = [
    ...(resolution.kind === "ambiguous" ? resolution.candidates : resolution.kind === "resolved" ? [resolution.employeeName] : []),
    ...context.messages.flatMap((message) => readEmployeeMentions(message.content).names),
  ];
  const codes = new Set(
    candidates
      .map((candidate) => candidate.trim().replace(/[.,;:!?]+$/, ""))
      .filter((candidate) => /^[A-Za-z]{2}$/.test(candidate) && US_STATE_CODE.test(candidate))
      .map((code) => code.toUpperCase()),
  );
  if (codes.size === 0) return null;
  const surnames = new Set(
    candidates
      .map((candidate) => candidate.trim().split(/\s+/))
      .filter((words) => words.length >= 2)
      .map((words) => words[words.length - 1]!.toLowerCase()),
  );
  const mask = (text: string) => withoutStateCodesAfterPlace(text, codes, surnames);
  const messages = context.messages.map((message) => ({ ...message, content: mask(message.content) }));
  if (messages.every((message, index) => message.content === context.messages[index]!.content)) return null;
  return { ...context, messages, text: mask(context.text) };
}

/** A place word, a comma, then a two-letter code that ends there. */
const AFTER_PLACE = /([A-Za-z][A-Za-z'’.-]*\)?)(\s*,\s*)([A-Za-z]{2})(?![A-Za-z'’-])/g;

function withoutStateCodesAfterPlace(text: string, codes: ReadonlySet<string>, surnames: ReadonlySet<string>): string {
  return text.replace(AFTER_PLACE, (whole, place: string, _gap: string, code: string, offset: number) => {
    if (!codes.has(code.toUpperCase())) return whole;
    if (surnames.has(place.replace(/\)$/, "").toLowerCase())) return whole;
    const after = text.slice(offset + whole.length);
    // "NE." / "NE 68022" / "NE salon" / "ne she …": a state. "Ne Oakes", "Al did": a name.
    const ends = /^(?:\s*$|\s*[.,;:!?)\]]|\s+\d)/.test(after);
    const titleCase = code[0] === code[0]!.toUpperCase() && code[1] === code[1]!.toLowerCase();
    if (!ends && (titleCase || !/^\s+\S/.test(after))) return whole;
    return place;
  });
}
