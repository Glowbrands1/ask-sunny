import { describe, expect, it } from "vitest";

import { SOURCE_LABEL } from "@/features/knowledge/document-status";

import { DOCUMENT_SOURCE_LABEL } from "./knowledge-taxonomy";

describe("knowledge taxonomy", () => {
  it("the AI's document source words are the Knowledge Base badge's (read_knowledge_documents, 27 Nov 2026)", () => {
    expect(DOCUMENT_SOURCE_LABEL).toEqual(SOURCE_LABEL);
  });
});
