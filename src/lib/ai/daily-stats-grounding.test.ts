import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { RETRIEVAL } from "@/lib/config/models";
import type { MatchedChunkRow } from "@/lib/knowledge/mappers";
import {
  DAILY_STATS_INTERPRETATION_FRAMEWORK,
  EMPLOYEE_PERFORMANCE_FRAMEWORK,
  KNOWLEDGE_DOCUMENT_ROLES,
  hasRoleTag,
  resolveRoleDocument,
  roleTagAdvice,
  selectMandatoryChunks,
  toRoleGroundingRow,
} from "@/lib/knowledge/document-roles";
import { detectTemplateIntent } from "@/lib/forms/template-intent";
import { routeReportFamilies } from "@/lib/reporting/read/family-routing";
import { assembleGrounding } from "./grounding-assembly";
import { isEmployeePerformanceQuestion } from "./employee-performance-gate";
import {
  DAILY_STATS_TERMS,
  hasDailyStatsVocabulary,
  isDailyStatsQuestion,
} from "./daily-stats-gate";
import {
  DAILY_STATS_RULES,
  EMPLOYEE_PERFORMANCE_RULES,
  MANAGER_ANSWER_SHAPE,
  buildSystemPrompt,
} from "./prompts";

/**
 * ============================================================================
 * THE DAILY STATS FRAMEWORK IS MANDATORY, NOT LUCKY
 * ============================================================================
 *
 * The framework is one document among many and 59 chunks among hundreds.
 * Whether it reached "what should I focus on today?" would otherwise depend on
 * whether one of those chunks cleared a similarity threshold — and that
 * question contains no vocabulary from the document at all. No metric name, no
 * coaching word, nothing a vector index can match on. The question the
 * framework exists to answer is precisely the question least likely to retrieve
 * it.
 *
 * THE FIXTURES BELOW ARE THAT HOSTILE CASE MADE CONCRETE. `RETRIEVED_NO_DAILY`
 * is fourteen real-looking chunks from the manuals and policies that actually
 * outrank the framework, with not one Daily Stats chunk among them. Every
 * inclusion test runs against it, so a test passing here cannot be a test that
 * merely re-observed vector search doing the right thing.
 *
 * The locators are the REAL ones — read from the supplied .docx through the
 * same extractor the ingestion pipeline uses — so a re-chunked or re-headed
 * document breaks these tests rather than silently changing what Sunny reasons
 * with.
 */

/* ------------------------------------------------------------- fixtures -- */

const DAILY_DOC = {
  id: "doc-daily-stats",
  title: "ASK SUNNY DAILY STATS INTERPRETATION FRAMEWORK",
  category: "leadership_coaching",
  original_filename: "ASK_SUNNY_DAILY_STATS_INTERPRETATION_FRAMEWORK.docx",
  tags: [] as string[],
  version: 1,
};

const EMPLOYEE_DOC = {
  id: "doc-employee-framework",
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
    id: "doc-bonus-policy",
    title: "Salon Director Bonus Policy",
    category: "policy",
    original_filename: "Salon Director Bonus Policy.pdf",
    tags: [] as string[],
    version: 1,
  },
];

/**
 * The framework's chunks as the real document produces them.
 *
 * Verified against the supplied .docx: 21 heading-delimited segments become 59
 * chunks, and these are the locators the four mandatory sections carry. The
 * counts per locator are the real ones — one, four, two and one — which is what
 * makes the eight-chunk expectation below a measurement rather than a guess.
 */
const DAILY_CHUNKS = [
  { locator: "Document body", count: 1 },
  { locator: "Document Map", count: 1 },
  { locator: "ASK SUNNY OPERATING RULES FOR DAILY STATS", count: 1 },
  { locator: "SECTION 1 - PURPOSE OF DAILY STATS", count: 3 },
  { locator: "SECTION 2 - DAILY STATS METRIC DEFINITIONS", count: 3 },
  { locator: "PRODUCTIVITY METRICS", count: 5 },
  { locator: "TRAFFIC AND CLIENT FLOW METRICS", count: 4 },
  { locator: "LABOR AND SCHEDULING METRICS", count: 3 },
  { locator: "MEMBERSHIP, DISCOUNT, AND CLIENT ACCOUNT REVIEW SECTIONS", count: 5 },
  { locator: "SECTION 3 - METRIC TO COACHING TRANSLATION GUIDE", count: 10 },
  { locator: "SECTION 4 - PRIORITY DECISION TREE", count: 4 },
  { locator: "SECTION 5 - DAILY ACTION PLAN FRAMEWORK", count: 4 },
  { locator: "SECTION 6 - BONUS VIEWER CORRELATION", count: 2 },
  { locator: "SECTION 7 - COACHING RECOMMENDATION LIBRARY", count: 5 },
  { locator: "SECTION 8 - OUTPUT TEMPLATES", count: 2 },
  { locator: "Manager Action Plan for Today", count: 1 },
  { locator: "Coaching Form Draft", count: 1 },
].flatMap((entry, group) =>
  Array.from({ length: entry.count }, (_, index) => ({
    id: `daily-${group}-${index}`,
    chunk_index: group * 100 + index,
    locator: entry.locator,
    page: null,
    section: entry.locator,
    content: `[${entry.locator} #${index}] framework text, including a worked example reading "PPTA 2.41 against a 3.10 target".`,
  })),
);

/** The hostile retrieval: real neighbours, no framework chunk among them. */
const RETRIEVED_NO_DAILY: MatchedChunkRow[] = Array.from({ length: 14 }, (_, index) => ({
  chunk_id: `other-${index}`,
  document_id: index % 2 === 0 ? OTHER_DOCS[0].id : OTHER_DOCS[1].id,
  document_title: index % 2 === 0 ? OTHER_DOCS[0].title : OTHER_DOCS[1].title,
  category: index % 2 === 0 ? "leadership_coaching" : "policy",
  locator: `Page ${index + 1}`,
  page: index + 1,
  section: null,
  content: `Manual text ${index}.`,
  similarity: 0.9 - index * 0.01,
}));

const CONTEXT = {
  userName: "Paulyne",
  locationName: "KS Lawrence",
  todayIso: "2026-09-09",
};

function promptFor(options: {
  hasDailyStatsFramework?: boolean;
  hasFrameworkGrounding?: boolean;
  hasReportData?: boolean;
  hasMissingReports?: boolean;
  hasEmployeeFacts?: boolean;
  hasContext?: boolean;
}): string {
  return buildSystemPrompt({
    assistantName: "Sunny",
    brandName: "Sun Tan City",
    salonNoun: "salon",
    context: CONTEXT,
    mode: "standard",
    hasContext: options.hasContext ?? true,
    hasReportData: options.hasReportData ?? false,
    hasFrameworkGrounding: options.hasFrameworkGrounding ?? false,
    hasEmployeeFacts: options.hasEmployeeFacts ?? false,
    hasDailyStatsFramework: options.hasDailyStatsFramework ?? false,
    hasMissingReports: options.hasMissingReports ?? false,
  });
}

/** The pinned rows the real selection produces for a role. */
function pinnedRows(
  role: typeof DAILY_STATS_INTERPRETATION_FRAMEWORK,
  document: typeof DAILY_DOC,
  chunks: typeof DAILY_CHUNKS,
): MatchedChunkRow[] {
  return selectMandatoryChunks(chunks, role).map((chunk) =>
    toRoleGroundingRow(document, chunk),
  );
}

/** The real assembly for a question, with the real gates deciding. */
function groundFor(question: string, retrieved = RETRIEVED_NO_DAILY) {
  const wantsDaily = isDailyStatsQuestion(question);
  const wantsEmployee = isEmployeePerformanceQuestion(question);

  const mandatory = [
    ...(wantsDaily
      ? pinnedRows(DAILY_STATS_INTERPRETATION_FRAMEWORK, DAILY_DOC, DAILY_CHUNKS)
      : []),
    ...(wantsEmployee
      ? [
          toRoleGroundingRow(EMPLOYEE_DOC, {
            id: "emp-0",
            chunk_index: 0,
            locator: "SOURCE HIERARCHY AND OPERATING RULES",
            page: null,
            section: null,
            content: "Employee framework operating rules.",
          }),
        ]
      : []),
  ];

  return assembleGrounding({
    mandatory,
    retrieved,
    roleDocumentIds: [
      ...(wantsDaily ? [DAILY_DOC.id] : []),
      ...(wantsEmployee ? [EMPLOYEE_DOC.id] : []),
    ],
    evidenceBudget: RETRIEVAL.contextChunks,
  });
}

function dailyRowsIn(rows: MatchedChunkRow[]): MatchedChunkRow[] {
  return rows.filter((row) => row.document_id === DAILY_DOC.id);
}

/* ============================================================ the gate == */

describe("A. the framework reaches the question it exists for", () => {
  const BROAD = [
    "What should I focus on today?",
    "What happened yesterday?",
    "How are we doing today?",
    "What should I coach today?",
    "What are my top 3 priorities?",
    "Where do I start this morning?",
  ];

  for (const question of BROAD) {
    it(`opens the gate for "${question}"`, () => {
      expect(isDailyStatsQuestion(question)).toBe(true);
    });

    it(`pins the framework for "${question}", against a retrieval that has none`, () => {
      const assembled = groundFor(question);
      expect(dailyRowsIn(assembled.rows).length).toBeGreaterThan(0);
      expect(assembled.roleIncluded).toBe(true);
    });
  }

  it("pins the four sections that are the reasoning contract, and only those", () => {
    /*
     * MEASURED AGAINST THE REAL DOCUMENT. The four mandatory locators hold
     * eight chunks between them; the other 51 are metric glossaries, the
     * translation guide and the recommendation library, which are what
     * retrieval is for.
     */
    const rows = pinnedRows(
      DAILY_STATS_INTERPRETATION_FRAMEWORK,
      DAILY_DOC,
      DAILY_CHUNKS,
    );
    expect(rows).toHaveLength(8);
    expect(new Set(rows.map((row) => row.locator))).toEqual(
      new Set([
        "ASK SUNNY OPERATING RULES FOR DAILY STATS",
        "SECTION 4 - PRIORITY DECISION TREE",
        "SECTION 8 - OUTPUT TEMPLATES",
        "Coaching Form Draft",
      ]),
    );
  });

  it("pins them in the document's own order, not the order this file lists them", () => {
    const rows = pinnedRows(
      DAILY_STATS_INTERPRETATION_FRAMEWORK,
      DAILY_DOC,
      DAILY_CHUNKS,
    );
    // The operating rules before the decision tree before the output
    // templates: the sequence their author wrote.
    expect(rows[0].locator).toBe("ASK SUNNY OPERATING RULES FOR DAILY STATS");
    expect(rows[rows.length - 1].locator).toBe("Coaching Form Draft");
  });

  it("caps the pinned set whatever the locators match", () => {
    /*
     * A re-upload chunked differently — a heading that stops being detected and
     * swallows the rest of the document — must not turn "pin the operating
     * rules" into "pin everything".
     */
    const swallowed = Array.from({ length: 40 }, (_, index) => ({
      id: `swallowed-${index}`,
      chunk_index: index,
      locator: "SECTION 8 - OUTPUT TEMPLATES",
      page: null,
      section: null,
      content: "everything",
    }));
    expect(
      selectMandatoryChunks(swallowed, DAILY_STATS_INTERPRETATION_FRAMEWORK),
    ).toHaveLength(DAILY_STATS_INTERPRETATION_FRAMEWORK.maxMandatoryChunks);
  });
});

describe("B. a question that reaches for figures is a question about what they mean", () => {
  it("opens on the report routing even with no interpretation vocabulary", () => {
    /*
     * THE CONDITION THAT MAKES THE GUARANTEE DETERMINISTIC RATHER THAN LUCKY.
     * "Tans are up but revenue is down" is the archetypal Daily Stats question
     * — traffic present, conversion weak, coach product attachment — and it
     * contains not one word of interpretation vocabulary. A keyword list long
     * enough to catch it is a list long enough to fire on everything.
     */
    const question = "Tans are up but revenue is down.";
    expect(hasDailyStatsVocabulary(question)).toBe(false);
    expect(routeReportFamilies(question).length).toBeGreaterThan(0);
    expect(isDailyStatsQuestion(question)).toBe(true);
    expect(dailyRowsIn(groundFor(question).rows).length).toBeGreaterThan(0);
  });

  it("opens for a bare metric question", () => {
    expect(isDailyStatsQuestion("Which salons have the lowest spa conversion?")).toBe(true);
    expect(isDailyStatsQuestion("What was our PPTA yesterday?")).toBe(true);
  });
});

describe("the gate stays shut on questions that are not about interpretation", () => {
  const CLOSED = [
    "What is the dress code?",
    "What does the handbook say about breaks?",
    "Who do I call when the POS is down?",
    "What is the refund policy on memberships?",
    "Can I approve time off for next week?",
    "Where is the safety report kept?",
  ];

  for (const question of CLOSED) {
    it(`stays shut for "${question}"`, () => {
      expect(isDailyStatsQuestion(question)).toBe(false);
    });
  }

  it("pins nothing and leaves the ordinary path untouched", () => {
    const assembled = groundFor("What is the dress code?");
    expect(assembled.mandatoryCount).toBe(0);
    expect(assembled.rows).toEqual(RETRIEVED_NO_DAILY.slice(0, RETRIEVAL.contextChunks));
  });

  it("holds no term that could match everything", () => {
    /*
     * A regex metacharacter added to the list unescaped would silently turn the
     * gate always-true, which is the one way this module could fail invisibly.
     * The apostrophe is allowed because managers type "what's driving" and the
     * escaper handles it; every other punctuation mark is not.
     */
    for (const term of DAILY_STATS_TERMS) {
      expect(term, term).toMatch(/^[a-z0-9 '-]+$/);
      expect(term.length, term).toBeGreaterThan(2);
    }
    expect(isDailyStatsQuestion("")).toBe(false);
    expect(isDailyStatsQuestion("hello")).toBe(false);
  });

  it("reads the question only, never the history", () => {
    expect(isDailyStatsQuestion.length).toBe(1);
  });
});

/* ================================================== two roles at once == */

describe("I. a coaching question is both classes of question, and pins both", () => {
  const question = "What should I coach today?";

  it("opens both gates", () => {
    expect(isDailyStatsQuestion(question)).toBe(true);
    expect(isEmployeePerformanceQuestion(question)).toBe(true);
  });

  it("pins both frameworks into one grounding set", () => {
    const assembled = groundFor(question);
    expect(dailyRowsIn(assembled.rows).length).toBeGreaterThan(0);
    expect(assembled.rows.some((row) => row.document_id === EMPLOYEE_DOC.id)).toBe(true);
    expect(assembled.pinnedDocumentIds).toContain(DAILY_DOC.id);
    expect(assembled.pinnedDocumentIds).toContain(EMPLOYEE_DOC.id);
  });

  it("reads the Daily Stats frame before the escalation limits inside it", () => {
    /*
     * Daily Stats is the OUTER reasoning model — how to read the day, how to
     * choose the top three — and the Employee Performance Framework's limits
     * apply once a person is named inside that. Reading the frame before the
     * constraint is the order a manager would be briefed in.
     */
    const SERVER_ASK = readFileSync("src/lib/ai/server-ask.ts", "utf8");
    expect(SERVER_ASK).toContain(
      "mandatory: [...(dailyStats?.rows ?? []), ...(role?.rows ?? [])]",
    );
  });

  it("mandatory rows do not spend the evidence budget", () => {
    /*
     * Sharing one budget would make this change actively harmful: eight pinned
     * Daily Stats chunks plus the employee framework's out of twelve slots
     * would leave almost nothing for the policy manuals that OUTRANK both.
     */
    const assembled = groundFor("What should I coach today?");
    expect(assembled.retrievedCount).toBe(RETRIEVAL.contextChunks);
    expect(assembled.rows.length).toBe(assembled.mandatoryCount + RETRIEVAL.contextChunks);
  });

  it("suppresses retrieval only of the documents that actually pinned rows", () => {
    /*
     * Per document rather than one flag, and that distinction is what a second
     * role broke. A role whose locators matched nothing must KEEP its retrieved
     * rows — otherwise the framework leaves the answer entirely, which is the
     * failure this whole feature exists to prevent.
     */
    const withDailyRetrieved: MatchedChunkRow[] = [
      {
        chunk_id: "daily-retrieved",
        document_id: DAILY_DOC.id,
        document_title: DAILY_DOC.title,
        category: "leadership_coaching",
        locator: "SECTION 3 - METRIC TO COACHING TRANSLATION GUIDE",
        page: null,
        section: null,
        content: "translation guide",
        similarity: 0.94,
      },
      ...RETRIEVED_NO_DAILY,
    ];

    // Locators matched nothing: the framework must survive via retrieval.
    const orphaned = assembleGrounding({
      mandatory: [],
      retrieved: withDailyRetrieved,
      roleDocumentIds: [DAILY_DOC.id],
      evidenceBudget: RETRIEVAL.contextChunks,
    });
    expect(dailyRowsIn(orphaned.rows).length).toBeGreaterThan(0);

    // Pinned: retrieval stops repeating it and hands those slots to manuals.
    const pinned = assembleGrounding({
      mandatory: pinnedRows(
        DAILY_STATS_INTERPRETATION_FRAMEWORK,
        DAILY_DOC,
        DAILY_CHUNKS,
      ),
      retrieved: withDailyRetrieved,
      roleDocumentIds: [DAILY_DOC.id],
      evidenceBudget: RETRIEVAL.contextChunks,
    });
    expect(
      pinned.rows.filter(
        (row) => row.document_id === DAILY_DOC.id && row.similarity > 0,
      ),
    ).toEqual([]);
  });
});

/* ================================================== the document's role == */

describe("the framework is identified durably, and the operator is told how", () => {
  it("resolves by its tag when the corpus carries one", () => {
    const tagged = {
      ...DAILY_DOC,
      original_filename: "renamed.docx",
      title: "Renamed",
      tags: ["daily-stats-interpretation-framework"],
    };
    const resolved = resolveRoleDocument(
      [...OTHER_DOCS, tagged],
      DAILY_STATS_INTERPRETATION_FRAMEWORK,
    );
    expect(resolved?.matchedBy).toBe("tag");
    expect(hasRoleTag(tagged, DAILY_STATS_INTERPRETATION_FRAMEWORK)).toBe(true);
  });

  it("resolves by filename or title while nobody has tagged it", () => {
    /*
     * The fallback exists because relying on the tag alone would ship a
     * mandatory safety guard that silently does nothing until somebody
     * remembers to tag a document.
     */
    const byFilename = resolveRoleDocument(
      [...OTHER_DOCS, DAILY_DOC],
      DAILY_STATS_INTERPRETATION_FRAMEWORK,
    );
    expect(byFilename?.matchedBy).toBe("fallback");
    expect(byFilename?.document.id).toBe(DAILY_DOC.id);

    const byTitle = resolveRoleDocument(
      [{ ...DAILY_DOC, original_filename: "whatever.docx" }],
      DAILY_STATS_INTERPRETATION_FRAMEWORK,
    );
    expect(byTitle?.matchedBy).toBe("fallback");
  });

  it("accepts the spellings the upload actually produces", () => {
    for (const title of [
      "ASK SUNNY DAILY STATS INTERPRETATION FRAMEWORK",
      "ASK SUNNY Daily Stats Interpretation Framework",
      "Daily Stats Interpretation Framework",
    ]) {
      expect(
        resolveRoleDocument(
          [{ ...DAILY_DOC, original_filename: "x.docx", title }],
          DAILY_STATS_INTERPRETATION_FRAMEWORK,
        ),
      ).not.toBeNull();
    }
  });

  it("does not confuse the two frameworks for each other", () => {
    expect(
      resolveRoleDocument([EMPLOYEE_DOC], DAILY_STATS_INTERPRETATION_FRAMEWORK),
    ).toBeNull();
    expect(resolveRoleDocument([DAILY_DOC], EMPLOYEE_PERFORMANCE_FRAMEWORK)).toBeNull();
  });

  it("tells the operator how to make the marker durable", () => {
    expect(roleTagAdvice(DAILY_STATS_INTERPRETATION_FRAMEWORK)).toContain(
      "daily-stats-interpretation-framework",
    );
  });

  it("is registered, so anything walking the roles finds it", () => {
    expect(KNOWLEDGE_DOCUMENT_ROLES).toContain(DAILY_STATS_INTERPRETATION_FRAMEWORK);
    expect(KNOWLEDGE_DOCUMENT_ROLES).toContain(EMPLOYEE_PERFORMANCE_FRAMEWORK);
    expect(new Set(KNOWLEDGE_DOCUMENT_ROLES.map((role) => role.id)).size).toBe(
      KNOWLEDGE_DOCUMENT_ROLES.length,
    );
  });

  it("pins real chunks, so the framework is citable and openable", () => {
    /*
     * A pinned chunk is a real `knowledge_chunks` row, so it carries its own
     * document id, title and locator and reaches `rowToCitation` — a manager
     * clicking the source card lands on the real Knowledge Base document.
     */
    const row = pinnedRows(
      DAILY_STATS_INTERPRETATION_FRAMEWORK,
      DAILY_DOC,
      DAILY_CHUNKS,
    )[0];
    expect(row.document_id).toBe(DAILY_DOC.id);
    expect(row.document_title).toBe(DAILY_DOC.title);
    expect(row.locator).toBe("ASK SUNNY OPERATING RULES FOR DAILY STATS");
    // Never measured, so never claimed: a high number here would put
    // fabricated confidence on a source card.
    expect(row.similarity).toBe(0);
  });
});

/* ================================================== G. examples are not facts == */

describe("G. the framework's examples never become current facts", () => {
  it("says so, in the words the model reads", () => {
    const prompt = promptFor({ hasDailyStatsFramework: true, hasReportData: true });
    expect(prompt).toContain("ITS EXAMPLES ARE NOT MEASUREMENTS");
    expect(prompt).toContain("teaching pattern");
    expect(prompt).toContain("Never repeat one as a current fact");
    expect(prompt).toContain(
      "never let one stand in for a figure the report data does not carry",
    );
  });

  it("names where current facts may come from, and nowhere else", () => {
    expect(DAILY_STATS_RULES).toContain(
      "CURRENT FACTS COME ONLY FROM THE REPORT DATA SECTION",
    );
    expect(DAILY_STATS_RULES).toContain("Nowhere else.");
  });

  it("puts policy above the framework, and the framework above its examples", () => {
    expect(DAILY_STATS_RULES).toContain("THE ORDER OF AUTHORITY, HIGHEST FIRST");
    const order = [
      "Current official Sun Tan City policy",
      "The current ingested report data",
      "The Daily Stats Interpretation Framework's reasoning",
      "Its historical examples and patterns",
    ];
    const prompt = promptFor({ hasDailyStatsFramework: true });
    let last = -1;
    for (const entry of order) {
      const at = prompt.indexOf(entry);
      expect(at, entry).toBeGreaterThan(last);
      last = at;
    }
    expect(DAILY_STATS_RULES).toContain("WHERE POLICY AND THE FRAMEWORK CONFLICT, POLICY WINS");
  });

  it("bars reasoning from measures the reports do not carry", () => {
    /*
     * THE GAP THAT PRODUCES A CONFIDENT WRONG ANSWER. The framework discusses
     * employee-level productivity, coupons, drawer reconciliation, breaks,
     * inventory variance and labour hours at length. The five ingested reports
     * carry none of them.
     */
    for (const absent of [
      "employee-level productivity",
      "coupon and discount detail",
      "drawer reconciliation",
      "break records",
      "inventory variance",
      "labour hours",
    ]) {
      expect(DAILY_STATS_RULES).toContain(absent);
    }
    expect(DAILY_STATS_RULES).toContain("REASON ONLY FROM MEASURES THAT ARE ACTUALLY PRESENT");
    expect(DAILY_STATS_RULES).toContain("Say which report would carry it");
  });

  it("describes itself as reasoning rather than evidence", () => {
    expect(DAILY_STATS_RULES).toContain("IT IS REASONING, NOT EVIDENCE");
    expect(DAILY_STATS_RULES).toContain("no facts about the current period");
  });
});

/* ================================================== the reasoning contract == */

describe("the prioritisation contract reaches the prompt", () => {
  it("forbids simply naming the lowest number", () => {
    expect(DAILY_STATS_RULES).toContain("DO NOT SIMPLY NAME THE LOWEST NUMBER");
    expect(DAILY_STATS_RULES).toContain("Weigh revenue impact, opportunity volume");
    expect(DAILY_STATS_RULES).toContain(
      "A moderate gap on high traffic usually beats a bad number on almost no traffic",
    );
  });

  it("requires a behaviour, not just a number", () => {
    expect(DAILY_STATS_RULES).toContain("A metric is a signal, not a finding");
    expect(DAILY_STATS_RULES).toContain('"improve PPTA" is not a behaviour');
  });

  it("keeps coaching and compliance apart", () => {
    expect(DAILY_STATS_RULES).toContain(
      "Separate coaching from operational and compliance follow-up",
    );
  });

  it("bars inferring character from a metric", () => {
    expect(DAILY_STATS_RULES).toContain(
      "Never infer attitude, effort, character or laziness from a metric",
    );
  });

  it("E. makes recognition half the job", () => {
    expect(DAILY_STATS_RULES).toContain("Recognition is half the job");
    expect(MANAGER_ANSWER_SHAPE).toContain("WHAT LOOKS STRONG");
    expect(MANAGER_ANSWER_SHAPE).toContain(
      "If nothing does, say so rather than manufacturing a compliment",
    );
  });
});

/* ================================================== the answer shape == */

describe("the default manager answer shape", () => {
  it("arrives when there is data to read", () => {
    const prompt = promptFor({ hasDailyStatsFramework: true, hasReportData: true });
    expect(prompt).toContain(MANAGER_ANSWER_SHAPE);
  });

  it("does NOT arrive with no figures, because five headings over nothing is not an answer", () => {
    const prompt = promptFor({ hasDailyStatsFramework: true, hasReportData: false });
    expect(prompt).toContain(DAILY_STATS_RULES.slice(0, 60));
    expect(prompt).not.toContain(MANAGER_ANSWER_SHAPE);
  });

  it("asks for the five parts, in order", () => {
    const order = [
      "1. OVERALL READ",
      "2. WHAT LOOKS STRONG",
      "3. TOP 3 PRIORITIES",
      "4. OPERATIONAL FOLLOW-UP",
      "5. SHORT TEAM MESSAGE",
    ];
    let last = -1;
    for (const heading of order) {
      const at = MANAGER_ANSWER_SHAPE.indexOf(heading);
      expect(at, heading).toBeGreaterThan(last);
      last = at;
    }
  });

  it("asks each priority for the whole chain from signal to follow-up", () => {
    for (const part of [
      "the signal (the measure and what it did, with its report and period)",
      "why it matters",
      "the likely behaviour or operational cause",
      "what to coach or inspect today",
      "a role-play, where one would help",
      "the follow-up: what to check, and when",
    ]) {
      expect(MANAGER_ANSWER_SHAPE).toContain(part);
    }
  });

  it("stops the metric dump, which is the failure it replaces", () => {
    expect(MANAGER_ANSWER_SHAPE).toContain("DO NOT DUMP EVERY METRIC");
    expect(MANAGER_ANSWER_SHAPE).toContain("Three priorities, chosen for impact");
  });

  it("bars an operational check the reports cannot support", () => {
    expect(MANAGER_ANSWER_SHAPE).toContain(
      "Never list an operational check the reports do not cover",
    );
  });

  it("asks for a behaviour-based team message, not a slogan", () => {
    expect(MANAGER_ANSWER_SHAPE).toContain('not "let\'s get Spa up"');
  });
});

/* ================================================== F. the no-data instruction == */

describe("F. a report that is not loaded is stated, not filled in", () => {
  it("adds the instruction when a requested family had no delivery", () => {
    const prompt = promptFor({ hasReportData: true, hasMissingReports: true });
    expect(prompt).toContain("ONE OR MORE REPORTS THIS QUESTION NEEDS IS NOT LOADED");
    expect(prompt).toContain("I don't have a current Spa Wellness delivery");
    expect(prompt).toContain("Never estimate the missing figures");
    expect(prompt).toContain("never use an example or historical figure");
  });

  it("omits it when everything loaded", () => {
    const prompt = promptFor({ hasReportData: true, hasMissingReports: false });
    expect(prompt).not.toContain("IS NOT LOADED");
  });

  it("still refuses figures from memory when NO report is attached at all", () => {
    const prompt = promptFor({ hasReportData: false });
    expect(prompt).toContain("You have NO report figures for this question");
    expect(prompt).toContain("Do not state a tans count");
  });
});

/* ================================================== the two rule blocks == */

describe("each framework's rules arrive only with that framework", () => {
  it("states the Daily Stats rules only when it was pinned", () => {
    expect(promptFor({ hasDailyStatsFramework: true })).toContain("DAILY OPERATIONAL INTERPRETATION");
    expect(promptFor({ hasDailyStatsFramework: false })).not.toContain(
      "DAILY OPERATIONAL INTERPRETATION",
    );
  });

  it("states the Employee Performance rules only when THAT was pinned", () => {
    /*
     * The distinction a single flag would have destroyed. Telling the model
     * "one of the numbered sources is the Employee Performance Framework" on a
     * turn that pinned only the Daily Stats one describes a source that is not
     * there, and a model given rules for an absent source picks the nearest
     * thing and follows them.
     */
    const dailyOnly = promptFor({ hasDailyStatsFramework: true, hasFrameworkGrounding: false });
    expect(dailyOnly).not.toContain("EMPLOYEE PERFORMANCE — HOW TO USE THE FRAMEWORK");
    expect(dailyOnly).not.toContain("Never recommend discipline");

    const both = promptFor({ hasDailyStatsFramework: true, hasFrameworkGrounding: true });
    expect(both).toContain("EMPLOYEE PERFORMANCE — HOW TO USE THE FRAMEWORK");
    expect(both).toContain("DAILY OPERATIONAL INTERPRETATION");
  });

  it("keeps the employee framework's escalation limits intact", () => {
    // Unchanged by this work, and asserted here because both frameworks now
    // travel together on a coaching question.
    expect(EMPLOYEE_PERFORMANCE_RULES).toContain(
      "Never recommend discipline, an EPP, a DPOA, a suspension or a termination on the strength of numbers alone",
    );
  });

  it("substitutes the brand into both", () => {
    const prompt = promptFor({ hasDailyStatsFramework: true, hasFrameworkGrounding: true });
    expect(prompt).not.toContain("{{BRAND}}");
    expect(prompt).toContain("Current official Sun Tan City policy");
  });
});

/* ================================================== H, I, J. the wiring == */

describe("H. the pipeline reloads server-authoritative data for a report context", () => {
  const SERVER_ASK = readFileSync("src/lib/ai/server-ask.ts", "utf8");
  const CHAT_ROUTE = readFileSync("src/app/api/chat/route.ts", "utf8");
  const CONTEXT_MODULE = readFileSync(
    "src/lib/reporting/read/chat-report-context.ts",
    "utf8",
  );

  it("bounds the context at the route and takes only pointers", () => {
    expect(CHAT_ROUTE).toContain("parseChatReportContext(body.reportContext)");
  });

  it("has no field through which a figure could travel", () => {
    /*
     * Structural, not a convention. The screen renders numbers and a screen is
     * not evidence about money — a stale render, an edited DOM and a replayed
     * response all look identical.
     */
    const fields = CONTEXT_MODULE.slice(
      CONTEXT_MODULE.indexOf("export interface ChatReportContext"),
      CONTEXT_MODULE.indexOf("/** A bounded, trimmed token"),
    );
    for (const word of ["value", "figure", "total", "amount", "rate", "count"]) {
      expect(fields, `a pointer type must not carry a "${word}" field`).not.toContain(
        `readonly ${word}:`,
      );
    }
    expect(fields).toContain("readonly family:");
    expect(fields).toContain("readonly period:");
  });

  it("adds the context's family to the routed ones, so a follow-up keeps its report", () => {
    expect(SERVER_ASK).toContain("const contextFamily = request.reportContext?.family ?? null");
    expect(SERVER_ASK).toContain("[contextFamily, ...routedFamilies]");
  });

  it("hands the context to the loader, which re-reads the rows", () => {
    expect(SERVER_ASK).toContain("context: request.reportContext ?? null");
  });
});

describe("I. a follow-up keeps the conversation's report without keeping its figures", () => {
  const CHAT_SCREEN = readFileSync("src/features/chat/chat-screen.tsx", "utf8");

  it("sends the context on every turn, not only the first", () => {
    /*
     * "Why is #1 the biggest problem?" names no report and no metric, and the
     * server's routing reads the question's own words by design. Without this
     * the second question in a report conversation loses the report.
     */
    expect(CHAT_SCREEN).toContain("reportContext,");
    expect(CHAT_SCREEN).toContain("chatReportContextFromParams");
  });

  it("keeps the context in the URL, so it survives a refresh and a shared link", () => {
    expect(CHAT_SCREEN).toContain("searchParams.toString()");
  });

  it("still opens the interpretation gate on a bare follow-up's own words", () => {
    // The framework stays present across a coaching conversation because each
    // turn earns it, not because a flag was set on the first one.
    for (const followUp of [
      "Why is #1 the biggest problem?",
      "Give me a role-play for that.",
      "What should I inspect?",
      "How do I follow up?",
    ]) {
      expect(isDailyStatsQuestion(followUp), followUp).toBe(true);
    }
  });
});

describe("J. asking for a coaching form hands off to the existing Coaching workflow", () => {
  it("routes a coaching-form request to the coaching template, not to a new flow", () => {
    /*
     * NO SECOND FORM FLOW. `proposeFormForTurn` runs before the knowledge and
     * report path in `answerQuestion` and returns early, so this reaches the
     * published Coaching template with its version and audit trail rather than
     * a chat message shaped like a form.
     */
    for (const request of [
      "Create a coaching form for that.",
      "create a coaching form for Sarah",
      "draft a documented coaching",
    ]) {
      expect(detectTemplateIntent(request), request).toEqual({
        kind: "explicit",
        templateKey: "coaching",
      });
    }
  });

  it("leaves a coaching QUESTION as a knowledge question", () => {
    expect(detectTemplateIntent("How do I coach someone on tardiness?").kind).toBe("none");
  });

  it("proposes before it retrieves, so the form path is not reached through the report path", () => {
    const SERVER_ASK = readFileSync("src/lib/ai/server-ask.ts", "utf8");
    expect(SERVER_ASK.indexOf("proposeFormForTurn")).toBeLessThan(
      SERVER_ASK.indexOf("routeReportFamilies"),
    );
    expect(SERVER_ASK).toContain("if (proposal) return proposal;");
  });

  it("keeps Sunny from writing a facsimile of a form instead", () => {
    expect(promptFor({ hasDailyStatsFramework: true })).toContain(
      "NEVER WRITE A FACSIMILE OF A COMPANY FORM",
    );
  });
});

describe("the Bonus Viewer is not wired as a data source", () => {
  it("is not a report family, because it has no ingested delivery", () => {
    /*
     * Its framework may sit in the Knowledge Base and is reachable by ordinary
     * retrieval. Giving it a report family would create one whose loader could
     * only ever return nothing, and a "no current delivery" message for a
     * report nobody sends.
     */
    expect(routeReportFamilies("analyse this bonus viewer")).toEqual([]);
    const FAMILIES = readFileSync("src/lib/reporting/read/report-families.ts", "utf8");
    expect(FAMILIES).not.toContain('"bonus-viewer"');
  });

  it("is not a mandatory document role", () => {
    expect(KNOWLEDGE_DOCUMENT_ROLES.map((role) => role.id)).toEqual([
      "employee_performance_framework",
      "daily_stats_interpretation_framework",
    ]);
  });
});
