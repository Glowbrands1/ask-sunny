import { createHash } from "node:crypto";

import { audienceKey, audienceLabel, decideAccess } from "./access";
import type {
  AttentionItem,
  AudienceDecision,
  ContentType,
  ListingResult,
  ManifestItem,
  PendingAction,
  SourcePart,
  SourceRecord,
  SourceSystem,
  SyncReport,
  SyncState,
  TypeReport,
} from "./types";

/**
 * ============================================================================
 * RECONCILIATION — what changed since the last successful sync
 * ============================================================================
 *
 * PURE. Given this run's listings, the manifest and the audience decisions, it
 * returns the manifest as it should now read and what each item needs. It
 * performs no I/O, so the dry run, the scheduled run and the manual run all
 * classify with exactly this function.
 *
 * EVIDENCE, IN ORDER: the source's stable id identifies the item; version,
 * version id, updated date, attachment ids and (for records without a
 * dependable date) a detail fingerprint decide whether it changed; publication
 * and audience decide whether Ask Sunny may hold it. File bytes are hashed at
 * download time, so a changed fingerprint whose bytes turn out identical is a
 * metadata-only update, never a re-index.
 *
 * TWO FINGERPRINTS PER ITEM. `observedFingerprint` is what the latest scan saw;
 * `syncedFingerprint` is what was last APPLIED to Ask Sunny. Comparing the scan
 * with the synced value, not the observed one, means an update whose download
 * failed is still an update on the next run instead of silently "unchanged".
 *
 * REMOVAL IS THE DANGEROUS DIRECTION, so it has three guards:
 *
 *   1. A content type whose listing failed is not reconciled at all — its
 *      items are left exactly as they are.
 *   2. A listing that arrived but looks wrong (empty, or less than half of what
 *      was there last time) is used for additions and updates only; nothing it
 *      omits is treated as removed.
 *   3. Across the run, if more than `MASS_REMOVAL_FLOOR` items AND more than
 *      `MASS_REMOVAL_SHARE` of what is in Ask Sunny would leave at once, every
 *      removal is held until an administrator confirms it.
 */

export const LISTING_SHRINK_BASELINE = 10;
export const LISTING_SHRINK_SHARE = 0.5;
export const MASS_REMOVAL_FLOOR = 10;
export const MASS_REMOVAL_SHARE = 0.25;

export interface ReconcileInput {
  source: SourceSystem;
  listings: ListingResult[];
  manifest: ManifestItem[];
  decisions: ReadonlyMap<string, AudienceDecision>;
  /** The source's labels that mean "everyone in the company". */
  companyWideLabels: readonly string[];
  now: string;
  /** An administrator confirmed a large removal this run. */
  confirmLargeRemoval?: boolean;
}

export interface ReconcileOutput {
  /** Every manifest item of every content type that was listed successfully. */
  items: ManifestItem[];
  byType: Partial<Record<ContentType, TypeReport>>;
  audiences: SyncReport["audiences"];
  removalsHeld: number;
  attention: AttentionItem[];
}

export function manifestKey(item: { contentType: string; entityId: string; partKey: string }): string {
  return `${item.contentType}\u0000${item.entityId}\u0000${item.partKey}`;
}

/**
 * The metadata that means the CONTENT may have changed. Audience and status
 * are deliberately absent: they decide access, and an audience relabelled from
 * one shared label to another must not re-index anything.
 */
export function partFingerprint(record: SourceRecord, part: SourcePart): string {
  const canonical = JSON.stringify([
    record.title,
    record.version,
    record.versionId,
    record.updatedAt,
    [...record.documentIds].sort(),
    [...record.attachmentIds].sort(),
    record.contentFingerprint,
    part.partKey,
    part.title,
    part.fileName,
    part.documentId,
    part.versionId,
    part.mimeType,
    part.sizeBytes,
    part.contentDigest ?? null,
    part.retrieval.kind,
  ]);
  return createHash("sha256").update(canonical).digest("hex");
}

export function emptyTypeReport(listing: TypeReport["listing"] = "not_read"): TypeReport {
  return {
    listing,
    listingCode: null,
    discovered: 0,
    items: 0,
    eligible: 0,
    excludedUnpublished: 0,
    excludedUnsupported: 0,
    excludedByDecision: 0,
    needsReview: 0,
    blocked: 0,
    blockedCapabilities: [],
    statusValues: {},
    new: 0,
    updated: 0,
    unchanged: 0,
    permissionChanged: 0,
    unpublished: 0,
    removed: 0,
    errors: 0,
  };
}

function isRetiredForAccess(item: ManifestItem | undefined): boolean {
  return (
    item !== undefined &&
    item.syncedFingerprint !== null &&
    (item.reason === "audience_needs_review" || item.reason === "audience_excluded")
  );
}

function plan(
  input: ReconcileInput,
  record: SourceRecord,
  part: SourcePart,
  previous: ManifestItem | undefined,
): { state: SyncState; pendingAction: PendingAction; reason: string | null } {
  const live = previous?.inAskSunny === true;
  const retire = (state: SyncState, reason: string) => ({
    state: live ? state : state === "UNPUBLISHED" ? "EXCLUDED" : state,
    pendingAction: (live ? "retire" : "none") as PendingAction,
    reason,
  });

  if (record.publication !== "published") {
    return retire("UNPUBLISHED", record.publication === "unknown" ? "status_not_recognised" : "not_published");
  }
  if (part.retrieval.kind === "unsupported_format") {
    return retire("EXCLUDED", "unsupported_format");
  }

  /*
   * BLOCKED BEFORE AUDIENCE. A part Ask Sunny cannot fetch yet is not put in
   * front of an administrator for an access decision that could change
   * nothing. A document already in Ask Sunny is kept as it is: being unable to
   * check is not a reason to remove.
   */
  if (part.retrieval.kind === "blocked") {
    return { state: "BLOCKED", pendingAction: "none", reason: part.retrieval.capability };
  }

  const access = decideAccess(record.audience, input.companyWideLabels, input.decisions);
  if (access.kind !== "company_wide") {
    const reason = access.kind === "review" ? "audience_needs_review" : "audience_excluded";
    if (live) return { state: "PERMISSION_CHANGED", pendingAction: "retire", reason };
    return { state: access.kind === "review" ? "NEEDS_REVIEW" : "EXCLUDED", pendingAction: "none", reason };
  }

  const fingerprint = partFingerprint(record, part);
  if (!live) {
    return {
      state: isRetiredForAccess(previous) ? "PERMISSION_CHANGED" : "NEW",
      pendingAction: "ingest",
      reason: null,
    };
  }
  if (previous!.syncedFingerprint !== fingerprint) {
    return { state: "UPDATED", pendingAction: "ingest", reason: null };
  }
  /*
   * NO CHANGE MARKER, SO THE BYTES ARE THE EVIDENCE. A part whose source gives
   * no dependable updated date (a procedure attachment) is re-downloaded on
   * every full sync; the engine re-indexes it only when its hash moved.
   */
  if (part.recheckBytes) return { state: "UNCHANGED", pendingAction: "ingest", reason: "recheck_bytes" };
  return { state: "UNCHANGED", pendingAction: "none", reason: null };
}

function count(report: TypeReport, state: SyncState, reason: string | null): void {
  switch (state) {
    case "NEW":
      report.new += 1;
      break;
    case "UPDATED":
      report.updated += 1;
      break;
    case "UNCHANGED":
      report.unchanged += 1;
      break;
    case "PERMISSION_CHANGED":
      report.permissionChanged += 1;
      break;
    case "UNPUBLISHED":
      report.unpublished += 1;
      break;
    case "REMOVED":
      report.removed += 1;
      break;
    case "BLOCKED":
      report.blocked += 1;
      break;
    case "ERROR":
      report.errors += 1;
      break;
    case "NEEDS_REVIEW":
      report.needsReview += 1;
      break;
    case "EXCLUDED":
      if (reason === "unsupported_format") report.excludedUnsupported += 1;
      else if (reason === "audience_excluded") report.excludedByDecision += 1;
      else report.excludedUnpublished += 1;
      break;
  }
}

export function reconcile(input: ReconcileInput): ReconcileOutput {
  const byKey = new Map(input.manifest.map((item) => [manifestKey(item), item]));
  const byType: Partial<Record<ContentType, TypeReport>> = {};
  const attention: AttentionItem[] = [];
  const items: ManifestItem[] = [];
  const audiences = new Map<string, SyncReport["audiences"][number]>();

  for (const listing of input.listings) {
    if (!listing.ok) {
      byType[listing.contentType] = { ...emptyTypeReport("failed"), listingCode: listing.code };
      continue;
    }

    const report = emptyTypeReport("ok");
    byType[listing.contentType] = report;
    report.discovered = listing.records.length;
    const shape = Object.entries(listing.diagnostics ?? {}).filter((e): e is [string, number] => typeof e[1] === "number" && Number.isFinite(e[1]));
    if (shape.length > 0) report.shape = Object.fromEntries(shape);

    const previousOfType = input.manifest.filter((item) => item.contentType === listing.contentType);
    const previousEntities = new Set(
      previousOfType.filter((item) => item.state !== "REMOVED").map((item) => item.entityId),
    );

    /* Guard 2: a listing that cannot be the whole collection. */
    let trusted = true;
    if (previousEntities.size > 0 && listing.records.length === 0) {
      trusted = false;
      report.listingCode = "empty_listing";
    } else if (
      previousEntities.size >= LISTING_SHRINK_BASELINE &&
      listing.records.length < previousEntities.size * LISTING_SHRINK_SHARE
    ) {
      trusted = false;
      report.listingCode = "listing_shrank";
    }
    if (!trusted) report.listing = "not_trusted";

    const seen = new Set<string>();
    const blockedCapabilities = new Set<string>();

    for (const record of listing.records) {
      const statusLabel = record.status ?? "(none)";
      report.statusValues[statusLabel] = (report.statusValues[statusLabel] ?? 0) + 1;

      for (const part of record.parts) {
        const key = manifestKey({ contentType: record.contentType, entityId: record.entityId, partKey: part.partKey });
        if (seen.has(key)) continue;
        seen.add(key);

        const previous = byKey.get(key);
        const decision = plan(input, record, part, previous);
        report.items += 1;
        count(report, decision.state, decision.reason);
        if (decision.state === "BLOCKED" && part.retrieval.kind === "blocked") {
          blockedCapabilities.add(part.retrieval.capability);
        }

        const eligible = record.publication === "published" && part.retrieval.kind !== "unsupported_format";
        if (eligible) report.eligible += 1;
        /* Only parts Ask Sunny could actually hold need an audience decision. */
        if (eligible && part.retrieval.kind === "available") {
          const akey = audienceKey(record.audience);
          const entry = audiences.get(akey) ?? {
            audienceKey: akey,
            label: audienceLabel(record.audience),
            items: 0,
            decision: input.decisions.get(akey)?.decision ?? null,
          };
          entry.items += 1;
          if (entry.decision === null) {
            const access = decideAccess(record.audience, input.companyWideLabels, input.decisions);
            if (access.kind === "company_wide") entry.decision = "public";
          }
          audiences.set(akey, entry);
        }

        items.push({
          source: input.source,
          contentType: record.contentType,
          entityId: record.entityId,
          partKey: part.partKey,
          title: part.title,
          recordTitle: record.title,
          status: record.status,
          audience: record.audience,
          version: record.version,
          versionId: part.versionId ?? record.versionId,
          sourceUpdatedAt: record.updatedAt,
          documentId: part.documentId,
          attachmentIds: record.attachmentIds,
          locator: part.retrieval.kind === "available" ? part.retrieval.locator : null,
          mimeType: part.mimeType,
          fileName: part.fileName,
          observedFingerprint: partFingerprint(record, part),
          syncedFingerprint: previous?.syncedFingerprint ?? null,
          contentHash: previous?.contentHash ?? null,
          knowledgeDocumentId: previous?.knowledgeDocumentId ?? null,
          inAskSunny: previous?.inAskSunny ?? false,
          state: decision.state,
          previousState: previous?.state ?? null,
          pendingAction: decision.pendingAction,
          reason: decision.reason,
          lastError: decision.pendingAction === "none" ? null : (previous?.lastError ?? null),
          errorCategory: decision.pendingAction === "none" ? null : (previous?.errorCategory ?? null),
          retryCount: decision.pendingAction === "none" ? 0 : (previous?.retryCount ?? 0),
          nextRetryAt: decision.pendingAction === "none" ? null : (previous?.nextRetryAt ?? null),
          firstSeenAt: previous?.firstSeenAt ?? input.now,
          lastSeenAt: input.now,
          lastSyncedAt: previous?.lastSyncedAt ?? null,
        });
      }
    }
    report.blockedCapabilities = [...blockedCapabilities].sort();

    /* Everything on file that this listing did not contain. */
    for (const previous of previousOfType) {
      const key = manifestKey(previous);
      if (seen.has(key)) continue;
      if (!trusted) {
        items.push(previous);
        continue;
      }
      const alreadyGone = previous.state === "REMOVED" && !previous.inAskSunny;
      const next: ManifestItem = {
        ...previous,
        previousState: previous.state,
        state: "REMOVED",
        reason: "not_in_source",
        pendingAction: previous.inAskSunny ? "retire" : "none",
      };
      if (!alreadyGone && previous.syncedFingerprint !== null) report.removed += 1;
      items.push(next);
    }

    if (!trusted) {
      attention.push({
        code: `listing_not_trusted_${listing.contentType}`,
        message: `Woven's ${listing.contentType.replace("_", " ")} list looked incomplete, so nothing was removed from Ask Sunny for it. Nothing needs doing unless this repeats.`,
      });
    }
  }

  /* Guard 3: hold a mass removal. */
  let removalsHeld = 0;
  const retiring = items.filter((item) => item.pendingAction === "retire");
  const live = input.manifest.filter((item) => item.inAskSunny).length;
  if (
    !input.confirmLargeRemoval &&
    retiring.length > MASS_REMOVAL_FLOOR &&
    retiring.length > live * MASS_REMOVAL_SHARE
  ) {
    for (const item of retiring) {
      item.pendingAction = "none";
      item.reason = "removal_held";
    }
    removalsHeld = retiring.length;
    attention.push({
      code: "mass_removal_held",
      message: `${retiring.length} documents disappeared from Woven or stopped being shared at once. They are still in Ask Sunny until you confirm the removal.`,
      count: retiring.length,
    });
  }

  const needsReview = [...audiences.values()].filter((a) => a.decision === null);
  if (needsReview.length > 0) {
    const heldItems = needsReview.reduce((sum, a) => sum + a.items, 0);
    attention.push({
      code: "audience_review",
      message: `${heldItems} published item${heldItems === 1 ? " is" : "s are"} limited to specific teams or positions in Woven. Choose whether each audience should be shared in Ask Sunny.`,
      count: heldItems,
    });
  }

  return {
    items,
    byType,
    audiences: [...audiences.values()].sort((a, b) => b.items - a.items || a.label.localeCompare(b.label)),
    removalsHeld,
    attention,
  };
}
