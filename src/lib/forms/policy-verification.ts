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
 * `provenance.verified` is written by exactly two things, and neither of them
 * is a model: `provenanceFor`, from a retrieval above the match floor, and
 * `formDerivedProvenance`, for the one field whose value is COPIED OFF THE FORM
 * — the ticked offense category, which makes no claim about a manual and so has
 * no manual to be checked against. `applyAssistantDraft` then refuses to write
 * a policy-grounded value that carries neither, so Ask Sunny cannot produce an
 * unverified one.
 *
 * Which makes the inverse informative: an unverified policy value on a form is
 * necessarily one a PERSON typed. `saveInstanceValues` writes
 * `filled_by: "manager"` and no provenance at all. That is a legitimate thing
 * for a manager to do — they may have read the manual themselves — and it is
 * not something the app may quietly present as sourced.
 *
 * THE FIELD THAT NAMES A MANUAL IS STILL THE ONE THAT GATES A FINALIZE. On the
 * current published version `policy_violated` is not policy-grounded at all and
 * never reaches this function; on the version published before it was redefined
 * it is, and its derived provenance makes those older instances behave like the
 * new ones rather than asking for an acknowledgement over a tick box.
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

export const POLICY_ACKNOWLEDGEMENT_TITLE = "Woven does not see this policy in the knowledge base";

export const POLICY_ACKNOWLEDGEMENT_MESSAGE =
  "Woven does not see this policy in the knowledge base, so the policy on this form could not be verified. Review the applicable company policy before issuing this Corrective Action Form. If you have verified the policy yourself, you may continue.";

/**
 * ============================================================================
 * "YOU EDITED THE POLICY WORDING" ONLY WHEN THAT IS WHAT HAPPENED
 * ============================================================================
 *
 * HR, 22 Oct 2026: Sunny quoted the Standards of Conduct from the manual, the
 * manager rewrote the quote, and Finalize said Woven does not see the policy.
 * It does — the wording on the form is simply no longer the manual's.
 *
 * Edited means the field now holds a person's text AND Sunny had written it.
 * Sunny writes a policy value only with verified provenance (see above), so a
 * policy field named in a `drafted` event was verified when written; a
 * revision carries its original's verified values over. A field a person
 * filled in where Sunny wrote nothing was never verified, so it is not called
 * an edit, and a blank field still means Woven matched no policy.
 */
export const POLICY_EDITED_TITLE = "You edited the policy wording";

export const POLICY_EDITED_MESSAGE =
  "You edited the policy wording on this form, so Ask Sunny can't confirm it still matches the policy manual. Review it against the applicable company policy before issuing this Corrective Action Form. If you have verified the policy yourself, you may continue.";

/** The form's events, as both the server and the browser hold them. */
export interface PolicyEventRow {
  readonly kind: string;
  readonly detail?: Record<string, unknown> | null;
}

/** Whether Sunny wrote this field at some point — and so had verified it. */
export function assistantWroteField(events: readonly PolicyEventRow[], key: string): boolean {
  return events.some(
    (event) => event.kind === "drafted" && Array.isArray(event.detail?.fields) && event.detail.fields.includes(key),
  );
}

/** True when every unverified policy field holds a person's change to wording Sunny had written. */
export function policyWordingEdited(
  fields: readonly Pick<UnverifiedPolicyField, "key" | "filled">[],
  events: readonly PolicyEventRow[],
  isRevision = false,
): boolean {
  return (
    fields.length > 0 &&
    fields.every((field) => field.filled && (isRevision || assistantWroteField(events, field.key)))
  );
}

/** The acknowledgement's title and message for these unverified fields. */
export function policyAcknowledgementWording(
  fields: readonly Pick<UnverifiedPolicyField, "key" | "filled">[],
  events: readonly PolicyEventRow[],
  isRevision = false,
): { title: string; message: string } {
  return policyWordingEdited(fields, events, isRevision)
    ? { title: POLICY_EDITED_TITLE, message: POLICY_EDITED_MESSAGE }
    : { title: POLICY_ACKNOWLEDGEMENT_TITLE, message: POLICY_ACKNOWLEDGEMENT_MESSAGE };
}
