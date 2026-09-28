import { beforeEach, describe, expect, it, vi } from "vitest";

import { JBA_MANUAL_CHUNKS, JBA_MANUAL_DOCUMENT } from "./__fixtures__/jba-policy-manual";

/**
 * ============================================================================
 * THE JBA POLICY MANUAL, AT RUNTIME
 * ============================================================================
 *
 * The vector search is replaced by what it ACTUALLY RETURNED in the live app
 * for each question — the rows the failed answers cited — so each test starts
 * from the real failure and asserts on what the model is sent:
 *
 *   SMOKING      retrieval already finds Smoking/Vaping, page 12. The manual is
 *                not named, so nothing is pinned and nothing changes.
 *
 *   OVERVIEW     retrieval found the cover, the introduction, one contents
 *                chunk and three scattered pages. The complete table of
 *                contents is now pinned, and the model is told it is complete.
 *
 *   ATTENDANCE   retrieval found the title page, the introduction, page 29 and
 *                the Salon Coaching Guide. The Attendance section, page 14, is
 *                now pinned and cited.
 */

const state = vi.hoisted(() => ({
  claudeInput: null as Record<string, unknown> | null,
  answer: "An answer citing [S1].",
  retrieved: [] as unknown[],
  manual: null as unknown,
  manualCalls: 0,
}));

vi.mock("@/lib/config/server-env", () => ({
  liveReadiness: () => ({ mode: "live", missing: [], problems: [], ready: true }),
  MissingConfigurationError: class MissingConfigurationError extends Error {
    missing: string[] = [];
  },
}));

vi.mock("./form-proposal", () => ({
  proposeFormForTurn: async () => null,
  suggestFormsForTurn: () => null,
}));

vi.mock("@/lib/forms/repository", () => ({
  listTemplateSummaries: async () => [],
}));

vi.mock("@/lib/knowledge/providers/supabase", () => ({
  SupabaseKnowledgeProvider: class {
    readonly name = "test double";
    async match() {
      return state.retrieved;
    }
    async fetchRoleGrounding() {
      return null;
    }
    async fetchOfficialPolicyManual() {
      state.manualCalls += 1;
      return state.manual;
    }
  },
}));

vi.mock("@/lib/reporting/read/report-briefing", () => ({
  loadReportBriefing: async () => null,
}));

vi.mock("@/lib/reporting/read/employee-facts", () => ({
  loadEmployeeFacts: async () => ({ available: false, block: null, reason: "no dataset" }),
  NO_EMPLOYEE_DATASET_REASON: "no dataset",
  EMPLOYEE_DATA_HEADING: "CURRENT EMPLOYEE PERFORMANCE DATA",
}));

vi.mock("./call-claude", () => ({
  callClaude: async (input: Record<string, unknown>) => {
    state.claudeInput = input;
    return state.answer;
  },
}));

/* ------------------------------------------------------------- fixtures -- */

const OVERVIEW =
  "What policies and topics are in the JBA Policy Manual? Give me an overview of its main sections, with citations from the manual.";
const ATTENDANCE =
  "In the JBA Policy Manual Edited 5.2025, what does the attendance or tardiness policy say? Cite the section and page.";

/** A manual chunk as the vector search returns it, with its live similarity. */
function manualHit(index: number, similarity: number) {
  const chunk = JBA_MANUAL_CHUNKS.find((entry) => entry.chunkIndex === index)!;
  return {
    chunk_id: chunk.chunkId,
    document_id: JBA_MANUAL_DOCUMENT.id,
    document_title: JBA_MANUAL_DOCUMENT.title,
    category: JBA_MANUAL_DOCUMENT.category,
    locator: chunk.locator,
    page: chunk.page,
    section: chunk.section,
    content: chunk.content,
    similarity,
  };
}

function coachingGuideHit(id: string, locator: string, content: string, similarity: number) {
  return {
    chunk_id: id,
    document_id: "cda320df-9530-40b6-ba24-c7723d009240",
    document_title: "Sun Tan City Salon Coaching Guide",
    category: "leadership_coaching",
    locator,
    page: null,
    section: null,
    content,
    similarity,
  };
}

/** What "what's the smoking policy?" retrieved: the Smoking/Vaping chunk. */
const SMOKING_RETRIEVAL = [manualHit(27, 0.86), manualHit(25, 0.84)];

/** What the overview question retrieved in the live app. */
const OVERVIEW_RETRIEVAL = [
  manualHit(0, 0.849),
  manualHit(1, 0.848),
  manualHit(109, 0.834),
  manualHit(64, 0.831),
  manualHit(46, 0.829),
  manualHit(2, 0.825),
];

/** What the attendance question retrieved in the live app. */
const ATTENDANCE_RETRIEVAL = [
  coachingGuideHit("scg-21", "Page 21", "Attendance (No-Call No-Show / Excessive Absences) ...", 0.869),
  manualHit(0, 0.865),
  coachingGuideHit("scg-20", "Page 20", "Lateness continues despite the written plan ...", 0.861),
  manualHit(1, 0.857),
  manualHit(64, 0.855),
  coachingGuideHit("scg-19", "Page 19", "Tardiness\nUnder Performance ...", 0.85),
];

function manualLookup() {
  return {
    ok: true as const,
    documentId: JBA_MANUAL_DOCUMENT.id,
    documentTitle: JBA_MANUAL_DOCUMENT.title,
    documentCategory: JBA_MANUAL_DOCUMENT.category,
    matchedBy: "fallback" as const,
    chunks: JBA_MANUAL_CHUNKS,
  };
}

async function ask(question: string) {
  const { answerQuestion } = await import("./server-ask");
  return answerQuestion(
    {
      question,
      mode: "standard",
      history: [],
      scopeId: "stc-core",
      context: { userName: "Dana Reyes", locationName: "MO Kansas City Wornall", todayIso: "2026-09-28" },
    } as never,
    {
      role: "salon_director" as never,
      scope: { level: "salon", primaryAreaId: "loc-0101", alsoCoversAreaIds: [] },
    },
  );
}

const grounding = () => String(state.claudeInput?.grounding ?? "");
const system = () => String(state.claudeInput?.system ?? "");

/** The `[S<n>] title — locator` lines, in marker order. */
function sourceLines(): string[] {
  return [...grounding().matchAll(/^\[S(\d+)\] (.+)$/gm)].map((match) => `S${match[1]} ${match[2]}`);
}

beforeEach(() => {
  vi.resetModules();
  state.claudeInput = null;
  state.answer = "An answer citing [S1].";
  state.retrieved = [];
  state.manual = manualLookup();
  state.manualCalls = 0;
});

/* ======================================================= 1. smoking works */

describe("1. the smoking questions that already worked are unchanged", () => {
  it.each(["what's the smoking policy?", "Does JCB policy have the smoking policy?"])(
    "%s — no manual lookup, the same sources, a page 12 citation",
    async (question) => {
      state.retrieved = SMOKING_RETRIEVAL;
      state.answer = "Smoking and vaping are not permitted at any location [S1].";

      const answer = await ask(question);

      expect(state.manualCalls).toBe(0);
      expect(sourceLines()).toEqual([
        "S1 JBA Policy Manual Edited 5.2025 — Page 12 — Smoking/Vaping",
        "S2 JBA Policy Manual Edited 5.2025 — Page 11 — Drug, Alcohol and Smoking Policy",
      ]);
      expect(system()).not.toContain("TABLE OF CONTENTS IS INCLUDED");
      expect(system()).not.toContain("SECTIONS READ FOR THIS QUESTION");
      expect(answer.citations).toEqual([
        expect.objectContaining({
          documentTitle: "JBA Policy Manual Edited 5.2025",
          locator: "Page 12 — Smoking/Vaping",
        }),
      ]);
    },
  );
});

/* ======================================================= 2. overview */

describe("2. the whole-manual overview is built from the complete table of contents", () => {
  beforeEach(() => {
    state.retrieved = OVERVIEW_RETRIEVAL;
  });

  it("pins all fifteen contents chunks ahead of the retrieved ones", async () => {
    await ask(OVERVIEW);

    const lines = sourceLines();
    const contents = lines.slice(0, 15);
    expect(contents[0]).toBe("S1 JBA Policy Manual Edited 5.2025 — Page 2 — Table of Contents");
    expect(contents.every((line) => /— Page [2-5]$|Table of Contents$/.test(line))).toBe(true);
    // Every contents chunk once, including the one retrieval also found.
    expect(grounding().match(/— Page 2 — Table of Contents/g)).toHaveLength(1);
    // The retrieved rows still follow.
    expect(lines.slice(15)).toContain("S16 JBA Policy Manual Edited 5.2025 — Page 1");
  });

  it("tells the model the contents are complete, by the markers they landed on", async () => {
    await ask(OVERVIEW);

    const markers = Array.from({ length: 15 }, (_, index) => `[S${index + 1}]`).join(", ");
    expect(system()).toContain("ITS COMPLETE TABLE OF CONTENTS IS INCLUDED");
    expect(system()).toContain(`Sources ${markers} are the complete table of contents`);
    expect(system()).toContain("never call it missing, unavailable or not covered");
  });

  it("cites the manual's contents pages, built from the pinned rows", async () => {
    state.answer = "The manual opens with the Reference List and Core Values [S1], and ends with the client tanning policies [S15].";

    const answer = await ask(OVERVIEW);

    expect(answer.citations.map((citation) => citation.locator)).toEqual([
      "Page 2 — Table of Contents",
      "Page 5",
    ]);
    expect(answer.coverage).toBe("grounded");
  });
});

/* ======================================================= 3. attendance */

describe("3. the attendance question is answered from the manual's Attendance section", () => {
  beforeEach(() => {
    state.retrieved = ATTENDANCE_RETRIEVAL;
  });

  it("puts Attendance, page 14 first, and the coaching guide after it", async () => {
    await ask(ATTENDANCE);

    const lines = sourceLines();
    expect(lines[0]).toBe("S1 JBA Policy Manual Edited 5.2025 — Page 14 — Attendance");
    expect(lines[1]).toBe("S2 JBA Policy Manual Edited 5.2025 — Page 37 — Shift Replacement");
    expect(grounding()).toContain("If an employee is going to be tardy or absent");
    // Retrieval is left standing, not replaced.
    expect(lines.some((line) => line.includes("Sun Tan City Salon Coaching Guide"))).toBe(true);
  });

  it("names the matched section and page, and keeps the coaching guide apart", async () => {
    await ask(ATTENDANCE);

    expect(system()).toContain("Attendance (page 14)");
    expect(system()).toContain("They are sources [S1], [S2]");
    expect(system()).toContain("never present it as the manual's policy");
  });

  it("cites Attendance, page 14 of the JBA manual", async () => {
    state.answer =
      "Each employee must know their schedule and always be on time, and must call their manager at least 2 hours before a shift they will be late for [S1].";

    const answer = await ask(ATTENDANCE);

    expect(answer.citations).toEqual([
      expect.objectContaining({
        documentId: JBA_MANUAL_DOCUMENT.id,
        documentTitle: "JBA Policy Manual Edited 5.2025",
        locator: "Page 14 — Attendance",
      }),
    ]);
  });
});

/* ======================================================= 4. degrading */

describe("4. a manual that cannot be read leaves ordinary retrieval standing", () => {
  it("adds nothing and claims nothing", async () => {
    state.retrieved = OVERVIEW_RETRIEVAL;
    state.manual = { ok: false, reason: "The official policy manual could not be looked up." };

    await ask(OVERVIEW);

    expect(state.manualCalls).toBe(1);
    expect(sourceLines()).toHaveLength(OVERVIEW_RETRIEVAL.length);
    expect(system()).not.toContain("TABLE OF CONTENTS IS INCLUDED");
  });
});
