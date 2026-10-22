import "server-only";

import { createHash } from "node:crypto";

import { getSupabaseAdmin } from "@/lib/supabase/server";

import { createInstance, DuplicateInstanceIdError, loadInstance, type InstanceRow, type NewInstance } from "./instances";
import { isProposalId } from "./proposal-id";

/**
 * ============================================================================
 * THE SAME CHAT CARD, PRESSED TWICE, IS ONE FORM
 * ============================================================================
 *
 * The browser stops a second click while a create is in flight, and marks the
 * card created the instant the row exists. What it cannot stop is a create
 * whose RESPONSE was lost — a dropped connection, a timeout, a reload — the
 * same card pressed in a second tab, or a conversation reopened before the
 * card's reference was saved: the row exists, the browser does not know, and
 * the next press filed a second disciplinary record (QA, 22 Oct 2026).
 *
 * KEYED ON THE CARD, NOT ON THE PERSON. Every proposal card carries a
 * `proposalId`, recorded on the form's `created` event. A press of the SAME
 * card returns the form it already made. A NEW request — a second incident for
 * the same employee, minutes later — is a new card with a new id and always
 * files a new form.
 *
 * NARROW ON PURPOSE. Only the caller's own forms (never another manager's, so
 * nothing is revealed that they could not already open), only drafts (a
 * finalized form is never handed back for editing), only Ask Sunny's, only the
 * same person and salon. A create without a card id is never matched.
 *
 * FOUR LAYERS, because a lookup alone is check-then-insert:
 *
 *   0. THE CARD'S OWN ROW ID (`cardInstanceId`). The first form a manager
 *      files from a card takes an id derived from the manager and the card, so
 *      the table's own primary key admits ONE such row, across every server
 *      instance, with no migration: a second insert fails with 23505 and the
 *      request returns the form that won. Only once that form is finalized or
 *      gone does the card file a new one, with an id of its own.
 *   1. THE LOOKUP. The card's draft inside `DUPLICATE_DRAFT_WINDOW_HOURS`.
 *      This alone covers every retry that arrives after the first finished.
 *   2. ONE CREATE PER CARD AT A TIME IN THIS PROCESS. Two requests for the same
 *      card on the same server instance run one after the other, so the second
 *      one's lookup sees the first one's form.
 *   3. THE CLAIM (`form_create_claims`, migration 20261022001000). The primary
 *      key on (manager, card) admits one creator across server instances; a
 *      request that loses waits for the winner's form and returns it. Until the
 *      migration is applied the claim reports itself unavailable and layers 1
 *      and 2 are what stands.
 */
export const DUPLICATE_DRAFT_WINDOW_HOURS = 24;

/** How long a request that lost the claim waits for the winner's form. */
const WAIT_MS = 3_000;
/** A claim with no form after this long belongs to a request that died. */
const STALE_MS = 30_000;
const POLL_MS = 200;

export type CreateOnceResult =
  | { kind: "created"; instance: InstanceRow }
  | { kind: "reused"; instance: InstanceRow }
  /** Another request for this card is still creating it. Nothing was written. */
  | { kind: "in_progress" };

export async function findRecentAssistantDraft(input: {
  templateKey: string;
  employeeName: string;
  createdBy: string;
  locationId: string | null;
  proposalId: string;
  now?: Date;
}): Promise<InstanceRow | null> {
  if (!isProposalId(input.proposalId)) return null;
  try {
    return await lookUpCardDraft(input);
  } catch {
    // A guard that cannot read is no guard: the create goes ahead as before.
    return null;
  }
}

async function lookUpCardDraft(input: {
  templateKey: string;
  employeeName: string;
  createdBy: string;
  locationId: string | null;
  proposalId: string;
  now?: Date;
}): Promise<InstanceRow | null> {
  const supabase = getSupabaseAdmin();
  const { data: template, error: templateError } = await supabase
    .from("form_templates")
    .select("id")
    .eq("key", input.templateKey)
    .maybeSingle();
  if (templateError || !template) return null;

  const since = new Date((input.now ?? new Date()).getTime() - DUPLICATE_DRAFT_WINDOW_HOURS * 3_600_000);
  const { data, error } = await supabase
    .from("form_instances")
    .select("id, employee_name, location_id, created_at")
    .eq("template_id", template.id)
    .eq("created_by", input.createdBy)
    .eq("source", "ask_sunny")
    .eq("status", "draft")
    .gte("created_at", since.toISOString())
    .order("created_at", { ascending: false })
    .limit(25);
  // A guard that cannot read is no guard: the create goes ahead as before.
  if (error || !Array.isArray(data)) return null;

  const candidates = (data as { id: unknown; employee_name: unknown; location_id: unknown }[])
    .filter(
      (row) =>
        samePerson(String(row.employee_name ?? ""), input.employeeName) &&
        (row.location_id ?? null) === (input.locationId ?? null),
    )
    .map((row) => String(row.id));
  if (candidates.length === 0) return null;

  const { data: events, error: eventsError } = await supabase
    .from("form_instance_events")
    .select("instance_id, detail")
    .in("instance_id", candidates)
    .eq("kind", "created");
  if (eventsError || !Array.isArray(events)) return null;
  const same = (events as { instance_id: unknown; detail: unknown }[]).find(
    (event) => (event.detail as { proposalId?: unknown } | null)?.proposalId === input.proposalId,
  );
  if (!same) return null;
  const loaded = await loadInstance(String(same.instance_id));
  return loaded?.instance ?? null;
}

/**
 * Creates the form for this card, or returns the one the card already made.
 * `input.source` must be `ask_sunny` and `input.proposalId` a card id; the
 * route only calls this for those.
 */
export async function createAssistantInstanceOnce(
  input: NewInstance & { proposalId: string },
): Promise<CreateOnceResult> {
  return oneAtATime(`${input.createdBy}\u0000${input.proposalId}`, async () => {
    const existing = await findRecentAssistantDraft({
      templateKey: input.templateKey,
      employeeName: input.employeeName,
      createdBy: input.createdBy,
      locationId: input.locationId ?? null,
      proposalId: input.proposalId,
    });
    if (existing) return { kind: "reused", instance: existing };

    // The card's own row, however long ago it was filed.
    const own = await reusable(cardInstanceId(input.createdBy, input.proposalId), input);
    if (own) return { kind: "reused", instance: own };

    const claim = await claimCard(input.createdBy, input.proposalId);
    if (claim !== "taken") return createAndRecord(input, claim === "claimed");
    return afterLosingTheClaim(input);
  });
}

/* ------------------------------------------------------------ internals -- */

function samePerson(a: string, b: string): boolean {
  const normal = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();
  return normal(a) === normal(b);
}

/**
 * The row id a card's first form takes: a name-based UUID of the manager and
 * the card, so two creates for the same card — on any server — name the same
 * row and the primary key lets one of them through. See layer 0 above.
 */
export function cardInstanceId(createdBy: string, proposalId: string): string {
  const hex = createHash("sha256").update(`ask-sunny/form-card/${createdBy}/${proposalId}`).digest("hex");
  const variant = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** The form at `id`, when it is this manager's open draft of this template — the one to hand back. */
async function reusable(id: string, input: NewInstance): Promise<InstanceRow | null> {
  const instance = (await loadInstance(id).catch(() => null))?.instance ?? null;
  if (!instance) return null;
  // By the template's id, read from the table: the row's own key comes from a view.
  const { data: template } = await getSupabaseAdmin()
    .from("form_templates")
    .select("id")
    .eq("key", input.templateKey)
    .maybeSingle();
  return template &&
    String((template as { id: unknown }).id) === instance.templateId &&
    instance.status === "draft" &&
    instance.createdBy === input.createdBy &&
    samePerson(instance.employeeName, input.employeeName) &&
    (instance.locationId ?? null) === (input.locationId ?? null)
    ? instance
    : null;
}

async function createAndRecord(
  input: NewInstance & { proposalId: string },
  claimed: boolean,
): Promise<CreateOnceResult> {
  const own = cardInstanceId(input.createdBy, input.proposalId);
  // The card's own id is free unless an earlier form from it was finalized or kept.
  const taken = (await loadInstance(own).catch(() => null)) !== null;
  let instance: InstanceRow;
  try {
    instance = await createInstance(taken ? input : { ...input, id: own });
  } catch (error) {
    if (!(error instanceof DuplicateInstanceIdError)) throw error;
    // Another request for this card won the insert, on this server or another.
    const winner = await reusable(own, input);
    if (winner) return { kind: "reused", instance: winner };
    instance = await createInstance(input);
  }
  if (claimed) await attachToClaim(input.createdBy, input.proposalId, instance.id);
  return { kind: "created", instance };
}

/**
 * Another request holds the card. Wait for its form and return it; take the
 * claim over only when its form was finalized or removed, or when it has held
 * the claim with no form for longer than any create takes.
 */
async function afterLosingTheClaim(input: NewInstance & { proposalId: string }): Promise<CreateOnceResult> {
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    const held = await readClaim(input.createdBy, input.proposalId);
    if (!held) {
      // Gone between the insert and this read: claim again, once per pass.
      const again = await claimCard(input.createdBy, input.proposalId);
      if (again !== "taken") return createAndRecord(input, again === "claimed");
    } else if (held.instanceId) {
      const loaded = await loadInstance(held.instanceId);
      const instance = loaded?.instance ?? null;
      if (
        instance &&
        instance.status === "draft" &&
        instance.createdBy === input.createdBy &&
        instance.templateKey === input.templateKey
      ) {
        return { kind: "reused", instance };
      }
      // Finalized, revised or deleted: this card may file a new form.
      if (await takeOverClaim(input.createdBy, input.proposalId, held.claimedAt)) {
        return createAndRecord(input, true);
      }
    } else if (Date.now() - Date.parse(held.claimedAt) > STALE_MS) {
      if (await takeOverClaim(input.createdBy, input.proposalId, held.claimedAt)) {
        return createAndRecord(input, true);
      }
    }
    if (Date.now() >= deadline) return { kind: "in_progress" };
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

/**
 * `claimed` — this request creates the form. `taken` — another one already
 * is, or did. `unavailable` — the table is not there (migration not applied)
 * or could not be written, and the create goes ahead on layers 1 and 2.
 */
async function claimCard(createdBy: string, proposalId: string): Promise<"claimed" | "taken" | "unavailable"> {
  try {
    const { error } = await getSupabaseAdmin()
      .from("form_create_claims")
      .insert({ created_by: createdBy, proposal_id: proposalId, instance_id: null, claimed_at: new Date().toISOString() });
    if (!error) return "claimed";
    return (error as { code?: string }).code === "23505" ? "taken" : "unavailable";
  } catch {
    return "unavailable";
  }
}

async function readClaim(
  createdBy: string,
  proposalId: string,
): Promise<{ instanceId: string | null; claimedAt: string } | null> {
  try {
    const { data, error } = await getSupabaseAdmin()
      .from("form_create_claims")
      .select("instance_id, claimed_at")
      .eq("created_by", createdBy)
      .eq("proposal_id", proposalId)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as { instance_id: unknown; claimed_at: unknown };
    return {
      instanceId: row.instance_id ? String(row.instance_id) : null,
      claimedAt: String(row.claimed_at ?? new Date(0).toISOString()),
    };
  } catch {
    return null;
  }
}

/** Compare-and-set on `claimed_at`, so two requests cannot both take a claim over. */
async function takeOverClaim(createdBy: string, proposalId: string, seenClaimedAt: string): Promise<boolean> {
  try {
    const { data, error } = await getSupabaseAdmin()
      .from("form_create_claims")
      .update({ instance_id: null, claimed_at: new Date().toISOString() })
      .eq("created_by", createdBy)
      .eq("proposal_id", proposalId)
      .eq("claimed_at", seenClaimedAt)
      .select("proposal_id");
    return !error && Array.isArray(data) && data.length > 0;
  } catch {
    return false;
  }
}

async function attachToClaim(createdBy: string, proposalId: string, instanceId: string): Promise<void> {
  try {
    await getSupabaseAdmin()
      .from("form_create_claims")
      .update({ instance_id: instanceId })
      .eq("created_by", createdBy)
      .eq("proposal_id", proposalId);
  } catch {
    // The form exists; a later press finds it through the lookup.
  }
}

/** Requests for the same card in this process, one after another. */
const running = new Map<string, Promise<void>>();

async function oneAtATime<T>(key: string, work: () => Promise<T>): Promise<T> {
  const before = running.get(key) ?? Promise.resolve();
  let release: () => void = () => {};
  const mine = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = before.then(() => mine);
  running.set(key, queued);
  await before;
  try {
    return await work();
  } finally {
    release();
    if (running.get(key) === queued) running.delete(key);
  }
}
