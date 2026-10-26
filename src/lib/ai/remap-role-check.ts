import { remapRoleCheckEnabled } from "@/lib/config/chat-quality-flags";
import { TEMPLATE_SEEDS } from "@/lib/forms/library";
import type { TemplateSummary } from "@/lib/forms/repository";
import { DEFAULT_PERMISSION_MATRIX, hasPermission } from "@/lib/permissions";
import type { Permission, Role } from "@/types";

import type { AskResponse } from "./types";

/**
 * ============================================================================
 * A REMAP CARD IS SHOWN ONLY TO A ROLE THAT MAY CREATE ITS FORM
 * ============================================================================
 *
 * REMAP_ROLE_CHECK_ENABLED (QA, 25 Oct 2026). With FORM_FULL_REMAP_ENABLED on,
 * `answerQuestion` returned the remap's card before the proposal path ran, and
 * the remap never read the actor's role. So an Employee or an Assistant Salon
 * Director asking for "a coaching form for …" was shown a Coaching Form card
 * that the server then refused with a 403 on Create.
 *
 * The proposal path already decides this from the template's own
 * `required_permission` and the default permission matrix, and refuses with
 * "Your role cannot create a **X**, so I will not propose one". This reads the
 * same permission the same way. When it says no, the caller drops the remap
 * card and lets the turn fall through to the proposal path, so the refusal and
 * the list of forms the role may start are that path's own, word for word.
 *
 * The permission is read from the template summaries the proposal path uses;
 * a template the library did not return is read from the seed the remap names
 * its form from. A template with neither, or an actor with no role, is not
 * shown the card either: the proposal path decides it.
 *
 * Off, and for a role that may create the form, the remap answer is returned
 * exactly as before.
 */
export function remapCardNotPermitted(input: {
  readonly response: AskResponse;
  readonly role: Role | null;
  readonly summaries: readonly TemplateSummary[];
}): boolean {
  if (!remapRoleCheckEnabled()) return false;
  const templateKey = input.response.formProposal?.templateKey;
  if (!templateKey) return false;
  if (!input.role) return true;
  const permission =
    input.summaries.find((summary) => summary.key === templateKey)?.requiredPermission ??
    TEMPLATE_SEEDS.find((seed) => seed.key === templateKey)?.requiredPermission ??
    null;
  if (!permission) return true;
  return !hasPermission(DEFAULT_PERMISSION_MATRIX, input.role, permission as Permission);
}
