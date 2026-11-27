import { expect, vi } from "vitest";

import { AI_READABLE_PAGES, readablePagesLine } from "@/config/ai-readable-pages";
import { __setDataToolDepsForTests } from "@/lib/ai/agent-loop/data-tools";
import type { KnowledgeDocument } from "@/types";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { lastResult, loopStandIn, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * THE KNOWLEDGE BASE'S DOCUMENT LIST REACHES THE MODEL, FOR ADMINISTRATORS ONLY (Pau, 27 Nov 2026; CLAUDE.md §5)
 * ============================================================================
 *
 * The Knowledge Base page (`/knowledge`) was `notReadable`: search_knowledge reads what the documents say, but nothing
 * read the list itself, so "which documents do we have?" or "did any document fail?" had no answer. The page is an
 * administrators' page (`requireAdminConsolePage("view_knowledge")`): the inventory is administration, so the reader
 * refuses anyone the page refuses. These cases ask through the real chat route with production's flags: an
 * administrator gets the documents with their status, date and a failed one's reason; a Salon Director, who holds View
 * knowledge but not the admin console, gets nothing. The document table is not in the harness, so it is scripted.
 */
const REPORT = "Pau, 27 Nov 2026: \"build the knowledge base list reader\" (the Knowledge Base page was not readable by the AI)";
const FLAG = "AGENT_LOOP_ENABLED";
const ADMIN_SCOPE = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] } as const;

const doc = (id: string, title: string, status: KnowledgeDocument["status"], updatedAt: string, extra: Partial<KnowledgeDocument> = {}): KnowledgeDocument => ({
  id,
  title,
  description: `${title}, the invented edition.`,
  category: "policies_compliance",
  fileName: `${id}.pdf`,
  fileType: "pdf",
  sizeBytes: 1000,
  characterCount: 500,
  status,
  source: "woven",
  version: 3,
  previousVersions: [],
  uploadedBy: "Invented Admin",
  uploadedAt: "2026-10-01T10:00:00Z",
  updatedAt,
  indexed: status === "ready",
  tags: [],
  ...extra,
});
const LIBRARY = [
  doc("d1", "Invented Policy Manual", "ready", "2026-11-20T10:00:00Z"),
  doc("d2", "Invented Cleaning Guide", "failed", "2026-11-25T10:00:00Z", { failureReason: "The file had no readable text.", source: "upload" }),
];

async function ask(t: ReplayContext, words: string, input: Record<string, unknown> = {}) {
  vi.setSystemTime(new Date("2026-11-27T16:00:00Z"));
  t.directory(STAFF);
  const read: string[] = [];
  __setDataToolDepsForTests({ loadKnowledgeDocuments: async (scopeId) => (read.push(scopeId), LIBRARY) });
  const model = loopStandIn((view: LoopView) => (lastResult(view, "read_knowledge_documents") ? { text: "Here is what the Knowledge Base holds." } : { tool: "read_knowledge_documents", input }));
  t.loopModel!(model);
  try {
    await t.thread().say(words);
  } finally {
    __setDataToolDepsForTests(null);
  }
  const output = (model.views.flatMap((view) => view.results.filter((result) => result.tool === "read_knowledge_documents")).at(-1)?.output ?? {}) as Record<string, unknown>;
  return { model, output, read };
}

export const NOV27_KNOWLEDGE_DOCUMENTS_CASES: ReplayCase[] = [
  {
    id: "nov27-knowledge-documents-reach-the-model",
    title: "\"which documents do we have in the knowledge base, and did any fail?\" (an administrator): read_knowledge_documents gives the model each document's status and date and a failed one's reason; the rules name the page",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
      t.as("admin", ADMIN_SCOPE);
      const { model, output, read } = await ask(t, "which documents do we have in the knowledge base, and did any fail?");
      expect(model.views[0]?.system, "the readable-pages line is not in what the model is given").toContain(readablePagesLine(AI_READABLE_PAGES)!);
      expect(model.views[0]?.system).toContain("Knowledge Base (read_knowledge_documents)");
      expect(output.refused, JSON.stringify(output)).toBeUndefined();
      expect(read, "the list was not read").toHaveLength(1);
      const documents = JSON.stringify(output.documents);
      expect(documents, "the documents did not reach the model").toContain("Invented Policy Manual");
      expect(documents).toContain("Invented Cleaning Guide");
      expect(documents, "the failed document's reason did not reach the model").toContain("The file had no readable text.");
      expect(output.by_status).toEqual({ Ready: 1, Failed: 1 });
    },
  },
  {
    id: "nov27-knowledge-documents-not-for-a-salon-director",
    title: "\"which documents do we have in the knowledge base?\" (a Salon Director, who holds View knowledge but not the admin console): refused, nothing read, no document named",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
      t.as("salon_director", KEARNEY);
      const { output, read } = await ask(t, "which documents do we have in the knowledge base?");
      expect(output.refused, "a Salon Director was given the document list").toBeTruthy();
      expect(read, "the list was read for a role the page refuses").toEqual([]);
      expect(JSON.stringify(output)).not.toContain("Invented Policy Manual");
    },
  },
];
