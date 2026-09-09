import {
  checkboxGroupsForVariant,
  fieldsForVariant,
  type FormDocument,
} from "./document";

/**
 * ============================================================================
 * WHICH FORMS THE PERFORMANCE MANAGEMENT FRAMEWORK GOVERNS
 * ============================================================================
 *
 * Drafting a Follow-Up Coaching Form asks Ask Sunny to choose a NEXT STEP from
 * Continue, Role-play, EPP, DPOA and Leadership Review. Drafting a Disciplinary
 * Plan of Action asks it to choose a TYPE OF WARNING from Verbal, Written,
 * Termination and Demotion. Those are not wording decisions. They are positions
 * on the approved corrective-action ladder, and the document that defines that
 * ladder is the Performance Management Framework.
 *
 * Before this module the framework governed the CHAT answer path and nothing
 * else, so the one place Ask Sunny actually writes an escalation onto a record
 * was the one place the ladder was absent.
 *
 * ============================================================================
 * DERIVED FROM THE STORED VERSION, NEVER FROM THE REQUEST
 * ============================================================================
 *
 * The requirement is a property of the DOCUMENT, read off the version the
 * instance is pinned to. Nothing here takes a hint from the browser, and there
 * is deliberately no parameter through which a caller could say "this one does
 * not need the framework" — that is exactly the assertion a client must never be
 * able to make about an HR record.
 *
 * IT IS ALSO NOT A LIST OF TEMPLATE KEYS. A key list would have to be edited
 * every time the library gains a form, and the edit that gets forgotten is the
 * one that leaves a new escalation-bearing template ungoverned. So three
 * independent signals are read from the stored data, and any one is enough:
 *
 *   1. THE LAYOUT FAMILY IS A RUNG. `corrective` is the DPOA and the Policy
 *      Review; `epp` and `dmit_epp` are the performance plans. Those families
 *      exist because those documents ARE rungs of the ladder, so the family is
 *      the most direct statement of it the row carries. This is what will cover
 *      EPP inline drafting the day it is enabled, with no edit here.
 *
 *   2. A FIELD QUOTES POLICY. `policyGrounded` marks the two fields that name
 *      and quote the manual. §6.4 of the framework is the rule they fail closed
 *      against — that an exact reference is verified rather than invented — so a
 *      form carrying one is a form the framework governs.
 *
 *   3. A CHECKBOX GROUP OFFERS AN ESCALATION RUNG. This is what catches the
 *      Follow-Up Coaching Form, whose layout family is `coaching` and which
 *      quotes no policy, but whose `next_step` group offers EPP, DPOA and
 *      Leadership Review. A form that can select an escalation is governed by
 *      the document that says when an escalation is appropriate.
 *
 * WHAT IS DELIBERATELY NOT GOVERNED. The plain Coaching Form: its layout family
 * is `coaching`, it quotes no policy, and its Type of Coaching options —
 * Underperformance, Training Plan of Action, Retraining — are kinds of coaching
 * rather than rungs to escalate to. It is the FIRST documented rung, and
 * drafting one commits to nothing further. The hiring forms are not governed
 * either: their subject is a candidate, and none of the three signals fires.
 *
 * That exclusion matters as much as the inclusions. The framework fails closed,
 * so governing the everyday coaching form would mean a corpus missing one
 * document could not draft the form a Salon Director reaches for most.
 */

/**
 * Option keys that name a position on the ladder, or a sensitive final action.
 *
 * Keys rather than labels: a key is part of the stored schema and a label is
 * display text that a re-publish may reword. These are the keys the seeded
 * templates use, and a template published later that reuses them is governed by
 * that fact alone.
 */
export const ESCALATION_OPTION_KEYS: ReadonlySet<string> = new Set([
  // Ladder rungs, as the Follow-Up Coaching Form's Next Step offers them.
  "role_play",
  "epp",
  "dpoa",
  "leadership_review",
  // Warning levels and final actions, as the DPOA's Type of Warning offers them.
  "written",
  "verbal",
  "final_warning",
  "termination",
  "demotion",
  "suspension",
]);

/** Layout families whose documents ARE rungs of the ladder. */
export const RUNG_LAYOUT_FAMILIES: ReadonlySet<string> = new Set([
  "corrective",
  "epp",
  "dmit_epp",
]);

export interface PerformanceManagementGovernance {
  /** Whether the framework is mandatory for drafting this version. */
  readonly governed: boolean;
  /**
   * Which signals fired, in the order they are checked. Reported rather than
   * collapsed to a boolean so an operator reading a refusal can see WHY this
   * form needed the framework.
   */
  readonly reasons: string[];
  /** Checkbox groups that offer an escalation, by key. */
  readonly escalationGroupKeys: string[];
}

/**
 * Whether drafting this stored version requires the Performance Management
 * Framework.
 *
 * `variantKey` is taken so the answer is about the document AS PRINTED — a
 * variant-scoped block belongs to one reading of the form and not to the others.
 */
export function performanceManagementGovernance(input: {
  readonly layoutFamily: string;
  readonly document: FormDocument;
  readonly variantKey: string | null;
}): PerformanceManagementGovernance {
  const reasons: string[] = [];

  if (RUNG_LAYOUT_FAMILIES.has(input.layoutFamily)) {
    reasons.push(`layout family "${input.layoutFamily}" is a rung of the ladder`);
  }

  const fields = fieldsForVariant(input.document, input.variantKey);
  const policyFields = fields.filter((field) => field.policyGrounded).map((field) => field.key);
  if (policyFields.length > 0) {
    reasons.push(`quotes approved policy in ${policyFields.join(", ")}`);
  }

  const escalationGroupKeys: string[] = [];
  for (const group of checkboxGroupsForVariant(input.document, input.variantKey)) {
    if (group.options.some((option) => ESCALATION_OPTION_KEYS.has(option.key))) {
      escalationGroupKeys.push(group.key);
    }
  }
  if (escalationGroupKeys.length > 0) {
    reasons.push(`offers an escalation in ${escalationGroupKeys.join(", ")}`);
  }

  return { governed: reasons.length > 0, reasons, escalationGroupKeys };
}

/**
 * The message a manager sees when the framework cannot be guaranteed and the
 * form they are drafting is one it governs.
 *
 * IT IS NOT AN ERROR, and that is deliberate. The form itself exists and is
 * perfectly usable: every field is editable by hand, and a manager who needs to
 * file today can. What is unavailable is Ask Sunny's DRAFT, so the response says
 * that and nothing more alarming.
 *
 * It also does not offer a general-HR fallback. A progression described from
 * general knowledge is the failure being refused, not a lesser service.
 */
export const PM_DRAFT_UNAVAILABLE_NOTICE =
  "Ask Sunny didn't draft this one. The Performance Management Framework that defines our corrective-action steps is currently unavailable, and this form records a step in that sequence — so drafting it without the framework would mean guessing at the progression. The form is ready to complete by hand, and an administrator can check that the framework document is present and indexed in the Knowledge Base.";
