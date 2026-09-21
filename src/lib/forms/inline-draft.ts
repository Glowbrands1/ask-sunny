import type { FormVariant } from "./document";

/**
 * ============================================================================
 * WHICH TEMPLATES CAN BE CREATED AND EDITED WITHOUT LEAVING CHAT
 * ============================================================================
 *
 * ONE LIST, READ BY TWO CALLERS. `form-proposal.ts` reads it to decide whether a
 * proposal carries a create action; `inventory.ts` reads it to tell the manager
 * whether Sunny can make a given form here or whether they need Create a Form.
 * Those two answers must never disagree — a card offering to create a form the
 * inventory says it cannot, or an inventory promising one the card will not
 * offer, is worse than either being conservative — so the list lives here and
 * neither of them keeps a copy.
 *
 * ============================================================================
 * WHY THESE FOUR, AND WHAT WAS CHECKED BEFORE EACH WENT IN
 * ============================================================================
 *
 * The set was `["coaching"]`. Widening it is not a matter of adding keys: every
 * one of these had to be true of each template first, and each was verified
 * against the code rather than assumed.
 *
 *   THE RENDERER. `ResponsiveForm` — the one the inline editor mounts — has a
 *   case for every block kind in the document model (letterhead, section,
 *   paragraph, note, acknowledgement, reference, field, field_row,
 *   checkbox_group, numbered_list, signature_row, page_break, and the three
 *   the performance plans added — expectation_checklist, objective_rows,
 *   draft_details) and takes its edit permission from `canPersonEdit`. It is
 *   generic; there was never a coaching-shaped assumption in it.
 *
 *   THE PERMISSION. `POST /api/forms/instances` resolves the template itself
 *   and applies THAT template's `required_permission`. A Salon Director who
 *   cannot create a Corrective Action Form in Forms still cannot obtain
 *   one by asking Sunny: nothing here widens authorization, and a key in this
 *   set is offered only after that check passes.
 *
 *   THE DRAFTING GUARDS. `POST /api/forms/instances/[id]/draft` reads the field
 *   list from the version the instance is pinned to, runs
 *   `enforceResponsibilities` on what the model returned, strips unresolved
 *   placeholders, applies the narrative guard, and withholds policy-quoting
 *   fields when retrieval found no approved policy. The Corrective Action Form
 *   and the Policy
 *   Review are exactly the two templates with `policyGrounded` fields, so this
 *   is the guard that mattered most for them — and it is per-field data on the
 *   stored version, not a rule keyed on a template name, so it was already
 *   doing its job for them before they could reach it.
 *
 *   SIGNATURES. `signature_row` blocks render with no control at all and
 *   `enforceResponsibilities` rejects a signature key outright. The Corrective
 *   Action Form and
 *   Policy Review both carry two signature rows; neither is fillable.
 *
 * ============================================================================
 * THE SDIT EPP IS IN. THE REST OF THE PLANS AND THE HIRING FORMS ARE NOT.
 * ============================================================================
 *
 * WHAT USED TO KEEP EVERY EPP OUT was structural and real: all six declare
 * VARIANTS, their labels are written as `{{role}}` and `{{roleAbbr}}` because
 * one document prints as several reviews, and `createInlineForm` sent no
 * `variantKey`. An instance created from chat pinned `null` and interpolated to
 * "the employee": "In what areas is the the employee currently succeeding?" —
 * on a performance plan.
 *
 * THE MISSING PIECE WAS A CHOICE NOBODY HAD TO MAKE. The SDIT EPP declares
 * exactly ONE variant — the SDIT review, a Training Salon Director reviewing an
 * ASD — so there is no reading to choose between and no question to ask. The
 * chat flow now pins that variant explicitly (see `inlineDraftVariantKey`), and
 * the interpolation is the same one the Forms screen produces.
 *
 * THE TSD PLAN IS IN, ON THE SAME TERMS AND FOR THE SAME REASON. It declares
 * exactly one variant — the TSD review, a District Manager reviewing a
 * Training Salon Director — so there is again nothing to choose between, and
 * its conversational workflow now exists: the intake asks the five TSD
 * productivity metrics rather than the SDIT three, the eight Plan of Action
 * objectives are drafted only where the conversation supports them, and the
 * manager's own self-assessment page is `employee` responsibility throughout
 * so nothing Ask Sunny generates can reach it.
 *
 * THE DMIT EPPs STAY OUT, and that is the same rule rather than an exception to
 * it: each declares TWO readings, so which review is being written is a real
 * question and `variantsAllowInline` refuses until something asks it. The
 * ASD-SDIT and FTTC plans stay out of the LIST — they are single-variant and
 * would pass the structural test — because their conversational workflow has
 * not been built or tested. A key goes in here when its workflow ships, never
 * because it would technically work.
 *
 * The hiring forms are out for a different reason again: their subject is a
 * CANDIDATE, and the whole proposal path — `resolveEmployee`, the employee
 * question, `form_instances.employee_name` — is built around an employee who is
 * already on the team.
 */
const INLINE_DRAFT_TEMPLATE_KEYS: ReadonlySet<string> = new Set([
  "coaching",
  // The Corrective Action Form. Its stored key has always been `dpoa`.
  "dpoa",
  "policy-review",
  "follow-up-coaching",
  "sdit-epp",
  "tsd-epp",
]);

/**
 * The structural half of the rule: a template printed in more than one reading
 * cannot be created from chat, whatever the list above says.
 *
 * Separate from the list so the two failure modes stay separate. The list is a
 * product decision about which workflows have been built; this is a fact about
 * the document.
 *
 * ONE VARIANT IS NOT A CHOICE. A document with a single reading has nothing to
 * ask about: the variant is pinned to the only one there is, which is exactly
 * what the Forms screen does for it. TWO OR MORE IS STILL REFUSED, because
 * then which reading is being written is a question, and pinning the first
 * would put the wrong review on somebody's file — the same class of guess this
 * whole area exists to prevent.
 */
export function variantsAllowInline(variants: readonly FormVariant[]): boolean {
  return variants.length <= 1;
}

/**
 * The variant an inline creation pins, for a template that passed both halves.
 *
 * `null` for a document with no variants — which is what the column has always
 * held for them — and the single variant's key otherwise. Never a guess: a
 * document with several reaches this only if `supportsInlineDraft` let it, and
 * it does not.
 */
export function inlineDraftVariantKey(variants: readonly FormVariant[]): string | null {
  return variants.length === 1 ? variants[0]!.key : null;
}

/**
 * Whether THIS published version of this template can be created inline.
 *
 * Takes the variants off the version rather than off the seed, because the
 * database is the authority at runtime: an administrator who publishes a
 * version with variants has changed the answer, and the seed file has not.
 */
export function supportsInlineDraft(
  templateKey: string,
  variants: readonly FormVariant[],
): boolean {
  return INLINE_DRAFT_TEMPLATE_KEYS.has(templateKey) && variantsAllowInline(variants);
}

/** The keys the product intends to support, for tests and for the report. */
export function inlineDraftTemplateKeys(): string[] {
  return [...INLINE_DRAFT_TEMPLATE_KEYS];
}
