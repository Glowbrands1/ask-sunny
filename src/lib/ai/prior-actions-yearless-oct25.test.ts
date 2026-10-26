import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { DirectoryFact } from "@/lib/forms/employee-roster";
import { blankYearlessStepDates } from "@/lib/forms/form-date-answer";
import { correctiveActionDocument } from "@/lib/forms/library";
import { statedPriorActions } from "@/lib/forms/prior-actions";
import { continuationFor } from "@/lib/forms/proposal-continuation";
import { JBA_MANUAL_CHUNKS, JBA_MANUAL_DOCUMENT } from "@/lib/ai/__fixtures__/jba-policy-manual";
import { fieldLines } from "./intake-augment";
import type { AccessScope, ChatMessage } from "@/types";

/**
 * ============================================================================
 * QA, 25 OCT 2026 — "SHE WAS COACHED ON 9-15" IS A PRIOR ACTION, NOT THE DATE
 * ============================================================================
 *
 * conv_mvnoiw8n2kfbcvc (Ask Sunny production, flags as live), the manager's
 * turn word for word ("Test Employee" is the QA account's own placeholder):
 *
 *   "create a verbal CA for Test Employee at NE Kearney for being late to open
 *    on 10-20, she was coached on 9-15 for being late, no payroll"
 *
 * Live, the card was dated 9/15/2026 (the coaching) and had no "Prior
 * actions" line. A dashed date needs a year to be read (`DATE_IN_TEXT`), so the
 * coaching was no earlier step, and the intake's yearless reader took the last
 * "on 9-15" as the incident. With PRIOR_ACTIONS_PARSE_ENABLED the earlier-step
 * reader reads a yearless "9-15" and keeps it off the form: the card is dated
 * 10/20 and lists "Coaching for being late — 09/15/2026" (QA decision, 25 Oct
 * 2026: the line holds no word the manager did not say; "signed" appears only
 * when they write it, and this manager did not).
 * LATE_OPEN_DATE_ENABLED alone does not cover it (still 9/15 without a model
 * reading, and never a prior action).
 *
 * Through `answerQuestion` with this app's production flag profile (intent
 * extraction on, CODE_SLOTS and FORM_FULL_REMAP unset). A coaching the manager
 * says they held ("I coached her on 10-16") is read as before.
 */

const TODAY = "2026-10-25";

const FLAGS = [
  "INTENT_EXTRACTION_ENABLED",
  "QUERY_REWRITE_ENABLED",
  "GROUNDED_ENTITIES_ENABLED",
  "TYPED_NAME_PROCEEDS_ENABLED",
  "FEWSHOT_EXAMPLES_ENABLED",
  "SLOT_RETENTION_ENABLED",
  "FIELD_ACCURACY_ENABLED",
  "LONG_CONTEXT_ENABLED",
  "POLICY_CITATION_ENABLED",
  "SECOND_FORM_ENABLED",
  "GLOBAL_SALON_ASK_ENABLED",
  "DRAFT_MERGE_ENABLED",
  "FULL_MANUAL_CONTEXT_ENABLED",
] as const;

const UNSET = [
  "CODE_SLOTS_ENABLED",
  "FORM_STATE_ENABLED",
  "FORM_FULL_REMAP_ENABLED",
  "MANAGER_WORDS_ONLY_ENABLED",
  "CHAT_MEMORY_ENABLED",
  "SELF_CHECK_ENABLED",
  "ATTENDANCE_POLICY_CITATION_ENABLED",
  "POLICY_PAGE_REQUIRED_ENABLED",
  "INTENT_PAYROLL_MANAGER_ONLY_ENABLED",
  "CHAT_DATA_TOOLS_ENABLED",
] as const;

const stateBag = vi.hoisted(() => ({ forms: new Map<string, unknown>() }));

/** What the intent model copies from the manager's words. Nothing is guessed. */
const intentModel = vi.hoisted(() => ({
  reading: null as null | ((manager: string) => Record<string, unknown>),
}));

const PEOPLE: DirectoryFact[] = [
  {
    id: "wren",
    firstName: "Wren",
    lastName: "Halvorsen",
    preferredFirstName: null,
    salonIds: ["loc-0309"],
    title: "Tanning Consultant",
    primarySalonId: "loc-0309",
    primaryLocationName: "NE Kearney",
  },
  {
    id: "test-employee",
    firstName: "Test",
    lastName: "Employee",
    preferredFirstName: null,
    salonIds: ["loc-0309"],
    title: "Tanning Consultant",
    primarySalonId: "loc-0309",
    primaryLocationName: "NE Kearney",
  },
];

function template(overrides: Record<string, unknown>) {
  return {
    id: "tpl",
    key: "coaching",
    name: "Coaching Form",
    shortName: "Coaching",
    description: "A coaching conversation.",
    category: "hr_performance",
    layoutFamily: "coaching",
    requiredPermission: "create_coaching_form",
    active: true,
    displayOrder: 1,
    currentVersion: { id: "v1", status: "published", variants: [] },
    draftVersion: null,
    versionCount: 1,
    activeAsset: null,
    assetCount: 0,
    ...overrides,
  };
}

const LIBRARY = [
  template({}),
  template({
    id: "tpl-dpoa",
    key: "dpoa",
    name: "Corrective Action Form",
    shortName: "CA",
    description: "A corrective action.",
    layoutFamily: "corrective",
    requiredPermission: "create_corrective_action",
    displayOrder: 2,
    currentVersion: { id: "v-dpoa", status: "published", document: correctiveActionDocument(), variants: [] },
  }),
];

vi.mock("@/lib/config/server-env", () => ({
  liveReadiness: () => ({ mode: "live", missing: [], problems: [], ready: true }),
  MissingConfigurationError: class MissingConfigurationError extends Error {
    missing: string[] = [];
  },
}));

vi.mock("@/lib/forms/employee-roster", () => ({
  readDirectoryFacts: async () => PEOPLE,
  loadScopedRoster: async () => PEOPLE,
  withRosterLimit: (_ids: readonly string[] | null, run: () => unknown) => run(),
}));

vi.mock("@/lib/forms/repository", () => ({
  listTemplateSummaries: async () => LIBRARY,
}));

vi.mock("@/lib/forms/prior-forms", () => ({
  priorFormsReadingForChat: async () => ({ attach: [], possible: [], identity: "none" }),
}));

vi.mock("./form-state-store", () => ({
  loadFormState: async (userId: string, conversationId: string) =>
    stateBag.forms.get(`${userId}:${conversationId}`) ?? null,
  saveFormState: async (userId: string, conversationId: string, state: unknown) => {
    stateBag.forms.set(`${userId}:${conversationId}`, state);
  },
}));

vi.mock("@/lib/knowledge/providers/supabase", () => ({
  SupabaseKnowledgeProvider: class {
    readonly name = "late-open";
    async match() {
      return [];
    }
    async search() {
      return [];
    }
    async fetchRoleGrounding() {
      return { ok: false, failure: { code: "missing", detail: "not used", missingGroups: [] } };
    }
    async fetchOfficialPolicyManual() {
      return {
        ok: true as const,
        documentId: JBA_MANUAL_DOCUMENT.id,
        documentTitle: JBA_MANUAL_DOCUMENT.title,
        documentCategory: "policies_compliance" as const,
        matchedBy: "fallback" as const,
        chunks: JBA_MANUAL_CHUNKS,
      };
    }
  },
}));

vi.mock("@/lib/reporting/read/report-briefing", () => ({ loadReportBriefing: async () => null }));

vi.mock("@/lib/reporting/read/employee-facts", () => ({
  loadEmployeeFacts: async () => null,
  NO_EMPLOYEE_DATASET_REASON: "no dataset",
  EMPLOYEE_DATA_HEADING: "CURRENT EMPLOYEE PERFORMANCE DATA",
}));

vi.mock("./call-claude", () => ({
  callClaude: async () => "An answer.",
  callClaudeTool: async (input: { tool?: { name?: string }; messages?: { content?: unknown }[] }) => {
    if (input.tool?.name !== "record_intent_slots") return null;
    const text = JSON.stringify(input.messages ?? []);
    const manager = (text.split("Manager:").pop() ?? text).replace(/\\n/g, "\n");
    return intentModel.reading ? intentModel.reading(manager) : null;
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({
    from() {
      const query = {
        select: () => query,
        eq: () => query,
        neq: () => query,
        is: () => query,
        in: () => query,
        gte: () => query,
        ilike: () => query,
        order: () => query,
        limit: () => query,
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
          Promise.resolve(resolve({ data: [], error: null })),
      };
      return query;
    },
  }),
}));

const SCOPE: AccessScope = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };

let answerQuestion: typeof import("./server-ask").answerQuestion;

// The app's whole chat path is imported once; under load that takes longer than the default hook timeout.
beforeAll(async () => {
  ({ answerQuestion } = await import("./server-ask"));
}, 60_000);

beforeEach(() => {
  stateBag.forms.clear();
  intentModel.reading = null;
  for (const name of FLAGS) vi.stubEnv(name, "1");
  for (const name of UNSET) vi.stubEnv(name, "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

type Answer = Awaited<ReturnType<typeof answerQuestion>>;

/** Each manager turn in order, with the replies the app gave as history. */
async function chat(turns: readonly string[], conversationId: string): Promise<Answer[]> {
  const history: ChatMessage[] = [];
  const answers: Answer[] = [];
  for (const [index, question] of turns.entries()) {
    const response = await answerQuestion(
      {
        question,
        mode: "standard",
        history: [...history],
        scopeId: "stc-core",
        questionMessageId: `msg-${conversationId}-${index}`,
        conversationId,
        continueProposalTemplateKey: continuationFor(history)?.templateKey,
        context: { userName: "Pat Manager", locationName: "All salons", todayIso: TODAY },
      },
      { role: "district_manager", scope: SCOPE, subject: "manager-late-open", verified: true },
      { memoryOwnerId: "manager-late-open" },
    );
    answers.push(response);
    history.push({ id: `u-${index}`, role: "user", content: question, createdAt: `${TODAY}T19:41:5${index}Z` });
    history.push({
      id: `a-${index}`,
      role: "assistant",
      content: response.content,
      createdAt: `${TODAY}T19:41:5${index}Z`,
      ...(response.formProposal ? { formProposal: response.formProposal } : {}),
    } as ChatMessage);
  }
  return answers;
}

/** A faithful copy of the manager's words: the date exactly as typed, no policy guessed. */
function copiesTheManager(manager: string): Record<string, unknown> {
  const date = /\b\d{1,2}[-/]\d{1,2}(?:[-/]\d{2,4})?\b/.exec(manager)?.[0] ?? null;
  return {
    employee: /test employee/i.test(manager) ? "Test Employee" : null,
    salon: /kearney/i.test(manager) ? "NE Kearney" : null,
    title: null,
    incidentType: /late to open/i.test(manager) ? "late to open" : null,
    incidentDate: date,
    payrollAmount: null,
    warningLevel: /\bverbal\b/i.test(manager) ? "verbal" : null,
    formType: /\bca\b/i.test(manager) ? "corrective action" : null,
    formTurn: /\bca\b/i.test(manager),
    policyHeading: null,
  };
}


const SAID =
  "create a verbal CA for Test Employee at NE Kearney for being late to open on 10-20, she was coached on 9-15 for being late, no payroll";

/** The "Prior actions" line the chat reads back, without its confirmation. */
function priorLine(content: string): string | null {
  const line = /\*\*Prior actions:\*\*\s*([^\n]+)/.exec(content)?.[1];
  return line ? line.replace(/, as you said\b.*$/, "") : null;
}

/** The model's reading as production stored it (chat_traces.slots: formDate null), or with a date it copied. */
const reading = (incidentDate: string | null) => (manager: string) => ({ ...copiesTheManager(manager), incidentDate });

describe("conv_mvnoiw8n2kfbcvc, word for word", () => {
  it.each([
    ["the model read no date, as live", reading(null)],
    ["the model copied 10-20", reading("10-20")],
    ["the model copied 9-15", reading("9-15")],
    ["no model reading at all", null],
  ] as const)("dated 10/20 with the 9/15 coaching as a prior action (%s)", async (_label, model) => {
    vi.stubEnv("PRIOR_ACTIONS_PARSE_ENABLED", "1");
    intentModel.reading = model;
    const [first] = await chat([SAID], `conv-yearless-${String(_label).length}`);
    const card = first!.formProposal!;
    expect(card, first!.content).toBeTruthy();
    expect(card.formDate).toBe("2026-10-20");
    expect(first!.content).toMatch(/\*\*Date:\*\* 10\/20\/2026/);
    // QA 25 Oct 2026: no "signed" — the manager never wrote it (see the header).
    expect(priorLine(first!.content)).toBe("Coaching for being late — 09/15/2026");
    expect(first!.content).not.toMatch(/Which date goes on the form\?|more than one date/i);
    expect(card.warningLevel).toBe("verbal");
    expect(card.payrollDeduct).toBe("no");
  });

  it("with the flag off it is dated 9/15 with no prior action, as live", async () => {
    vi.stubEnv("PRIOR_ACTIONS_PARSE_ENABLED", "");
    // Pinned to LATE_OPEN_DATE off, the profile this was recorded under; the env may set it. On: see the twin below.
    vi.stubEnv("LATE_OPEN_DATE_ENABLED", "");
    intentModel.reading = reading(null);
    const [first] = await chat([SAID], "conv-yearless-off");
    expect(first!.formProposal?.formDate).toBe("2026-09-15");
    expect(priorLine(first!.content)).toBeNull();
  });
});

describe("a coaching the manager held is read as before", () => {
  it.each([[""], ["1"]])('"I coached her on 10-16" dates the Coaching Form 10/16 (flag "%s")', async (flag) => {
    vi.stubEnv("PRIOR_ACTIONS_PARSE_ENABLED", flag);
    // Pinned to LATE_OPEN_DATE off; the env may set it. On, see "LATE_OPEN_DATE_FIX_ENABLED" below.
    vi.stubEnv("LATE_OPEN_DATE_ENABLED", "");
    intentModel.reading = (manager: string) => ({ ...copiesTheManager(manager), formType: "coaching", formTurn: true, incidentDate: null });
    const [first] = await chat(
      ["coaching form for Test Employee at NE Kearney, she was late on 10-5 and 10-15, I coached her on 10-16 about being late"],
      `conv-held-${flag}`,
    );
    expect(first!.formProposal?.templateKey).toBe("coaching");
    expect(first!.formProposal?.formDate).toBe("2026-10-16");
    expect(priorLine(first!.content)).toBeNull();
  });
});

/*
 * LATE_OPEN_DATE is on in production; the 9/15 pin above predates it. With it
 * on, "late to open on 10-20" is read as the incident's date, and 9/15 — a
 * coaching she was given — is not: the card is dated 10/20 whether or not the
 * earlier-step reader is on, and LATE_OPEN_DATE_FIX_ENABLED leaves that alone.
 */
describe("conv_mvnoiw8n2kfbcvc with LATE_OPEN_DATE_ENABLED on, as in production", () => {
  it.each([[""], ["1"]])("with the earlier-step flag off it is dated 10/20 (LATE_OPEN_DATE_FIX \"%s\")", async (fix) => {
    vi.stubEnv("LATE_OPEN_DATE_ENABLED", "1");
    vi.stubEnv("LATE_OPEN_DATE_FIX_ENABLED", fix);
    vi.stubEnv("PRIOR_ACTIONS_PARSE_ENABLED", "");
    intentModel.reading = reading(null);
    const [first] = await chat([SAID], `conv-yearless-lo-${fix}`);
    expect(first!.formProposal?.formDate).toBe("2026-10-20");
  });
});

/*
 * ============================================================================
 * LATE_OPEN_DATE_FIX_ENABLED (QA, 25 Oct 2026): "LATE ON 10-5" IS NO LATE
 * OPENING, AND THE COACHING SHE WAS GIVEN DATES THE COACHING FORM
 * ============================================================================
 *
 * With LATE_OPEN_DATE_ENABLED on (production), the Coaching Form above was
 * dated 10/5: the "on" in "she was late on 10-5" made 10-5 the one date the
 * turn stated (`newestStatedDate`), and it went on the form ahead of the
 * coaching the manager held. With the fix, a plain "late on <date>" is not
 * that date, and the held coaching is the Coaching Form's date. A late
 * OPENING ("late to open on 10-20") is still read. "Test Employee" is the QA
 * account's placeholder; every other name is invented.
 */
describe("LATE_OPEN_DATE_FIX_ENABLED, with LATE_OPEN_DATE_ENABLED on as in production", () => {
  const COACHING = "coaching form for Test Employee at NE Kearney, she was late on 10-5 and 10-15, I coached her on 10-16 about being late";
  const COACHING_SENTENCES = "Coaching form for Test Employee at NE Kearney. She was late on 10-5 and 10-15. I coached her on 10-16 about being late.";
  const coachingReading = (manager: string) => ({ ...copiesTheManager(manager), formType: "coaching", formTurn: true, incidentDate: null });

  async function coachingDate(words: string, id: string): Promise<string | null | undefined> {
    intentModel.reading = coachingReading;
    const [first] = await chat([words], id);
    expect(first!.formProposal?.templateKey).toBe("coaching");
    return first!.formProposal?.formDate;
  }

  async function caDate(words: string, id: string): Promise<string | null | undefined> {
    intentModel.reading = reading(null);
    const [first] = await chat([words], id);
    expect(first!.formProposal?.templateKey).toBe("dpoa");
    return first!.formProposal?.formDate;
  }

  beforeEach(() => {
    vi.stubEnv("LATE_OPEN_DATE_ENABLED", "1");
    vi.stubEnv("LATE_OPEN_DATE_FIX_ENABLED", "1");
  });

  it.each([
    ["lowercase", COACHING.toLowerCase()],
    ["as typed", COACHING],
    ["Sentence case", COACHING_SENTENCES],
  ])('"I coached her on 10-16" dates the Coaching Form 10/16 (%s)', async (label, words) => {
    for (const prior of ["", "1"]) {
      vi.stubEnv("PRIOR_ACTIONS_PARSE_ENABLED", prior);
      expect(await coachingDate(words, `conv-fix-${label}-${prior}`), `PRIOR_ACTIONS_PARSE "${prior}"`).toBe("2026-10-16");
    }
  });

  it.each([
    ["negation", "coaching form for Test Employee at NE Kearney, she was not late on 10-5, I coached her on 10-16"],
    ["negation, Sentence case", "Coaching form for Test Employee at NE Kearney. She was not late on 10-5. I coached her on 10-16."],
    ["another person", "coaching form for Test Employee at NE Kearney, Rowan Pell was late on 10-5, I coached Test Employee on 10-16"],
    ["another person, Sentence case", "Coaching form for Test Employee at NE Kearney. Rowan Pell was late on 10-5. I coached Test Employee on 10-16."],
  ])("probe, %s: the Coaching Form is dated 10/16", async (label, words) => {
    expect(await coachingDate(words, `conv-fix-probe-${label}`)).toBe("2026-10-16");
  });

  it.each([
    ["lowercase", "create a verbal ca for test employee at ne kearney, she was late to open on 10-5 and i coached her on 10-16"],
    ["Sentence case", "Create a verbal CA for Test Employee at NE Kearney. She was late to open on 10-5 and I coached her on 10-16."],
  ])("probe, two clauses on a CA (%s): the late opening's 10/5 is still read", async (label, words) => {
    expect(await caDate(words, `conv-fix-two-${label}`)).toBe("2026-10-05");
  });

  it.each([
    ["lowercase", "create a verbal ca for test employee at ne kearney for being late to open on 10-20, no payroll"],
    ["Sentence case", "Create a verbal CA for Test Employee at NE Kearney for being late to open on 10-20. No payroll."],
  ])("probe, a real late opening (%s): still dated 10/20", async (label, words) => {
    expect(await caDate(words, `conv-fix-real-${label}`)).toBe("2026-10-20");
  });

  it.each([
    ["lowercase", "create a verbal ca for test employee at ne kearney, she was late on 10-20, no payroll"],
    ["Sentence case", "Create a verbal CA for Test Employee at NE Kearney. She was late on 10-20. No payroll."],
  ])("a plain \"late on 10-20\" on a CA is still the incident's date (%s), fix on or off", async (label, words) => {
    for (const fix of ["1", ""]) {
      vi.stubEnv("LATE_OPEN_DATE_FIX_ENABLED", fix);
      expect(await caDate(words, `conv-fix-plain-${label}-${fix}`), `LATE_OPEN_DATE_FIX "${fix}"`).toBe("2026-10-20");
    }
  });

  it("never-break: with the fix off and LATE_OPEN_DATE on, the Coaching Form is dated 10/5, exactly as main", async () => {
    vi.stubEnv("LATE_OPEN_DATE_FIX_ENABLED", "");
    for (const prior of ["", "1"]) {
      vi.stubEnv("PRIOR_ACTIONS_PARSE_ENABLED", prior);
      expect(await coachingDate(COACHING, `conv-fix-off-${prior}`)).toBe("2026-10-05");
    }
  });

  it("never-break: with LATE_OPEN_DATE off the fix changes nothing (10/16, as main)", async () => {
    vi.stubEnv("LATE_OPEN_DATE_ENABLED", "");
    for (const fix of ["", "1"]) {
      vi.stubEnv("LATE_OPEN_DATE_FIX_ENABLED", fix);
      expect(await coachingDate(COACHING, `conv-fix-lo-off-${fix}`)).toBe("2026-10-16");
    }
  });
});

describe("the readers", () => {
  it("read the yearless coaching as an earlier step, and the late opening as the incident", () => {
    vi.stubEnv("PRIOR_ACTIONS_PARSE_ENABLED", "1");
    // QA 25 Oct 2026: no "signed" — the manager never wrote it (see the header).
    expect(statedPriorActions(SAID, TODAY)).toEqual(["Coaching for being late — 09/15/2026"]);
    expect(fieldLines(SAID, TODAY)).toEqual(["It happened on 10/20/2026."]);
    expect(blankYearlessStepDates(SAID, TODAY)).toBe(SAID.replace("9-15", "    "));
  });

  it("leave a range, a held coaching and the flag-off reading alone", () => {
    vi.stubEnv("PRIOR_ACTIONS_PARSE_ENABLED", "1");
    const range = "CA for Test Employee, she was 10-15 minutes late on 10-20";
    expect(blankYearlessStepDates(range, TODAY)).toBe(range);
    expect(fieldLines(range, TODAY)).toEqual(["It happened on 10/20/2026."]);
    const held = "I coached her on 10-16 about her cell phone";
    expect(blankYearlessStepDates(held, TODAY)).toBe(held);
    expect(statedPriorActions(held, TODAY)).toEqual([]);
    vi.stubEnv("PRIOR_ACTIONS_PARSE_ENABLED", "");
    expect(statedPriorActions(SAID, TODAY)).toEqual([]);
    expect(fieldLines(SAID, TODAY)).toEqual(["It happened on 9/15/2026."]);
    expect(blankYearlessStepDates(SAID, TODAY)).toBe(SAID);
  });
});
