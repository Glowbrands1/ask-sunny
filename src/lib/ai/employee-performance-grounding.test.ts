import { readFileSync } from "node:fs";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { RETRIEVAL } from "@/lib/config/models";
import type { MatchedChunkRow } from "@/lib/knowledge/mappers";
import {
  EMPLOYEE_PERFORMANCE_FRAMEWORK,
  resolveRoleDocument,
  selectMandatoryChunks,
  toRoleGroundingRow,
} from "@/lib/knowledge/document-roles";
import { assembleGrounding } from "./grounding-assembly";
import { isEmployeePerformanceQuestion } from "./employee-performance-gate";
import { EMPLOYEE_PERFORMANCE_RULES, buildSystemPrompt } from "./prompts";

/**
 * ============================================================================
 * THE EMPLOYEE PERFORMANCE FRAMEWORK IS MANDATORY, NOT LUCKY
 * ============================================================================
 *
 * The framework is one document among 28 and 80 chunks among 897. Before this,
 * whether it reached a coaching answer depended on whether one of those 80
 * chunks cleared the similarity threshold and landed in the top 14 — and
 * measured against the live corpus, a coaching question phrased in the Salon
 * Coaching Guide's vocabulary retrieves ZERO of them.
 *
 * THE FIXTURES BELOW ARE THAT MEASUREMENT. `RETRIEVED_NO_FRAMEWORK` is the
 * hostile case made concrete: fourteen real-looking chunks from the manuals and
 * policies that actually outrank the framework, and not one framework chunk
 * among them. Every inclusion test runs against it, so a test passing here
 * cannot be a test that merely re-observed vector search doing the right thing.
 *
 * Locators, titles and chunk indices are the real ones read from the live
 * project, so a re-chunked or renamed document breaks these tests rather than
 * silently changing what Sunny is grounded in.
 */

/* ------------------------------------------------------------- fixtures -- */

const FRAMEWORK_DOC = {
  id: "doc-framework",
  title: "ASK SUNNY EMPLOYEE PERFORMANCE FRAMEWORK KB TEXT",
  category: "leadership_coaching",
  original_filename: "ASK_SUNNY_EMPLOYEE_PERFORMANCE_FRAMEWORK_KB_TEXT.txt",
  tags: [] as string[],
  version: 1,
};

const OTHER_DOCS = [
  {
    id: "doc-coaching-guide",
    title: "Sun Tan City Salon Coaching Guide",
    category: "leadership_coaching",
    original_filename: "Sun Tan City Salon Coaching Guide.pdf",
    tags: [] as string[],
    version: 1,
  },
  {
    id: "doc-policy-manual",
    title: "JBA Policy Manual Edited 5.2025",
    category: "operations",
    original_filename: "JBA Policy Manual Edited 5.2025.pdf",
    tags: [] as string[],
    version: 1,
  },
];

/**
 * The framework's real chunk map: index, locator. Content is a stand-in, but
 * every locator and index is exactly what the live table holds, including the
 * en-dash in "SECTION 10 – FINAL OPERATING RULES FOR ASK Sunny", which the
 * role registry has to match byte for byte.
 */
const FRAMEWORK_CHUNKS = [
  { chunk_index: 0, locator: "ASK SUNNY EMPLOYEE PERFORMANCE FRAMEWORK" },
  { chunk_index: 1, locator: "SOURCE HIERARCHY AND OPERATING RULES" },
  { chunk_index: 2, locator: "SOURCE HIERARCHY AND OPERATING RULES" },
  { chunk_index: 3, locator: "DEFAULT OUTPUT RULE FOR EMPLOYEE PERFORMANCE REPORTS" },
  { chunk_index: 4, locator: "SECTION 1 – PURPOSE OF EMPLOYEE PERFORMANCE REPORTING" },
  { chunk_index: 13, locator: "OPPORTUNITY AND VOLUME METRICS" },
  { chunk_index: 38, locator: "STEP 10: IDENTIFY EMPLOYEES WHO MAY NEED EPP REVIEW" },
  { chunk_index: 50, locator: "SECTION 5 – COACHING PRIORITY SYSTEM" },
  { chunk_index: 58, locator: "RECOGNITION MESSAGE TEMPLATES" },
  { chunk_index: 65, locator: "EPP REVIEW" },
  { chunk_index: 67, locator: "NEVER RECOMMEND DISCIPLINE BASED ON METRICS ALONE" },
  { chunk_index: 68, locator: "NEVER RECOMMEND DISCIPLINE BASED ON METRICS ALONE" },
  { chunk_index: 69, locator: "NEVER RECOMMEND DISCIPLINE BASED ON METRICS ALONE" },
  { chunk_index: 70, locator: "NEVER RECOMMEND DISCIPLINE BASED ON METRICS ALONE" },
  { chunk_index: 71, locator: "NEVER RECOMMEND DISCIPLINE BASED ON METRICS ALONE" },
  { chunk_index: 77, locator: "SECTION 10 – FINAL OPERATING RULES FOR ASK Sunny" },
  { chunk_index: 78, locator: "SECTION 10 – FINAL OPERATING RULES FOR ASK Sunny" },
  { chunk_index: 79, locator: "FINAL INTERPRETATION MODEL" },
].map((chunk) => ({
  ...chunk,
  id: `fw-${chunk.chunk_index}`,
  page: null,
  section: chunk.locator,
  content: `Framework text for ${chunk.locator} (chunk ${chunk.chunk_index}).`,
}));

/**
 * The framework rows exactly as the provider builds them.
 *
 * Uses the REAL `toRoleGroundingRow`, not a hand-rolled object literal, so a
 * change that drops or fabricates a provenance field fails these tests instead
 * of passing them against a fixture that agreed with the bug.
 */
function frameworkRows(): MatchedChunkRow[] {
  return selectMandatoryChunks(FRAMEWORK_CHUNKS, EMPLOYEE_PERFORMANCE_FRAMEWORK).map(
    (chunk) => toRoleGroundingRow(FRAMEWORK_DOC, chunk),
  );
}

/**
 * THE HOSTILE CASE. Fourteen retrieved chunks, none of them the framework —
 * the measured live behaviour for a coaching question anchored in the Coaching
 * Guide. Similarities are the real band gte-small produces (0.86–0.93), every
 * one of them comfortably above the 0.78 threshold, which is itself part of
 * what the audit found.
 */
const RETRIEVED_NO_FRAMEWORK: MatchedChunkRow[] = Array.from(
  { length: 14 },
  (_, index) => {
    const doc = OTHER_DOCS[index % OTHER_DOCS.length]!;
    return {
      chunk_id: `other-${index}`,
      document_id: doc.id,
      document_title: doc.title,
      category: doc.category,
      locator: `Page ${index + 2}`,
      page: index + 2,
      section: null,
      content: `Manual text ${index}.`,
      similarity: 0.93 - index * 0.005,
    };
  },
);

/** Retrieval that is almost entirely framework — the other measured extreme. */
const RETRIEVED_FRAMEWORK_HEAVY: MatchedChunkRow[] = [
  ...frameworkRows().slice(0, 4).map((row, index) => ({
    ...row,
    similarity: 0.95 - index * 0.005,
  })),
  ...FRAMEWORK_CHUNKS.slice(4, 13).map((chunk, index) => ({
    ...toRoleGroundingRow(FRAMEWORK_DOC, chunk),
    similarity: 0.93 - index * 0.004,
  })),
  {
    chunk_id: "other-late",
    document_id: OTHER_DOCS[1]!.id,
    document_title: OTHER_DOCS[1]!.title,
    category: OTHER_DOCS[1]!.category,
    locator: "Page 40",
    page: 40,
    section: null,
    content: "Policy manual text that only ranks once the framework is out of the way.",
    similarity: 0.8905,
  },
];

const CONTEXT = { userName: "Paulyne", locationName: "Salon 0495", todayIso: "2026-09-09" };

function promptFor(options: {
  hasFrameworkGrounding: boolean;
  hasEmployeeFacts?: boolean;
  hasReportData?: boolean;
}): string {
  return buildSystemPrompt({
    assistantName: "Sunny",
    brandName: "Sun Tan City",
    salonNoun: "salon",
    context: CONTEXT,
    mode: "standard",
    hasContext: true,
    hasReportData: options.hasReportData ?? false,
    hasFrameworkGrounding: options.hasFrameworkGrounding,
    hasEmployeeFacts: options.hasEmployeeFacts ?? false,
  });
}

/** Runs the real assembly for an employee-performance question. */
function groundFor(question: string, retrieved: MatchedChunkRow[] = RETRIEVED_NO_FRAMEWORK) {
  const wantsFramework = isEmployeePerformanceQuestion(question);
  const mandatory = wantsFramework ? frameworkRows() : [];
  return assembleGrounding({
    mandatory,
    retrieved,
    roleDocumentIds: wantsFramework ? [FRAMEWORK_DOC.id] : [],
    evidenceBudget: RETRIEVAL.contextChunks,
  });
}

function frameworkRowsIn(rows: MatchedChunkRow[]): MatchedChunkRow[] {
  return rows.filter((row) => row.document_id === FRAMEWORK_DOC.id);
}

/* ------------------------------------------------ A, B, C: it is included -- */

describe("A. the framework is included for a coaching question", () => {
  const question = "Who should I coach from this employee performance report?";

  it("fires the intent gate", () => {
    expect(isEmployeePerformanceQuestion(question)).toBe(true);
  });

  it("reaches the prompt even though retrieval returned none of it", () => {
    expect(frameworkRowsIn(RETRIEVED_NO_FRAMEWORK)).toHaveLength(0);

    const assembled = groundFor(question);

    expect(assembled.roleIncluded).toBe(true);
    expect(frameworkRowsIn(assembled.rows).length).toBeGreaterThan(0);
  });

  it("carries the operating rules and the output rule, not just any section", () => {
    const locators = frameworkRowsIn(groundFor(question).rows).map((row) => row.locator);

    expect(locators).toContain("SOURCE HIERARCHY AND OPERATING RULES");
    expect(locators).toContain("DEFAULT OUTPUT RULE FOR EMPLOYEE PERFORMANCE REPORTS");
    expect(locators).toContain("FINAL INTERPRETATION MODEL");
  });

  it("puts the reasoning before the evidence", () => {
    const rows = groundFor(question).rows;
    expect(rows[0]!.document_id).toBe(FRAMEWORK_DOC.id);
  });

  it("does not spend the evidence budget on the framework", () => {
    const assembled = groundFor(question);

    // All twelve evidence slots still went to real manuals.
    expect(assembled.retrievedCount).toBe(RETRIEVAL.contextChunks);
    expect(
      assembled.rows.filter((row) => row.document_id !== FRAMEWORK_DOC.id),
    ).toHaveLength(RETRIEVAL.contextChunks);
  });
});

describe("B. the framework is included for a recognition question", () => {
  const question = "Who should I recognize from this report?";

  it("fires the intent gate", () => {
    expect(isEmployeePerformanceQuestion(question)).toBe(true);
  });

  it("reaches the prompt", () => {
    expect(groundFor(question).roleIncluded).toBe(true);
  });

  it("also fires on the British spelling and on praise", () => {
    expect(isEmployeePerformanceQuestion("who should I recognise this month?")).toBe(true);
    expect(isEmployeePerformanceQuestion("anyone worth praise this week?")).toBe(true);
  });
});

describe("C. an EPP question gets the framework and the escalation guard", () => {
  const question = "Does anyone need an EPP based on these numbers?";

  it("fires the intent gate", () => {
    expect(isEmployeePerformanceQuestion(question)).toBe(true);
  });

  it("pins the escalation limits, which are the point of the guard", () => {
    const locators = frameworkRowsIn(groundFor(question).rows).map((row) => row.locator);
    expect(locators).toContain("NEVER RECOMMEND DISCIPLINE BASED ON METRICS ALONE");
  });

  it("states the metric-alone prohibition in the prompt", () => {
    const prompt = promptFor({ hasFrameworkGrounding: true });

    expect(prompt).toContain(
      "Never recommend discipline, an EPP, a DPOA, a suspension or a termination on the strength of numbers alone",
    );
    expect(prompt).toContain("A metric is a coaching signal, not a finding.");
    expect(prompt).toContain("the correct recommendation is to observe first");
  });

  it("also fires on DPOA and on discipline", () => {
    expect(isEmployeePerformanceQuestion("is a DPOA justified here?")).toBe(true);
    expect(isEmployeePerformanceQuestion("should I discipline her for this?")).toBe(true);
  });
});

/* ------------------------------------------------ D: it is not injected -- */

describe("D. an unrelated policy question does not get the framework", () => {
  const question = "What does the refund policy say?";

  it("does not fire the intent gate", () => {
    expect(isEmployeePerformanceQuestion(question)).toBe(false);
  });

  it("pins nothing, and the prompt does not mention the framework", () => {
    const assembled = groundFor(question);

    expect(assembled.roleIncluded).toBe(false);
    expect(assembled.mandatoryCount).toBe(0);
    expect(frameworkRowsIn(assembled.rows)).toHaveLength(0);
    expect(promptFor({ hasFrameworkGrounding: false })).not.toContain(
      "EMPLOYEE PERFORMANCE — HOW TO USE THE FRAMEWORK",
    );
  });

  it("leaves the ordinary retrieval budget alone", () => {
    expect(groundFor(question).retrievedCount).toBe(RETRIEVAL.contextChunks);
  });

  it("stays quiet for the other questions that are plainly not about a person", () => {
    for (const other of [
      "What does the refund policy say?",
      "How long do I keep the safety binder?",
      "What is the tanning bed cleaning procedure?",
      "When is the bonus paid out?",
      "How is my salon performing on spa conversion?",
      "Where is the employee handbook?",
    ]) {
      expect(isEmployeePerformanceQuestion(other), other).toBe(false);
    }
  });
});

/* ------------------------------- E: examples cannot become current facts -- */

describe("E. the framework's examples cannot become current employee facts", () => {
  it("tells the model its contents are placeholders, not people", () => {
    const prompt = promptFor({ hasFrameworkGrounding: true });

    expect(prompt).toContain("ITS EXAMPLES ARE NOT PEOPLE.");
    expect(prompt).toContain("[Employee]");
    expect(prompt).toContain("never fill a placeholder in with a guess");
    expect(prompt).toContain(
      "never carry an example's numbers into your answer as though they were measured",
    );
  });

  it("names the only sources current facts may come from", () => {
    expect(promptFor({ hasFrameworkGrounding: true })).toContain(
      "CURRENT FACTS COME ONLY FROM CURRENT DATA",
    );
  });

  it("says the framework is reasoning rather than evidence about a person", () => {
    expect(promptFor({ hasFrameworkGrounding: true })).toContain(
      "IT IS REASONING, NOT EVIDENCE ABOUT ANY PERSON.",
    );
  });
});

/* --------------------------------------- F: no data means no invented people -- */

describe("F. with no employee-level data, nobody is invented", () => {
  it("says so explicitly, and forbids naming or ranking anyone", () => {
    const prompt = promptFor({ hasFrameworkGrounding: true, hasEmployeeFacts: false });

    expect(prompt).toContain("YOU HAVE NO CURRENT EMPLOYEE-LEVEL DATA FOR THIS QUESTION.");
    expect(prompt).toContain(
      "Do NOT invent an employee, a name, a score, a ranking or a headcount",
    );
  });

  it("still offers the useful half rather than refusing", () => {
    const prompt = promptFor({ hasFrameworkGrounding: true, hasEmployeeFacts: false });

    expect(prompt).toContain("which metrics matter, what to observe, how to prioritise");
  });

  it("drops the no-data warning once facts exist", () => {
    const prompt = promptFor({ hasFrameworkGrounding: true, hasEmployeeFacts: true });

    expect(prompt).not.toContain("YOU HAVE NO CURRENT EMPLOYEE-LEVEL DATA");
    // The framework rules themselves stay.
    expect(prompt).toContain("EMPLOYEE PERFORMANCE — HOW TO USE THE FRAMEWORK");
  });

  it("reports no employee dataset, because there is none", async () => {
    const { loadEmployeeFacts } = await import("@/lib/reporting/read/employee-facts");
    const facts = await loadEmployeeFacts();

    expect(facts.available).toBe(false);
    expect(facts.block).toBeNull();
    expect(facts.reason).toMatch(/salon-level data only/);
  });
});

/* ------------------------- G: facts and reasoning coexist without collision -- */

describe("G. current facts and framework reasoning coexist", () => {
  it("keeps the report block separate from the knowledge block", () => {
    const prompt = promptFor({
      hasFrameworkGrounding: true,
      hasEmployeeFacts: true,
      hasReportData: true,
    });

    // Three kinds of statement, each with its own citation rule.
    expect(prompt).toContain("three");
    expect(prompt).toContain("3. Report figures");
    expect(prompt).toContain("Never mark them with a source marker");
    expect(prompt).toContain("EMPLOYEE PERFORMANCE — HOW TO USE THE FRAMEWORK");
  });

  it("does not let the framework displace retrieved evidence", () => {
    const assembled = groundFor("Who should I coach from this employee report?");

    expect(assembled.mandatoryCount).toBeGreaterThan(0);
    expect(assembled.retrievedCount).toBe(RETRIEVAL.contextChunks);
    expect(assembled.rows).toHaveLength(
      assembled.mandatoryCount + assembled.retrievedCount,
    );
  });

  it("never gives one chunk two markers", () => {
    const assembled = groundFor(
      "Who should I coach from this employee report?",
      RETRIEVED_FRAMEWORK_HEAVY,
    );
    const ids = assembled.rows.map((row) => row.chunk_id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("hands the evidence slots to the manuals when retrieval is framework-heavy", () => {
    const assembled = groundFor(
      "Who should I coach from this employee report?",
      RETRIEVED_FRAMEWORK_HEAVY,
    );

    // Every retrieved framework row was dropped; the one policy row survived.
    expect(assembled.retrievedCount).toBe(1);
    expect(assembled.rows.at(-1)!.document_id).toBe(OTHER_DOCS[1]!.id);
  });
});

/* --------------------------------------------------- H: policy overrides -- */

describe("H. official policy overrides the framework", () => {
  it("states the hierarchy with policy first and the framework third", () => {
    const prompt = promptFor({ hasFrameworkGrounding: true });
    const hierarchy = prompt.slice(prompt.indexOf("THE ORDER OF AUTHORITY"));

    const policyAt = hierarchy.indexOf("Current official Sun Tan City policy");
    const dataAt = hierarchy.indexOf("Current employee performance data");
    const frameworkAt = hierarchy.indexOf("The Employee Performance Framework's reasoning");
    const examplesAt = hierarchy.indexOf("Historical examples and patterns");

    expect(policyAt).toBeGreaterThanOrEqual(0);
    expect(policyAt).toBeLessThan(dataAt);
    expect(dataAt).toBeLessThan(frameworkAt);
    expect(frameworkAt).toBeLessThan(examplesAt);
  });

  it("says outright which one wins on a conflict", () => {
    expect(promptFor({ hasFrameworkGrounding: true })).toContain(
      "WHERE POLICY AND THE FRAMEWORK CONFLICT, POLICY WINS.",
    );
  });

  it("carries the brand's real name into the hierarchy", () => {
    const prompt = promptFor({ hasFrameworkGrounding: true });

    expect(prompt).toContain("Current official Sun Tan City policy");
    expect(prompt).not.toContain("{{BRAND}}");
  });

  it("keeps policy chunks in the prompt for the rule to bite on", () => {
    const assembled = groundFor("Who should I coach from this employee report?");
    const policyRows = assembled.rows.filter(
      (row) => row.document_id === "doc-policy-manual",
    );

    expect(policyRows.length).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------- I: provenance -- */

describe("I. citations identify the real framework document", () => {
  it("pins rows that carry the document's own id, title and locator", () => {
    const rows = frameworkRowsIn(groundFor("Who should I coach?").rows);

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.document_id).toBe(FRAMEWORK_DOC.id);
      expect(row.document_title).toBe(
        "ASK SUNNY EMPLOYEE PERFORMANCE FRAMEWORK KB TEXT",
      );
      expect(row.category).toBe("leadership_coaching");
      expect(row.locator.length).toBeGreaterThan(0);
      expect(row.chunk_id).toMatch(/^fw-\d+$/);
    }
  });

  it("maps to a source card through the ordinary citation mapper", async () => {
    const { rowToCitation } = await import("@/lib/knowledge/mappers");
    const citation = rowToCitation(frameworkRowsIn(groundFor("Who should I coach?").rows)[0]!);

    expect(citation.documentId).toBe(FRAMEWORK_DOC.id);
    expect(citation.documentTitle).toBe("ASK SUNNY EMPLOYEE PERFORMANCE FRAMEWORK KB TEXT");
    expect(citation.category).toBe("leadership_coaching");
    expect(citation.excerpt.length).toBeGreaterThan(0);
  });

  it("does not copy the framework's text into the system prompt", () => {
    const prompt = promptFor({ hasFrameworkGrounding: true });

    // The rules ABOUT the framework are in the prompt; the framework's own
    // section text is not, so the citation stays the only route to its content.
    expect(prompt).toContain("EMPLOYEE PERFORMANCE — HOW TO USE THE FRAMEWORK");
    expect(prompt).not.toContain("Framework text for");
    expect(EMPLOYEE_PERFORMANCE_RULES).not.toContain("Framework text for");
  });

  it("marks pinned rows unscored rather than inventing a relevance", () => {
    for (const row of frameworkRowsIn(groundFor("Who should I coach?").rows)) {
      expect(row.similarity).toBe(0);
    }
  });
});

/* ------------------------------------------- the document's own identity -- */

describe("the role document is identified by metadata, not a bare filename", () => {
  const role = EMPLOYEE_PERFORMANCE_FRAMEWORK;

  it("prefers the durable tag when it is set", () => {
    const tagged = { ...FRAMEWORK_DOC, tags: [role.tag], original_filename: "renamed.txt" };
    const resolved = resolveRoleDocument([...OTHER_DOCS, tagged], role);

    expect(resolved?.document.id).toBe(FRAMEWORK_DOC.id);
    expect(resolved?.matchedBy).toBe("tag");
  });

  it("lets the tag win over a document that only matches the filename", () => {
    const tagged = { ...OTHER_DOCS[0]!, tags: [role.tag] };
    const resolved = resolveRoleDocument([FRAMEWORK_DOC, tagged], role);

    expect(resolved?.document.id).toBe(OTHER_DOCS[0]!.id);
    expect(resolved?.matchedBy).toBe("tag");
  });

  it("falls back to the filename so the guard works before anyone tags it", () => {
    const resolved = resolveRoleDocument([...OTHER_DOCS, FRAMEWORK_DOC], role);

    expect(resolved?.document.id).toBe(FRAMEWORK_DOC.id);
    expect(resolved?.matchedBy).toBe("fallback");
  });

  it("falls back to the title when the file was renamed", () => {
    const renamed = { ...FRAMEWORK_DOC, original_filename: "framework-v2.txt" };
    const resolved = resolveRoleDocument([...OTHER_DOCS, renamed], role);

    expect(resolved?.matchedBy).toBe("fallback");
  });

  it("resolves nothing when the corpus has no such document", () => {
    expect(resolveRoleDocument(OTHER_DOCS, role)).toBeNull();
  });

  it("does not mistake the Coaching Guide for the framework", () => {
    expect(resolveRoleDocument([OTHER_DOCS[0]!], role)).toBeNull();
  });
});

describe("the mandatory selection is bounded and ordered", () => {
  const role = EMPLOYEE_PERFORMANCE_FRAMEWORK;

  it("takes only the sections the role names", () => {
    const selected = selectMandatoryChunks(FRAMEWORK_CHUNKS, role);
    const locators = new Set(selected.map((chunk) => chunk.locator));

    for (const locator of locators) {
      expect(role.mandatoryLocators).toContain(locator);
    }
    expect(locators.has("OPPORTUNITY AND VOLUME METRICS")).toBe(false);
    expect(locators.has("RECOGNITION MESSAGE TEMPLATES")).toBe(false);
  });

  it("keeps the document's own order", () => {
    const indices = selectMandatoryChunks(FRAMEWORK_CHUNKS, role).map(
      (chunk) => chunk.chunk_index,
    );

    expect(indices).toEqual([...indices].sort((a, b) => a - b));
  });

  it("matches the en-dash section heading exactly as stored", () => {
    const locators = selectMandatoryChunks(FRAMEWORK_CHUNKS, role).map((c) => c.locator);
    expect(locators).toContain("SECTION 10 – FINAL OPERATING RULES FOR ASK Sunny");
  });

  it("never exceeds the ceiling, however the document is re-chunked", () => {
    const exploded = Array.from({ length: 400 }, (_, index) => ({
      chunk_index: index,
      locator: "SOURCE HIERARCHY AND OPERATING RULES",
      id: `boom-${index}`,
    }));

    expect(selectMandatoryChunks(exploded, role).length).toBe(role.maxMandatoryChunks);
  });

  it("tolerates whitespace and case drift in a re-exported heading", () => {
    const drifted = [
      { chunk_index: 1, locator: "  source hierarchy   and operating rules  ", id: "d1" },
    ];

    expect(selectMandatoryChunks(drifted, role)).toHaveLength(1);
  });
});

/* ------------------------ the framework survives a corpus that lacks it -- */

describe("a corpus without the framework still answers", () => {
  it("pins nothing and reports no role, rather than failing", () => {
    const assembled = assembleGrounding({
      mandatory: [],
      retrieved: RETRIEVED_NO_FRAMEWORK,
      roleDocumentIds: [],
      evidenceBudget: RETRIEVAL.contextChunks,
    });

    expect(assembled.roleIncluded).toBe(false);
    expect(assembled.rows).toHaveLength(RETRIEVAL.contextChunks);
  });

  it("keeps retrieved framework rows when nothing could be pinned", () => {
    // The locators matched nothing — a re-upload chunked differently. Dropping
    // the retrieved rows too would remove the framework altogether.
    const assembled = assembleGrounding({
      mandatory: [],
      retrieved: RETRIEVED_FRAMEWORK_HEAVY,
      roleDocumentIds: [FRAMEWORK_DOC.id],
      evidenceBudget: RETRIEVAL.contextChunks,
    });

    expect(frameworkRowsIn(assembled.rows).length).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------- J, K, L: regressions -- */

describe("J. general knowledge retrieval is unchanged", () => {
  const SERVER_ASK = readFileSync("src/lib/ai/server-ask.ts", "utf8");

  it("still retrieves through match_knowledge_chunks at the ordinary top-K", () => {
    expect(SERVER_ASK).toContain("knowledge.match({");
    expect(SERVER_ASK).toContain("RETRIEVAL.topK");
  });

  it("leaves the similarity threshold alone", () => {
    expect(RETRIEVAL.minSimilarity).toBe(0.78);
    expect(SERVER_ASK).not.toContain("minSimilarity");
  });

  it("keeps the corpus server-decided rather than request-supplied", () => {
    const ROUTE = readFileSync("src/app/api/chat/route.ts", "utf8");
    expect(ROUTE).toContain("scopeId: activeKnowledgeCorpus()");
  });

  it("still builds citations from retrieved rows only", () => {
    expect(SERVER_ASK).toContain("rowToCitation");
    expect(SERVER_ASK).toContain("extractUsedMarkers");
  });

  it("passes an unrelated question straight through the ordinary path", () => {
    const assembled = groundFor("What is the tanning bed cleaning procedure?");

    expect(assembled.mandatoryCount).toBe(0);
    expect(assembled.rows).toEqual(RETRIEVED_NO_FRAMEWORK.slice(0, RETRIEVAL.contextChunks));
  });
});

describe("K. reporting chat grounding is unchanged", () => {
  const SERVER_ASK = readFileSync("src/lib/ai/server-ask.ts", "utf8");

  /*
   * THE GATE AND THE LOADER WERE BOTH REPLACED BY WIDER ONES, and this is what
   * the assertions now pin.
   *
   * `isReportingQuestion` covered three of the five report families with one
   * boolean; `routeReportFamilies` covers all five and says WHICH. So the
   * property worth asserting is no longer "the bed/spa gate is called" — the
   * bed/spa gate still exists and still has its own suite — it is that the
   * pipeline still asks a gate before loading, and still loads through the
   * shared report path rather than growing one of its own.
   */
  it("still gates the report block on the question, and loads through one path", () => {
    expect(SERVER_ASK).toContain("routeReportFamilies(request.question)");
    expect(SERVER_ASK).toContain("loadReportBriefing({");
    // The gate decides. A briefing loaded unconditionally is the regression.
    expect(SERVER_ASK).toContain("families.length > 0");
  });

  it("still passes report data as its own block", () => {
    expect(SERVER_ASK).toContain("reportData: briefing");
  });

  it("keeps report coverage independent of the citation list", () => {
    /*
     * The condition now reads "no chunks AND no family had data", because a
     * block that names an absent report is a block with no figures in it —
     * reporting that as `grounded` would put a confident banner over an answer
     * whose whole content is "I do not have that delivery".
     */
    expect(SERVER_ASK).toContain("(briefing?.present.length ?? 0) === 0");
    expect(SERVER_ASK).toContain('? "insufficient"');
  });

  it("keeps the report rules in the prompt", () => {
    const prompt = promptFor({ hasFrameworkGrounding: false, hasReportData: true });
    expect(prompt).toContain("3. Report figures");
  });

  it("does not confuse a reporting question for an employee one", () => {
    expect(isEmployeePerformanceQuestion("what was our spa conversion last month?")).toBe(
      false,
    );
    expect(isEmployeePerformanceQuestion("which salons are below market on tans?")).toBe(
      false,
    );
  });
});

describe("L. the forms and coaching flow is untouched", () => {
  const SERVER_ASK = readFileSync("src/lib/ai/server-ask.ts", "utf8");

  it("still proposes a form before any grounding work happens", () => {
    const proposalAt = SERVER_ASK.indexOf("proposeFormForTurn");
    const roleAt = SERVER_ASK.indexOf("fetchRoleGrounding");
    const matchAt = SERVER_ASK.indexOf("knowledge.match({");

    expect(proposalAt).toBeGreaterThanOrEqual(0);
    expect(proposalAt).toBeLessThan(roleAt);
    expect(proposalAt).toBeLessThan(matchAt);
    expect(SERVER_ASK).toContain("if (proposal) return proposal;");
  });

  it("keeps the form-facsimile prohibition, framework or not", () => {
    for (const hasFrameworkGrounding of [true, false]) {
      expect(promptFor({ hasFrameworkGrounding })).toContain(
        "NEVER WRITE A FACSIMILE OF A COMPANY FORM.",
      );
    }
  });

  it("leaves disciplinary decisions with the manager", () => {
    expect(promptFor({ hasFrameworkGrounding: true })).toContain(
      "Signature lines, disciplinary decisions and anything with legal weight stay with the manager.",
    );
  });
});

/* --------------------------------------------------- the wiring is real -- */

describe("the pipeline actually calls this machinery", () => {
  const SERVER_ASK = readFileSync("src/lib/ai/server-ask.ts", "utf8");

  it("gates, pins, assembles and reports the flag", () => {
    expect(SERVER_ASK).toContain("isEmployeePerformanceQuestion(request.question)");
    expect(SERVER_ASK).toContain("fetchRoleGrounding(EMPLOYEE_PERFORMANCE_FRAMEWORK");
    expect(SERVER_ASK).toContain("assembleGrounding({");
    expect(SERVER_ASK).toContain("hasEmployeeFacts: employeeFacts?.available ?? false");
  });

  it("reports the flag from what was PINNED, not from what the gate wanted", () => {
    /*
     * This assertion got stricter rather than looser when a second role
     * arrived. `assembled.roleIncluded` is now true if EITHER framework was
     * pinned, so passing it as `hasFrameworkGrounding` would have told the
     * model "one of the numbered sources is the Employee Performance Framework"
     * on a turn that pinned only the Daily Stats one — and a model given rules
     * for a source that is not there picks the nearest thing and follows them.
     *
     * So the flag is derived per document, from the ids that actually
     * contributed rows.
     */
    expect(SERVER_ASK).toContain("hasFrameworkGrounding: employeeFrameworkIncluded");
    expect(SERVER_ASK).toContain("pinned.has(role.documentId)");
    expect(SERVER_ASK).toContain("new Set(assembled.pinnedDocumentIds)");
  });

  it("fetches deeper when a role is in play", () => {
    expect(SERVER_ASK).toContain("RETRIEVAL.roleAugmentedTopK");
    expect(RETRIEVAL.roleAugmentedTopK).toBeGreaterThan(RETRIEVAL.topK);
    // match_knowledge_chunks clamps match_count to 50 internally.
    expect(RETRIEVAL.roleAugmentedTopK).toBeLessThanOrEqual(50);
  });

  it("never fails the answer when the framework cannot be read", () => {
    expect(SERVER_ASK).toMatch(/fetchRoleGrounding\([\s\S]{0,120}?\)\s*\n\s*\.catch\(\(\) => null\)/);
  });

  it("reads the same visibility rules retrieval does", () => {
    const PROVIDER = readFileSync("src/lib/knowledge/providers/supabase.ts", "utf8");

    expect(PROVIDER).toContain('.eq("indexed", true)');
    expect(PROVIDER).toContain('.eq("status", "indexed")');
    expect(PROVIDER).toContain('.eq("version", document.version)');
  });
});

/* -------------------------------------------------------- the gate itself -- */

describe("the intent gate", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("fires on every question the brief listed as mandatory", () => {
    for (const question of [
      "Who should I coach from this employee report?",
      "Who should I recognize?",
      "Who has the biggest opportunity?",
      "Build me a coaching plan from this employee report.",
      "Does anyone need an EPP?",
      "Create a role-play plan for this team.",
    ]) {
      expect(isEmployeePerformanceQuestion(question), question).toBe(true);
    }
  });

  it("reads the question only, never the history", () => {
    // Comments discuss history at length — deliberately, since not carrying it
    // is the design decision. The CODE must not touch it, so strip comments
    // first rather than searching the file and catching the explanation.
    const code = readFileSync("src/lib/ai/employee-performance-gate.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");

    expect(code).not.toMatch(/\bhistory\b/);
    expect(isEmployeePerformanceQuestion("What does the refund policy say?")).toBe(false);
  });

  it("does not fire on a word merely containing a term", () => {
    expect(isEmployeePerformanceQuestion("who is Epperson?")).toBe(false);
    expect(isEmployeePerformanceQuestion("the approach is fine")).toBe(false);
  });

  it("holds no term so generic it would fire on everything", () => {
    for (const generic of ["policy", "report", "performance", "employee", "salon"]) {
      expect(isEmployeePerformanceQuestion(`tell me about the ${generic}`), generic).toBe(
        false,
      );
    }
  });
});
