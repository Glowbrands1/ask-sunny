import "server-only";

import { pageIdentity } from "@/lib/auth/page";

import type { FormsActor } from "./access";
import { formsScopeFor, formsSalonIdsFor, lacksHomeSalon } from "./forms-scope";
import { actorMaySeeInstance, instanceListFilterFor } from "./instance-scope";
import {
  listOutstandingFollowUps,
  type InstanceListFilter,
  type InstanceRow,
} from "./instances";

/**
 * The reader of a SERVER-RENDERED page, as the same `FormsActor` the API routes
 * build, so a page and a route cannot disagree about whose forms are whose.
 *
 * The scope is decided by `formsScopeFor` from the VERIFIED identity — never
 * from a request value. An unverified (demo) identity carries no scope and is
 * not enforced, exactly as `authorizeForms` treats it; no identity at all fails
 * closed to a reader with no salon.
 */
export async function pageFormsActor(): Promise<FormsActor> {
  const identity = await pageIdentity();
  if (!identity) {
    return {
      id: "anonymous",
      role: null,
      verified: false,
      scope: { level: "salon", primaryAreaId: null, alsoCoversAreaIds: [] },
    };
  }
  return {
    id: identity.subject,
    role: identity.role,
    verified: identity.verified,
    scope: identity.verified ? formsScopeFor(identity) : null,
  };
}

/** The query narrowing for this reader, or undefined when unrestricted. */
export function pageListFilter(actor: FormsActor): InstanceListFilter | undefined {
  return instanceListFilterFor(actor);
}

/** True when a verified reader has no salon to read. */
export function actorLacksHomeSalon(actor: FormsActor): boolean {
  return actor.verified && lacksHomeSalon(actor.scope);
}

/** Rows this reader may see — the same predicate the API applies. */
export function onlyVisible<T extends InstanceRow>(actor: FormsActor, rows: readonly T[]): T[] {
  return rows.filter((row) => actorMaySeeInstance(actor, row));
}

/**
 * Outstanding follow-ups for this reader: narrowed in the query, re-checked in
 * memory. The Monitoring banner, the Overview queue and the rail badge all call
 * this, so their counts cannot disagree and none can count another salon.
 */
export async function outstandingFollowUpsFor(
  actor: FormsActor,
  limit?: number,
): Promise<InstanceRow[]> {
  return onlyVisible(actor, await listOutstandingFollowUps(limit, formsSalonIdsFor(actor.scope)));
}
