import "server-only";

import { businessToday } from "@/lib/business-date";
import { formRevisionsEnabled } from "@/lib/config/chat-quality-flags";

import { findOpenRevision, loadInstance, reviseInstance, type InstanceRow, type LoadedInstance } from "./instances";
import {
  normalizeRevisionReason,
  referenceOf,
  revisionMarks,
  REVISION_REASON_REQUIRED,
  REVISION_REASON_REQUIRED_MESSAGE,
  type RevisionEntry,
  type RevisionHistory,
  type RevisionMark,
} from "./revision-history";

/**
 * ============================================================================
 * THE REVISION CHAIN, READ FROM THE RECORDS THEMSELVES
 * ============================================================================
 *
 * Behind `FORM_REVISIONS_ENABLED`; see `revision-history.ts` for what is
 * printed from it. Read only: nothing here writes.
 *
 * BACK through `revises_instance_id`, which every revision carries. FORWARD
 * through the original's own `revised` event, which names the revision that
 * replaced it (the same pointer "Open newer version" follows), or, for a
 * finalized form, the revision draft still open on it. An archived draft is
 * not part of the chain: somebody put it away.
 *
 * The number of a record is its place in the chain, the original being 0. It
 * is the number `reviseFinalizedForm` records on the revision's `created`
 * event when the revision is opened.
 */

/** Far more hops than any real revision history; a bound, not a limit. */
const MAX_HOPS = 25;

/** The revision a `revised` form points to, from its own history. */
function newerIdOf(loaded: LoadedInstance): string | null {
  for (let index = loaded.events.length - 1; index >= 0; index -= 1) {
    const event = loaded.events[index]!;
    if (event.kind !== "revised" && event.kind !== "reevaluated") continue;
    const revisionId = event.detail?.revisionId;
    if (typeof revisionId === "string" && revisionId !== "") return revisionId;
  }
  return null;
}

async function nextInChain(loaded: LoadedInstance): Promise<LoadedInstance | null> {
  if (loaded.instance.status === "revised") {
    const id = newerIdOf(loaded);
    return id ? loadInstance(id) : null;
  }
  if (loaded.instance.status === "finalized") {
    const open = await findOpenRevision(loaded.instance.id);
    if (!open || open.archivedAt) return null;
    return loadInstance(open.id);
  }
  return null;
}

/** The records before this one, oldest first. */
async function ancestorsOf(loaded: LoadedInstance): Promise<LoadedInstance[]> {
  const chain: LoadedInstance[] = [];
  const seen = new Set([loaded.instance.id]);
  let current = loaded;
  for (let hop = 0; hop < MAX_HOPS && current.instance.revisesInstanceId; hop += 1) {
    const previousId = current.instance.revisesInstanceId;
    if (seen.has(previousId)) break;
    const previous = await loadInstance(previousId);
    if (!previous) break;
    seen.add(previousId);
    chain.unshift(previous);
    current = previous;
  }
  return chain;
}

function entryOf(loaded: LoadedInstance, revisionNumber: number): RevisionEntry {
  const created = loaded.events.find((event) => event.kind === "created");
  const detail = created?.detail ?? {};
  const isRevision = Boolean(loaded.instance.revisesInstanceId) && typeof detail.revisionOf === "string";
  const superseded = [...loaded.events].reverse().find((event) => event.kind === "revised" || event.kind === "reevaluated");
  return {
    id: loaded.instance.id,
    reference: referenceOf(loaded.instance.id),
    status: loaded.instance.status,
    revisionNumber,
    kind: loaded.instance.revisesInstanceId ? (isRevision && detail.kind === "reevaluated" ? "reevaluated" : "revised") : null,
    reason: typeof detail.reason === "string" && detail.reason.trim() !== "" ? detail.reason : null,
    openedAt: created?.createdAt ?? loaded.instance.createdAt,
    openedBy: created?.actor ?? loaded.instance.createdBy ?? null,
    finalizedAt: loaded.instance.finalizedAt,
    supersededAt: loaded.instance.status === "revised" ? (superseded?.createdAt ?? null) : null,
  };
}

/**
 * The chain `instanceId` belongs to, original first, or null when the form
 * does not exist. `mayOpen` leaves out a record the reader may not open; the
 * numbers stay the records' places in the whole chain.
 */
export async function loadRevisionHistory(
  instanceId: string,
  mayOpen: (loaded: LoadedInstance) => Promise<boolean> | boolean = () => true,
): Promise<RevisionHistory | null> {
  const start = await loadInstance(instanceId);
  if (!start) return null;

  const chain = [...(await ancestorsOf(start)), start];
  const seen = new Set(chain.map((loaded) => loaded.instance.id));
  let current = start;
  for (let hop = 0; hop < MAX_HOPS; hop += 1) {
    const next = await nextInChain(current);
    if (!next || seen.has(next.instance.id)) break;
    seen.add(next.instance.id);
    chain.push(next);
    current = next;
  }

  const entries: RevisionEntry[] = [];
  for (const [index, loaded] of chain.entries()) {
    if (loaded.instance.id === instanceId || (await mayOpen(loaded))) entries.push(entryOf(loaded, index));
  }
  return { instanceId, entries };
}

/** A timestamp's calendar date where the business is, not in UTC. */
export function businessDateOf(timestamp: string): string {
  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime()) ? timestamp.slice(0, 10) : businessToday(parsed);
}

/** The marks a record carries, its dates in the business timezone. */
export function marksFor(history: RevisionHistory): RevisionMark[] {
  return revisionMarks(history, businessDateOf);
}

/* ------------------------------------------------- opening a revision --- */

/** An edit of a finalized form arrived without a reason, with the flag on. */
export class RevisionReasonRequiredError extends Error {
  readonly code = REVISION_REASON_REQUIRED;

  constructor() {
    super(REVISION_REASON_REQUIRED_MESSAGE);
    this.name = "RevisionReasonRequiredError";
  }
}

/**
 * ============================================================================
 * EVERY EDIT OF A FINALIZED FORM SAYS WHY
 * ============================================================================
 *
 * The one door to `reviseInstance` for the card's button, the form page, the
 * register and chat. With `FORM_REVISIONS_ENABLED` off it is
 * `reviseInstance`, called exactly as before.
 *
 * On:
 *
 *   A REVISION ALREADY OPEN is returned as it always was. Landing on the
 *   draft somebody already opened, with its own reason, is not a new edit.
 *
 *   A FINALIZED FORM needs a reason, or `RevisionReasonRequiredError`. The
 *   reason and the revision's number go on the revision's `created` event.
 *
 *   A RE-EVALUATION (the DMIT EPP's next stage) is not an edit: a reason is
 *   recorded when one is given, and not required.
 */
export async function reviseFinalizedForm(
  instanceId: string,
  actor: string,
  kind: "revised" | "reevaluated",
  rawReason?: unknown,
): Promise<InstanceRow> {
  if (!formRevisionsEnabled()) return reviseInstance(instanceId, actor, kind);

  const loaded = await loadInstance(instanceId);
  if (!loaded || loaded.instance.status !== "finalized") return reviseInstance(instanceId, actor, kind);
  if (await findOpenRevision(instanceId)) return reviseInstance(instanceId, actor, kind);

  const reason = normalizeRevisionReason(rawReason);
  if (!reason && kind === "revised") throw new RevisionReasonRequiredError();
  const revisionNumber = (await ancestorsOf(loaded)).length + 1;
  return reviseInstance(instanceId, actor, kind, { ...(reason ? { reason } : {}), revisionNumber });
}
