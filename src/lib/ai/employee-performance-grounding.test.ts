import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { RETRIEVAL } from "@/lib/config/models";
import type { MatchedChunkRow } from "@/lib/knowledge/mappers";
import {
  EMPLOYEE_PERFORMANCE_FRAMEWORK,
  headingKey,
  resolveRoleDocument,
  selectMandatoryChunks,
  toRoleGroundingRow,
} from "@/lib/knowledge/document-roles";
import {
  FRAMEWORK_UNAVAILABLE_MESSAGE,
  buildRoleGrounding,
  evaluateRoleGrounding,
} from "@/lib/knowledge/role-grounding";
import { assembleGrounding } from "./grounding-assembly";
import {
  MAX_CONTINUATION_HOPS,
  classifyEmployeePerformanceIntent,
  findContinuationAnchor,
  isDocumentaryLookup,
  isEllipticalFollowUp,
  isEmployeePerformanceQuestion,
  mentionsPersonName,
} from "./employee-performance-gate";
import {
  EMPLOYEE_DATA_SECTION,
  EMPLOYEE_PERFORMANCE_RULES,
  buildSystemPrompt,
} from "./prompts";

/**
 * ============================================================================
 * THE FRAMEWORK IS MANDATORY, AND ITS ABSENCE IS A REFUSAL
 * ============================================================================
 *
 * Pure-function coverage for the decisions behind mandatory grounding: which
 * document is the framework, whether it still contains its rules, which
 * questions need it, and what the prompt then says. The orchestration — what
 * Claude was actually sent, and whether it was called at all — is exercised in
 * `employee-performance-runtime.test.ts`.
 *
 * THE FIXTURES ARE THE LIVE MEASUREMENT. `RETRIEVED_NO_FRAMEWORK` is the hostile
 * case made concrete: fourteen chunks from the manuals that genuinely outrank
 * the framework, and not one framework chunk among them — which is what a query
 * anchored in the Salon Coaching Guide really returns against the live corpus.
 * Locators, titles and chunk indices are the real ones, so a re-chunked or
 * renamed document breaks these tests rather than silently changing what Sunny
 * is grounded in.
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

const COACHING_GUIDE = {
  id: "doc-coaching-guide",
  title: "Sun Tan City Salon Coaching Guide",
  category: "leadership_coaching",
  original_filename: "Sun Tan City Salon Coaching Guide.pdf",
  tags: [] as string[],
  version: 1,
};

const POLICY_MANUAL = {
  id: "doc-policy-manual",
  title: "JBA Policy Manual Edited 5.2025",
  category: "operations",
  original_filename: "JBA Policy Manual Edited 5.2025.pdf",
  tags: [] as string[],
  version: 1,
};

const OTHER_DOCS = [COACHING_GUIDE, POLICY_MANUAL];

/** The framework's real chunk map: index and locator exactly as stored. */
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
 * The framework rows exactly as the provider builds them, through the REAL
 * mapping — so a change that drops or fabricates a provenance field fails these
 * tests rather than passing against a fixture that agreed with the bug.
 */
function frameworkRows(): MatchedChunkRow[] {
  const selection = selectMandatoryChunks(FRAMEWORK_CHUNKS, EMPLOYEE_PERFORMANCE_FRAMEWORK);
  return selection.chunks.map((chunk) => toRoleGroundingRow(FRAMEWORK_DOC, chunk));
}

/** Fourteen retrieved chunks, none of them the framework. The measured case. */
const RETRIEVED_NO_FRAMEWORK: MatchedChunkRow[] = Array.from({ length: 14 }, (_, index) => {
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
});

const CONTEXT = { userName: "Paulyne", locationName: "Salon 0495", todayIso: "2026-09-09" };

function promptFor(options: {
  hasFrameworkGrounding: boolean;
  hasEmployeeFactsBlock?: boolean;
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
    hasEmployeeFactsBlock: options.hasEmployeeFactsBlock ?? false,
  });
}

function groundFor(question: string, retrieved: MatchedChunkRow[] = RETRIEVED_NO_FRAMEWORK) {
  const active = isEmployeePerformanceQuestion(question);
  return assembleGrounding({
    mandatory: active ? frameworkRows() : [],
    retrieved,
    roleDocumentId: active ? FRAMEWORK_DOC.id : null,
    evidenceBudget: RETRIEVAL.contextChunks,
  });
}

function frameworkRowsIn(rows: MatchedChunkRow[]): MatchedChunkRow[] {
  return rows.filter((row) => row.document_id === FRAMEWORK_DOC.id);
}

/* ============================ INTENT: FALSE POSITIVES ==================== */

describe("intent does not fire on generic phrasing", () => {
  /** The exact phrases QA found the old flat keyword list firing on. */
  const QA_FALSE_POSITIVES = [
    "Who should I contact about payroll?",
    "Who should I ask about the refund policy?",
    "What should I prioritize for opening the salon?",
    "Where do I record this observation?",
  ];

  for (const question of QA_FALSE_POSITIVES) {
    it(`stays quiet for "${question}"`, () => {
      expect(isEmployeePerformanceQuestion(question)).toBe(false);
    });
  }

  it("no longer holds the over-broad terms at all", () => {
    const source = readFileSync("src/lib/ai/employee-performance-gate.ts", "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

    for (const term of ['"who should i"', '"who needs"', '"prioritize"', '"prioritise"', '"observe"', '"observation"']) {
      expect(code, term).not.toContain(term);
    }
  });

  it("stays quiet on the rest of the knowledge base's ordinary questions", () => {
    for (const question of [
      "What does the refund policy say?",
      "How long do I keep the safety binder?",
      "What is the tanning bed cleaning procedure?",
      "When is the bonus paid out?",
      "How is my salon performing on spa conversion?",
      "Where is the employee handbook?",
      "What was our spa conversion last month?",
      "Which salons are below market on tans?",
      "Who is Epperson?",
      "Tell me about the performance review process for salons",
    ]) {
      expect(isEmployeePerformanceQuestion(question), question).toBe(false);
    }
  });

  it("does not fire on a subject with no judgement, or a judgement with no subject", () => {
    expect(isEmployeePerformanceQuestion("how many consultants do we have?")).toBe(false);
    expect(isEmployeePerformanceQuestion("what is the conversion target?")).toBe(false);
  });
});

/* ============================ INTENT: FALSE NEGATIVES ==================== */

describe("intent fires on real employee-performance language", () => {
  /** The phrasings QA found the old list missing entirely. */
  const QA_FALSE_NEGATIVES = [
    "Rank my team by conversion.",
    "Which consultant is lowest?",
    "Who is below goal?",
    "How did Sarah perform this month?",
    "Which associate has the weakest conversion?",
    "Compare Sarah and Jane.",
    "Who improved the most?",
    "Which team member needs the most attention?",
  ];

  for (const question of QA_FALSE_NEGATIVES) {
    it(`fires for "${question}"`, () => {
      expect(isEmployeePerformanceQuestion(question)).toBe(true);
    });
  }

  it("still fires on the six original examples", () => {
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

  it("fires on escalation language, where the guard matters most", () => {
    for (const question of [
      "is a DPOA justified here?",
      "should I discipline her for this?",
      "does she need a write-up?",
      "who is struggling right now?",
    ]) {
      expect(isEmployeePerformanceQuestion(question), question).toBe(true);
    }
  });

  it("fires when the manager supplies the figures in the question", () => {
    expect(
      isEmployeePerformanceQuestion(
        "Sarah had 40 opportunities and converted 8 this month. What should I coach?",
      ),
    ).toBe(true);
  });
});

describe("the person-name heuristic", () => {
  it("reads a mid-sentence first name as a person", () => {
    expect(mentionsPersonName("how did Sarah do?")).toBe(true);
    expect(mentionsPersonName("compare Sarah and Jane")).toBe(true);
  });

  it("does not mistake a sentence-opening capital for a name", () => {
    expect(mentionsPersonName("Sarah is fine")).toBe(false);
    expect(mentionsPersonName("Where is the handbook?")).toBe(false);
  });

  it("does not mistake the brand, a metric or a month for a person", () => {
    expect(mentionsPersonName("the Sun Tan City policy")).toBe(false);
    expect(mentionsPersonName("our EFT and PIF numbers")).toBe(false);
    expect(mentionsPersonName("since August we improved")).toBe(false);
    expect(mentionsPersonName("the Spa Wellness report")).toBe(false);
  });
});

/* ============================== FOLLOW-UP INTENT ========================= */

describe("elliptical follow-ups inherit intent across consecutive hops", () => {
  const U = (content: string) => ({ role: "user", content });
  const A = (content: string) => ({ role: "assistant", content });

  const ANCHOR = "Who should I coach?";
  const HOP_1 = [U(ANCHOR), A("Here are the top three.")];
  const HOP_2 = [...HOP_1, U("What about Sarah?"), A("She is low on upgrades.")];
  const HOP_3 = [...HOP_2, U("The other two?"), A("Both improving.")];

  it("inherits on the first hop", () => {
    const intent = classifyEmployeePerformanceIntent({
      question: "What about Sarah?",
      history: HOP_1,
    });

    expect(intent.active).toBe(true);
    expect(intent.source).toBe("continuation");
    expect(intent.anchor).toBe(ANCHOR);
  });

  it("inherits on the SECOND hop, where the previous turn is itself a fragment", () => {
    // QA's case: "And Jane?" used to lose the framework because the turn
    // before it was not independently explicit.
    const intent = classifyEmployeePerformanceIntent({
      question: "And Jane?",
      history: HOP_2,
    });

    expect(intent.active).toBe(true);
    expect(intent.source).toBe("continuation");
    expect(intent.anchor).toBe(ANCHOR);
  });

  it("inherits on the third and fourth hops", () => {
    for (const question of ["Why?", "What about her upgrades?", "the rest?"]) {
      const intent = classifyEmployeePerformanceIntent({ question, history: HOP_3 });
      expect(intent.active, question).toBe(true);
      expect(intent.anchor, question).toBe(ANCHOR);
    }
  });

  it("walks past assistant turns without treating them as anchors", () => {
    expect(findContinuationAnchor(HOP_2)).toBe(ANCHOR);
  });

  it("clears immediately for a question that stands on its own", () => {
    const intent = classifyEmployeePerformanceIntent({
      question: "What does the refund policy say?",
      history: HOP_2,
    });

    expect(intent.active).toBe(false);
    expect(intent.source).toBeNull();
  });

  it("cannot reach back past a standalone question to resurrect intent", () => {
    // The refund question becomes the anchor, so "What about it?" is about IT.
    const history = [
      ...HOP_2,
      U("What does the refund policy say?"),
      A("Fourteen days."),
    ];
    const intent = classifyEmployeePerformanceIntent({
      question: "What about it?",
      history,
    });

    expect(intent.active).toBe(false);
    expect(findContinuationAnchor(history)).toBe("What does the refund policy say?");
  });

  it("reports explicit intent as explicit, not as continuation", () => {
    const intent = classifyEmployeePerformanceIntent({
      question: "Who should I coach?",
      history: [],
    });

    expect(intent).toEqual({ active: true, source: "explicit", anchor: null });
  });

  it("does not inherit with no history at all", () => {
    expect(
      classifyEmployeePerformanceIntent({ question: "What about Sarah?", history: [] }).active,
    ).toBe(false);
  });

  it("is bounded rather than unlimited history inference", () => {
    const fragments = Array.from({ length: MAX_CONTINUATION_HOPS + 2 }, (_, index) =>
      U(`and ${index}?`),
    );

    expect(findContinuationAnchor([U(ANCHOR), ...fragments])).toBeNull();
    expect(
      classifyEmployeePerformanceIntent({
        question: "and one more?",
        history: [U(ANCHOR), ...fragments],
      }).active,
    ).toBe(false);
  });

  it("recognises fragments without treating short complete questions as fragments", () => {
    expect(isEllipticalFollowUp("What about Sarah?")).toBe(true);
    expect(isEllipticalFollowUp("and Jane?")).toBe(true);
    expect(isEllipticalFollowUp("Rank my team.")).toBe(false);
    expect(isEllipticalFollowUp("What does the refund policy say?")).toBe(false);
  });
});

/* ==================== DISCIPLINE: POLICY VS EMPLOYEE ACTION =============== */

describe("escalation words do not fire on a policy lookup", () => {
  /**
   * The re-priced trade-off. While grounding was FAIL-OPEN, a false positive
   * here cost prompt tokens. Now that it fails CLOSED, it can REFUSE an
   * ordinary Knowledge Base question outright — so these have to be negative.
   */
  const POLICY_LOOKUPS = [
    "What does the disciplinary policy say?",
    "Where can I find the discipline policy?",
    "What is the disciplinary process?",
    "Where is the coaching form?",
    "What does the coaching policy say?",
    "How do I find the performance improvement plan template?",
    "Is there a write-up form?",
    "What's the termination policy?",
    "Which form do I use for a write-up?",
    "Show me the disciplinary documentation",
    /*
     * These three carry no lookup SHAPE and no document noun, so the
     * documentary suppressor does not see them. They are protected only by the
     * rule that an escalation action needs a person to be about — which is
     * what makes them the cases that prove that rule is doing work.
     */
    "Is a write-up required for a no-call no-show?",
    "Does disciplinary action need HR approval?",
    "How many verbal coachings before a write-up?",
  ];

  for (const question of POLICY_LOOKUPS) {
    it(`stays quiet for "${question}"`, () => {
      expect(isEmployeePerformanceQuestion(question)).toBe(false);
    });
  }

  it("no longer holds the escalation words as unconditional strong terms", () => {
    const source = readFileSync("src/lib/ai/employee-performance-gate.ts", "utf8");
    const strong = source.slice(
      source.indexOf("export const STRONG_TERMS"),
      source.indexOf("export const ESCALATION_ACTION_TERMS"),
    );

    for (const term of ['"discipline"', '"disciplinary"', '"write-up"', '"performance improvement"', '"coaching form"']) {
      expect(strong, term).not.toContain(term);
    }
  });

  it("identifies a documentary lookup by shape AND a document noun", () => {
    expect(isDocumentaryLookup("What does the disciplinary policy say?")).toBe(true);
    expect(isDocumentaryLookup("Where can I find the discipline policy?")).toBe(true);

    // A document noun with no lookup shape is not a lookup.
    expect(isDocumentaryLookup("The policy says she was late again")).toBe(false);
    // A lookup shape with no document noun is not a lookup either.
    expect(isDocumentaryLookup("What does Sarah say?")).toBe(false);
  });
});

describe("escalation words DO fire on an employee decision", () => {
  const EMPLOYEE_ACTIONS = [
    "Should I discipline Sarah based on these numbers?",
    "Does Jane need disciplinary action based on this report?",
    "Should she be disciplined because of her conversion?",
    "should I discipline her for this?",
    "Does anyone need a write-up after this month?",
    "Does she need a coaching form after this report?",
    "Should Sarah be terminated for this?",
  ];

  for (const question of EMPLOYEE_ACTIONS) {
    it(`fires for "${question}"`, () => {
      expect(isEmployeePerformanceQuestion(question)).toBe(true);
    });
  }

  it("a named person outranks the documentary suppressor", () => {
    // Adding a policy noun must not be a way to ask for an escalation
    // recommendation with the guard switched off.
    expect(isEmployeePerformanceQuestion("Should I discipline Sarah under the policy?")).toBe(
      true,
    );
    expect(
      isEmployeePerformanceQuestion("What does the policy say about disciplining her?"),
    ).toBe(true);
  });

  it("still fires on EPP and DPOA, which are not policy nouns", () => {
    expect(isEmployeePerformanceQuestion("Does anyone need an EPP?")).toBe(true);
    expect(isEmployeePerformanceQuestion("is a DPOA justified here?")).toBe(true);
  });
});

/* ========================= ROLE DOCUMENT UNIQUENESS ====================== */

describe("role document resolution", () => {
  const role = EMPLOYEE_PERFORMANCE_FRAMEWORK;

  it("0 candidates: reports not_found rather than guessing", () => {
    const resolution = resolveRoleDocument(OTHER_DOCS, role);

    expect(resolution.ok).toBe(false);
    if (!resolution.ok) {
      expect(resolution.problem).toBe("not_found");
      expect(resolution.candidates).toEqual([]);
    }
  });

  it("1 tagged document: resolves and reports the tag", () => {
    const tagged = { ...FRAMEWORK_DOC, tags: [role.tag], original_filename: "renamed.txt" };
    const resolution = resolveRoleDocument([...OTHER_DOCS, tagged], role);

    expect(resolution.ok).toBe(true);
    if (resolution.ok) {
      expect(resolution.document.id).toBe(FRAMEWORK_DOC.id);
      expect(resolution.matchedBy).toBe("tag");
    }
  });

  it("2 tagged documents: ambiguous, never an arbitrary first row", () => {
    const first = { ...FRAMEWORK_DOC, tags: [role.tag] };
    const second = { ...COACHING_GUIDE, id: "doc-second", tags: [role.tag] };
    const resolution = resolveRoleDocument([first, second], role);

    expect(resolution.ok).toBe(false);
    if (!resolution.ok) {
      expect(resolution.problem).toBe("ambiguous");
      expect(resolution.candidates).toHaveLength(2);
    }
  });

  it("tagged replacement plus the old fallback filename: the tagged one wins", () => {
    const replacement = {
      ...FRAMEWORK_DOC,
      id: "doc-replacement",
      title: "Employee Performance Framework v2",
      original_filename: "framework-v2.txt",
      tags: [role.tag],
    };
    const original = FRAMEWORK_DOC; // still matches the fallback filename
    const resolution = resolveRoleDocument([original, replacement], role);

    expect(resolution.ok).toBe(true);
    if (resolution.ok) {
      expect(resolution.document.id).toBe("doc-replacement");
      expect(resolution.matchedBy).toBe("tag");
    }
  });

  it("2 fallback matches with none tagged: ambiguous", () => {
    const duplicate = { ...FRAMEWORK_DOC, id: "doc-duplicate" };
    const resolution = resolveRoleDocument([FRAMEWORK_DOC, duplicate], role);

    expect(resolution.ok).toBe(false);
    if (!resolution.ok) expect(resolution.problem).toBe("ambiguous");
  });

  it("falls back on the filename so the guard works before anyone tags it", () => {
    const resolution = resolveRoleDocument([...OTHER_DOCS, FRAMEWORK_DOC], role);

    expect(resolution.ok).toBe(true);
    if (resolution.ok) expect(resolution.matchedBy).toBe("fallback");
  });

  it("falls back on the title when the file was renamed", () => {
    const renamed = { ...FRAMEWORK_DOC, original_filename: "whatever.txt" };
    const resolution = resolveRoleDocument([...OTHER_DOCS, renamed], role);

    expect(resolution.ok).toBe(true);
    if (resolution.ok) expect(resolution.matchedBy).toBe("fallback");
  });

  it("does not mistake the Coaching Guide for the framework", () => {
    expect(resolveRoleDocument([COACHING_GUIDE], role).ok).toBe(false);
  });
});

/* ====================== MANDATORY RULE GROUP HEALTH ====================== */

describe("mandatory rule group health", () => {
  const role = EMPLOYEE_PERFORMANCE_FRAMEWORK;

  it("declares the five required groups the brief names", () => {
    expect(role.ruleGroups.map((group) => group.id)).toEqual([
      "source_hierarchy",
      "output_rules",
      "escalation_guard",
      "final_operating_rules",
      "interpretation_model",
    ]);
  });

  it("reports every group present for the real document", () => {
    const selection = selectMandatoryChunks(FRAMEWORK_CHUNKS, role);

    expect(selection.complete).toBe(true);
    expect(selection.missingGroups).toEqual([]);
    expect(selection.presentGroups).toHaveLength(5);
  });

  it("keeps the document's own order", () => {
    const indices = selectMandatoryChunks(FRAMEWORK_CHUNKS, role).chunks.map(
      (chunk) => chunk.chunk_index,
    );
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
  });

  it("takes only the sections the groups name", () => {
    const locators = new Set(
      selectMandatoryChunks(FRAMEWORK_CHUNKS, role).chunks.map((chunk) => chunk.locator),
    );

    expect(locators.has("OPPORTUNITY AND VOLUME METRICS")).toBe(false);
    expect(locators.has("RECOGNITION MESSAGE TEMPLATES")).toBe(false);
    expect(locators.has("SOURCE HIERARCHY AND OPERATING RULES")).toBe(true);
  });

  it("reports the escalation guard missing when a re-upload loses it", () => {
    const withoutGuard = FRAMEWORK_CHUNKS.filter(
      (chunk) => chunk.locator !== "NEVER RECOMMEND DISCIPLINE BASED ON METRICS ALONE",
    );
    const selection = selectMandatoryChunks(withoutGuard, role);

    expect(selection.complete).toBe(false);
    expect(selection.missingGroups).toEqual(["escalation_guard"]);
  });

  it("reports incomplete when only one group survives", () => {
    const onlyHierarchy = FRAMEWORK_CHUNKS.filter(
      (chunk) => chunk.locator === "SOURCE HIERARCHY AND OPERATING RULES",
    );
    const selection = selectMandatoryChunks(onlyHierarchy, role);

    expect(selection.chunks.length).toBeGreaterThan(0);
    expect(selection.complete).toBe(false);
    expect(selection.missingGroups).toHaveLength(4);
  });

  it("reports nothing pinned when the headings were all lost", () => {
    const flattened = FRAMEWORK_CHUNKS.map((chunk) => ({ ...chunk, locator: "Text" }));
    const selection = selectMandatoryChunks(flattened, role);

    expect(selection.chunks).toEqual([]);
    expect(selection.complete).toBe(false);
  });

  it("never exceeds the ceiling, however the document is re-chunked", () => {
    const exploded = Array.from({ length: 400 }, (_, index) => ({
      chunk_index: index,
      locator: "SOURCE HIERARCHY AND OPERATING RULES",
      id: `boom-${index}`,
    }));

    expect(selectMandatoryChunks(exploded, role).chunks.length).toBe(role.maxMandatoryChunks);
  });

  it("keeps every group under the ceiling rather than truncating the tail", () => {
    // 20 escalation chunks would fill the cap on their own and hide the rest.
    const lopsided = [
      ...Array.from({ length: 20 }, (_, index) => ({
        chunk_index: index,
        locator: "NEVER RECOMMEND DISCIPLINE BASED ON METRICS ALONE",
        id: `guard-${index}`,
      })),
      { chunk_index: 90, locator: "SOURCE HIERARCHY AND OPERATING RULES", id: "h" },
      { chunk_index: 91, locator: "DEFAULT OUTPUT RULE FOR EMPLOYEE PERFORMANCE REPORTS", id: "o" },
      { chunk_index: 92, locator: "SECTION 10 – FINAL OPERATING RULES FOR ASK Sunny", id: "f" },
      { chunk_index: 93, locator: "FINAL INTERPRETATION MODEL", id: "i" },
    ];
    const selection = selectMandatoryChunks(lopsided, role);

    expect(selection.chunks.length).toBeLessThanOrEqual(role.maxMandatoryChunks);
    expect(selection.complete).toBe(true);
    expect(selection.missingGroups).toEqual([]);
  });
});

describe("heading matching survives harmless formatting drift", () => {
  const role = EMPLOYEE_PERFORMANCE_FRAMEWORK;

  it("matches the live en-dash heading exactly as stored", () => {
    const locators = selectMandatoryChunks(FRAMEWORK_CHUNKS, role).chunks.map((c) => c.locator);
    expect(locators).toContain("SECTION 10 – FINAL OPERATING RULES FOR ASK Sunny");
  });

  it("normalises dashes, numbering, case, punctuation and spacing", () => {
    const canonical = headingKey("SECTION 10 – FINAL OPERATING RULES FOR ASK Sunny");

    for (const variant of [
      "SECTION 10 - FINAL OPERATING RULES FOR ASK SUNNY",
      "SECTION 10 — FINAL OPERATING RULES FOR ASK Sunny",
      "Section 11 – Final Operating Rules For Ask Sunny",
      "FINAL  OPERATING   RULES  FOR  ASK  SUNNY",
      "## FINAL OPERATING RULES FOR ASK SUNNY",
      "FINAL OPERATING RULES FOR ASK SUNNY:",
    ]) {
      expect(headingKey(variant), variant).toBe(canonical);
    }
  });

  it("resolves a whole re-export whose headings drifted", () => {
    const drifted = FRAMEWORK_CHUNKS.map((chunk) => ({
      ...chunk,
      locator: `## ${chunk.locator.replace(/–/g, "-").toLowerCase()}  `,
    }));

    expect(selectMandatoryChunks(drifted, role).complete).toBe(true);
  });

  it("does NOT collapse two genuinely different rules together", () => {
    expect(headingKey("FINAL INTERPRETATION MODEL")).not.toBe(
      headingKey("SECTION 10 – FINAL OPERATING RULES FOR ASK Sunny"),
    );
    expect(headingKey("SOURCE HIERARCHY AND OPERATING RULES")).not.toBe(
      headingKey("FINAL OPERATING RULES FOR ASK SUNNY"),
    );
  });
});

/* ===================== THE HEALTH RESULT IS A REFUSAL ==================== */

describe("grounding health reports a reason for every failure", () => {
  const role = EMPLOYEE_PERFORMANCE_FRAMEWORK;

  it("succeeds for the real document", () => {
    const result = buildRoleGrounding({
      role,
      document: FRAMEWORK_DOC,
      matchedBy: "fallback",
      chunks: FRAMEWORK_CHUNKS,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.grounding.rows.length).toBeGreaterThan(0);
      expect(result.grounding.presentGroups).toHaveLength(5);
      expect(result.grounding.documentId).toBe(FRAMEWORK_DOC.id);
    }
  });

  it("fails with no_mandatory_chunks when the headings were lost", () => {
    const result = buildRoleGrounding({
      role,
      document: FRAMEWORK_DOC,
      matchedBy: "tag",
      chunks: FRAMEWORK_CHUNKS.map((chunk) => ({ ...chunk, locator: "Text" })),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe("no_mandatory_chunks");
  });

  it("fails with incomplete_rule_groups and names the missing rule", () => {
    const result = buildRoleGrounding({
      role,
      document: FRAMEWORK_DOC,
      matchedBy: "tag",
      chunks: FRAMEWORK_CHUNKS.filter(
        (chunk) => chunk.locator !== "NEVER RECOMMEND DISCIPLINE BASED ON METRICS ALONE",
      ),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("incomplete_rule_groups");
      expect(result.failure.detail).toContain("EPP or DPOA on a metric alone");
      expect(result.failure.missingGroups).toEqual(["escalation_guard"]);
    }
  });

  it("fails with not_found when the corpus has no framework", () => {
    const result = evaluateRoleGrounding({
      role,
      documents: OTHER_DOCS,
      chunksFor: () => [],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe("role_document_not_found");
  });

  it("fails with ambiguous when two documents claim the role", () => {
    const result = evaluateRoleGrounding({
      role,
      documents: [
        { ...FRAMEWORK_DOC, tags: [role.tag] },
        { ...COACHING_GUIDE, id: "doc-second", tags: [role.tag] },
      ],
      chunksFor: () => FRAMEWORK_CHUNKS,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("role_document_ambiguous");
      expect(result.failure.detail).toContain("2 indexed documents");
    }
  });

  it("carries no database detail in the manager-facing message", () => {
    expect(FRAMEWORK_UNAVAILABLE_MESSAGE).not.toMatch(/select|relation|postgres|supabase/i);
    expect(FRAMEWORK_UNAVAILABLE_MESSAGE).toContain(
      "can't safely rank or recommend coaching or escalation actions",
    );
  });
});

/* ========================== GROUNDING ASSEMBLY =========================== */

describe("assembly puts reasoning first and does not spend the evidence budget", () => {
  const question = "Who should I coach from this employee performance report?";

  it("includes the framework though retrieval returned none of it", () => {
    expect(frameworkRowsIn(RETRIEVED_NO_FRAMEWORK)).toHaveLength(0);

    const assembled = groundFor(question);

    expect(assembled.roleIncluded).toBe(true);
    expect(frameworkRowsIn(assembled.rows).length).toBeGreaterThan(0);
  });

  it("puts the reasoning before the evidence", () => {
    expect(groundFor(question).rows[0]!.document_id).toBe(FRAMEWORK_DOC.id);
  });

  it("still gives all twelve evidence slots to the manuals", () => {
    const assembled = groundFor(question);

    expect(assembled.retrievedCount).toBe(RETRIEVAL.contextChunks);
    expect(assembled.rows.filter((row) => row.document_id !== FRAMEWORK_DOC.id)).toHaveLength(
      RETRIEVAL.contextChunks,
    );
  });

  it("keeps policy in the prompt for the hierarchy to bite on", () => {
    expect(
      groundFor(question).rows.filter((row) => row.document_id === POLICY_MANUAL.id).length,
    ).toBeGreaterThan(0);
  });

  it("never gives one chunk two markers", () => {
    const withDuplicate = [...frameworkRows().slice(0, 2), ...RETRIEVED_NO_FRAMEWORK];
    const assembled = assembleGrounding({
      mandatory: frameworkRows(),
      retrieved: withDuplicate,
      roleDocumentId: FRAMEWORK_DOC.id,
      evidenceBudget: RETRIEVAL.contextChunks,
    });
    const ids = assembled.rows.map((row) => row.chunk_id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps retrieved framework rows when nothing could be pinned", () => {
    // Pinning failed, so dropping them too would remove the framework entirely.
    const assembled = assembleGrounding({
      mandatory: [],
      retrieved: frameworkRows(),
      roleDocumentId: FRAMEWORK_DOC.id,
      evidenceBudget: RETRIEVAL.contextChunks,
    });

    expect(frameworkRowsIn(assembled.rows).length).toBeGreaterThan(0);
  });

  it("passes an unrelated question straight through unchanged", () => {
    const assembled = groundFor("What is the tanning bed cleaning procedure?");

    expect(assembled.mandatoryCount).toBe(0);
    expect(assembled.rows).toEqual(RETRIEVED_NO_FRAMEWORK.slice(0, RETRIEVAL.contextChunks));
  });
});

/* ============================ PROMPT GUARANTEES ========================== */

describe("the framework's examples cannot become current employee facts", () => {
  it("says its contents are placeholders, not people", () => {
    const prompt = promptFor({ hasFrameworkGrounding: true });

    expect(prompt).toContain("ITS EXAMPLES ARE NOT PEOPLE.");
    expect(prompt).toContain("[Employee]");
    expect(prompt).toContain("never fill a placeholder in with a guess");
    expect(prompt).toContain(
      "never carry an example's numbers into your answer as though they were measured",
    );
  });

  it("says the framework is reasoning rather than evidence about a person", () => {
    expect(promptFor({ hasFrameworkGrounding: true })).toContain(
      "IT IS REASONING, NOT EVIDENCE ABOUT ANY PERSON.",
    );
  });

  it("names the only sources current facts may come from", () => {
    expect(promptFor({ hasFrameworkGrounding: true })).toContain(
      "CURRENT FACTS COME ONLY FROM CURRENT DATA",
    );
  });
});

describe("official policy overrides the framework", () => {
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

  it("carries the brand's real name and leaves no token behind", () => {
    const prompt = promptFor({ hasFrameworkGrounding: true });

    expect(prompt).toContain("Current official Sun Tan City policy");
    expect(prompt).not.toContain("{{BRAND}}");
  });
});

describe("EPP and DPOA safety", () => {
  it("forbids escalation on numbers alone", () => {
    const prompt = promptFor({ hasFrameworkGrounding: true });

    expect(prompt).toContain(
      "Never recommend discipline, an EPP, a DPOA, a suspension or a termination on the strength of numbers alone",
    );
    expect(prompt).toContain("A metric is a coaching signal, not a finding.");
    expect(prompt).toContain("the correct recommendation is to observe first");
  });

  it("keeps the rest of the safety rules", () => {
    const prompt = promptFor({ hasFrameworkGrounding: true });

    expect(prompt).toContain("Weigh opportunity volume before performance.");
    expect(prompt).toContain("Never infer attitude, effort, character or laziness from a metric.");
    expect(prompt).toContain("Recommend the lightest appropriate next step.");
    expect(prompt).toContain("Recognition is half the job.");
  });

  it("leaves disciplinary decisions with the manager", () => {
    expect(promptFor({ hasFrameworkGrounding: true })).toContain(
      "Signature lines, disciplinary decisions and anything with legal weight stay with the manager.",
    );
  });

  it("says nothing about the framework on a turn that has none", () => {
    expect(promptFor({ hasFrameworkGrounding: false })).not.toContain(
      "EMPLOYEE PERFORMANCE — HOW TO USE THE FRAMEWORK",
    );
  });
});

describe("the two absences are distinguished", () => {
  it("with no ingested dataset, says exactly that and permits stated figures", () => {
    const prompt = promptFor({ hasFrameworkGrounding: true, hasEmployeeFactsBlock: false });

    expect(prompt).toContain("NO EMPLOYEE PERFORMANCE REPORT HAS BEEN INGESTED");
    expect(prompt).toContain(
      "You MAY use employee figures the manager has stated in this conversation, exactly as stated",
    );
  });

  it("never claims outright that there are no employee facts", () => {
    const prompt = promptFor({ hasFrameworkGrounding: true, hasEmployeeFactsBlock: false });

    // The old wording was false whenever the manager supplied figures.
    expect(prompt).not.toContain("YOU HAVE NO CURRENT EMPLOYEE-LEVEL DATA FOR THIS QUESTION");
    expect(prompt).not.toContain("no employee figures at all");
  });

  it("still forbids inventing what was not stated", () => {
    const prompt = promptFor({ hasFrameworkGrounding: true, hasEmployeeFactsBlock: false });

    expect(prompt).toContain("Do not infer a metric that was not stated");
    expect(prompt).toContain(
      "Do not invent an employee, a name, a score, a ranking or a headcount",
    );
  });

  it("switches to the attached-data rules when a block exists", () => {
    const prompt = promptFor({ hasFrameworkGrounding: true, hasEmployeeFactsBlock: true });

    expect(prompt).toContain(
      "The CURRENT EMPLOYEE PERFORMANCE DATA section holds the employee figures",
    );
    expect(prompt).not.toContain("NO EMPLOYEE PERFORMANCE REPORT HAS BEEN INGESTED");
  });

  it("keeps employee figures out of the source-marker system", () => {
    expect(promptFor({ hasFrameworkGrounding: true, hasEmployeeFactsBlock: true })).toContain(
      "Never mark an employee figure with a source marker.",
    );
  });

  it("reports no ingested dataset, because there is none", async () => {
    const { loadEmployeeFacts } = await import("@/lib/reporting/read/employee-facts");
    const facts = await loadEmployeeFacts();

    expect(facts.datasetIngested).toBe(false);
    expect(facts.available).toBe(false);
    expect(facts.block).toBeNull();
    expect(facts.provenance).toBeNull();
    expect(facts.reason).toMatch(/salon-level data only/);
  });

  it("renders a block with real provenance when facts exist", async () => {
    const { renderEmployeeFactsBlock } = await import("@/lib/reporting/read/employee-facts");
    const block = renderEmployeeFactsBlock({
      facts: "Sarah Cole — 412 opportunities.",
      provenance: "Employee Performance Report, August 2026",
    });

    expect(block).toContain("CURRENT EMPLOYEE PERFORMANCE DATA");
    expect(block).toContain("Source: Employee Performance Report, August 2026.");
    expect(block).toContain("Never mark them with a source marker");
  });

  it("says the manager is the source when there is no report", async () => {
    const { renderEmployeeFactsBlock } = await import("@/lib/reporting/read/employee-facts");
    const block = renderEmployeeFactsBlock({ facts: "Sarah: 40 and 8.", provenance: null });

    expect(block).toContain("stated by the manager in this conversation");
  });
});

/* ========================= STATEMENT TAXONOMY ============================ */

describe("the statement taxonomy counts what is actually attached", () => {
  it("2 kinds: knowledge and general guidance", () => {
    const prompt = promptFor({ hasFrameworkGrounding: false });

    expect(prompt).toContain("distinguish clearly between two kinds of statement");
    expect(prompt).toContain("1. Company knowledge");
    expect(prompt).toContain("2. General management guidance");
    expect(prompt).not.toContain("3. ");
  });

  it("3 kinds: plus salon report figures", () => {
    const prompt = promptFor({ hasFrameworkGrounding: false, hasReportData: true });

    expect(prompt).toContain("distinguish clearly between three kinds of statement");
    expect(prompt).toContain("3. Salon report figures");
    expect(prompt).not.toContain("4. ");
  });

  it("3 kinds: plus employee figures, with no salon report", () => {
    const prompt = promptFor({
      hasFrameworkGrounding: true,
      hasEmployeeFactsBlock: true,
      hasReportData: false,
    });

    expect(prompt).toContain("distinguish clearly between three kinds of statement");
    expect(prompt).toContain("3. Employee figures");
    expect(prompt).not.toContain("Salon report figures");
  });

  it("4 kinds: knowledge, guidance, salon report and employee figures", () => {
    const prompt = promptFor({
      hasFrameworkGrounding: true,
      hasEmployeeFactsBlock: true,
      hasReportData: true,
    });

    expect(prompt).toContain("distinguish clearly between four kinds of statement");
    expect(prompt).toContain("1. Company knowledge");
    expect(prompt).toContain("2. General management guidance");
    expect(prompt).toContain("3. Salon report figures");
    expect(prompt).toContain("4. Employee figures");
  });

  it("states all four properties employee figures need", () => {
    const prompt = promptFor({ hasFrameworkGrounding: true, hasEmployeeFactsBlock: true });
    const kind = prompt.slice(prompt.indexOf("Employee figures"));

    // current measurements, not policy
    expect(kind).toContain("CURRENT MEASUREMENTS ABOUT NAMED PEOPLE, not policy");
    // no knowledge marker
    expect(kind).toContain("Never mark them with a source marker");
    // real provenance / reporting period
    expect(kind).toContain("Attribute them to the report and reporting period that section names");
    // never infer or calculate unstated metrics
    expect(kind).toContain(
      "Never infer, estimate or calculate an employee metric the section does not state",
    );
  });

  it("keeps employee figures distinct from salon-level results", () => {
    const prompt = promptFor({
      hasFrameworkGrounding: true,
      hasEmployeeFactsBlock: true,
      hasReportData: true,
    });

    expect(prompt).toContain("not policy and not salon-level results");
    expect(prompt).toContain("A salon-level figure is not an employee's");
  });

  it("adds no employee taxonomy or rule when no block is attached", () => {
    const prompt = promptFor({ hasFrameworkGrounding: true, hasEmployeeFactsBlock: false });

    expect(prompt).not.toContain("Employee figures —");
    expect(prompt).not.toContain("A salon-level figure is not an employee's");
  });

  it("names the same section heading the facts block renders", async () => {
    const { EMPLOYEE_DATA_HEADING } = await import("@/lib/reporting/read/employee-facts");

    // The constant is duplicated across a server-only boundary; this is what
    // stops the two copies drifting.
    expect(EMPLOYEE_DATA_SECTION).toBe(EMPLOYEE_DATA_HEADING);
    expect(promptFor({ hasFrameworkGrounding: true, hasEmployeeFactsBlock: true })).toContain(
      EMPLOYEE_DATA_HEADING,
    );
  });
});

/* ============================== PROVENANCE =============================== */

describe("citations identify the real framework document", () => {
  it("pins rows carrying the document's own id, title and locator", () => {
    const rows = frameworkRowsIn(groundFor("Who should I coach?").rows);

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.document_id).toBe(FRAMEWORK_DOC.id);
      expect(row.document_title).toBe("ASK SUNNY EMPLOYEE PERFORMANCE FRAMEWORK KB TEXT");
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

/* ====================== STRUCTURAL INVARIANTS WORTH KEEPING ============== */

describe("structural invariants", () => {
  const SERVER_ASK = readFileSync("src/lib/ai/server-ask.ts", "utf8");

  it("has no fail-open catch around the mandatory grounding fetch", () => {
    /*
     * The bug this whole remediation exists for. Comments discuss it by name —
     * deliberately, so the next reader knows why the shape is what it is — so
     * the CODE is what gets searched.
     */
    const code = SERVER_ASK.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

    expect(code).not.toContain(".catch(");
    expect(code).toContain("fetchRoleGrounding(EMPLOYEE_PERFORMANCE_FRAMEWORK");
  });

  it("refuses before the model call rather than after it", () => {
    const refusalAt = SERVER_ASK.indexOf("FRAMEWORK_UNAVAILABLE_MESSAGE");
    const modelAt = SERVER_ASK.indexOf("await callClaude(");

    expect(refusalAt).toBeGreaterThanOrEqual(0);
    expect(refusalAt).toBeLessThan(modelAt);
  });

  it("proposes a form before any grounding work happens", () => {
    const proposalAt = SERVER_ASK.indexOf("proposeFormForTurn");

    expect(proposalAt).toBeLessThan(SERVER_ASK.indexOf("fetchRoleGrounding"));
    expect(proposalAt).toBeLessThan(SERVER_ASK.indexOf("knowledge.match({"));
    expect(SERVER_ASK).toContain("if (proposal) return proposal;");
  });

  it("leaves the similarity threshold untouched and unread here", () => {
    expect(RETRIEVAL.minSimilarity).toBe(0.78);
    expect(SERVER_ASK).not.toContain("minSimilarity");
  });

  it("keeps the corpus server-decided rather than request-supplied", () => {
    expect(readFileSync("src/app/api/chat/route.ts", "utf8")).toContain(
      "scopeId: activeKnowledgeCorpus()",
    );
  });

  it("reads the same visibility rules retrieval does", () => {
    const PROVIDER = readFileSync("src/lib/knowledge/providers/supabase.ts", "utf8");

    expect(PROVIDER).toContain('.eq("indexed", true)');
    expect(PROVIDER).toContain('.eq("status", "indexed")');
    expect(PROVIDER).toContain('.eq("version", document.version)');
  });

  it("fetches deeper when a role is in play, within the RPC's clamp", () => {
    expect(SERVER_ASK).toContain("RETRIEVAL.roleAugmentedTopK");
    expect(RETRIEVAL.roleAugmentedTopK).toBeGreaterThan(RETRIEVAL.topK);
    expect(RETRIEVAL.roleAugmentedTopK).toBeLessThanOrEqual(50);
  });

  it("passes the employee facts block, not just its presence", () => {
    expect(SERVER_ASK).toContain("employeeData: employeeFacts?.block ?? null");
  });
});
