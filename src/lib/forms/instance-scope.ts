import "server-only";

import { authorizeForms, type FormsActor } from "./access";
import {
  loadInstance,
  type InstanceListFilter,
  type InstanceRow,
  type LoadedInstance,
} from "./instances";
import { authorizedSalonIds } from "./location-scope";
import { getTemplateByKey } from "./repository";
import type { Permission } from "@/types";

/**
 * ============================================================================
 * AN HR RECORD THAT ALREADY EXISTS IS NOT PUBLIC TO EVERY MANAGER
 * ============================================================================
 *
 * THE GAP. Phase 2 authorized the salon a form is CREATED against. Nothing
 * authorized the salon of a form being READ, EDITED, DRAFTED, FINALIZED,
 * ARCHIVED, DELETED or EXPORTED. Every one of those routes took an id from the
 * URL and served the row, so a Salon Director at salon A who knew a UUID could
 * open — and edit, and finalize, and delete — a disciplinary record belonging to
 * salon B. Form Monitoring listed every form in the company to anybody holding
 * `view_form_monitoring`, which is every manager role.
 *
 * Creation being locked while everything after it was open is the worst shape
 * this could have taken: it reads like the boundary exists.
 *
 * ============================================================================
 * A REFUSAL IS A 404, NOT A 403 — AND THAT IS THE OPPOSITE OF CREATION
 * ============================================================================
 *
 * Creating names a salon the CALLER CHOSE, so a refusal there is a 403 that
 * says which salon and why: they need to know.
 *
 * Reading names a UUID and nothing else. A 403 would confirm that the UUID
 * names a real form at a salon they do not cover — an existence oracle over
 * other people's HR records, one guess at a time. So an unauthorized instance
 * answers exactly as a missing one does: same status, same wording. The caller
 * cannot tell the difference, which is the point.
 *
 * ============================================================================
 * WHO MAY TOUCH WHICH FORM
 * ============================================================================
 *
 *   salon actor      the form's salon must be one they are assigned to
 *   global actor     everything — that is what global means
 *   district/region  FAILS CLOSED, exactly as creation does: their
 *                    `primaryAreaId` is an area id and nothing expands an area
 *                    into its salons, so "is this salon in your district?" has
 *                    no truthful answer yet
 *   demo (no scope)  not enforced — a scope the browser asserted about itself
 *                    is not a security control, and preview QA needs the data
 *
 * THE NULL-LOCATION RULE. A form can legitimately carry no salon: Phase 2 lets
 * a manager create one without naming a location, and older rows predate the
 * column being used. Refusing everybody would strand real work, and allowing
 * everybody would make `locationId: null` a way to opt out of the boundary.
 * So a form with no salon belongs to WHOEVER CREATED IT, and to global actors.
 * That keeps every manager's own work reachable without opening anybody else's.
 */

/** What the caller is trying to do, which decides how hard the permission is. */
export type InstanceAction =
  /** Read it: Form Monitoring, the inline editor's fetch, the PDF. */
  | "view"
  /** Change its content: save, assistant draft, finalize, revise, follow-up. */
  | "edit"
  /** Manage the record itself: archive, restore, delete. */
  | "manage";

/**
 * May this actor touch this form at all?
 *
 * Exported separately from the guard so the LIST path can apply the identical
 * rule to many rows without a request per row — and so the two can never
 * disagree, which is what a hand-written `where` clause beside a guard always
 * eventually does.
 */
export function actorMaySeeInstance(actor: FormsActor, instance: InstanceRow): boolean {
  // Demo: unverified identity, no scope, no enforcement. See `location-scope`.
  if (!actor.scope) return true;

  if (actor.scope.level === "global") return true;

  /*
   * ==========================================================================
   * A LOCATION-BEARING RECORD IS DECIDED BY THE CURRENT SCOPE. FULL STOP.
   * ==========================================================================
   *
   * THE ORDER OF THESE TWO BRANCHES IS THE WHOLE FIX. `createdBy === actor.id`
   * used to be tested FIRST, above the location rule, so authorship overrode
   * assignment:
   *
   *   A manager files a coaching record at salon A.
   *   They transfer, and their scope becomes salon B.
   *   Their AccessScope no longer covers salon A at all.
   *   They could still open, edit, finalize, archive and delete that record —
   *   and download its PDF — because they had once created it.
   *
   * Authorization here answers "may this person see this salon's HR records
   * TODAY", and the answer changed when they moved. It also quietly punched
   * through the district/region fail-closed rule for any historical record
   * those actors had created themselves.
   *
   * So a record that names a salon is decided by the salon, and nothing else.
   */
  if (instance.locationId) {
    if (actor.scope.level === "salon") {
      return authorizedSalonIds(actor.scope).includes(instance.locationId);
    }
    // district | region — fails closed, exactly as creation does.
    return false;
  }

  /*
   * ==========================================================================
   * AND THIS IS WHERE THE CREATOR EXCEPTION BELONGS
   * ==========================================================================
   *
   * A record naming NO salon has no scope to be decided by. Phase 2 lets a
   * manager create one without a location, and older rows predate the column
   * being used. Refusing everybody would strand real work; allowing everybody
   * would make `locationId: null` the way to opt out of the boundary.
   *
   * So it belongs to whoever created it — and to nobody else below global.
   * That is a narrow exception about an ABSENT salon, not an override of a
   * present one.
   */
  return instance.createdBy === actor.id;
}

/**
 * ============================================================================
 * THE SAME RULE, EXPRESSED AS A QUERY INSTEAD OF A PREDICATE
 * ============================================================================
 *
 * `visibleInstances` filters rows that were already fetched. That is the wrong
 * shape for a LIST: the read has to be narrowed before its limit, or an
 * authorized row that is older than 200 foreign ones never enters the page and
 * no filter can bring it back.
 *
 * So this expresses the same policy as a filter the database applies, and
 * `visibleInstances` still runs afterwards. Two mechanisms for one rule is
 * deliberate here: the query decides what is READ, the predicate re-checks what
 * is RETURNED, and if the two ever drift the predicate is the one that fails
 * closed.
 */
export function instanceListFilterFor(actor: FormsActor): InstanceListFilter | undefined {
  // Preview and global: unrestricted, one ordered bounded read.
  if (!actor.scope) return undefined;
  if (actor.scope.level === "global") return undefined;

  return {
    /*
     * EMPTY FOR DISTRICT AND REGION, which is how they fail closed on
     * location-bearing rows: `authorizedSalonIds` returns nothing for any level
     * but `salon`, and an empty list means no salon query is issued at all.
     */
    locationIds: authorizedSalonIds(actor.scope),
    // The narrow exception for an ABSENT salon, matching `actorMaySeeInstance`.
    ownNullLocationCreatedBy: actor.id,
  };
}

/** Filters a list to what this actor may see. Same rule, applied in bulk. */
export function visibleInstances<T extends InstanceRow>(
  actor: FormsActor,
  instances: T[],
): T[] {
  return instances.filter((instance) => actorMaySeeInstance(actor, instance));
}

/**
 * Thrown where a form exists but this caller may not know that.
 *
 * Carries the wording a MISSING form gets, so a route can answer both cases
 * with one branch and cannot accidentally answer them differently.
 */
export class InstanceNotVisibleError extends Error {
  constructor() {
    super("No such form.");
    this.name = "InstanceNotVisibleError";
  }
}

/**
 * ============================================================================
 * THE GUARD EVERY PER-INSTANCE ROUTE CALLS
 * ============================================================================
 *
 * The order is the design, and the first step looks wrong until you read the
 * second:
 *
 *   1. LOAD THE INSTANCE, before authorizing. It is our own database, read with
 *      our own key, and nothing is returned to the caller from this step. It has
 *      to happen first because step 2 cannot be asked until the TEMPLATE is
 *      known.
 *
 *   2. AUTHORIZE ON THE TEMPLATE'S OWN PERMISSION. Every editing route
 *      hard-coded `create_coaching_form`, so a role that may write a coaching
 *      form could save, draft and finalize a Corrective Action Form or an
 *      EPP — permissions it does not hold. The permission is data on the
 *      template row; it is read from there.
 *
 *   3. CHECK THE SCOPE, and refuse as a 404.
 */
export async function authorizeInstance(
  request: Request,
  instanceId: string,
  action: InstanceAction,
): Promise<{ actor: FormsActor; loaded: LoadedInstance }> {
  const loaded = await loadInstance(instanceId);
  if (!loaded) throw new InstanceNotVisibleError();

  const permission = await permissionFor(loaded.instance, action);
  const actor = await authorizeForms(request, permission);

  if (!actorMaySeeInstance(actor, loaded.instance)) throw new InstanceNotVisibleError();

  return { actor, loaded };
}

/**
 * The permission an action on THIS form needs.
 *
 * `view` and `manage` are template-agnostic by design: reading the history and
 * managing the record are jobs about forms in general, not about a particular
 * document. `edit` is not — writing into a Corrective Action Form is a
 * different authority from writing into a coaching form, and the template row
 * says so.
 */
async function permissionFor(
  instance: InstanceRow,
  action: InstanceAction,
): Promise<Permission> {
  if (action === "view") return "view_form_monitoring";
  if (action === "manage") return "manage_form_records";

  const template = await getTemplateByKey(instance.templateKey);
  /*
   * A form whose template has since been removed is not editable by falling
   * back to the easiest permission. `manage_form_templates` is deliberately
   * stricter than any create permission: if the library no longer describes
   * this document, only somebody who administers the library should be
   * writing into it.
   */
  return (template?.requiredPermission as Permission | undefined) ?? "manage_form_templates";
}
