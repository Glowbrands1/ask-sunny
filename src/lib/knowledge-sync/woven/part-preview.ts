import "server-only";

import { extractDocument } from "@/lib/ingestion/extract";
import { validateUpload } from "@/lib/ingestion/validation";
import { displayLocator } from "@/lib/knowledge/locator";
import { partRef } from "../inventory";
import type { KnowledgeSyncStore } from "../ports";
import { createSupabaseKnowledgeSyncStore } from "../store";
import type { ContentType, KnowledgeSourceConnector } from "../types";
import { readWovenKnowledgeConfig, type WovenKnowledgeConfig } from "./config";
import { WovenKnowledgeConnector } from "./connector";
import { WovenTeamClient } from "./http";

/**
 * ============================================================================
 * "PREVIEW" — WHAT ASK SUNNY WOULD READ IN ONE WOVEN ITEM, BEFORE ANY CHOICE
 * ============================================================================
 *
 * An administrator deciding "Share with everyone" (or about to run a large
 * sync) sees the content itself, not only its title:
 *
 *   ALREADY IN ASK SUNNY   the existing document page (`askSunnyDocumentId`),
 *                          which shows the indexed text and opens the file;
 *   NOT YET                the part is fetched from Woven exactly as a sync
 *                          would fetch it and run through the SAME extractor,
 *                          IN MEMORY ONLY — nothing is stored, indexed or made
 *                          searchable, and the manifest is not touched.
 *
 * The request names the part by its opaque `ref` (see `partRef`); the locator
 * comes from what Ask Sunny recorded, or from a fresh listing of that one
 * content type — never from the browser. What comes back is the title, type,
 * source name, file name and extracted text with its page/section labels. No
 * Woven or storage URL, no stored file name, no id beyond the Ask Sunny
 * document's own.
 */

/** Enough to judge what a document says, and small enough to send. */
const PREVIEW_CHARACTERS = 40_000;

export interface PartPreview {
  title: string;
  contentType: ContentType;
  /** The Woven item it belongs to (the manual, the procedure, the policy). */
  sourceName: string;
  fileName: string | null;
  /** Set when Ask Sunny already holds this part: open that document instead. */
  askSunnyDocumentId: string | null;
  sections: { label: string; page: number | null; text: string }[];
  characterCount: number;
  truncated: boolean;
}

export type PartPreviewResult =
  | { status: "ok"; preview: PartPreview }
  | { status: "not_found" | "not_previewable" | "failed"; reason: string };

export async function previewWovenPart(
  ref: string,
  overrides: { config?: WovenKnowledgeConfig; store?: KnowledgeSyncStore; connector?: KnowledgeSourceConnector } = {},
): Promise<PartPreviewResult> {
  if (!/^[0-9a-f]{16}$/.test(ref)) return { status: "not_found", reason: "That item is not in the Woven inventory." };
  const store = overrides.store ?? createSupabaseKnowledgeSyncStore();

  const manifest = await store.loadManifest("woven");
  const known = manifest.find((item) => partRef(item) === ref);
  const scanned = known ? null : (await store.loadPreviewInventory("woven").catch(() => [])).find((item) => partRef(item) === ref);
  const target = known ?? scanned;
  if (!target) return { status: "not_found", reason: "That item is not in the latest Woven inventory. Scan Woven again." };
  if (target.state === "BLOCKED" || target.reason === "unsupported_format") {
    return { status: "not_previewable", reason: "Ask Sunny can't read this kind of Woven item yet, so there is nothing to preview." };
  }

  const sourceName = (target.recordTitle ?? "").trim() || target.title;
  const base = { title: target.title, contentType: target.contentType, sourceName, fileName: target.fileName };
  if (known?.inAskSunny && known.knowledgeDocumentId) {
    return { status: "ok", preview: { ...base, askSunnyDocumentId: known.knowledgeDocumentId, sections: [], characterCount: 0, truncated: false } };
  }

  const config = overrides.config ?? readWovenKnowledgeConfig();
  if (!overrides.connector && (!config.enabled || !config.credentials)) {
    return { status: "failed", reason: "The Woven connection is not configured, so the item cannot be read." };
  }
  const connector =
    overrides.connector ??
    new WovenKnowledgeConnector({
      client: new WovenTeamClient({ baseUrl: config.baseUrl, deadlineAt: Date.now() + 50_000 }),
      credentials: config.credentials!,
      company: config.company,
    });

  try {
    await connector.connect();
    let locator = known?.locator ?? null;
    let mimeType = known?.mimeType ?? null;
    if (!locator) {
      /* Found by a scan only: list that one content type again for where to read it from. */
      const listing = await connector.list(target.contentType);
      if (!listing.ok) return { status: "failed", reason: "Woven's list could not be read just now. Try again." };
      const part = listing.records.find((r) => r.entityId === target.entityId)?.parts.find((p) => p.partKey === target.partKey);
      if (!part || part.retrieval.kind !== "available") return { status: "not_previewable", reason: "Woven no longer offers this item for download." };
      locator = part.retrieval.locator;
      mimeType = part.mimeType;
    }
    const file = await connector.fetchPart({
      contentType: target.contentType,
      entityId: target.entityId,
      partKey: target.partKey,
      locator,
      fileName: target.fileName,
      mimeType,
      title: target.title,
    });
    const { fileType } = validateUpload({ fileName: file.fileName, mimeType: file.mimeType, sizeBytes: file.bytes.byteLength });
    const extracted = await extractDocument(fileType, file.bytes);

    let budget = PREVIEW_CHARACTERS;
    const sections: PartPreview["sections"] = [];
    for (const segment of extracted.segments) {
      if (budget <= 0) break;
      const text = segment.text.slice(0, budget);
      budget -= text.length;
      const page = segment.printedPage ?? segment.page;
      sections.push({ label: displayLocator(segment.section ?? segment.locator), page: page ?? null, text });
    }
    return {
      status: "ok",
      preview: {
        ...base,
        /* The name the file is known by, never a storage name. */
        fileName: target.fileName ?? (file.mimeType === "text/plain" ? null : file.fileName),
        askSunnyDocumentId: null,
        sections,
        characterCount: extracted.characterCount,
        truncated: extracted.characterCount > PREVIEW_CHARACTERS,
      },
    };
  } catch (error) {
    const category = (error as { category?: string; code?: string }).category ?? (error as { code?: string }).code ?? "";
    const reason =
      /no_text/.test(category)
        ? "No text could be read from this file — it looks like a scanned image."
        : /not_a_file/.test(category)
          ? "Woven sent back a page instead of the file."
          : "The item could not be read from Woven just now.";
    return { status: "failed", reason };
  }
}
