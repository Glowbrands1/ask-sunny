import "server-only";

import { isFormVocabulary } from "./template-intent";
import { boundManagerTurns, type BoundedContext } from "./bounded-context";
import { proposeLocation } from "./location-scope";
import type { AccessScope, ChatFormProposal, ChatMessage } from "@/types";

/**
 * ============================================================================
 * FROM A CONVERSATION TO A FORM PROPOSAL — DETERMINISTICALLY
 * ============================================================================
 *
 * WHICH FORM, WHO IT IS ABOUT, AND WHICH SALON ARE CODE DECISIONS. A language
 * model is excellent at drafting the prose inside a coaching form and has no
 * business choosing the frame around it: the template, the employee's identity
 * and the location on a disciplinary record are facts, and a model that is
 * uncertain about a fact produces a plausible one.
 *
 * So this module reads the conversation and returns either a proposal or a
 * question. It never invents a value to fill a gap.
 *
 * ============================================================================
 * WHAT THIS REPLACES, AND WHY IT HAD TO GO
 * ============================================================================
 *
 * The prototype flow it supersedes did all of the following when the manager
 * had not supplied them:
 *
 *   employee            -> "Jane Kowalski"
 *   topic               -> "repeated tardiness"
 *   incident details    -> "Arrived after the start of a scheduled shift on
 *                          three occasions in the past two weeks, between ten
 *                          and twenty minutes late each time."
 *   employee role       -> "Tanning Consultant"
 *   expected action     -> a generated sentence about meeting the standard
 *   follow-up           -> today + 14 days
 *
 * Every one of those is a load-bearing fact on an employment document, and
 * every one was a default. Harmless in a demo; indefensible the moment the
 * record is real. There are no fallbacks in this file. A missing fact is
 * reported as missing.
 */

/*
 * `detectTemplateIntent` used to live here and now lives in `template-intent.ts`
 * — pure, and importable from the browser bundle so the preview provider reads
 * a sentence the same way the server does. This module stays server-only
 * because a proposal depends on the authenticated scope.
 */

/*
 * The bounded window's NUMBERS and its ALGORITHM both live in
 * `bounded-context.ts`, which is pure and importable from the browser bundle.
 * The browser bounds the same conversation again when it assembles drafting
 * notes, and two implementations of one rule is exactly how the two answers
 * drifted apart. Re-exported so this module stays the one thing callers import.
 */
export { MANAGER_CONTEXT_CHARS, MANAGER_CONTEXT_TURNS } from "./bounded-context";

export type ManagerContext = BoundedContext;

/**
 * ============================================================================
 * MANAGER TURNS ONLY
 * ============================================================================
 *
 * The eventual form must be based on what the MANAGER said. An assistant turn
 * is Sunny's interpretation of what the manager said, and promoting an
 * interpretation to a factual HR record is the worst failure available here —
 * it is also the one nobody would notice, because the wording reads fine.
 *
 * So assistant turns are excluded structurally rather than filtered by
 * heuristic: only `role === "user"` is read, and a turn carrying an `error` is
 * skipped because a failed turn is not something anybody said.
 *
 * THE BOUNDING ITSELF IS NOT HERE. This function decides WHO SPOKE; the window
 * decides HOW MUCH FITS. Keeping them apart is what lets the browser apply the
 * identical window to the identical turns — see `bounded-context.ts` for the
 * recency rule and why it exists.
 */
export function managerContext(
  history: Pick<ChatMessage, "id" | "role" | "content" | "error">[],
  current: { id?: string; content: string },
): ManagerContext {
  const prior = history
    .filter((message) => message.role === "user" && !message.error)
    .filter((message) => typeof message.content === "string" && message.content.trim() !== "")
    .map((message) => ({ id: message.id, content: message.content }));

  return boundManagerTurns(prior, current);
}

/* ------------------------------------------------------- employee intent -- */

const NOT_A_NAME = new Set([
  "a", "an", "the", "my", "our", "this", "that", "them", "him", "her", "it",
  "me", "us", "someone", "somebody", "everyone", "everybody", "today",
  "tomorrow", "yesterday", "monday", "tuesday", "wednesday", "thursday",
  "friday", "saturday", "sunday",
]);

export type EmployeeResolution =
  | { kind: "resolved"; employeeName: string }
  | { kind: "missing" }
  /** More than one plausible person. The manager says which; Sunny does not. */
  | { kind: "ambiguous"; candidates: string[] };

/**
 * Names the manager mentioned, in their own turns.
 *
 * CONSERVATIVE ON PURPOSE. The prototype accepted a capitalised first word,
 * which turned "Create a coaching form for a performance concern" into an
 * employee called **Create** — invisible while it only appeared in demo prose,
 * and a name on somebody's employment file the moment the record was real.
 *
 * Two shapes are accepted: an explicit `for <Name>` / `about <Name>`, and a
 * capitalised full name anywhere. A lone capitalised word is accepted only when
 * it is the entire message — which is what a manager types when Sunny has just
 * asked who the form is for.
 */
export function extractEmployeeNames(text: string): string[] {
  const found: string[] = [];

  /*
   * A WORD THAT NAMES A FORM NEVER NAMES A PERSON.
   *
   * "Coaching Form for Sarah Test, she was late today" used to yield TWO
   * candidates — "Coaching Form" and "Sarah Test" — so the turn was ambiguous
   * and Ask Sunny asked who the form was about, having just been told. Every
   * template with two capitalised words in its name had the same fault, and
   * capitalising the form's name is the most natural way to ask for one.
   */
  const notAName = (word: string) =>
    NOT_A_NAME.has(word.toLowerCase()) || isFormVocabulary(word);

  const NAME = "[A-Z][a-zA-Z'’-]+";
  const FULL = new RegExp(`\\b(${NAME}(?:\\s+${NAME})+)\\b`, "g");
  for (const match of text.matchAll(FULL)) {
    const candidate = match[1]!.trim();
    if (!candidate.split(/\s+/).some(notAName)) {
      found.push(candidate);
    }
  }

  const PREPOSED = new RegExp(`\\b(?:for|about|with|regarding)\\s+(${NAME})\\b`, "g");
  for (const match of text.matchAll(PREPOSED)) {
    const candidate = match[1]!.trim();
    if (!notAName(candidate)) found.push(candidate);
  }

  const whole = text.trim().replace(/[.?!]+$/, "");
  if (new RegExp(`^${NAME}(?:\\s+${NAME})?$`).test(whole) && !whole.split(/\s+/).some(notAName)) {
    found.push(whole);
  }

  // De-duplicated, and a bare first name that is part of a full name already
  // found is the same person rather than a second candidate.
  const unique: string[] = [];
  for (const name of found) {
    if (unique.some((kept) => kept === name)) continue;
    if (unique.some((kept) => kept.split(/\s+/)[0] === name || name.split(/\s+/)[0] === kept)) {
      // Keep the longer form: "Sarah Jones" over "Sarah".
      const index = unique.findIndex(
        (kept) => kept.split(/\s+/)[0] === name.split(/\s+/)[0],
      );
      if (index >= 0 && name.length > unique[index]!.length) unique[index] = name;
      continue;
    }
    unique.push(name);
  }
  return unique;
}

/**
 * Who the form is about, read from MANAGER turns only, most recent first.
 *
 * There is no employee directory in Ask Sunny and none is invented here: the
 * value is the manager's own words, and `form_instances.employee_name` has
 * always been free text.
 */
export function resolveEmployee(context: ManagerContext): EmployeeResolution {
  for (const message of [...context.messages].reverse()) {
    const names = extractEmployeeNames(message.content);
    if (names.length === 1) return { kind: "resolved", employeeName: names[0]! };
    if (names.length > 1) return { kind: "ambiguous", candidates: names };
  }
  return { kind: "missing" };
}

/* ------------------------------------------------------------- proposal -- */

export interface ProposalInput {
  proposalId: string;
  templateKey: string;
  templateName: string;
  context: ManagerContext;
  scope: AccessScope | null;
  /**
   * Whether THIS TEMPLATE can be created and edited without leaving chat.
   *
   * Passed in rather than decided here: which templates the inline editor
   * supports is a phase-by-phase product fact, and this module's job is reading
   * a conversation. The caller reads it off the validated library row.
   */
  inlineDraftSupported: boolean;
}

/**
 * Assembles the proposal from parts that were each established, not guessed.
 *
 * THE TEMPLATE IS ALREADY VALIDATED by the time this is called — the caller
 * resolves it against the published, active library, so a key this module
 * detected can never reach a proposal unless a real published template answers
 * to it.
 */
export function buildProposal(input: ProposalInput): ChatFormProposal {
  const employee = resolveEmployee(input.context);
  const location = proposeLocation(input.scope);

  const employeeName = employee.kind === "resolved" ? employee.employeeName : null;
  const locationId = location.resolution === "resolved" ? location.locationId : null;
  /*
   * `not_applicable` IS AN ANSWER, NOT A GAP. A global actor is not assigned to
   * a salon, and the server already permits a form that names none — so the
   * proposal is ready, and the card says the form will carry no salon. Only
   * `needs_selection` (several to choose between) and `unavailable` (a salon
   * exists and cannot be verified) leave a question outstanding.
   */
  const salonSettled =
    location.resolution === "resolved" || location.resolution === "not_applicable";

  /*
   * ORDER MATTERS: the employee is asked for before the salon. A manager who
   * has not said who the form is about cannot usefully be asked which salon it
   * belongs to, and asking two questions at once gets one answer.
   */
  const status: ChatFormProposal["status"] =
    employeeName === null ? "needs_employee" : salonSettled ? "ready" : "needs_location";

  return {
    proposalId: input.proposalId,
    templateKey: input.templateKey,
    templateName: input.templateName,
    /*
     * READY, AND SUPPORTED. A proposal still missing the employee or the salon
     * offers no create action — not a disabled one, and not one that opens a
     * form with a gap in it. The gap is the reason it is not offered.
     */
    supportsInlineDraft: input.inlineDraftSupported && status === "ready",
    employeeName,
    locationId,
    /*
     * NO DISPLAY NAME. There is no salon roster to resolve one from an id, and
     * `DEMO_LOCATIONS` is seeded demo data rather than an authority — putting a
     * fictional salon name in front of a manager about to file a disciplinary
     * record is exactly the class of thing this phase exists to stop.
     */
    locationName: null,
    locationResolution: location.resolution,
    authorizedLocationIds:
      location.resolution === "needs_selection" ? location.authorizedIds : [],
    status,
    sourceMessageIds: input.context.ids,
  };
}
