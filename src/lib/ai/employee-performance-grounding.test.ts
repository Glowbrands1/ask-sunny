import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { RETRIEVAL } from "@/lib/config/models";
import type { MatchedChunkRow } from "@/lib/knowledge/mappers";
import {
  DAILY_STATS_INTERPRETATION_FRAMEWORK,
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
  hasActionReferent,
  isDecisionRequest,
  isDefinitionalLookup,
  isDocumentaryLookup,
  isEllipticalFollowUp,
  isEmployeePerformanceQuestion,
  mentionsCaseData,
  mentionsCategoryOnly,
  mentionsEscalationAction,
  mentionsIndividual,
  mentionsPersonName,
  suppliesActionReferent,
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
    roleDocumentIds: active ? [FRAMEWORK_DOC.id] : [],
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

  it("inherits for every fragment form the brief names", () => {
    /**
     * The multi-hop WALK was correct; the fragment ENUMERATION was not. These
     * three lost the framework three turns into a coaching conversation.
     */
    for (const question of [
      "Why?", "How so?", "What do you mean?", "Based on that?", "Based on this?",
      "What about her?", "What about him?", "What about Sarah?", "And Jane?",
      "And him?", "The other one?", "The other two?", "What about last month?",
      "What about this month?", "What then?", "How?",
    ]) {
      const intent = classifyEmployeePerformanceIntent({ question, history: HOP_2 });
      expect(intent.active, question).toBe(true);
      expect(intent.source, question).toBe("continuation");
      expect(intent.anchor, question).toBe(ANCHOR);
    }
  });

  it("clears every one of those fragments against an unrelated anchor", () => {
    const unrelated = [U("What does the refund policy say?"), A("Fourteen days.")];
    for (const question of [
      "Why?", "How so?", "What do you mean?", "Based on that?", "What about her?",
      "The other one?", "What then?", "How?",
    ]) {
      expect(
        classifyEmployeePerformanceIntent({ question, history: unrelated }).active,
        question,
      ).toBe(false);
    }
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
      roleDocumentIds: [FRAMEWORK_DOC.id],
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
      roleDocumentIds: [FRAMEWORK_DOC.id],
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

/* ============ REMEDIATION 2: CATEGORY vs INDIVIDUAL ====================== */

describe("a category of people is a policy question, not a decision", () => {
  /**
   * QA found "Can managers discipline employees under this policy?" firing,
   * because `managers` and `employees` were subject words. Under fail-closed
   * grounding that REFUSES an ordinary policy lookup. The distinction is the
   * determiner, not the word.
   */
  const CATEGORY_QUESTIONS = [
    "Can managers discipline employees under this policy?",
    "What disciplinary action can managers take with employees?",
    "What are managers allowed to do when employees violate this rule?",
  ];

  for (const question of CATEGORY_QUESTIONS) {
    it(`stays quiet for "${question}"`, () => {
      expect(isEmployeePerformanceQuestion(question)).toBe(false);
    });
  }

  const INDIVIDUAL_QUESTIONS = [
    "Should this employee be disciplined?",
    "Should Sarah be disciplined?",
    "Should my employee be written up based on these numbers?",
    "Should one of these employees be disciplined based on this report?",
    "Can I discipline Sarah under this policy?",
  ];

  for (const question of INDIVIDUAL_QUESTIONS) {
    it(`fires for "${question}"`, () => {
      expect(isEmployeePerformanceQuestion(question)).toBe(true);
    });
  }

  it("reads a determined singular as an individual and a bare plural as a class", () => {
    expect(mentionsIndividual("this employee")).toBe(true);
    expect(mentionsIndividual("the consultant")).toBe(true);
    expect(mentionsIndividual("which team member")).toBe(true);
    expect(mentionsIndividual("my team")).toBe(true);

    expect(mentionsIndividual("employees")).toBe(false);
    expect(mentionsIndividual("managers and staff")).toBe(false);
    expect(mentionsCategoryOnly("what may managers do about employees")).toBe(true);
  });

  it("reads a SELECTED plural as an individual", () => {
    expect(mentionsIndividual("one of these employees")).toBe(true);
    expect(mentionsIndividual("any of my consultants")).toBe(true);
  });

  it("did not solve this by deleting the plural words", () => {
    // The brief warned against that: it would lose the selected-plural case.
    expect(
      isEmployeePerformanceQuestion(
        "Should one of these employees be disciplined based on this report?",
      ),
    ).toBe(true);
  });
});

/* ============ REMEDIATION 2: ONE DOCUMENT-NOUN LIST ====================== */

describe("documentary lookup reads one noun list", () => {
  const DOCUMENTARY = [
    "What is a coaching form used for?",
    "Where is the coaching form?",
    "Is there a write-up form?",
    "What are the steps for a write-up?",
    "Where is the disciplinary procedure documented?",
    "What does the coaching guide say?",
    "Where can I find the performance improvement template?",
    "What is this document used for?",
    "What does the write-up policy say?",
    "Where is the write-up form?",
  ];

  for (const question of DOCUMENTARY) {
    it(`stays quiet for "${question}"`, () => {
      expect(isEmployeePerformanceQuestion(question)).toBe(false);
    });
  }

  it("has exactly one document-noun list in the source", () => {
    // The drift between an inline shape list and DOCUMENT_NOUNS is what let
    // "What is a coaching form used for?" through.
    const source = readFileSync("src/lib/ai/employee-performance-gate.ts", "utf8");
    expect(source.match(/const DOCUMENT_NOUNS/g) ?? []).toHaveLength(1);
    const shapes = source.slice(
      source.indexOf("const LOOKUP_SHAPES"),
      source.indexOf("const DOCUMENT_NOUNS"),
    );
    // The shapes must carry no noun vocabulary of their own beyond the
    // "which <document>" form, which is a shape rather than a requirement.
    expect(shapes).not.toContain("guideline|guidelines|steps");
  });

  it("covers every noun the brief names", () => {
    for (const noun of [
      "policy", "process", "procedure", "rule", "rules", "guideline",
      "guidelines", "steps", "form", "manual", "guide", "template", "document",
    ]) {
      expect(isDocumentaryLookup(`What is the coaching ${noun}?`), noun).toBe(true);
    }
  });

  it("is not an escape hatch when a person is named", () => {
    for (const question of [
      "Should I discipline Sarah under the policy?",
      "Based on the policy and Sarah's numbers, should I coach her?",
      "Does Jane need a write-up according to this policy?",
      "Given this report and the disciplinary process, what action should I take with Sarah?",
      "The policy says Sarah was late. Should I discipline her?",
    ]) {
      expect(isEmployeePerformanceQuestion(question), question).toBe(true);
    }
  });
});

/* ============ REMEDIATION 2: SEPARABLE WRITE-UP ========================== */

describe("write ... up is a separable phrasal verb", () => {
  const POSITIVES = [
    "Should we write her up?",
    "Should I write Sarah up?",
    "Do we need to write him up?",
    "Would you write this employee up?",
    "Should we write them up?",
    "Write up Sarah?",
  ];

  for (const question of POSITIVES) {
    it(`fires for "${question}"`, () => {
      expect(isEmployeePerformanceQuestion(question)).toBe(true);
    });
  }

  const NEGATIVES = [
    "Where is the write-up form?",
    "What does the write-up policy say?",
    "What are the steps for a write-up?",
  ];

  for (const question of NEGATIVES) {
    it(`stays quiet for "${question}"`, () => {
      expect(isEmployeePerformanceQuestion(question)).toBe(false);
    });
  }

  it("recognises the separated forms as escalation actions", () => {
    expect(mentionsEscalationAction("write her up")).toBe(true);
    expect(mentionsEscalationAction("write this employee up")).toBe(true);
    expect(mentionsEscalationAction("written up")).toBe(true);
    expect(mentionsEscalationAction("writeup")).toBe(true);
  });

  it("does not stretch across a clause", () => {
    expect(
      mentionsEscalationAction("write the monthly summary, then follow up next week"),
    ).toBe(false);
  });
});

/* ============ REMEDIATION 2: CASE DATA ESTABLISHES CONTEXT =============== */

describe("current case data establishes employee decision context", () => {
  const POSITIVES = [
    "Based on those numbers, is a write-up appropriate?",
    "Based on this report, should someone be disciplined?",
    "Given these metrics, is an EPP justified?",
    "Based on those figures, do we need a DPOA?",
    "Does this report justify a performance improvement plan?",
    "Based on what we just reviewed, should we coach her?",
    "Based on those numbers, should we write her up?",
  ];

  for (const question of POSITIVES) {
    it(`fires for "${question}"`, () => {
      expect(isEmployeePerformanceQuestion(question)).toBe(true);
    });
  }

  const NEGATIVES = [
    "What does this report contain?",
    "Summarize these numbers.",
    "What does the disciplinary policy say about reports?",
    "Where can I find this report?",
    "What does this report say about the disciplinary policy?",
  ];

  for (const question of NEGATIVES) {
    it(`stays quiet for "${question}"`, () => {
      expect(isEmployeePerformanceQuestion(question)).toBe(false);
    });
  }

  it("never fires on case data alone — it only ever combines with escalation", () => {
    expect(mentionsCaseData("based on those numbers")).toBe(true);
    expect(isEmployeePerformanceQuestion("Based on those numbers, what is the trend?")).toBe(
      false,
    );
  });

  it("does not treat a bare mention of report or data as case context", () => {
    expect(mentionsCaseData("the annual report")).toBe(false);
    expect(mentionsCaseData("data retention")).toBe(false);
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

/* ================================== remediation 2 — routing gap regressions == */

/**
 * ============================================================================
 * FOUR GAPS THE FIVE-BLOCKER MATRICES DID NOT REACH
 * ============================================================================
 *
 * Each was found by running the brief's matrices and then pushing one step past
 * them. Three are the same class of bug the remediation exists to fix — an
 * ordinary question routed into mandatory grounding and therefore REFUSED when
 * the framework is unavailable. The fourth is the opposite and worse direction:
 * a fragment that falls through loses intent, so the escalation guard goes
 * absent mid-conversation.
 */
describe("remediation 2 — a complete question is not an elliptical fragment", () => {
  const COMPLETE_QUESTIONS = [
    "Based on those numbers, what was our total revenue?",
    "According to this policy, what is the refund window?",
    "Given this report, which salon led the district?",
  ];

  for (const question of COMPLETE_QUESTIONS) {
    it(`is judged on its own words: "${question}"`, () => {
      expect(isEllipticalFollowUp(question)).toBe(false);

      // And therefore inherits nothing from an employee-performance anchor.
      expect(
        classifyEmployeePerformanceIntent({
          question,
          history: [{ role: "user", content: "Who should I coach?" }],
        }).active,
      ).toBe(false);
    });
  }

  /*
   * The other half, and the reason this is a bare-demonstrative rule rather
   * than a strict end-anchor: these ARE continuations and must still inherit.
   */
  const STILL_FRAGMENTS = [
    "Based on that?",
    "Based on that, what should I do?",
    "According to that, who needs coaching?",
    "Given this, what next?",
    /*
     * WHERE THE LINE ACTUALLY FALLS, said plainly because it is a judgement
     * rather than a certainty. This is a reporting question and it inherits —
     * structurally it is identical to "Based on that, what should I do?" and
     * only meaning separates them. Telling those apart needs a classifier,
     * which this gate deliberately is not.
     *
     * A BARE demonstrative is an explicit pointer back at the previous turn, so
     * it is read as one. The costly case was never this: it was the
     * demonstrative followed by a NOUN, which introduces a new subject and
     * points nowhere — "According to this policy, …".
     */
    "From that, what is our headcount?",
  ];

  for (const question of STILL_FRAGMENTS) {
    it(`still continues the previous turn: "${question}"`, () => {
      expect(isEllipticalFollowUp(question)).toBe(true);
      expect(
        classifyEmployeePerformanceIntent({
          question,
          history: [{ role: "user", content: "Should we write Sarah up?" }],
        }).active,
      ).toBe(true);
    });
  }
});

describe("remediation 2 — near-neighbour fragments do not fall through", () => {
  const NEIGHBOURS = ["What does that mean?", "Why then?", "What else?", "What now?"];

  for (const fragment of NEIGHBOURS) {
    it(`continues an escalation anchor: "${fragment}"`, () => {
      expect(isEllipticalFollowUp(fragment)).toBe(true);
      expect(
        classifyEmployeePerformanceIntent({
          question: fragment,
          history: [{ role: "user", content: "Should we write Sarah up?" }],
        }).active,
      ).toBe(true);
    });
  }
});

describe("remediation 2 — a plural pronoun reads against the class beside it", () => {
  it("is the class where there is a class to refer to", () => {
    const question = "Can managers discipline them when employees break this rule?";
    expect(mentionsIndividual(question)).toBe(false);
    expect(isEmployeePerformanceQuestion(question)).toBe(false);
  });

  it("is a person where there is not", () => {
    expect(mentionsIndividual("Should we write them up?")).toBe(true);
    expect(isEmployeePerformanceQuestion("Should we write them up?")).toBe(true);
  });

  it("leaves a selected plural individuating", () => {
    expect(
      isEmployeePerformanceQuestion("Should one of these employees be disciplined?"),
    ).toBe(true);
  });
});

describe("remediation 2 — the document-noun list has no surviving copy", () => {
  /*
   * The `which` shape still re-typed seven nouns and required the noun to be
   * adjacent, so a Forms lookup fired `coaching` instead. Every noun below is
   * reached ONLY through the shared `DOCUMENT_NOUNS` list, so removing one from
   * it fails a behavioural test rather than passing quietly.
   */
  const SHARED_LIST_ONLY = [
    "Which coaching form should I use?",
    "Which disciplinary procedure applies?",
    "What is the coaching manual?",
    "What is the coaching handbook?",
    "What is the disciplinary template?",
    "What is this checklist?",
  ];

  for (const question of SHARED_LIST_ONLY) {
    it(`stays a lookup: "${question}"`, () => {
      expect(isDocumentaryLookup(question)).toBe(true);
      expect(isEmployeePerformanceQuestion(question)).toBe(false);
    });
  }
});

/* ========================================================================== *
 * REMEDIATION 4 — SURGICAL RECONCILIATION
 *
 * Independent QA of the live head measured four routing gaps in front of the
 * fail-closed architecture: documentary 15/25, escalation vocabulary 2/11,
 * coaching inflections 2/6, cross-topic referent 1/12. Everything below is a
 * BEHAVIOURAL assertion — the source-level checks that already exist stay as
 * supplements, because a vocabulary can be present in the file and still not
 * reach the decision.
 * ========================================================================== */

describe("remediation 4 — documentary and definitional questions are answered, not refused", () => {
  /**
   * The brief's twenty-five. Under fail-closed grounding each of these was
   * REFUSED whenever the framework happened to be unavailable, and every one is
   * a question the corpus answers well.
   */
  const ORDINARY = [
    "What procedure applies to coaching?",
    "Explain the coaching process.",
    "Tell me about the coaching guide.",
    "Do we have a coaching form?",
    "What is an EPP?",
    "What is a DPOA?",
    "What is a PIP?",
    "Explain the disciplinary process.",
    "Describe the coaching procedure.",
    "Tell me about the write-up policy.",
    "Do we have a performance improvement form?",
    "Which policy applies to write-ups?",
    "What policy covers verbal coaching?",
    "Can you show me the disciplinary manual?",
    "Where do I find the coaching template?",
    "What is corrective counseling?",
    "What is a written warning?",
    "What is probation?",
    "What does the warning policy say?",
    "Where is the reprimand policy?",
    "Explain the termination process.",
    "Tell me about the suspension policy.",
    "What procedure applies to disciplinary action?",
    "What is coaching?",
    "What does EPP stand for?",
  ];

  for (const question of ORDINARY) {
    it(`answers "${question}" from the corpus`, () => {
      expect(isEmployeePerformanceQuestion(question)).toBe(false);
    });
  }

  it("recognises the constructions the narrower shape list missed", () => {
    for (const question of [
      "Explain the coaching process.",
      "Describe the coaching procedure.",
      "Outline the disciplinary process.",
      "Walk me through the write-up form.",
      "Tell me about the coaching guide.",
      "Do we have a coaching form?",
      "Does the company have a write-up policy?",
      "What procedure applies to coaching?",
      "Which rule governs verbal coaching?",
      "What policy covers verbal coaching?",
      "What is a coaching form used for?",
      "Where can I locate the coaching manual?",
      "Point me at the counseling documentation.",
    ]) {
      expect(isDocumentaryLookup(question), question).toBe(true);
    }
  });

  it("still reads DOCUMENT_NOUNS as the single noun source", () => {
    const source = readFileSync("src/lib/ai/employee-performance-gate.ts", "utf8");
    expect(source.match(/const DOCUMENT_NOUNS/g) ?? []).toHaveLength(1);
    // No shape may carry a noun vocabulary of its own.
    const shapes = source.slice(
      source.indexOf("const LOOKUP_SHAPES"),
      source.indexOf("const DOCUMENT_NOUNS"),
    );
    expect(shapes).not.toContain("guideline|guidelines|steps");
  });
});

describe("remediation 4 — a definition is not a decision", () => {
  /**
   * `What is an EPP?` was refused: the acronym is a strong term and the
   * question carries no document noun, so the documentary suppressor could not
   * see it. A definition asks what a term means; a decision asks what to do
   * about somebody, and the same acronym appears in both.
   */
  const PAIRS: [string, string][] = [
    ["What is an EPP?", "Does Jane need an EPP?"],
    ["What is a DPOA?", "Is a DPOA justified for Sarah?"],
    ["What is a PIP?", "Should Jane be put on a PIP?"],
    ["What is corrective counseling?", "Does she need corrective counseling?"],
    ["What is a written warning?", "Should Sarah receive a written warning?"],
    ["What is probation?", "Should he be put on probation?"],
    ["What is coaching?", "Should she be coached?"],
  ];

  for (const [definition, decision] of PAIRS) {
    it(`"${definition}" is ordinary and "${decision}" is not`, () => {
      expect(isEmployeePerformanceQuestion(definition)).toBe(false);
      expect(isEmployeePerformanceQuestion(decision)).toBe(true);
    });
  }

  it("exposes the two halves independently", () => {
    expect(isDefinitionalLookup("What is an EPP?")).toBe(true);
    expect(isDecisionRequest("What is an EPP?")).toBe(false);
    expect(isDefinitionalLookup("Does Jane need an EPP?")).toBe(false);
    expect(isDecisionRequest("Does Jane need an EPP?")).toBe(true);
  });

  it("needs the subject to be a concept this gate governs", () => {
    // A definitional shape about anything else is not this gate's business and
    // must not be suppressed by it — it never fired in the first place.
    expect(isDefinitionalLookup("What is the refund window?")).toBe(false);
    expect(isDefinitionalLookup("What is a spa bed?")).toBe(false);
  });

  it("A SUPERLATIVE IS NEVER A DEFINITION, so ranking questions stay open", () => {
    /*
     * The trap in the obvious implementation. A bare "any `what is …` with
     * nobody in it" rule also swallows a prioritisation request, which needs
     * the framework — trading a false refusal for a bypass, the worse of the
     * two errors.
     */
    for (const question of [
      "What is the biggest coaching opportunity?",
      "What is the lowest conversion on my team?",
      "What is our worst coaching gap?",
    ]) {
      expect(isDefinitionalLookup(question), question).toBe(false);
      expect(isEmployeePerformanceQuestion(question), question).toBe(true);
    }
  });

  it("does not let a person-less process question become an employee one", () => {
    /*
     * Why the suppressor is guarded on `!individual` ALONE. An earlier draft
     * also required `!isDecisionRequest`, and `should` is enough to make a
     * Forms lookup look like a decision.
     */
    for (const question of [
      "Which coaching form should I use?",
      "Should we use the coaching form?",
      "Which disciplinary procedure applies?",
    ]) {
      expect(isEmployeePerformanceQuestion(question), question).toBe(false);
    }
  });
});

describe("remediation 4 — the escalation vocabulary is complete by concept and inflection", () => {
  const CONCEPTS: [string, string][] = [
    ["written warning", "Should Sarah receive a written warning?"],
    ["formal warning", "Should Jane receive a formal warning?"],
    ["final warning", "Should Sarah get a final warning?"],
    ["warning, bare", "Does this warrant a formal warning?"],
    ["corrective action", "Do these numbers justify corrective action?"],
    ["corrective action, from a report", "Per this report, does anyone need corrective action?"],
    ["corrective counseling", "Does she need corrective counseling?"],
    ["PIP", "Should Jane be put on a PIP?"],
    ["improvement plan", "Does Jane need an improvement plan?"],
    ["reprimand", "Should Sarah be reprimanded?"],
    ["probation", "Should he be put on probation?"],
    ["fire", "Should we fire Sarah?"],
    ["fire, with case data", "Should we fire Sarah based on these results?"],
    ["let go, separated", "Should we let Jane go?"],
    ["suspension", "Is suspension appropriate for Jane?"],
    ["termination", "Should Sarah be terminated?"],
  ];

  for (const [concept, question] of CONCEPTS) {
    it(`covers ${concept}`, () => {
      expect(isEmployeePerformanceQuestion(question)).toBe(true);
    });
  }

  it("carries each concept as a bare term, so a new phrasing does not need a new test", () => {
    for (const term of [
      "warn", "warned", "warning", "warnings", "written warning", "formal warning",
      "verbal warning", "final warning", "corrective action", "corrective counseling",
      "corrective counselling", "counsel", "counseled", "counselled", "counseling",
      "counselling", "pip", "pips", "improvement plan", "performance plan",
      "reprimand", "reprimanded", "reprimands", "probation", "probationary",
      "fire", "fires", "fired", "firing", "let go",
      "terminate", "terminated", "terminating", "termination",
      "suspend", "suspended", "suspending", "suspension",
      "discipline", "disciplinary", "write-up", "written up", "performance improvement",
    ]) {
      expect(mentionsEscalationAction(term), term).toBe(true);
    }
  });

  it("BREADTH IS SAFE ONLY BECAUSE AN ESCALATION TERM NEVER FIRES ALONE", () => {
    // Each of these carries a newly listed word and asks for nothing.
    for (const question of [
      "What is a written warning?",
      "What is corrective counseling?",
      "What is a PIP?",
      "What is probation?",
      "Explain the termination process.",
      "What does the warning policy say?",
      "Where is the reprimand policy?",
      "What paperwork does a final warning need?",
      "How many verbal coachings before a write-up?",
      "Is a write-up required for a no-call no-show?",
      "Does disciplinary action need HR approval?",
    ]) {
      expect(isEmployeePerformanceQuestion(question), question).toBe(false);
    }
  });
});

describe("remediation 4 — fire equipment is not a dismissal", () => {
  /**
   * `fire` is what makes "Should we fire Sarah?" reach the framework, and a
   * salon is full of fire equipment. The compound guard blanks the equipment
   * senses before the test rather than excluding them afterwards, so the
   * surrounding words still count.
   */
  const NOT_DISMISSAL = [
    "Where is the fire extinguisher?",
    "When is the next fire drill?",
    "Sarah, did you check the fire alarm?",
    "Did the consultant check the fire alarm?",
    "Should I ask my consultant to check the fire alarm?",
    "Who signs off the fire safety log?",
    "What is the fire evacuation procedure?",
    "Sarah, is the fire exit clear?",
    "Is the fire door blocked again?",
    "When was the last fire inspection?",
  ];

  for (const question of NOT_DISMISSAL) {
    it(`stays quiet for "${question}"`, () => {
      expect(isEmployeePerformanceQuestion(question)).toBe(false);
    });
  }

  const DISMISSAL = [
    "Should we fire Sarah?",
    "Should Sarah be fired based on this report?",
    "Should we let Jane go?",
    "Should we let her go?",
    "Do we need to let this employee go?",
  ];

  for (const question of DISMISSAL) {
    it(`fires for "${question}"`, () => {
      expect(isEmployeePerformanceQuestion(question)).toBe(true);
    });
  }

  it("blanks only the equipment sense, so a real escalation in the same sentence survives", () => {
    expect(
      isEmployeePerformanceQuestion("Should we fire Sarah after she ignored the fire drill?"),
    ).toBe(true);
  });

  it("does not read a first-person or particle `go` as a dismissal", () => {
    for (const question of [
      "Can you let me go through her numbers?",
      "Should we let the shift go on without her?",
      "Let me go over Sarah's report.",
      "Did you let it go to voicemail?",
    ]) {
      expect(isEmployeePerformanceQuestion(question), question).toBe(false);
    }
  });
});

describe("remediation 4 — the coaching inflection family is complete", () => {
  const POSITIVES = [
    "Should she be coached?",
    "Should Sarah be coached?",
    "Who should be coached?",
    "Who needs coaching?",
    "Is coaching appropriate for Jane?",
    "Should Sarah be coached based on today's numbers?",
    "Has Sarah been coached about this before?",
    "Would coaching be appropriate for her?",
  ];

  for (const question of POSITIVES) {
    it(`fires for "${question}"`, () => {
      expect(isEmployeePerformanceQuestion(question)).toBe(true);
    });
  }

  it("holds the whole family and NOT `coachings`", () => {
    const source = readFileSync("src/lib/ai/employee-performance-gate.ts", "utf8");
    const strong = source.slice(
      source.indexOf("export const STRONG_TERMS"),
      source.indexOf("export const ESCALATION_ACTION_TERMS"),
    );
    const code = strong.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

    for (const term of ['"coach"', '"coaches"', '"coached"', '"coaching"', '"coachable"']) {
      expect(code, term).toContain(term);
    }
    // The plural would fire a policy question about the escalation ladder.
    expect(code).not.toContain('"coachings"');
  });

  it("keeps the plural's question ordinary", () => {
    expect(isEmployeePerformanceQuestion("How many verbal coachings before a write-up?")).toBe(
      false,
    );
  });
});

describe("remediation 4 — a lookup that becomes an employee decision", () => {
  const U = (content: string) => ({ role: "user", content });
  const A = (content: string) => ({ role: "assistant", content });

  /** anchor, follow-up, what the referent resolves to. */
  const SEQUENCES: [string, string, string][] = [
    ["What is the disciplinary policy?", "Should Sarah get one?", "disciplinary action"],
    ["What is the write-up policy?", "Should Sarah get one?", "a write-up"],
    ["What does the coaching policy say?", "Based on her numbers, should we do that?", "coaching"],
    ["What is the coaching process?", "Should Jane go through it?", "coaching"],
    ["Where is the write-up form?", "Should I use it for Sarah?", "a write-up"],
    ["What is an EPP?", "Does Jane need one?", "an EPP"],
    ["What is a DPOA?", "Is one justified for Sarah?", "a DPOA"],
    ["What is a PIP?", "Should Jane be put on one?", "a PIP"],
    ["What is corrective counseling?", "Does Jane need it?", "corrective counseling"],
    ["What is a written warning?", "Should Sarah get one?", "a written warning"],
    ["What is probation?", "Should he be put on it?", "probation"],
  ];

  for (const [anchorTurn, followUp, referent] of SEQUENCES) {
    it(`resolves "${followUp}" to ${referent}`, () => {
      const intent = classifyEmployeePerformanceIntent({
        question: followUp,
        history: [U(anchorTurn), A("...")],
      });

      expect(intent.active).toBe(true);
      expect(intent.source).toBe("referent");
      expect(intent.anchor).toBe(anchorTurn);
    });
  }

  it("reads a turn that names its own action as explicit, not as a referent", () => {
    const intent = classifyEmployeePerformanceIntent({
      question: "Should Sarah be terminated?",
      history: [U("What does the termination policy say?"), A("...")],
    });

    expect(intent.active).toBe(true);
    expect(intent.source).toBe("explicit");
  });

  it("resolves the fresh sequences too, because it reads the shared vocabularies", () => {
    const FRESH: [string, string][] = [
      ["We discussed the PIP.", "Does Jane need it?"],
      ["What is the suspension policy?", "Should Sarah get one?"],
      ["Explain corrective action.", "Does Jane need that?"],
      ["What does the reprimand policy say?", "Should he get one?"],
      ["Where is the final warning form?", "Should I use it for Jane?"],
      ["What is the probation process?", "Should Sarah go on it?"],
      ["Tell me about the counseling procedure.", "Does she need it?"],
      ["What is a verbal coaching?", "Should Jane have one?"],
      ["What is the termination checklist?", "Should we start it for Sarah?"],
      ["What does the improvement plan cover?", "Should Sarah be on one?"],
    ];

    for (const [anchorTurn, followUp] of FRESH) {
      const intent = classifyEmployeePerformanceIntent({
        question: followUp,
        history: [U(anchorTurn), A("...")],
      });
      expect(intent.active, `${anchorTurn} -> ${followUp}`).toBe(true);
      expect(intent.source, `${anchorTurn} -> ${followUp}`).toBe("referent");
    }
  });

  it("exposes the four conditions independently", () => {
    expect(isDecisionRequest("Should Sarah get one?")).toBe(true);
    expect(mentionsIndividual("Should Sarah get one?")).toBe(true);
    expect(hasActionReferent("Should Sarah get one?")).toBe(true);
    // A turn naming its own action does not need this path.
    expect(hasActionReferent("Should Sarah be disciplined?")).toBe(false);
    expect(suppliesActionReferent("What is the disciplinary policy?")).toBe(true);
    expect(suppliesActionReferent("What does the refund policy say?")).toBe(false);
  });

  it("DOES NOT OVER-INFER: each condition rejects one of QA's traps", () => {
    // No action is being asked for, so condition 1 and 3 fail.
    expect(
      classifyEmployeePerformanceIntent({
        question: "What about Sarah?",
        history: [U("Can managers discipline employees under this policy?"), A("...")],
      }).active,
    ).toBe(false);

    // A named person is not a request, so condition 1 fails.
    expect(
      classifyEmployeePerformanceIntent({
        question: "What about Sarah?",
        history: [U("What is the coaching policy?"), A("...")],
      }).active,
    ).toBe(false);

    // The anchor names no action this gate governs, so condition 4 fails.
    expect(
      classifyEmployeePerformanceIntent({
        question: "Should Sarah get one?",
        history: [U("What does the refund policy say?"), A("Fourteen days.")],
      }).active,
    ).toBe(false);
  });

  it("but the same anchor with an explicit follow-up still fires", () => {
    const intent = classifyEmployeePerformanceIntent({
      question: "Should Sarah be coached?",
      history: [U("What is the coaching policy?"), A("...")],
    });

    expect(intent.active).toBe(true);
    expect(intent.source).toBe("explicit");
  });

  it("inherits the ACTION and never the subject", () => {
    /*
     * The referent path resolves one thing. "Should Sarah get one?" is about
     * Sarah because it says Sarah — no prior subject is carried forward, so a
     * follow-up naming nobody stays inactive.
     */
    expect(
      classifyEmployeePerformanceIntent({
        question: "Should we get one?",
        history: [U("What is the disciplinary policy?"), A("...")],
      }).active,
    ).toBe(false);
  });

  it("is bounded by the same walk the fragment path uses", () => {
    const fragments = Array.from({ length: MAX_CONTINUATION_HOPS + 2 }, (_, index) =>
      U(`and ${index}?`),
    );

    expect(
      classifyEmployeePerformanceIntent({
        question: "Should Sarah get one?",
        history: [U("What is the disciplinary policy?"), ...fragments],
      }).active,
    ).toBe(false);
  });

  it("cannot reach back past a standalone question", () => {
    expect(
      classifyEmployeePerformanceIntent({
        question: "Should Sarah get one?",
        history: [
          U("What is the disciplinary policy?"),
          A("..."),
          U("What does the refund policy say?"),
          A("Fourteen days."),
        ],
      }).active,
    ).toBe(false);
  });
});

describe("remediation 4 — the reverse context switch reverts to the corpus", () => {
  const U = (content: string) => ({ role: "user", content });
  const A = (content: string) => ({ role: "assistant", content });

  const REVERSALS: [string, string][] = [
    ["Should Sarah be written up?", "Where is the form?"],
    ["Should Jane receive an EPP?", "What does EPP stand for?"],
    ["Should Sarah be coached?", "Where is the coaching guide?"],
  ];

  for (const [anchorTurn, followUp] of REVERSALS) {
    it(`answers "${followUp}" from the corpus`, () => {
      expect(
        classifyEmployeePerformanceIntent({
          question: followUp,
          history: [U(anchorTurn), A("...")],
        }).active,
      ).toBe(false);
    });
  }
});

describe("remediation 4 — a demonstrative handed to a justification verb is case data", () => {
  const POSITIVES = [
    "Does this warrant a formal warning?",
    "Does this justify corrective action?",
    "Would this merit a reprimand?",
    "Do today's results warrant formal action?",
    "Do these numbers justify corrective action?",
  ];

  for (const question of POSITIVES) {
    it(`fires for "${question}"`, () => {
      expect(isEmployeePerformanceQuestion(question)).toBe(true);
    });
  }

  it("stays bounded to the justification verbs", () => {
    expect(mentionsCaseData("Does this warrant a formal warning?")).toBe(true);
    expect(mentionsCaseData("today's numbers")).toBe(true);
    // Reading questions are untouched.
    expect(mentionsCaseData("What does this say?")).toBe(false);
    expect(mentionsCaseData("the annual report")).toBe(false);
  });

  it("never fires on case data alone", () => {
    expect(isEmployeePerformanceQuestion("What does this report contain?")).toBe(false);
    expect(isEmployeePerformanceQuestion("Summarize these numbers.")).toBe(false);
    expect(isEmployeePerformanceQuestion("Based on those numbers, what is the trend?")).toBe(
      false,
    );
    expect(isEmployeePerformanceQuestion("Explain today's conversion numbers.")).toBe(false);
  });
});

describe("remediation 4 — fresh adversarial probes", () => {
  const NEGATIVES = [
    "Could you explain corrective counseling?",
    "What does probation mean?",
    "Can you show me the warning procedure?",
    "Is there a checklist for a suspension?",
    "What are the steps in the reprimand process?",
    "Remind me what a DPOA is.",
    "Where do we keep the improvement plan template?",
    "What paperwork does a final warning need?",
    "How is corrective action defined in the handbook?",
    "Point me at the counseling documentation.",
  ];

  for (const question of NEGATIVES) {
    it(`stays quiet for "${question}"`, () => {
      expect(isEmployeePerformanceQuestion(question)).toBe(false);
    });
  }

  const POSITIVES = [
    "Would a written warning make sense for Jane?",
    "Does this merit a reprimand?",
    "Should I put Sarah on probation?",
    "Do today's results warrant formal action?",
    "Should Sarah be let go based on this report?",
    "Is it time to move Jane to a PIP?",
    "Would coaching be appropriate for her?",
    "Given these figures, does he need corrective counseling?",
    "Am I right to suspend Sarah over this?",
    "Has Sarah been coached about this before?",
  ];

  for (const question of POSITIVES) {
    it(`fires for "${question}"`, () => {
      expect(isEmployeePerformanceQuestion(question)).toBe(true);
    });
  }
});

describe("remediation 4 — the branches that only bite in one combination", () => {
  const U = (content: string) => ({ role: "user", content });

  /*
   * Two mutations survived the first audit, and both were test gaps rather
   * than dead code. Recorded here with the combination that makes each branch
   * load-bearing, so removing it fails a behavioural test.
   */

  it("a CATEGORY question carrying a strong term is still a policy question", () => {
    /*
     * The category suppressor differs from the fall-through only when a STRONG
     * term is present — otherwise the missing predicate would have ended the
     * question anyway. This is that combination: a class of people, a strong
     * term, no predicate and no escalation.
     */
    for (const question of [
      "Do employees get recognition for perfect attendance?",
      "Do consultants get a shout out for hitting goal?",
      "Are managers given coaching plans during onboarding?",
    ]) {
      expect(mentionsCategoryOnly(question), question).toBe(true);
      expect(isEmployeePerformanceQuestion(question), question).toBe(false);
    }
  });

  it("the pinned set is CAPPED, and the cap is what bounds the prompt", () => {
    /*
     * `maxMandatoryChunks` had no behavioural test: raising it to any number
     * changed nothing any assertion could see. The cap is what keeps the
     * prompt's size a property of the ROLE DEFINITION rather than of whatever
     * was last uploaded, so a re-export that chunked one section into forty
     * pieces would otherwise silently take over the prompt.
     */
    const role = EMPLOYEE_PERFORMANCE_FRAMEWORK;
    expect(role.maxMandatoryChunks).toBe(14);

    // One rule group, chunked far past the ceiling.
    const flooded = Array.from({ length: 60 }, (_, index) => ({
      chunk_index: index,
      locator: "NEVER RECOMMEND DISCIPLINE BASED ON METRICS ALONE",
      chunk_id: `flood-${index}`,
      content: `Flood ${index}.`,
      page: null,
      section: "NEVER RECOMMEND DISCIPLINE BASED ON METRICS ALONE",
    }));

    const selection = selectMandatoryChunks([...FRAMEWORK_CHUNKS, ...flooded], role);

    expect(selection.chunks.length).toBeLessThanOrEqual(role.maxMandatoryChunks);
    // And the cap does not cost a group its representation.
    expect(selection.missingGroups).toEqual([]);
  });

  it("caps the Daily Stats role at its own, smaller ceiling", () => {
    const role = DAILY_STATS_INTERPRETATION_FRAMEWORK;
    expect(role.maxMandatoryChunks).toBe(10);

    const flooded = role.ruleGroups.flatMap((group) =>
      Array.from({ length: 12 }, (_, index) => ({
        chunk_index: index,
        locator: group.headings[0]!,
        chunk_id: `${group.id}-${index}`,
        content: `Flood ${index}.`,
        page: null,
        section: group.headings[0]!,
      })),
    );

    const selection = selectMandatoryChunks(flooded, role);

    expect(selection.chunks.length).toBeLessThanOrEqual(role.maxMandatoryChunks);
    expect(selection.missingGroups).toEqual([]);
  });

  it("the continuation bound is SIX, asserted against a literal chain", () => {
    /*
     * The existing bound test builds its fragment list FROM
     * `MAX_CONTINUATION_HOPS`, so raising the constant raises the input too and
     * the assertion holds either way. This one counts fragments literally.
     */
    expect(MAX_CONTINUATION_HOPS).toBe(6);

    const anchor = U("Who should I coach?");
    const fragment = (index: number) => U(`and ${index}?`);

    // Six fragments: the anchor is still in reach.
    expect(
      findContinuationAnchor([anchor, ...Array.from({ length: 5 }, (_, i) => fragment(i))]),
    ).toBe("Who should I coach?");

    // Seven: too far, and the manager restates rather than us guessing.
    expect(
      findContinuationAnchor([anchor, ...Array.from({ length: 7 }, (_, i) => fragment(i))]),
    ).toBeNull();
  });
});
