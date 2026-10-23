import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { expandGlossaryQuery } from "@/lib/ai/glossary";
import { normalizeUserMessage } from "@/lib/ai/message-normalize";
import { runSelfCheck, type ReviewBrief } from "@/lib/ai/self-check";
import { queryRewriteEnabled, selfCheckEnabled } from "@/lib/config/chat-quality-flags";
import { EMBEDDING_DIMENSIONS, RETRIEVAL } from "@/lib/config/models";
import type { ManualChunk } from "@/lib/forms/official-policy-manual";
import { JBA_MANUAL_CA_CHUNKS } from "@/test/fixtures/jba-manual-ca-sections";
import { createMigratedTestDatabase } from "@/test/pglite-knowledge-db";

import type { MatchedChunkRow } from "./mappers";
import { selectRecallCandidates, type RecallCandidate } from "./recall-rank";

/**
 * Must-pass bars for the questions that regressed with both retrieval flags on.
 *
 * QUERY_REWRITE is on. The model call is a mock of a standalone rewrite: it
 * keeps the manager's words and does not name a section. Retrieval embeds
 * the production gte-small vector of that string. For the three "late"
 * questions, Attendance has to be in the context the answer model sees.
 * SELF_CHECK is on, and a judge that has read the chunk text drops Late
 * Opening, so the citation that leaves is Attendance.
 */

const PRIOR = [
  "20260829000100_extensions",
  "20260829000200_knowledge_schema",
  "20260829000300_match_knowledge_chunks",
  "20260829000400_rls",
  "20260831000600_rls_privilege_hardening",
  "20260831000800_embedding_dimensions_384",
  "20260929001000_woven_knowledge_sync",
  "20260930001000_woven_knowledge_inventory",
  "20260930002000_knowledge_document_superseded",
  "20261023001000_knowledge_hybrid_search",
  "20261023161000_match_knowledge_chunks_hybrid_index",
] as const;

const SCOPE = "rewrite-rank";
const MANUAL = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const FRAMEWORK = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";

/** Section titles the rewrite is not allowed to introduce. */
const SECTION_TITLES = ["attendance", "late opening", "shift replacement", "standards of conduct"] as const;

const CASES = [
  {
    question: "what is the policy if an employee showed up late 3 times this month",
    rewrite: "what is the policy if an employee showed up late 3 times this month",
    bar: "attendance-in-context",
  },
  {
    question: "late 3 times",
    rewrite: "employee was late 3 times",
    bar: "attendance-in-context",
  },
  {
    question: "employee keeps coming in late",
    rewrite: "employee keeps coming in late",
    bar: "attendance-in-context",
  },
  {
    question: "tardy twice this week",
    rewrite: "employee was tardy twice this week",
    bar: "attendance-first",
  },
  {
    question: "salon opened late today",
    rewrite: "salon opened late today",
    bar: "late-opening-first",
  },
  {
    question: "swap shifts",
    rewrite: "employees swapping shifts",
    bar: "shift-replacement-first",
  },
  {
    question: "rude to a customer",
    rewrite: "rude to a customer",
    bar: "standards-first",
  },
] as const;

type Bar = (typeof CASES)[number]["bar"];

interface LiveChunk {
  id: string;
  section: string;
  page: number;
  contentSha256: string;
  embedding: number[];
  category: string;
  title: string;
  content?: string;
}

interface RewriteQuestion {
  question: string;
  rewrite: string;
  intent: string;
  searched: string;
  embedding: number[];
}

interface RewriteFile {
  model: string;
  questions: RewriteQuestion[];
}

interface LiveFile {
  model: string;
  chunks: LiveChunk[];
}

interface RpcRow {
  chunk_id: string;
  document_id: string;
  document_title: string;
  category: string;
  locator: string;
  page: number;
  section: string | null;
  content: string;
  similarity: number;
  vector_rank: number | null;
  keyword_rank: number | null;
  section_exact: boolean;
}

const rewrites = JSON.parse(
  readFileSync("src/lib/knowledge/rewrite-question-embeddings.json", "utf8"),
) as RewriteFile;
const live = JSON.parse(readFileSync("src/lib/knowledge/live-question-embeddings.json", "utf8")) as LiveFile;

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function contentFor(chunk: LiveChunk): string {
  if (chunk.content) return chunk.content;
  const fixture = JBA_MANUAL_CA_CHUNKS.find((row) => row.chunkId === chunk.id);
  if (!fixture) throw new Error(`no stand-in text for ${chunk.id}`);
  return fixture.content;
}

function toCandidate(row: RpcRow): RecallCandidate {
  return {
    row: {
      chunk_id: row.chunk_id,
      document_id: row.document_id,
      document_title: row.document_title,
      category: row.category,
      locator: row.locator,
      page: row.page,
      section: row.section,
      content: row.content,
      similarity: Number(row.similarity),
    },
    vectorRank: row.vector_rank === null ? null : Number(row.vector_rank),
    keywordRank: row.keyword_rank === null ? null : Number(row.keyword_rank),
    sectionExact: Boolean(row.section_exact),
    sectionSimilarity: null,
  };
}

/** The retrieval string production embeds when QUERY_REWRITE is on. */
async function searchedQuery(question: string, rewrite: string): Promise<string> {
  const heard = await normalizeUserMessage({
    question,
    history: [],
    callModel: async () => ({ query: rewrite, intent: "policy_question" }),
  });
  expect(heard.answerText, question).toBe(question);
  expect(heard.modelQuery, question).toBe(rewrite);
  expect(heard.intent, question).toBe("policy");
  const query = queryRewriteEnabled() ? expandGlossaryQuery(heard.modelQuery ?? question) : question;
  // matchRecallKnowledge expands the retrieval query once more before embedding.
  return expandGlossaryQuery(query);
}

function firstSection(rows: readonly MatchedChunkRow[], section: string): number {
  const wanted = section.toLowerCase();
  return rows.findIndex((row) => (row.section ?? "").toLowerCase() === wanted);
}

function orderLine(rows: readonly MatchedChunkRow[]): string {
  return rows
    .slice(0, 5)
    .map((row) => `${row.section ?? "(no section)"} p.${row.page} ${row.similarity.toFixed(4)}`)
    .join(" | ");
}

function passes(bar: Bar, rows: readonly MatchedChunkRow[]): boolean {
  if (bar === "attendance-in-context") return firstSection(rows, "Attendance") >= 0;
  if (bar === "attendance-first") return rows[0]?.section === "Attendance";
  if (bar === "late-opening-first") return rows[0]?.section === "Late Opening";
  if (bar === "shift-replacement-first") return rows[0]?.section === "Shift Replacement";
  return rows[0]?.section === "Standards of Conduct";
}

/**
 * The SELF_CHECK prompt: a section applies when its own text describes the
 * situation in the question. Late Opening's text is the scheduled opener and
 * the $25 repayment. A question that never describes opening the salon does
 * not get that section.
 */
function sectionApplies(question: string, text: string): boolean {
  const aboutOpening = /scheduled to open|cannot open on time|did not open|repays the company \$25/i.test(text);
  const asksAboutOpening = /\b(?:salon|location|store)\b/i.test(question) && /\bopen/i.test(question);
  if (aboutOpening && !asksAboutOpening) return false;
  return true;
}

const LATE_QUESTIONS = [
  "what is the policy if an employee showed up late 3 times this month",
  "late 3 times",
  "employee keeps coming in late",
] as const;

describe("QUERY_REWRITE must-pass rankings on production embeddings", () => {
  let previousRewrite: string | undefined;
  let previousCheck: string | undefined;
  let harness: Awaited<ReturnType<typeof createMigratedTestDatabase>> | undefined;

  beforeAll(async () => {
    previousRewrite = process.env.QUERY_REWRITE_ENABLED;
    previousCheck = process.env.SELF_CHECK_ENABLED;
    process.env.QUERY_REWRITE_ENABLED = "1";
    process.env.SELF_CHECK_ENABLED = "1";
    harness = await createMigratedTestDatabase(PRIOR);
    await insertDocument(harness.db, {
      id: MANUAL,
      title: "JBA Policy Manual Edited 5.2025",
      category: "policies_compliance",
    });
    await insertDocument(harness.db, {
      id: FRAMEWORK,
      title: "Performance Management Framework",
      category: "leadership_coaching",
    });
    for (const chunk of live.chunks) {
      const documentId = chunk.id === "pmf" ? FRAMEWORK : MANUAL;
      const chunkIndex =
        chunk.id === "pmf" ? 0 : chunk.id === "buddy" ? 1001 : chunk.id === "start" ? 1002 : Number(chunk.id.slice(4));
      await insertChunk(harness.db, {
        documentId,
        index: chunkIndex,
        section: chunk.section,
        page: chunk.page,
        content: contentFor(chunk),
        embedding: chunk.embedding,
      });
    }
  }, 60_000);

  afterAll(async () => {
    if (previousRewrite === undefined) delete process.env.QUERY_REWRITE_ENABLED;
    else process.env.QUERY_REWRITE_ENABLED = previousRewrite;
    if (previousCheck === undefined) delete process.env.SELF_CHECK_ENABLED;
    else process.env.SELF_CHECK_ENABLED = previousCheck;
    await harness?.close();
  });

  it("embeds a standalone rewrite that does not name a section", () => {
    expect(queryRewriteEnabled()).toBe(true);
    expect(selfCheckEnabled()).toBe(true);
    expect(rewrites.model).toBe("gte-small");
    expect(live.model).toBe("gte-small");
    expect(rewrites.questions.map((question) => question.question)).toEqual(CASES.map((item) => item.question));
    for (const item of CASES) {
      const stored = rewrites.questions.find((question) => question.question === item.question);
      expect(stored?.rewrite, item.question).toBe(item.rewrite);
      expect(stored?.intent, item.question).toBe("policy_question");
      expect(stored?.embedding, item.question).toHaveLength(EMBEDDING_DIMENSIONS);
      const rewrite = item.rewrite.toLowerCase();
      for (const title of SECTION_TITLES) {
        expect(rewrite.includes(title), `${item.question} rewrite names ${title}`).toBe(false);
      }
    }
    for (const chunk of live.chunks) {
      expect(chunk.embedding).toHaveLength(EMBEDDING_DIMENSIONS);
      expect(sha256(contentFor(chunk)), chunk.id).toBe(chunk.contentSha256);
    }
  });

  it.each(CASES)("$question", async (item) => {
    const stored = rewrites.questions.find((question) => question.question === item.question);
    if (!stored || !harness) throw new Error(`missing production embedding for ${item.question}`);
    const searched = await searchedQuery(item.question, item.rewrite);
    expect(searched, item.question).toBe(stored.searched);
    const matched = await harness.db.query<RpcRow>(
      `select chunk_id, document_id, document_title, category, locator, page, section, content,
              similarity, vector_rank, keyword_rank, section_exact
         from public.match_knowledge_chunks_hybrid(
           $1::extensions.vector, $2, $3, 20, 0, null
         )`,
      [`[${stored.embedding.join(",")}]`, searched, SCOPE],
    );
    const selected = selectRecallCandidates(matched.rows.map(toCandidate), searched, {
      limit: RETRIEVAL.topK,
    });
    const answer = selected.rows.slice(0, RETRIEVAL.contextChunks);
    const line = `rewrite: ${item.rewrite}\nsearched: ${searched.replaceAll("\n", " / ")}\nranked: ${orderLine(answer)}`;
    expect(passes(item.bar, answer), line).toBe(true);
    expect(searched, item.question).toBe(item.rewrite);
  });

  it.each(LATE_QUESTIONS)("SELF_CHECK cites Attendance for %s", async (question) => {
    const item = CASES.find((entry) => entry.question === question);
    const stored = rewrites.questions.find((entry) => entry.question === question);
    if (!item || !stored || !harness) throw new Error(`missing production embedding for ${question}`);
    expect(selfCheckEnabled()).toBe(true);
    const searched = await searchedQuery(question, item.rewrite);
    const matched = await harness.db.query<RpcRow>(
      `select chunk_id, document_id, document_title, category, locator, page, section, content,
              similarity, vector_rank, keyword_rank, section_exact
         from public.match_knowledge_chunks_hybrid(
           $1::extensions.vector, $2, $3, 20, 0, null
         )`,
      [`[${stored.embedding.join(",")}]`, searched, SCOPE],
    );
    const answer = selectRecallCandidates(matched.rows.map(toCandidate), searched, {
      limit: RETRIEVAL.topK,
    }).rows.slice(0, RETRIEVAL.contextChunks);
    const attendance = answer.find((row) => row.section === "Attendance");
    const lateOpening = answer.find((row) => row.section === "Late Opening");
    expect(attendance, orderLine(answer)).toBeTruthy();
    expect(lateOpening, orderLine(answer)).toBeTruthy();
    const cited = [attendance!, lateOpening!];
    const chunks: ManualChunk[] = cited.map((row, index) => ({
      chunkIndex: index,
      page: row.page,
      printedPage: row.page,
      section: row.section,
      content: row.content,
      sections: [{ heading: row.section ?? "", page: row.page }],
    }));
    const content = cited.map((row) => `${row.section}, JBA Policy Manual p.${row.page}.`).join(" ");
    let brief: ReviewBrief | null = null;
    const settled = await runSelfCheck(
      { content, employeeName: null, actionPlan: null, chunks, roster: [], question },
      async (seen: ReviewBrief) => {
        brief = seen;
        const verdicts = seen.sections.map((section) => ({
          heading: section.heading,
          applies: sectionApplies(seen.question, section.text),
        }));
        const kept = seen.sections.filter((section) => sectionApplies(seen.question, section.text));
        return {
          content: kept.map((section) => `${section.heading}, JBA Policy Manual p.${section.page}.`).join(" "),
          employeeName: null,
          actionPlan: null,
          sections: verdicts,
        };
      },
    );
    expect(brief?.question).toBe(question);
    expect(brief?.sections.map((section) => section.heading).sort()).toEqual(["Attendance", "Late Opening"]);
    expect(brief?.sections.find((section) => section.heading === "Attendance")?.text).toMatch(/arrives on time/i);
    expect(brief?.sections.find((section) => section.heading === "Late Opening")?.text).toMatch(/\$25/);
    expect(settled.content).toContain("Attendance");
    expect(settled.content).not.toContain("Late Opening");
  });
});

async function insertDocument(
  db: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
  input: { id: string; title: string; category: string },
) {
  await db.query(
    `insert into public.knowledge_documents (
       id, knowledge_scope_id, title, description, category, tags, original_filename, mime_type, file_type,
       storage_path, size_bytes, character_count, source, status, indexed, version, previous_versions,
       uploaded_by_name, indexed_at
     ) values (
       $1, $2, $3, '', $4, '{}', $5, 'text/plain', 'txt', $6, 100, 100, 'upload',
       'indexed'::public.knowledge_document_status, true, 1, '[]', 'fixture', now()
     )`,
    [input.id, SCOPE, input.title, input.category, `${input.id}.txt`, `${SCOPE}/${input.id}/1/${input.id}.txt`],
  );
}

async function insertChunk(
  db: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
  input: {
    documentId: string;
    index: number;
    section: string;
    page: number;
    content: string;
    embedding: readonly number[];
  },
) {
  await db.query(
    `insert into public.knowledge_chunks (
       document_id, knowledge_scope_id, chunk_index, version, content, locator, page, section,
       embedding_model, embedding
     ) values (
       $1, $2, $3, 1, $4, $5, $6, $7, 'gte-small', $8::extensions.vector
     )`,
    [
      input.documentId,
      SCOPE,
      input.index,
      input.content,
      `Page ${input.page} — ${input.section}`,
      input.page,
      input.section,
      `[${input.embedding.join(",")}]`,
    ],
  );
}
