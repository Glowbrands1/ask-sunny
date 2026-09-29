import { audienceKey, audienceLabel } from "./access";
import type { AudienceDecision, ContentType, InventoryItem } from "./types";

/**
 * ============================================================================
 * WHAT WOVEN HOLDS, AS AN ADMINISTRATOR READS IT
 * ============================================================================
 *
 * PURE. Turns inventory rows (the manifest, or before the initial sync the
 * latest dry run's inventory) and the audience decisions into:
 *
 *   * the audience groups waiting for a choice, and those already chosen;
 *   * one CONTENT ROW per Woven item — a policy and its attachments are one
 *     row with expandable parts — each with a plain sync state.
 *
 * A DECISION TAKES EFFECT HERE AT ONCE. A part held for its audience is shown
 * under the administrator's current choice ("will be added on the next sync",
 * "kept out"), not under the classification the scan stored before the choice
 * was made — so the counts move the moment a choice is saved.
 */

export type ContentSyncState =
  | "up_to_date"
  | "new"
  | "updated"
  | "waiting_for_audience"
  | "kept_out"
  | "not_supported"
  | "unpublished"
  | "retired"
  | "error";

export const CONTENT_SYNC_STATE_LABEL: Record<ContentSyncState, string> = {
  up_to_date: "Up to date",
  new: "New in Woven",
  updated: "Updated in Woven",
  waiting_for_audience: "Waiting for audience decision",
  kept_out: "Kept out of Ask Sunny",
  not_supported: "Not yet supported",
  unpublished: "Draft / unpublished",
  retired: "Retired",
  error: "Error",
};

/** Which state a Woven item shows when its parts differ: the one a person most needs to see. */
const PRIORITY: ContentSyncState[] = [
  "error",
  "waiting_for_audience",
  "updated",
  "new",
  "up_to_date",
  "kept_out",
  "unpublished",
  "retired",
  "not_supported",
];

export interface AudienceGroup {
  audienceKey: string;
  label: string;
  /** Parts with this audience that an administrator's choice decides. */
  items: number;
  decision: AudienceDecision["decision"] | null;
}

export interface ContentPart {
  partKey: string;
  kind: "body" | "attachment" | "file" | "version" | "other";
  title: string;
  fileName: string | null;
  syncState: ContentSyncState;
  inAskSunny: boolean;
}

export interface ContentRow {
  /** `contentType:entityId` — stable, not shown. */
  key: string;
  title: string;
  contentType: ContentType;
  wovenStatus: string | null;
  published: boolean;
  audience: string;
  audienceKey: string;
  audienceDecision: AudienceDecision["decision"] | "public" | null;
  version: string | null;
  /** The source's own date. Null means Woven did not give one — never invented. */
  wovenUpdatedAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  lastSyncedAt: string | null;
  syncState: ContentSyncState;
  /** Ask Sunny documents this item owns, while they are searchable. */
  askSunny: { id: string; title: string }[];
  parts: ContentPart[];
}

/* The manifest identity, inline: this module is imported by the screen, so it must not pull in node:crypto via reconcile. */
const partIdentity = (item: Pick<InventoryItem, "contentType" | "entityId" | "partKey">) => `${item.contentType}\u0000${item.entityId}\u0000${item.partKey}`;

const HELD_FOR_AUDIENCE = new Set(["audience_needs_review", "audience_excluded"]);

/** True for a part whose presence in Ask Sunny is decided by an audience choice. */
export function heldForAudience(item: Pick<InventoryItem, "reason" | "state">): boolean {
  return item.reason !== null && HELD_FOR_AUDIENCE.has(item.reason) && item.state !== "REMOVED";
}

/**
 * The rows the screen reads. After the initial sync the manifest is the whole
 * truth. Before it, the latest dry run's inventory, with any manifest rows (a
 * partly-run initial sync) taking precedence for the parts they cover.
 */
export function effectiveInventory(manifest: InventoryItem[], preview: InventoryItem[], initialSyncDone: boolean): InventoryItem[] {
  if (initialSyncDone) return manifest;
  const merged = new Map(preview.map((item) => [partIdentity(item), item]));
  for (const item of manifest) merged.set(partIdentity(item), item);
  return [...merged.values()];
}

/** The plain state of one part, under the audience choices as they stand now. */
export function partSyncState(item: InventoryItem, decisions: ReadonlyMap<string, AudienceDecision>): ContentSyncState {
  if (item.state === "ERROR") return "error";
  if (item.state === "REMOVED") return "retired";
  if (item.state === "BLOCKED") return item.inAskSunny ? "up_to_date" : "not_supported";

  if (heldForAudience(item)) {
    const decision = decisions.get(audienceKey(item.audience))?.decision ?? null;
    if (decision === "company_wide") return item.inAskSunny ? "up_to_date" : "new";
    if (decision === "excluded") return "kept_out";
    return "waiting_for_audience";
  }

  if (item.state === "EXCLUDED") {
    if (item.reason === "unsupported_format") return "not_supported";
    return item.knowledgeDocumentId && !item.inAskSunny ? "retired" : "unpublished";
  }
  if (item.state === "UNPUBLISHED") return item.inAskSunny ? "unpublished" : item.knowledgeDocumentId ? "retired" : "unpublished";

  if (item.pendingAction === "ingest") {
    return item.state === "UPDATED" || (item.state === "PERMISSION_CHANGED" && item.inAskSunny) ? "updated" : "new";
  }
  if (item.pendingAction === "retire") return "unpublished";
  return item.inAskSunny ? "up_to_date" : "new";
}

function partKind(partKey: string): ContentPart["kind"] {
  if (partKey === "content") return "body";
  if (partKey.startsWith("attachment:")) return "attachment";
  if (partKey === "file") return "file";
  if (partKey === "current-version") return "version";
  return "other";
}

/** Audience groups an administrator's choice decides, most items first; decided groups after. */
export function audienceGroups(items: InventoryItem[], decisions: readonly AudienceDecision[]): AudienceGroup[] {
  const groups = new Map<string, AudienceGroup>();
  for (const item of items) {
    if (!heldForAudience(item)) continue;
    const key = audienceKey(item.audience);
    const entry = groups.get(key) ?? { audienceKey: key, label: audienceLabel(item.audience), items: 0, decision: null };
    entry.items += 1;
    groups.set(key, entry);
  }
  for (const decision of decisions) {
    const entry = groups.get(decision.audienceKey) ?? { audienceKey: decision.audienceKey, label: decision.audienceKey, items: 0, decision: null };
    entry.decision = decision.decision;
    groups.set(decision.audienceKey, entry);
  }
  return [...groups.values()].sort(
    (a, b) => Number(a.decision !== null) - Number(b.decision !== null) || b.items - a.items || a.label.localeCompare(b.label),
  );
}

const earliest = (values: string[]) => values.reduce((a, b) => (Date.parse(b) < Date.parse(a) ? b : a));
const latest = (values: string[]) => values.reduce((a, b) => (Date.parse(b) > Date.parse(a) ? b : a));

/**
 * One row per Woven item. `documentTitles` are the Ask Sunny titles of the
 * documents the manifest says are searchable.
 */
export function contentRows(
  items: InventoryItem[],
  decisionList: readonly AudienceDecision[],
  documentTitles: ReadonlyMap<string, string> = new Map(),
): ContentRow[] {
  const decisions = new Map(decisionList.map((d) => [d.audienceKey, d]));
  const byRecord = new Map<string, InventoryItem[]>();
  for (const item of items) {
    const key = `${item.contentType}:${item.entityId}`;
    byRecord.set(key, [...(byRecord.get(key) ?? []), item]);
  }

  const rows: ContentRow[] = [];
  for (const [key, parts] of byRecord) {
    parts.sort((a, b) => Number(partKind(b.partKey) === "body") - Number(partKind(a.partKey) === "body") || a.partKey.localeCompare(b.partKey));
    const lead = parts[0]!;
    const states = parts.map((p) => partSyncState(p, decisions));
    const syncState = PRIORITY.find((s) => states.includes(s)) ?? "not_supported";
    const akey = audienceKey(lead.audience);
    const held = parts.some(heldForAudience);
    const lastSynced = parts.map((p) => p.lastSyncedAt).filter((v): v is string => v !== null);
    rows.push({
      key,
      title: (lead.recordTitle ?? "").trim() || lead.title,
      contentType: lead.contentType,
      wovenStatus: lead.status,
      published: !parts.every((p) => p.reason === "not_published" || p.reason === "status_not_recognised"),
      audience: audienceLabel(lead.audience),
      audienceKey: akey,
      audienceDecision: decisions.get(akey)?.decision ?? (held ? null : "public"),
      version: lead.version,
      wovenUpdatedAt: lead.sourceUpdatedAt,
      firstSeenAt: earliest(parts.map((p) => p.firstSeenAt)),
      lastSeenAt: latest(parts.map((p) => p.lastSeenAt)),
      lastSyncedAt: lastSynced.length > 0 ? latest(lastSynced) : null,
      syncState,
      askSunny: parts
        .filter((p) => p.inAskSunny && p.knowledgeDocumentId)
        .map((p) => ({ id: p.knowledgeDocumentId!, title: documentTitles.get(p.knowledgeDocumentId!) ?? p.title })),
      parts: parts.map((p, i) => ({
        partKey: p.partKey,
        kind: partKind(p.partKey),
        title: p.title,
        fileName: p.fileName,
        syncState: states[i]!,
        inAskSunny: p.inAskSunny,
      })),
    });
  }
  return rows.sort((a, b) => a.contentType.localeCompare(b.contentType) || a.title.localeCompare(b.title));
}
