import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { lateOpenDateEnabled } from "@/lib/config/chat-quality-flags";
import type { DirectoryFact } from "@/lib/forms/employee-roster";
import { correctiveActionDocument } from "@/lib/forms/library";
import { continuationFor } from "@/lib/forms/proposal-continuation";
import { JBA_MANUAL_CHUNKS, JBA_MANUAL_DOCUMENT } from "@/lib/ai/__fixtures__/jba-policy-manual";
import type { AccessScope, ChatMessage } from "@/types";

/**
 * ============================================================================
 * QA, 24 OCT 2026 — A LATE OPENING, ITS DATE AND ITS PAYROLL ANSWER
 * ============================================================================
 *
 * Through `answerQuestion`, with this app's production flag profile (intent
 * extraction on, CODE_SLOTS and FORM_FULL_REMAP unset) and
 * LATE_OPEN_DATE_ENABLED.
 *
 * F5: "late to open 10-19, verbal, no payroll" gave formDate null (live
 * conv_mvmt1v0u2u32xsf) and the code's incident was Attendance. Late to open
 * is the manual's Late Opening section (p.15).
 * F6: "payroll deduct is not applicable." is payroll No.
 * conv_mvmyre8z2unys1a: a late opening's card cited Late Opening p.15 AND
 * Attendance p.14. HR asked for Late Opening only.
 *
 * The manager turns are the saved chat_messages, word for word. "Test
 * Employee" is the QA account's own placeholder name.
 */

const TODAY = "2026-10-24";

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
  vi.stubEnv("LATE_OPEN_DATE_ENABLED", "1");
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

/** The Sources the card shows: the policy lines in the reply and the citations. */
function sources(answer: Answer): string {
  const lines = answer.content.split("\n").filter((line) => /JBA Policy Manual p\.\d+/.test(line));
  const cited = (answer.citations ?? []).map((item) => `${item.excerpt.split(".")[0]} ${item.locator}`);
  return [...lines, ...cited].join("\n");
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

describe("LATE_OPEN_DATE_ENABLED", () => {
  it("defaults off", () => {
    vi.stubEnv("LATE_OPEN_DATE_ENABLED", "");
    expect(lateOpenDateEnabled()).toBe(false);
  });
});

describe("conv_mvmt1v0u2u32xsf, word for word (F5)", () => {
  const TURNS = ["CA for Test Employee at NE Kearney, late to open 10-19, verbal, no payroll", "change the date to 10-22"];

  it("dates the card 10/19, cites Late Opening p.15 only, verbal, payroll No", async () => {
    intentModel.reading = copiesTheManager;
    const [first] = await chat(TURNS.slice(0, 1), "conv-late-open-f5");
    const card = first!.formProposal!;
    expect(card, first!.content).toBeTruthy();
    expect(card.formDate).toBe("2026-10-19");
    expect(card.warningLevel).toBe("verbal");
    expect(card.payrollDeduct).toBe("no");
    expect(first!.content).toMatch(/Late Opening/);
    expect(sources(first!)).toMatch(/Late Opening.*(?:p\.|Page )15/);
    expect(sources(first!)).not.toMatch(/Attendance/);
    expect(first!.content).not.toMatch(/Attendance/);
    const saved = stateBag.forms.get("manager-late-open:conv-late-open-f5") as { formDate: string; incidentType: string };
    expect(saved.formDate).toBe("2026-10-19");
    expect(saved.incidentType).toBe("Late Opening");
  });

  it('"change the date to 10-22" on the open card dates it 10/22', async () => {
    intentModel.reading = copiesTheManager;
    const answers = await chat(TURNS, "conv-late-open-f5b");
    const card = answers[1]!.formProposal!;
    expect(card, answers[1]!.content).toBeTruthy();
    expect(card.formDate).toBe("2026-10-22");
    expect(card.payrollDeduct).toBe("no");
    expect(sources(answers[1]!)).not.toMatch(/Attendance/);
  });

  it("reads the same with no model reading at all", async () => {
    intentModel.reading = null;
    const [first] = await chat(TURNS.slice(0, 1), "conv-late-open-f5c");
    expect(first!.formProposal?.formDate).toBe("2026-10-19");
    expect(sources(first!)).not.toMatch(/Attendance/);
  });
});

/*
 * S1, conv_mvn007ti21c35au (24 Oct 2026, replayed live on 25 Oct), word for
 * word: the date is given in the second turn, the late opening in the third,
 * and "change the date to 10-21" in the fourth. Live, the card stayed 10/20.
 */
describe("S1: conv_mvn007ti21c35au, word for word", () => {
  const S1 = [
    "I need a CA for Test Employee",
    "she works at NE Kearney and it happened on 10-20",
    "she opened the salon 20 minutes late and did not call anyone",
    "change the date to 10-21",
  ];

  it("ends dated 10/21, citing Late Opening only", async () => {
    intentModel.reading = copiesTheManager;
    const answers = await chat(S1, "conv-s1");
    expect(answers[1]!.formProposal?.formDate).toBe("2026-10-20");
    expect(answers[2]!.formProposal?.formDate).toBe("2026-10-20");
    const last = answers[3]!;
    expect(last.formProposal, last.content).toBeTruthy();
    expect(last.formProposal!.formDate).toBe("2026-10-21");
    expect(sources(last)).toMatch(/Late Opening/);
    expect(sources(last)).not.toMatch(/Attendance/);
    const saved = stateBag.forms.get("manager-late-open:conv-s1") as { formDate: string };
    expect(saved.formDate).toBe("2026-10-21");
  });

  it("with the flag off it stays 10/20, as live", async () => {
    vi.stubEnv("LATE_OPEN_DATE_ENABLED", "");
    intentModel.reading = copiesTheManager;
    const answers = await chat(S1, "conv-s1-off");
    expect(answers[3]!.formProposal?.formDate).toBe("2026-10-20");
  });
});

describe("conv_mvmyre8z2unys1a, word for word", () => {
  it("a late opening cites Late Opening p.15 only", async () => {
    intentModel.reading = copiesTheManager;
    const [first] = await chat(
      ["create a CA for Test Employee, tanning consultant at NE Kearney, for opening the salon late on 10-20-26"],
      "conv-late-open-sources",
    );
    expect(first!.formProposal?.formDate).toBe("2026-10-20");
    expect(sources(first!)).toMatch(/Late Opening.*(?:p\.|Page )15/);
    expect(sources(first!)).not.toMatch(/Attendance/);
  });
});

describe("the variants (F5)", () => {
  it.each([
    ["CA for Test Employee at NE Kearney, late opening 10-19, verbal, no payroll"],
    ["CA for Test Employee at NE Kearney, opened late on 10/19, verbal, no payroll"],
    ["CA for Test Employee at NE Kearney, was late to open the salon 10-19-26, verbal, no payroll"],
  ])("%s", async (question) => {
    intentModel.reading = copiesTheManager;
    const [first] = await chat([question], `conv-variant-${question.length}`);
    expect(first!.formProposal?.formDate).toBe("2026-10-19");
    expect(first!.formProposal?.payrollDeduct).toBe("no");
    expect(sources(first!)).toMatch(/Late Opening/);
    expect(sources(first!)).not.toMatch(/Attendance/);
  });

  it("late for a shift stays Attendance", async () => {
    intentModel.reading = copiesTheManager;
    const [first] = await chat(
      ["CA for Test Employee at NE Kearney, arrived 20 minutes late for her shift on 10-19, verbal, no payroll"],
      "conv-late-shift",
    );
    expect(first!.formProposal?.formDate).toBe("2026-10-19");
    expect(sources(first!)).toMatch(/Attendance/);
    expect(sources(first!)).not.toMatch(/Late Opening/);
  });
});

describe("payroll deduct is not applicable (F6)", () => {
  it.each([
    ["payroll deduct is not applicable."],
    ["payroll deduct n/a"],
    ["not applicable"],
    ["doesn't apply"],
  ])("answering the payroll question: %s", async (reply) => {
    intentModel.reading = copiesTheManager;
    const answers = await chat(
      ["CA for Test Employee at NE Kearney, late to open 10-19, verbal", reply],
      `conv-payroll-${reply.length}`,
    );
    expect(answers[0]!.content).toMatch(/payroll deduct/i);
    expect(answers[1]!.formProposal?.payrollDeduct).toBe("no");
    const saved = stateBag.forms.get(`manager-late-open:conv-payroll-${reply.length}`) as { payrollDeduct: string };
    expect(saved.payrollDeduct).toBe("no");
  });

  it("inside the request", async () => {
    intentModel.reading = copiesTheManager;
    const [first] = await chat(
      ["CA for Test Employee at NE Kearney, late to open 10-19, verbal. payroll deduct is not applicable."],
      "conv-payroll-inline",
    );
    expect(first!.formProposal?.payrollDeduct).toBe("no");
    const saved = stateBag.forms.get("manager-late-open:conv-payroll-inline") as { payrollDeduct: string };
    expect(saved.payrollDeduct).toBe("no");
  });
});

/*
 * INTEGRATION, LATE_OPEN_DATE_ENABLED + REMAP_INCIDENT_FIX_ENABLED. The remap
 * fix reads the held date from the manager's own words without the intent
 * read's "It happened on …" line, and those words keep "change the date to
 * 10-22" yearless, so with both on the card kept 10/19 (F5) and 10/20 (S1).
 */
describe("with REMAP_INCIDENT_FIX_ENABLED on too", () => {
  beforeEach(() => {
    vi.stubEnv("REMAP_INCIDENT_FIX_ENABLED", "1");
  });

  it('F5: "change the date to 10-22" on the open card dates it 10/22', async () => {
    intentModel.reading = copiesTheManager;
    const answers = await chat(["CA for Test Employee at NE Kearney, late to open 10-19, verbal, no payroll", "change the date to 10-22"], "conv-late-open-remap-f5");
    expect(answers[0]!.formProposal?.formDate).toBe("2026-10-19");
    const card = answers[1]!.formProposal!;
    expect(card, answers[1]!.content).toBeTruthy();
    expect(card.formDate).toBe("2026-10-22");
    expect(sources(answers[1]!)).not.toMatch(/Attendance/);
  });

  it("S1: ends dated 10/21, citing Late Opening only", async () => {
    intentModel.reading = copiesTheManager;
    const answers = await chat(
      [
        "I need a CA for Test Employee",
        "she works at NE Kearney and it happened on 10-20",
        "she opened the salon 20 minutes late and did not call anyone",
        "change the date to 10-21",
      ],
      "conv-late-open-remap-s1",
    );
    const last = answers[3]!;
    expect(last.formProposal, last.content).toBeTruthy();
    expect(last.formProposal!.formDate).toBe("2026-10-21");
    expect(sources(last)).toMatch(/Late Opening/);
    expect(sources(last)).not.toMatch(/Attendance/);
  });
});
