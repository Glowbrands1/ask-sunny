import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { groundPolicy } from "@/lib/forms/policy-grounding";
import { answerQuestion } from "@/lib/ai/server-ask";
import { activeKnowledgeCorpus } from "@/lib/knowledge/corpus";
import { SupabaseKnowledgeProvider } from "@/lib/knowledge/providers/supabase";

import { ATTENDANCE_POLICY_TEXT, WovenIntoKnowledge } from "./integration-support";
import { PASSWORD, USERNAME } from "./test-support";

/* A fresh PGlite database per test: its start-up is slow under a parallel suite. */
vi.setConfig({ hookTimeout: 60_000, testTimeout: 60_000 });

/**
 * ============================================================================
 * SYNCED WOVEN KNOWLEDGE IS USED, NOT MERELY STORED
 * ============================================================================
 *
 * A Woven policy is synced by the real engine through the real sink into the
 * real `ingestDocument` pipeline, on the repository's own knowledge schema
 * (PGlite + pgvector, the migrations verbatim). Then it is asked for the way
 * Ask Sunny asks:
 *
 *   CHAT       `answerQuestion` with the real `SupabaseKnowledgeProvider` and
 *              the real `match_knowledge_chunks`. Only the model call is
 *              replaced, so what it was SENT and what the answer CITES are
 *              both observable.
 *   FORMS      `groundPolicy`, the Corrective Action / Policy Review search,
 *              with the global `fetch` trapped so a regression to the browser
 *              client's relative `/api/knowledge/search` fails loudly.
 *
 * And across the lifecycle: an update re-indexes the SAME document and stale
 * chunks are gone; unpublishing retires it out of both; republishing restores
 * the same document.
 */

const model = vi.hoisted(() => ({
  input: null as Record<string, unknown> | null,
  answer: "Team members must arrive on time [S1].",
}));

vi.mock("@/lib/config/server-env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/config/server-env")>()),
  liveReadiness: () => ({ mode: "live", missing: [], problems: [], ready: true }),
}));

vi.mock("@/lib/ai/call-claude", () => ({
  callClaude: async (input: Record<string, unknown>) => {
    model.input = input;
    return model.answer;
  },
}));

/* Not what is under test, and each reads tables this schema does not carry. */
vi.mock("@/lib/ai/form-proposal", () => ({ proposeFormForTurn: async () => null, suggestFormsForTurn: () => null }));
vi.mock("@/lib/forms/repository", () => ({ listTemplateSummaries: async () => [] }));
vi.mock("@/lib/reporting/read/report-briefing", () => ({ loadReportBriefing: async () => null }));
vi.mock("@/lib/reporting/read/employee-facts", () => ({
  loadEmployeeFacts: async () => ({ available: false, block: null, reason: "no dataset" }),
  NO_EMPLOYEE_DATASET_REASON: "no dataset",
  EMPLOYEE_DATA_HEADING: "CURRENT EMPLOYEE PERFORMANCE DATA",
}));

/*
 * The test embedder is lexical (see `bagOfWordsEmbedding`), so questions are
 * worded in the policy's own vocabulary to clear the production similarity
 * floor. What is under test is WHICH rows retrieval may return, not ranking.
 */
const QUESTION = "What does the attendance policy say? Do team members have to arrive on time and call the salon if they will be late?";
const UPDATED_QUESTION = "Attendance policy: arrive on time for every shift? Text the salon director before the shift starts if late?";
const NOTES = "Attendance policy: did not arrive on time; did not call the salon; late.";
const UPDATED_NOTES = "Attendance policy: did not arrive on time for the shift; did not text the salon director before the shift started; late.";

async function ask(question = QUESTION) {
  model.input = null;
  return answerQuestion(
    {
      question,
      mode: "standard",
      history: [],
      scopeId: activeKnowledgeCorpus(),
      context: { userName: "Dana Reyes", locationName: "MO Kansas City Wornall", todayIso: "2026-09-29" },
    } as never,
    { role: "salon_director" as never, scope: { level: "salon", primaryAreaId: "loc-0101", alsoCoversAreaIds: [] } } as never,
  );
}

const grounding = () => String(model.input?.grounding ?? "");

/** Nothing that authenticates to Woven or unlocks a stored file may reach an answer. */
function expectNoSecrets(value: unknown) {
  const text = JSON.stringify(value);
  for (const secret of [PASSWORD, USERNAME, "WovenSession", "__RequestVerificationToken", "blob.core.windows.net", "sig=", "se=", "app.woven.team"]) {
    expect(text, secret).not.toContain(secret);
  }
  expect(text).not.toMatch(/https?:\/\//);
}

let h: WovenIntoKnowledge;

beforeEach(async () => {
  h = await WovenIntoKnowledge.create();
  model.answer = "Team members must arrive on time [S1].";
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await h.close();
});

describe("a synced Woven policy enters the normal knowledge pipeline", () => {
  it("is an ordinary indexed knowledge document with chunks, marked as from Woven", async () => {
    await h.initial();
    const id = await h.documentId(ATTENDANCE_POLICY_TEXT);

    expect(await h.document(id)).toMatchObject({
      title: "Attendance Policy",
      source: "woven",
      status: "indexed",
      indexed: true,
      version: 1,
      category: "policies_compliance",
      tags: ["woven", "woven-policy"],
    });
    const chunks = await h.chunks(id);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every((chunk) => chunk.version === 1)).toBe(true);
    expect(chunks.map((chunk) => chunk.content).join("\n")).toContain("Call the salon if you will be late.");
    /* The stored original is the policy text, in private Storage, under the document's id. */
    expect([...h.database.storage.keys()].some((path) => path.includes(id))).toBe(true);
  });
});

describe("chat retrieves and cites synced Woven content", () => {
  it("the retrieved policy reaches answer generation, and the answer cites it by its Woven title", async () => {
    await h.initial();
    const id = await h.documentId(ATTENDANCE_POLICY_TEXT);

    const answer = await ask();

    /* Retrieval → the grounding the model was sent. */
    expect(grounding()).toMatch(/^\[S1\] Attendance Policy/m);
    expect(grounding()).toContain("Call the salon if you will be late.");
    /* The citation: the human-readable title and the synced document's id. */
    expect(answer.citations).toEqual([expect.objectContaining({ documentId: id, documentTitle: "Attendance Policy" })]);
    expect((await h.document(answer.citations[0]!.documentId))?.source).toBe("woven");
    expectNoSecrets(answer.citations);
    expectNoSecrets(grounding());
  });

  it("the retrieval row itself carries the title and the synced document", async () => {
    await h.initial();
    const rows = await new SupabaseKnowledgeProvider().match({ query: QUESTION, scopeId: activeKnowledgeCorpus() });
    expect(rows[0]).toMatchObject({ document_id: (await h.documentId(ATTENDANCE_POLICY_TEXT)), document_title: "Attendance Policy", category: "policies_compliance" });
  });

  it("an update in Woven re-indexes the same document; chat sees only the new text", async () => {
    await h.initial();
    const id = await h.documentId(ATTENDANCE_POLICY_TEXT);
    const before = await h.documentCount();

    const policy = h.fake.state.policies[0]!;
    policy.body = "Arrive on time for every shift.\nText your salon director if you will be late, before the shift starts.";
    policy.version = "Version 3";
    policy.updated = "10/1/2026";
    await h.run("sync");

    expect((await h.documentId(ATTENDANCE_POLICY_TEXT))).toBe(id);
    expect(await h.documentCount()).toBe(before);
    expect(await h.document(id)).toMatchObject({ status: "indexed", version: 2, source: "woven" });
    /* Stale chunks are gone, not merely outranked. */
    const chunks = await h.chunks(id);
    expect(chunks.every((chunk) => chunk.version === 2)).toBe(true);
    expect(chunks.map((c) => c.content).join("\n")).not.toContain("Call the salon");

    const answer = await ask(UPDATED_QUESTION);
    expect(grounding()).toContain("Text your salon director if you will be late");
    expect(grounding()).not.toContain("Call the salon if you will be late.");
    expect(answer.citations).toEqual([expect.objectContaining({ documentId: id, documentTitle: "Attendance Policy" })]);
  });

  it("unpublished in Woven: retired, never retrieved or cited; republished: the same document is back", async () => {
    await h.initial();
    const id = await h.documentId(ATTENDANCE_POLICY_TEXT);

    h.fake.state.policies[0]!.status = "draft";
    await h.run("sync");
    expect(await h.document(id)).toMatchObject({ status: "retired", indexed: false });

    const retired = await ask();
    expect(grounding()).not.toContain("Attendance Policy");
    expect(retired.citations.some((c) => c.documentId === id)).toBe(false);
    const rows = await new SupabaseKnowledgeProvider().match({ query: QUESTION, scopeId: activeKnowledgeCorpus() });
    expect(rows.some((row) => row.document_id === id)).toBe(false);
    /* And a signed-in browser cannot read it either (the read policies). */
    expect(await h.database.asAuthenticated("select id from public.knowledge_documents where id = $1", [id])).toEqual([]);
    expect(await h.database.asAuthenticated("select id from public.knowledge_chunks where document_id = $1", [id])).toEqual([]);

    h.fake.state.policies[0]!.status = "current";
    await h.run("sync");
    expect((await h.documentId(ATTENDANCE_POLICY_TEXT))).toBe(id);
    expect(await h.document(id)).toMatchObject({ status: "indexed", indexed: true });
    const restored = await ask();
    expect(restored.citations).toEqual([expect.objectContaining({ documentId: id, documentTitle: "Attendance Policy" })]);
  });
});

describe("forms: groundPolicy retrieves synced Woven policy through the server-side index", () => {
  /** Any request the grounding makes over HTTP — the browser client's is `/api/knowledge/search`. */
  function trapFetch() {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      calls.push(String(input instanceof Request ? input.url : input));
      throw new TypeError("fetch is not available to server-side policy grounding in this test");
    });
    return calls;
  }

  it("finds the current Woven policy text, with its source, and makes no HTTP request", async () => {
    await h.initial();
    const id = await h.documentId(ATTENDANCE_POLICY_TEXT);
    const calls = trapFetch();

    const result = await groundPolicy(NOTES);

    expect(calls).toEqual([]);
    expect(result.unverified).toBe(false);
    expect(result.passages[0]).toMatchObject({ source: { documentId: id, documentTitle: "Attendance Policy" } });
    expect(result.passages[0]!.text).toContain("Call the salon if you will be late.");
    expectNoSecrets(result);
  });

  it("follows the policy through an update and a retirement", async () => {
    await h.initial();
    const id = await h.documentId(ATTENDANCE_POLICY_TEXT);
    trapFetch();
    const policy = h.fake.state.policies[0]!;

    policy.body = "Arrive on time for every shift.\nText your salon director if you will be late, before the shift starts.";
    policy.updated = "10/1/2026";
    await h.run("sync");
    const updated = await groundPolicy(UPDATED_NOTES);
    expect(updated.passages[0]).toMatchObject({ source: { documentId: id } });
    expect(updated.passages.map((p) => p.text).join("\n")).toContain("Text your salon director");
    expect(updated.passages.map((p) => p.text).join("\n")).not.toContain("Call the salon");

    policy.status = "draft";
    await h.run("sync");
    const retired = await groundPolicy(UPDATED_NOTES);
    expect(retired.sources.some((s) => s.documentId === id)).toBe(false);
    expect(retired.unverified).toBe(true);
  });
});
