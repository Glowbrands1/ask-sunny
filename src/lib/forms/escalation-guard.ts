import { checkboxGroupsForVariant, type FormDocument } from "./document";

/**
 * ============================================================================
 * ASK SUNNY MAY PROPOSE A RUNG. IT MAY NOT DECIDE A TERMINATION.
 * ============================================================================
 *
 * Two different rules live here, and they are different because the framework
 * treats them differently.
 *
 * THE FIRST IS REASONING. Choosing a Next Step — Continue, Role-play, EPP,
 * Corrective Action, Leadership Review — is a performance-management
 * judgement, and §10.7
 * states the order it must be made in. That order is given to the model, along
 * with the framework's own text, and the model reasons with it. Where the
 * manager's account does not support a choice, the field is left unset: a
 * guessed rung on somebody's record is worse than a blank one a manager fills
 * in deliberately.
 *
 * THE SECOND IS AUTHORITY, and no amount of reasoning satisfies it. The
 * framework's leadership escalation rule is unconditional: termination,
 * demotion, suspension and any final or sensitive employment action go through
 * the Sun Tan City leadership process, and Ask Sunny never replaces DM, HR or
 * LP approval. A manager asking "should we terminate Sarah?" is asking for
 * exactly the decision the framework reserves — so the answer is the leadership
 * route, not a ticked Termination box.
 *
 * ============================================================================
 * WHY THE SECOND RULE IS A GUARD AND NOT A PROMPT LINE
 * ============================================================================
 *
 * It is BOTH, and the guard is the half that holds. A prompt instruction is a
 * request: it is followed almost always, and "almost always" is the wrong
 * standard for a box whose meaning is that somebody lost their job. The options
 * stay on the template — they are legitimate parts of the business form, and a
 * manager acting on a leadership decision ticks them by hand — but the
 * ASSISTANT cannot select them.
 *
 * SO THE TEMPLATE IS NOT CHANGED. Nothing here removes an option, renames one,
 * or edits a published version. This filters the MODEL'S OUTPUT, which is the
 * only thing that was ever in question.
 */

/**
 * Option keys naming a final or sensitive employment action.
 *
 * Keys rather than labels: a key is part of the stored schema, a label is
 * display text a re-publish may reword. `final_warning` is deliberately ABSENT —
 * a final written warning is a documented step the manager takes, not a
 * separation, and the framework places it on the ladder rather than beyond it.
 */
export const SENSITIVE_ACTION_OPTION_KEYS: ReadonlySet<string> = new Set([
  "termination",
  "terminate",
  "demotion",
  "demote",
  "suspension",
  "suspend",
  "separation",
]);

export interface SensitiveSelectionResult {
  /** The checked map with sensitive selections removed. */
  readonly checked: Record<string, string[]>;
  /** Group key -> option keys that were refused, for the response and the trail. */
  readonly refused: Record<string, string[]>;
  /** True when anything was refused, so the caller can add the guidance. */
  readonly anyRefused: boolean;
}

/**
 * Strips a sensitive final action out of the model's checkbox selections.
 *
 * Runs on the model's OUTPUT, before validation and before anything is stored,
 * so a ticked Termination has no path to `form_instance_values` — and none to
 * the printed PDF, which renders from the stored values.
 *
 * The groups come from the STORED VERSION, so a template that does not offer a
 * sensitive option cannot have one refused, and a template published later that
 * does is covered without an edit here.
 */
export function refuseSensitiveSelections(input: {
  readonly document: FormDocument;
  readonly variantKey: string | null;
  readonly checked: Record<string, string[]>;
}): SensitiveSelectionResult {
  /** Which option keys each group legitimately offers, for cross-checking. */
  const offered = new Map<string, Set<string>>();
  for (const group of checkboxGroupsForVariant(input.document, input.variantKey)) {
    offered.set(group.key, new Set(group.options.map((option) => option.key)));
  }

  const checked: Record<string, string[]> = {};
  const refused: Record<string, string[]> = {};

  for (const [groupKey, selected] of Object.entries(input.checked)) {
    if (!Array.isArray(selected)) continue;

    // Only groups this version actually has are considered; anything else is
    // rejected downstream by `enforceResponsibilities` anyway.
    const groupOffers = offered.get(groupKey);
    if (!groupOffers) {
      checked[groupKey] = selected;
      continue;
    }

    const kept = selected.filter((option) => !SENSITIVE_ACTION_OPTION_KEYS.has(option));
    const dropped = selected.filter((option) => SENSITIVE_ACTION_OPTION_KEYS.has(option));

    if (dropped.length > 0) refused[groupKey] = dropped;
    if (kept.length > 0) checked[groupKey] = kept;
  }

  return { checked, refused, anyRefused: Object.keys(refused).length > 0 };
}

/**
 * The sentence a manager sees when a sensitive selection was refused.
 *
 * It says what was not done and where the decision goes, because a silently
 * unticked box would read as "Ask Sunny judged this not to apply" — the
 * opposite of what happened.
 */
export const SENSITIVE_ACTION_NOTICE =
  "I haven't selected a termination, demotion or suspension on this form. Those are final employment decisions and the approved process routes them through your District Manager and the appropriate leadership review rather than through me. Everything else is drafted; if leadership has already authorised a final action, tick it yourself and the form is yours to complete.";

/**
 * ============================================================================
 * THE DRAFTING RULES FOR A FORM THE FRAMEWORK GOVERNS
 * ============================================================================
 *
 * Appended to the drafting system prompt only when
 * `performanceManagementGovernance` says this form records a rung — so a plain
 * Coaching Form is not handed a page of escalation reasoning it has no decision
 * to make with.
 *
 * THE ORDER IS §10.7'S, not a paraphrase of good practice: identify the issue,
 * classify it, choose the LOWEST appropriate rung, translate it into observable
 * behaviour, connect it to impact, give the exact language, include role-play
 * where the issue is skill or confidence, follow up every time, escalate only
 * where the history supports it. The framework's own text travels alongside
 * these rules in its own block, so the model has the source and not only the
 * summary.
 *
 * THE LAST RULE IS THE ONE THAT MATTERS MOST. "Leave it unset" has to be an
 * available answer, or every under-specified account produces a guessed rung —
 * and a rung is the part of these forms that decides what happens to somebody.
 */
export const PERFORMANCE_MANAGEMENT_DRAFT_RULES: readonly string[] = [
  "THIS FORM RECORDS A STEP IN THE APPROVED CORRECTIVE-ACTION PROGRESSION. The PERFORMANCE MANAGEMENT FRAMEWORK section below is that progression. Reason from it; do not restate it in a field.",
  "Where the form asks for a next step or a level of action, work in this order: identify the issue; classify it as a skill, knowledge, confidence, effort, policy or leadership issue; then choose the LOWEST rung that fits.",
  "A skill, knowledge or confidence gap is coached, demonstrated and role-played. It does not go to a performance plan or a warning on a first occurrence.",
  "An effort or policy issue that has already been coached and documented, and has not improved, is what supports a formal step.",
  "Weigh what the manager told you about HISTORY: prior coaching, prior documentation, and whether anything improved. Absent history is not evidence of a first occurrence, and it is not evidence of a pattern either.",
  /*
   * A REPEATED INCIDENT IS NOT A PRIOR WRITE-UP, and the two are one word
   * apart in the way managers actually speak. "Late again" says the lateness
   * happened before; it says nothing about whether anybody ever documented it,
   * and a manager who has been letting it slide says exactly that sentence.
   * Reading it as a formal history puts a step on the record that never
   * happened — and the whole progression escalates on that field.
   */
  "A REPEATED BEHAVIOUR IS NOT A PRIOR CORRECTIVE ACTION. \"again\", \"keeps\", \"still\" and \"repeatedly\" tell you the conduct recurred. They do NOT tell you the employee was ever coached, warned, written up or put on a plan. Record a previous corrective action only where the manager SAID one happened — \"I gave her a verbal warning last week\" — and record \"None — first occurrence\" only where they said there was none. Otherwise leave the previous-action fields EMPTY for the manager, and never invent a date for one.",
  "NEVER SELECT A TERMINATION, DEMOTION OR SUSPENSION, and never write that one is warranted. Those are final employment decisions reserved to the Sun Tan City leadership process — District Manager, HR or Loss Prevention as applicable. If the manager asks whether to take one, draft the rest of the form and say the decision goes to leadership review.",
  "IF THE MANAGER'S ACCOUNT DOES NOT SUPPORT A CHOICE, LEAVE THE STEP UNSET and say what you would need to choose one. A guessed rung on somebody's record is worse than a blank line the manager fills in deliberately.",
];
