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
 *   checkbox_group, numbered_list, signature_row, page_break) and takes its
 *   edit permission from `canPersonEdit`. It is generic; there was never a
 *   coaching-shaped assumption in it.
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
 * WHY THE EPPs AND THE HIRING FORMS ARE STILL OUT
 * ============================================================================
 *
 * NOT CAUTION — A MISSING PIECE, and a specific one. The four EPPs and the two
 * DMIT readings all declare VARIANTS, and their field labels are written as
 * `{{role}}` and `{{roleAbbr}}` because one document is printed as several
 * reviews. `createInlineForm` sends no `variantKey`, so an instance created
 * from chat would pin a variant of `null` and interpolate to "the employee":
 * "In what areas is the the employee currently succeeding?" — on a performance
 * plan. Choosing which review is being written is a question nothing in the
 * chat flow asks yet, so `variantsAllowInline` below refuses structurally
 * rather than trusting this list to stay correct.
 *
 * The hiring forms are out for a different reason: their subject is a
 * CANDIDATE, and the whole proposal path — `resolveEmployee`, the employee
 * question, `form_instances.employee_name` — is built around an employee who is
 * already on the team. `template-intent.ts` has no hiring matchers either, so
 * nothing routes to them from a sentence today.
 */
const INLINE_DRAFT_TEMPLATE_KEYS: ReadonlySet<string> = new Set([
  "coaching",
  // The Corrective Action Form. Its stored key has always been `dpoa`.
  "dpoa",
  "policy-review",
  "follow-up-coaching",
]);

/**
 * The structural half of the rule: a template printed in more than one reading
 * cannot be created from chat, whatever the list above says.
 *
 * Separate from the list so the two failure modes stay separate. The list is a
 * product decision about which workflows have been built; this is a fact about
 * the document. If somebody adds variants to a template that is in the list,
 * this is what stops the chat flow silently pinning `null` for them.
 */
export function variantsAllowInline(variants: readonly FormVariant[]): boolean {
  return variants.length === 0;
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
