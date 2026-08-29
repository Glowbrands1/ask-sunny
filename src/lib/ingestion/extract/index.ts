import "server-only";

import { IngestionError } from "../errors";
import type { SupportedFileType } from "../validation";
import { extractDocx } from "./docx";
import { extractPdf } from "./pdf";
import { extractTextFile } from "./txt";
import type { ExtractedDocument } from "./types";

export * from "./types";
export { extractFromString, extractTextFile } from "./txt";
export { splitHtmlByHeading } from "./docx";

/**
 * One entry point per supported type. Adding a format is a case here plus an
 * extractor module — nothing else in the pipeline changes.
 */
export async function extractDocument(
  fileType: SupportedFileType,
  buffer: Uint8Array,
): Promise<ExtractedDocument> {
  switch (fileType) {
    case "pdf":
      return extractPdf(buffer);
    case "docx":
      return extractDocx(buffer);
    case "txt":
      return extractTextFile(buffer);
    default: {
      // Exhaustiveness guard: a new SupportedFileType without an extractor is
      // a compile error here rather than a silent success at runtime.
      const exhaustive: never = fileType;
      throw new IngestionError(
        "unsupported_type",
        `No text extractor is registered for "${String(exhaustive)}".`,
      );
    }
  }
}
