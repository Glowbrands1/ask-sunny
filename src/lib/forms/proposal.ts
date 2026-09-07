import "server-only";

import { MANAGER_CONTEXT_CHARS, MANAGER_CONTEXT_TURNS } from "./context-limits";
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
 * Bounded window of manager turns used as provenance and as drafting input.
 * The numbers live in `context-limits.ts` because the browser assembles the
 * same bounded notes from the same conversation and must not hold a second copy
 * of them. Re-exported so this module stays the one thing callers import.
 */
export { MANAGER_CONTEXT_CHARS, MANAGER_CONTEXT_TURNS } from "./context-limits";

/** Separator between retained turns. Counted against the budget, not ignored. */
const JOIN = "\n\n";

/**
 * Appended when the CURRENT message alone is longer than the whole budget.
 *
 * A silent cut is the failure mode to avoid: the model would draft from a
 * partial account with no way of knowing it was partial, and the manager would
 * have no way of seeing that either.
 */
const TRUNCATION_MARKER =
  "\n[This message was longer than Ask Sunny reads at once and was cut here.]";

export interface ManagerContext {
  /**
   * RETAINED turns only, restored to chronological order — oldest first, the
   * message being answered last.
   *
   * "Retained" is the load-bearing word. A turn that did not fit the character
   * budget is absent from this list entirely, rather than present-but-unused,
   * so nothing downstream can quote a turn that was never supplied to drafting.
   *
   * `id` is optional because it is BROWSER-LOCAL PROVENANCE, not authority: a
   * conversation lives in IndexedDB, and a client that sends history without
   * ids still gets a correct proposal — it just gets one that cannot point back
   * at which turn each fact came from.
   */
  messages: { id?: string; content: string }[];
  /** Ids of the RETAINED messages, for `ChatFormProposal.sourceMessageIds`. */
  ids: string[];
  /** The retained turns, joined. Never persisted as an HR value. */
  text: string;
  /** True when the current message alone exceeded the budget and was cut. */
  truncated: boolean;
}

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
 * BOUNDED, because "the whole conversation" is not context, it is everything
 * the manager has ever mentioned — including a different employee, last week.
 *
 * ============================================================================
 * NEWEST FIRST — THE REMEDIATION
 * ============================================================================
 *
 * THE DEFECT. This walked the retained turns OLDEST -> NEWEST and stopped at the
 * first one that would overflow the character budget. So old content, which had
 * already been said and possibly already been superseded, spent the budget
 * before the manager's newest words were ever considered:
 *
 *   turn 1 (long)  "Sarah was late three times this week..."
 *   turn 2         "Correction — it was twice, not three times."   <- DROPPED
 *
 * The correction is the one sentence that must not be lost. Every other
 * failure here produces a thin draft; this one produces a CONFIDENT WRONG draft,
 * stating an occurrence count on a disciplinary record that the manager had
 * explicitly retracted.
 *
 * SO RETENTION RUNS IN PRIORITY ORDER AND PRESENTATION RUNS IN TIME ORDER:
 *
 *   1. The current turn is retained first, always. It is what the manager is
 *      saying right now, and it can never be crowded out by older content.
 *   2. Prior turns are then considered NEWEST -> OLDEST while budget remains.
 *   3. The retained set is sorted back into chronological order before it is
 *      handed to drafting, because "then... then... then" is how an account
 *      reads and reversing it would misstate the sequence of events.
 *
 * STOP, DO NOT SKIP. When a prior turn does not fit, the walk STOPS rather than
 * skipping it to squeeze in an older, shorter one. Skipping would reintroduce
 * the same recency inversion in miniature — an older statement surviving while
 * a newer one is dropped — which is the exact defect being fixed.
 */
export function managerContext(
  history: Pick<ChatMessage, "id" | "role" | "content" | "error">[],
  current: { id?: string; content: string },
): ManagerContext {
  const priorTurns = history
    .filter((message) => message.role === "user" && !message.error)
    .filter((message) => typeof message.content === "string" && message.content.trim() !== "")
    .slice(-(MANAGER_CONTEXT_TURNS - 1))
    .map((message) => ({ id: message.id, content: message.content.trim() }));

  /* 1. The current turn, first claim on the budget. */
  let currentContent = current.content.trim();
  let truncated = false;
  if (currentContent.length > MANAGER_CONTEXT_CHARS) {
    truncated = true;
    currentContent =
      currentContent.slice(0, Math.max(0, MANAGER_CONTEXT_CHARS - TRUNCATION_MARKER.length)) +
      TRUNCATION_MARKER;
  }

  const retained = [{ id: current.id, content: currentContent }];
  let remaining = MANAGER_CONTEXT_CHARS - currentContent.length;

  /* 2. Prior turns, newest first, while they fit whole. */
  for (let index = priorTurns.length - 1; index >= 0; index -= 1) {
    const turn = priorTurns[index]!;
    const cost = turn.content.length + JOIN.length;
    if (cost > remaining) break;
    // `unshift` keeps `retained` in chronological order as it grows, so step 3
    // is already done by the time the loop ends.
    retained.unshift(turn);
    remaining -= cost;
  }

  /* 3. Chronological order, which `unshift` above has maintained. */
  return {
    messages: retained,
    ids: retained
      .map((message) => message.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0),
    text: retained.map((message) => message.content).join(JOIN),
    truncated,
  };
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

  const NAME = "[A-Z][a-zA-Z'’-]+";
  const FULL = new RegExp(`\\b(${NAME}(?:\\s+${NAME})+)\\b`, "g");
  for (const match of text.matchAll(FULL)) {
    const candidate = match[1]!.trim();
    if (!candidate.split(/\s+/).some((word) => NOT_A_NAME.has(word.toLowerCase()))) {
      found.push(candidate);
    }
  }

  const PREPOSED = new RegExp(`\\b(?:for|about|with|regarding)\\s+(${NAME})\\b`, "g");
  for (const match of text.matchAll(PREPOSED)) {
    const candidate = match[1]!.trim();
    if (!NOT_A_NAME.has(candidate.toLowerCase())) found.push(candidate);
  }

  const whole = text.trim().replace(/[.?!]+$/, "");
  if (new RegExp(`^${NAME}(?:\\s+${NAME})?$`).test(whole) && !NOT_A_NAME.has(whole.toLowerCase())) {
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
   * ORDER MATTERS: the employee is asked for before the salon. A manager who
   * has not said who the form is about cannot usefully be asked which salon it
   * belongs to, and asking two questions at once gets one answer.
   */
  const status: ChatFormProposal["status"] =
    employeeName === null ? "needs_employee" : locationId === null ? "needs_location" : "ready";

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
    status,
    sourceMessageIds: input.context.ids,
  };
}
