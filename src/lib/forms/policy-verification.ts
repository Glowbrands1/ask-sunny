import { fieldsForVariant, type FormDocument } from "./document";

/**
 * ============================================================================
 * WHICH POLICY FIELDS NOBODY HAS VERIFIED — ONE ANSWER, THREE CALLERS
 * ============================================================================
 *
 * The same question is asked in three places, and they must not be able to
 * disagree about it:
 *
 *   THE FORM CARD, to say policy verification is still outstanding.
 *   THE FINALIZE DIALOG, to decide whether to ask for an acknowledgement.
 *   `finalizeInstance`, which REFUSES an unacknowledged finalize and is the
 *   only one of the three that is a guarantee.
 *
 * A second implementation is how the dialog would come to open on forms the
 * server waves through, or — far worse — how a manager would meet a refusal
 * with no dialog offering them a way past it. So the rule lives here, it is
 * pure, and all three import it.
 *
 * ============================================================================
 * VERIFIED MEANS PROVENANCE SAYS SO
 * ============================================================================
 *
 * `provenance.verified` is written in exactly one place — `provenanceFor`, from
 * a retrieval above the match floor. `applyAssistantDraft` then refuses to
 * write a policy-grounded value that does not carry it, so Ask Sunny cannot
 * produce an unverified one.
 *
 * Which makes the inverse informative: an unverified policy value on a form is
 * necessarily one a PERSON typed. `saveInstanceValues` writes
 * `filled_by: "manager"` and no provenance at all. That is a legitimate thing
 * for a manager to do — they may have read the manual themselves — and it is
 * not something the app may quietly present as sourced.
 *
 * ABSENT IS UNVERIFIED. A blank field and a hand-typed one are both unresolved
 * here; `filled` is reported so a caller can word the difference.
 */

/** The stored shape both the server and the browser hold a value in. */
export interface PolicyValueRow {
  readonly fieldKey: string;
  readonly value: string | null;
  readonly provenance?: Record<string, unknown>;
}

export interface UnverifiedPolicyField {
  readonly key: string;
  readonly label: string;
  /** True when somebody typed something into it that was never verified. */
  readonly filled: boolean;
}

/**
 * The policy-grounded fields on this version that no approved source backs.
 *
 * Empty for the twelve templates that quote no policy — which is what keeps
 * every other form's finalize untouched.
 */
export function unverifiedPolicyFields(
  document: FormDocument,
  variantKey: string | null,
  values: readonly PolicyValueRow[],
): UnverifiedPolicyField[] {
  const rows = new Map(values.map((row) => [row.fieldKey, row]));

  return fieldsForVariant(document, variantKey)
    .filter((field) => field.policyGrounded)
    .filter((field) => rows.get(field.key)?.provenance?.verified !== true)
    .map((field) => ({
      key: field.key,
      label: field.label,
      filled: (rows.get(field.key)?.value ?? "").trim() !== "",
    }));
}

/**
 * The refusal a finalize gets when nobody has verified the policy.
 *
 * IT IS NOT A REFUSAL TO FILE. The manager may have checked the manual
 * themselves, and the dialog says so and offers to continue — what the app
 * will not do is record the form as though it had done the checking.
 */
export const POLICY_ACKNOWLEDGEMENT_REQUIRED = "policy_verification_required";

export const POLICY_ACKNOWLEDGEMENT_MESSAGE =
  "Official policy verification is incomplete. Ask Sunny could not verify one or more policy fields from an approved policy source. Review the applicable company policy before issuing this Corrective Action Form. If you have independently verified the policy, you may continue.";
