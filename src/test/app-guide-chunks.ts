import { readFileSync } from "node:fs";

import type { ManualChunk } from "@/lib/forms/official-policy-manual";
import { chunkSegments } from "@/lib/ingestion/chunking";
import { extractFromString } from "@/lib/ingestion/extract/txt";

/** The corrected Ask Sunny app guide, as it will be re-uploaded. */
export const APP_GUIDE = readFileSync("docs/knowledge/ask-sunny-app-knowledge.txt", "utf8");

/**
 * The guide chunked exactly as ingestion will chunk the uploaded .txt — the
 * real extractor and chunker — so a test sees the sections and locators the
 * live document will have, not a hand-made approximation.
 */
export function appGuideChunks(): ManualChunk[] {
  return chunkSegments(extractFromString(APP_GUIDE).segments).map((chunk) => ({
    chunkIndex: chunk.index,
    chunkId: `app-${chunk.index}`,
    locator: chunk.locator,
    page: chunk.page,
    section: chunk.section,
    content: chunk.content,
  }));
}
