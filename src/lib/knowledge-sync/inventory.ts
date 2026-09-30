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
  | "stale"
  | "error";

export const CONTENT_SYNC_STATE_LABEL: Record<ContentSyncState, string> = {
  up_to_date: "Current",
  new: "New in Woven",
  updated: "Updated in Woven",
  waiting_for_audience: "Waiting for audience decision",
  kept_out: "Kept out of Ask Sunny",
  not_supported: "Not yet supported",
  unpublished: "Draft / unpublished",
  retired: "Retired",
  stale: "Stale / Superseded",
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
  /**
   * The Woven items this choice affects, by title — so nobody decides "Share
   * with everyone" blind. Display metadata only; no text, no locator. Capped
   * (`membersTotal` says how many there are).
   */
  members?: ContentRow[];
  membersTotal?: number;
}

export interface ContentPart {
  /** An opaque key for the list: the manifest part key can carry a storage file name, which is never shown. */
  key: string;
  /** `superseded_copy`: a hand upload this item's current Woven copy replaced (kept for audit, never used). */
  kind: "body" | "attachment" | "file" | "version" | "other" | "superseded_copy";
  title: string;
  fileName: string | null;
  syncState: ContentSyncState;
  inAskSunny: boolean;
  /** An opaque reference to this part for the preview request (a hash of its identity; carries no name). */
  ref: string;
  /** Ask Sunny can read this part's content (it is not blocked or an unsupported format). */
  previewable: boolean;
  /** The searchable Ask Sunny document for this part, when there is one: the existing document preview. */
  askSunnyDocumentId: string | null;
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

/**
 * An opaque, stable reference to a part: two 32-bit FNV-1a hashes of its
 * identity. It lets the screen ask for one part's preview without the page
 * ever carrying the part key (which may hold a storage file name).
 */
export function partRef(item: Pick<InventoryItem, "contentType" | "entityId" | "partKey">): string {
  const text = partIdentity(item);
  const fnv = (seed: number) => {
    let h = seed >>> 0;
    for (let i = 0; i < text.length; i += 1) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, "0");
  };
  return `${fnv(0x811c9dc5)}${fnv(0x5bd1e995)}`;
}

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
export function effectiveInventory(manifest: InventoryItem[], preview: InventoryItem[], initialSyncDone: boolean, previewIsNewer = false): InventoryItem[] {
  if (initialSyncDone) {
    if (!previewIsNewer || preview.length === 0) return manifest;
    /*
     * AFTER SETUP, A SCAN NEWER THAN THE LAST SYNC is what Woven holds now:
     * its classification (New / Updated / Removed…) and Woven's own fields
     * lead, and what only Ask Sunny knows — whether a part is in Ask Sunny,
     * its document, when it was synced, its error — comes from the manifest.
     */
    const byKey = new Map(manifest.map((item) => [partIdentity(item), item]));
    const merged = new Map<string, InventoryItem>(byKey);
    for (const scanned of preview) {
      const known = byKey.get(partIdentity(scanned));
      merged.set(
        partIdentity(scanned),
        known && known.state === "ERROR"
          ? known
          : known
            ? {
                ...known,
                title: scanned.title,
                recordTitle: scanned.recordTitle,
                status: scanned.status,
                audience: scanned.audience,
                version: scanned.version,
                sourceUpdatedAt: scanned.sourceUpdatedAt,
                fileName: scanned.fileName,
                state: scanned.state,
                reason: scanned.reason,
                pendingAction: scanned.pendingAction,
                lastSeenAt: scanned.lastSeenAt,
              }
            : scanned,
      );
    }
    return [...merged.values()];
  }
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
    /* A byte re-check of a part already in Ask Sunny is routine, not a change. */
    if (item.state === "UNCHANGED") return item.inAskSunny ? "up_to_date" : "new";
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
  /** Hand uploads superseded, keyed by the document that replaced them. */
  supersededBy: ReadonlyMap<string, readonly { id: string; title: string }[]> = new Map(),
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
      parts: [
        ...parts.map((p, i) => ({
          key: `${partKind(p.partKey)}-${i}`,
          kind: partKind(p.partKey),
          title: p.title,
          fileName: p.fileName,
          syncState: states[i]!,
          inAskSunny: p.inAskSunny,
          ref: partRef(p),
          previewable: p.state !== "BLOCKED" && p.reason !== "unsupported_format" && p.state !== "REMOVED",
          askSunnyDocumentId: p.inAskSunny ? p.knowledgeDocumentId : null,
        })),
        /* Informational: the row's own state is its Woven parts'. */
        ...parts
          .flatMap((p) => (p.knowledgeDocumentId ? (supersededBy.get(p.knowledgeDocumentId) ?? []) : []))
          .map((doc, i) => ({
            key: `superseded_copy-${i}`,
            kind: "superseded_copy" as const,
            title: doc.title,
            fileName: null,
            syncState: "stale" as const,
            inAskSunny: false,
            ref: `superseded:${doc.id}`,
            previewable: false,
            /* Kept for audit: the Ask Sunny document page still opens it. */
            askSunnyDocumentId: doc.id,
          })),
      ],
    });
  }
  return rows.sort((a, b) => a.contentType.localeCompare(b.contentType) || a.title.localeCompare(b.title));
}
