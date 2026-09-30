import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EMBEDDING_DIMENSIONS } from "@/lib/config/models";
import { parseFormDocument } from "@/lib/forms/document";
import { TEMPLATE_SEEDS } from "@/lib/forms/library";
import { activeKnowledgeCorpus } from "@/lib/knowledge/corpus";
import { WovenIntoKnowledge } from "@/lib/knowledge-sync/woven/integration-support";
import { uuid } from "@/lib/knowledge-sync/woven/test-support";
import { bagOfWordsEmbedding } from "@/test/pglite-knowledge-db";

/* A fresh PGlite database per test: its start-up is slow under a parallel suite. */
vi.setConfig({ hookTimeout: 60_000, testTimeout: 60_000 });

/**
 * ============================================================================
 * THE LIVE DRESS-CODE CORRECTIVE ACTION, ON THE REAL SCHEMA
 * ============================================================================
 *
 * Production, 29 September 2026, after the Woven initial sync: a dress-code
 * Corrective Action read "Direct policy from official manual: Shift
 * Replacement — Text".
 *
 * This reproduces that corpus on the repository's own knowledge migrations
 * (PGlite): the hand-uploaded JBA manual, Woven's copy of the same PDF, and
 * Woven policies — "Shift Replacement" and "STC Dress Code" among them —
 * synced through the real engine and pipeline. The draft route runs with the
 * REAL `fetchOfficialPolicyManual` and the REAL retrieval; only the model, the
 * instance store and the Performance Management Framework are fixtures.
 */

const state = vi.hoisted(() => ({
  modelInput: null as Record<string, unknown> | null,
  templateKey: "dpoa",
  persisted: [] as { values: Record<string, string>; provenance: Record<string, Record<string, unknown>> }[],
}));

vi.mock("@/lib/api/respond", () => ({
  assertLiveMode: () => {},
  assertNoConfigurationProblems: () => {},
  assertWithinRateLimit: () => {},
  errorResponse: (error: unknown) => {
    throw error;
  },
}));

vi.mock("@/lib/forms/instance-scope", () => ({
  InstanceNotVisibleError: class InstanceNotVisibleError extends Error {},
  authorizeInstance: async () => {
    const seed = TEMPLATE_SEEDS.find((entry) => entry.key === state.templateKey)!;
    return {
      actor: { id: "demo:salon_director:QA", role: "salon_director", verified: false, scope: null },
      loaded: {
        instance: {
          id: "form-1",
          templateKey: seed.key,
          templateName: seed.name,
          layoutFamily: seed.layoutFamily,
          variantKey: seed.variants[0]?.key ?? null,
          employeeName: "Paulyne Co",
          employeeRole: null,
          locationName: "MO Kansas City Wornall",
          formDate: "2026-09-29",
          status: "draft",
        },
        version: { document: parseFormDocument(seed.document), variants: seed.variants },
      },
    };
  },
}));

vi.mock("@/lib/forms/instances", () => ({
  applyAssistantDraft: async (
    _id: string,
    draft: { values: Record<string, string>; checked: Record<string, string[]> },
    _actor: string,
    provenance: Record<string, Record<string, unknown>> = {},
  ) => {
    state.persisted.push({ values: draft.values ?? {}, provenance });
    return { accepted: { values: draft.values ?? {}, checked: draft.checked ?? {} }, rejected: [], policyRefused: [] };
  },
}));

vi.mock("@/lib/ai/anthropic", () => ({
  getAnthropicClient: () => ({
    messages: {
      create: async (input: Record<string, unknown>) => {
        state.modelInput = input;
        return {
          content: [
            {
              type: "tool_use",
              name: "write_form_fields",
              /* The model's own attempt at the line, which must not survive. */
              input: { values: { policy_language: "Shift Replacement — Text" }, checked: { offense_type: ["dress_code"] } },
            },
          ],
        };
      },
    },
  }),
}));

vi.mock("@/lib/knowledge", () => ({
  getKnowledgeProvider: () => {
    throw new Error("getKnowledgeProvider() is the browser knowledge client and must not be used on the server");
  },
}));

/* Only the framework is a fixture; the manual lookup and the retrieval are the real provider's. */
vi.mock("@/lib/knowledge/providers/supabase", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/knowledge/providers/supabase")>();
  const row = (index: number, locator: string, content: string) => ({
    chunk_id: `pmf-${index}`,
    document_id: "doc-progression",
    document_title: "ASK SUNNY PERFORMANCE MANAGEMENT FRAMEWORK KB TEXT",
    category: "leadership_coaching",
    locator,
    page: null,
    section: null,
    content,
    similarity: 0,
  });
  class WithFixtureFramework extends real.SupabaseKnowledgeProvider {
    override async fetchRoleGrounding() {
      return {
        ok: true,
        grounding: {
          role: { id: "performance_management_framework" },
          documentId: "doc-progression",
          documentTitle: "ASK SUNNY PERFORMANCE MANAGEMENT FRAMEWORK KB TEXT",
          matchedBy: "tag",
          rows: [row(0, "SECTION 2 – PERFORMANCE MANAGEMENT LADDER", "Solve the issue at the lowest appropriate level."), row(1, "10.7 Final operating rule for Ask Sunny", "Classify the issue before escalating.")],
          presentGroups: ["escalation_ladder", "final_operating_rule"],
        },
      } as never;
    }
  }
  return { ...real, SupabaseKnowledgeProvider: WithFixtureFramework };
});

const DRESS_CODE = "Employees are to keep a neat, clean, professional appearance at all times. Skirts and dresses must reach the knee.";

/** The manual PDF as ingestion stores it: printed-page sheets with their headings. */
const SHEETS = [
  { index: 0, page: 13, printed: 12, heading: "Standards of Conduct", text: "The Company expects Employees to follow rules of conduct." },
  { index: 1, page: 15, printed: 14, heading: "Attendance", text: "It is the responsibility of each employee to know his or her work schedule." },
  { index: 2, page: 16, printed: 15, heading: "Dress Code for The Company", text: DRESS_CODE },
];

let h: WovenIntoKnowledge;
const MANUAL_UPLOAD = "11111111-1111-4111-8111-111111111111";
const MANUAL_WOVEN = "22222222-2222-4222-8222-222222222222";

async function insertManualCopy(id: string, source: "upload" | "woven") {
  const scope = activeKnowledgeCorpus();
  await h.database.db.query(
    `insert into public.knowledge_documents (id, knowledge_scope_id, title, description, category, tags, original_filename, mime_type, file_type, storage_path, size_bytes, character_count, source, status, indexed, version, previous_versions, uploaded_by_name, indexed_at)
     values ($1, $2, 'JBA Policy Manual Edited 5.2025', '', 'policies_compliance', $3, 'JBA-Policy-Manual-Edited-5.2025.pdf', 'application/pdf', 'pdf', $4, 1000, 1000, $5, 'indexed', true, 1, '[]', 'fixture', now())`,
    [id, scope, source === "woven" ? ["woven", "woven-handbook"] : [], `${scope}/${id}/1/manual.pdf`, source],
  );
  for (const sheet of SHEETS) {
    const content = `${sheet.printed} | P a g e\n${sheet.heading}\n${sheet.text}`;
    await h.database.db.query(
      `insert into public.knowledge_chunks (document_id, knowledge_scope_id, chunk_index, version, content, locator, page, section, metadata, embedding_model, embedding)
       values ($1, $2, $3, 1, $4, $5, $6, $7, $8::jsonb, 'bag-of-words-test', $9::extensions.vector)`,
      [
        id,
        scope,
        sheet.index,
        content,
        `Page ${sheet.printed} — ${sheet.heading}`,
        sheet.page,
        sheet.heading,
        JSON.stringify({ printedPage: sheet.printed, sections: [{ heading: sheet.heading, page: sheet.printed }] }),
        `[${bagOfWordsEmbedding(content, EMBEDDING_DIMENSIONS).join(",")}]`,
      ],
    );
  }
}

async function draft(notes: string) {
  state.persisted = [];
  const { POST } = await import("./instances/[id]/draft/route");
  const response = await POST(
    new Request("http://localhost/api/forms/instances/form-1/draft", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ notes }) }),
    { params: Promise.resolve({ id: "form-1" }) },
  );
  return (await response.json()) as Record<string, unknown>;
}

beforeEach(async () => {
  h = await WovenIntoKnowledge.create();
  /* The Woven policies the live form named instead: short plain-text documents, chunk locator "Text". */
  h.fake.state.policies.push(
    { id: uuid(111), title: "Shift Replacement", status: "current", audience: "Public", updated: "3/1/2026", body: "Find your own replacement for a shift and notify the salon director.", version: "Version 1", attachments: [] },
    { id: uuid(112), title: "STC Dress Code", status: "current", audience: "Public", updated: "3/1/2026", body: "Wear the Sun Tan City uniform shirt. Skirts must reach the knee.", version: "Version 1", attachments: [] },
  );
  await h.initial();
  await insertManualCopy(MANUAL_UPLOAD, "upload");
  await insertManualCopy(MANUAL_WOVEN, "woven");
  state.templateKey = "dpoa";
});

afterEach(async () => {
  await h.close();
});

describe("Direct policy from official manual, on the live corpus shape", () => {
  /*
   * The Corrective Action cites the pinned manual's section for the ticked
   * box; the Policy Review has no offense boxes, so it cites what retrieval
   * found IN the pinned manual. (The notes are worded in the manual's own
   * vocabulary because the test embedder is lexical.)
   */
  it.each(["dpoa", "policy-review"])("%s: the dress-code wording and its source — the Woven copy of the manual, section and printed page", async (key) => {
    state.templateKey = key;
    await draft("Dress code for the company: employees keep a neat, clean, professional appearance at all times; skirts and dresses must reach the knee. She wore a mini skirt.");
    const [persisted] = state.persisted;
    const value = persisted!.values.policy_language!;

    expect(value).toBe(`${DRESS_CODE}\n\nSource: JBA Policy Manual — Dress Code for The Company, p. 15`);
    /* The unrelated source the live form showed cannot appear, and nor can an extractor label. */
    expect(value).not.toContain("Shift Replacement");
    expect(value).not.toMatch(/— Text\b/);
    /* Structured provenance names the Woven copy of the manual — pinned (Corrective Action) or retrieved from it (Policy Review). */
    if (key === "dpoa") {
      expect(persisted!.provenance.policy_language).toMatchObject({
        verified: true,
        source: "official_policy_manual",
        documentId: MANUAL_WOVEN,
        citation: [{ policyText: DRESS_CODE, documentTitle: "JBA Policy Manual", sectionTitle: "Dress Code for The Company", pageLabel: "15", documentId: MANUAL_WOVEN, source: "official_policy_manual" }],
      });
    } else {
      expect(persisted!.provenance.policy_language).toMatchObject({ verified: true, sources: expect.arrayContaining([expect.objectContaining({ documentId: MANUAL_WOVEN })]) });
    }
    expect(JSON.stringify(persisted)).not.toMatch(/https?:\/\/|blob\.core\.windows\.net|sig=|WovenSession/);
  });

  it("the attendance section cites its own printed page, and nothing about dress code", async () => {
    await draft("She was forty minutes late for her shift today.");
    /* The model ticked dress code in the fixture; the section cited follows the tick, from the manual's rows. */
    expect(state.persisted[0]!.values.policy_language).toContain("Source: JBA Policy Manual — Dress Code for The Company, p. 15");
    expect(state.persisted[0]!.values.policy_language).not.toMatch(/p\. 1[^5]/);
  });

  it.each(["dpoa", "policy-review"])("%s: a SUPERSEDED copy is out of the running — the same-kind tie resolves to the current copy, and nothing is drawn from the old one", async (key) => {
    state.templateKey = key;
    /* Two uploads (a same-kind tie, which alone is refused as ambiguous) — one replaced by the other. */
    await h.database.db.query("update public.knowledge_documents set source = 'upload' where id = $1", [MANUAL_WOVEN]);
    await h.database.db.query(
      "update public.knowledge_documents set status = 'superseded', indexed = false, superseded_by = $2, superseded_at = now(), tags = '{official-policy-manual}' where id = $1",
      [MANUAL_UPLOAD, MANUAL_WOVEN],
    );
    await draft("Dress code for the company: employees keep a neat, clean, professional appearance at all times; skirts and dresses must reach the knee. She wore a mini skirt.");
    const persisted = state.persisted[0]!;
    expect(persisted.values.policy_language).toBe(`${DRESS_CODE}\n\nSource: JBA Policy Manual — Dress Code for The Company, p. 15`);
    expect(JSON.stringify(persisted.provenance)).not.toContain(MANUAL_UPLOAD);
    expect(JSON.stringify(persisted.provenance)).toContain(MANUAL_WOVEN);
  });

  it("two copies of the SAME kind stay ambiguous: the line is left for the manager, never filled from an unrelated hit", async () => {
    await h.database.db.query("update public.knowledge_documents set source = 'upload' where id = $1", [MANUAL_WOVEN]);
    await draft("She was wearing a mini skirt at the front desk today. Dress code.");
    expect(state.persisted[0]!.values.policy_language).toBeUndefined();
  });
});
