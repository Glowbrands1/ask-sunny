import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { DirectoryFact } from "@/lib/forms/employee-roster";
import { correctiveActionDocument } from "@/lib/forms/library";
import { continuationFor } from "@/lib/forms/proposal-continuation";
import { JBA_MANUAL_CHUNKS, JBA_MANUAL_DOCUMENT } from "@/lib/ai/__fixtures__/jba-policy-manual";
import type { AccessScope, ChatMessage } from "@/types";

/**
 * ============================================================================
 * B13 P0 ROWS, PORTED FROM THE SIBLING APP — REMAP_INCIDENT_FIX + PRIOR_ACTIONS_PARSE
 * ============================================================================
 *
 * The sibling app's live tester (25 Oct 2026, both flags on in production)
 * found four rows that got worse; the same mechanisms run here. Each turn is
 * the sibling manager's, word for word, told with this app's salons and job
 * titles, through `answerQuestion` with this app's production flag profile
 * (intent extraction on) and both flags on:
 *
 *   G11  "jba manual 1-1-95" must be 01/01/1995, not 2095; a clause that only
 *        names or places the employee is never What happened.
 *   B4   "jba manual 1-1-26 for previous coaching" is a prior action, never
 *        What happened; a new create request with its own incident starts
 *        with no priors unless the manager restates them.
 *   Q7   What happened keeps "late to open", not the prior's "being late".
 *   H7   "create a coaching document for … regarding On 10-16-26 …" is the
 *        request; a bare repeat request keeps the incident.
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

const UNDER_TEST = ["REMAP_INCIDENT_FIX_ENABLED", "PRIOR_ACTIONS_PARSE_ENABLED"] as const;

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
  for (const name of UNDER_TEST) vi.stubEnv(name, "1");
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
    incidentType: null,
    incidentDate: date,
    payrollAmount: null,
    warningLevel: /\bverbal\b/i.test(manager) ? "verbal" : null,
    formType: /\b(?:ca|corrective action)\b/i.test(manager) ? "corrective action" : /coaching document/i.test(manager) ? "coaching" : null,
    formTurn: true,
    policyHeading: null,
  };
}

function whatHappened(content: string): string | null {
  return /\*\*(?:Observation of Offense|What happened):\*\*\s*([^\n]+)/.exec(content)?.[1]?.trim() ?? null;
}

function priorLine(content: string): string | null {
  const line = /\*\*Prior actions:\*\*\s*([^\n]+)/.exec(content)?.[1];
  return line ? line.replace(/, as you said\b.*$/, "") : null;
}

const G11 =
  "create a written corrective action for tan consultant Test Employee at grand island, ne. location. previous coaching jba manual 1-1-95, verbal ca 10-5-26. payroll deduct is applicable and $25 will be payroll deducted for late open on 10-21-26";
const B4 = [
  "create ca form for Test Employee for violating attendance policy on 10-20-26. verbal. no payroll deduct. jba manual 1-1-26 for previous coaching",
  "verbal",
  "create ca form for Test Employee for a register shortage on 10-20-26. payroll deduct applies and $3.25 will be deducted from check. previous coaching - jba policy manual 1-20-26.",
];
const Q7 = "create a CA for Test Employee at Kearney, late to open on 10-20, she was coached on 9-15 for being late";
const H7 = [
  "create a coaching document for Test Employee regarding On 10-16-26 Test Employee did not complete her closing checklist",
  "create a coaching document for Test Employee",
  "create a coaching document for Test Employee",
];

describe("B13 P0 rows, both flags on (production flags too)", () => {
  beforeEach(() => {
    intentModel.reading = copiesTheManager;
  });

  it("G11: 1-1-95 is 1995, and What happened is not the person or the salon", async () => {
    const [reply] = await chat([G11], "conv-b13-g11");
    expect(priorLine(reply!.content)).toContain("01/01/1995");
    expect(priorLine(reply!.content)).not.toContain("2095");
    // What happened is the late open the payroll answer is for, not "tan consultant at grand island".
    expect(whatHappened(reply!.content)).toBe("late open on 10-21-26");
  });

  it("B4 turns 1-2: the prior is never What happened", async () => {
    const [first, second] = await chat(B4.slice(0, 2), "conv-b13-b4a");
    for (const reply of [first!, second!]) {
      expect(whatHappened(reply.content)).toBe("violating attendance policy on 10-20-26");
      expect(priorLine(reply.content)).toBe("Coaching — JBA Policy Manual — 01/01/2026");
    }
  });

  it("B4 turn 3: a new CA with its own incident starts with its own prior only", async () => {
    const third = (await chat(B4, "conv-b13-b4b")).at(-1)!;
    expect(whatHappened(third.content)).toBe("a register shortage on 10-20-26");
    expect(priorLine(third.content)).toBe("Coaching — JBA Policy Manual — 01/20/2026");
  });

  it("Q7: What happened keeps the incident's own words, late to open", async () => {
    const [reply] = await chat([Q7], "conv-b13-q7");
    expect(whatHappened(reply!.content)).toBe("late to open on 10-20");
    expect(priorLine(reply!.content)).toBe("Coaching for being late — 09/15/2026");
  });

  it("H7: the request words go, and a bare repeat request keeps the incident", async () => {
    const replies = await chat(H7, "conv-b13-h7");
    for (const reply of replies) {
      expect(whatHappened(reply.content)).toBe("did not complete her closing checklist");
    }
  });
});

/*
 * The sibling app's B16 rows (live 25 Oct 2026, pairs 1-4 on:
 * REMAP_INCIDENT_FIX, PRIOR_ACTIONS_PARSE, CA_TEMPLATE_MAP, FORM_CHOICE_STATED,
 * KEEP_FORM_EMPLOYEE, LATE_OPEN_DATE, PLACE_SPAN_GUARD, TITLE_WHOLE_WORD),
 * told with this app's salons:
 *
 *   conv_mvnub78w2aellap  a turn of only the warning level, the prior and the
 *                         payroll answer replaced What happened with "Her".
 *   conv_mvnuc0z025sotrk  a numbered intake ("2.today" with no space) was read
 *                         as one sentence.
 */
const B16 = [
  "CA_TEMPLATE_MAP_ENABLED",
  "FORM_CHOICE_STATED_ENABLED",
  "KEEP_FORM_EMPLOYEE_ENABLED",
  "LATE_OPEN_DATE_ENABLED",
  "PLACE_SPAN_GUARD_ENABLED",
  "TITLE_WHOLE_WORD_ENABLED",
] as const;

describe("B16 rows, pairs 1-4 on (production flags too)", () => {
  beforeEach(() => {
    for (const flag of B16) vi.stubEnv(flag, "1");
    intentModel.reading = copiesTheManager;
  });

  it("a turn of only the warning level, the prior and the payroll answer keeps the incident", async () => {
    const replies = await chat(
      [
        "I need a CA form for Test Employee at Kearney for being out of dress code on October 11",
        "This is a verbal warning. Her prior coaching is her policy manual ackwnelegement on 9/01. payroll deduction is not applicable.",
        "Use Kearney as the location",
      ],
      "conv-b16-dress",
    );
    for (const reply of replies) {
      expect(whatHappened(reply.content)).toBe("being out of dress code on October 11");
    }
  });

  it("a numbered intake is read item by item", async () => {
    const [, reply] = await chat(
      ["create a coaching form", "1. test employee 2.today 3. i have observed test employee running late to her shifts 4. kearney"],
      "conv-b16-list",
    );
    expect(whatHappened(reply!.content)).toBe("running late to her shifts");
    expect(reply!.formProposal?.formDate ?? null).toBe(TODAY);
  });
});

/*
 * The sibling app's B17 (pairs 1-5 on), conv_mvnuh50i2hanl53 turn 3: a new
 * incident carried incident 1's warning level and payroll answer "as you
 * said", and What happened read "different incident: no call no show".
 */
describe("B17: a different incident starts its own form", () => {
  beforeEach(() => {
    for (const flag of [...B16, "DRAFT_ACTIONS_ENABLED", "CONVERSATION_DRAFT_REUSE_ENABLED"]) vi.stubEnv(flag, "1");
    intentModel.reading = copiesTheManager;
  });

  it("no warning level or payroll from incident 1, and no \"different incident:\"", async () => {
    const replies = await chat(
      [
        "create a CA for Test Employee at Kearney for being late to open on 10-20-26, verbal, no payroll",
        "add that she was also on her phone",
        "create a corrective action for Test Employee for a different incident: no call no show on 10-22-26",
      ],
      "conv-b17",
    );
    const third = replies[2]!;
    expect(whatHappened(third.content)).toBe("no call no show on 10-22-26");
    expect(third.formProposal?.formDate).toBe("2026-10-22");
    expect(third.formProposal?.warningLevel ?? null).toBeNull();
    expect(third.formProposal?.payrollDeduct ?? null).toBeNull();
    expect(third.content).not.toMatch(/Verbal Warning, as you said|payroll[^\n]*as you said/i);
  });
});

/* The sibling app's S20, S3, S22, S23, G10, S14, B18 and two leftovers, told with this app's salons. */
describe("What happened is the incident only (QA, 25 Oct 2026)", () => {
  beforeEach(() => {
    for (const flag of B16) vi.stubEnv(flag, "1");
    intentModel.reading = copiesTheManager;
  });

  it.each([
    ["create a second coaching form for Test Employee at Kearney for being late on 10-22-26, she already has a coaching form from 10-15-26", "being late on 10-22-26"],
    ["create a CA for Test Employee at Kearney citing the Standards of Conduct for missing the woven deadline on 10-15-26", "missing the woven deadline on 10-15-26"],
    ["create a coaching citing dress code violation on 10-15-26. Tanning consultants name is Testy Testerson", "dress code violation on 10-15-26"],
    ["create a written CA for Test Employee at Kearney for missing the 10-15-26 woven deadline. action plan: complete the Woven policy module by 10-30-26 and review it with her manager", "missing the 10-15-26 woven deadline"],
    ["create a coaching form for Test Employee at Kearney: on 10-20-26 she did not restock the lotion shelf before close and left it empty for the morning shift", "on 10-20-26 she did not restock the lotion shelf before close and left it empty for the morning shift"],
    ["create a written CA for Test Employee for not attending the monthly meeting on 12-20-26. previous coaching: jba policy manual 5-8-26, verbal ca 10-2-26. payroll deduct not applicable”", "not attending the monthly meeting on 12-20-26"],
  ])("%s", async (said, expected) => {
    const [reply] = await chat([said], `conv-wh2-${said.length}`);
    expect(whatHappened(reply!.content)).toBe(expected);
  });

  it("B18: the form is dated the incident, not the plan's due date", async () => {
    const [reply] = await chat(
      ["create a written CA for Test Employee at Kearney for missing the 10-15-26 woven deadline. action plan: complete the Woven policy module by 10-30-26 and review it with her manager"],
      "conv-b18",
    );
    expect(reply!.formProposal?.formDate).toBe("2026-10-15");
  });

  it("S3: \"use today's date\" is the date, not What happened", async () => {
    const [reply] = await chat(["create a coaching form for Test Employee, tan consultant at Kearney, use today's date"], "conv-s3");
    expect(whatHappened(reply!.content)).toBeNull();
  });

  it("S23: \"it is for …\" and \"the policy violated is …\" are answers, not What happened", async () => {
    const replies = await chat(["create a CA", "it is for Test Employee at Kearney", "the policy violated is standards of conduct"], "conv-s23");
    for (const reply of replies) expect(whatHappened(reply.content)).toBeNull();
  });

  it("\"employee name is …\" on the turn after a missed name is never What happened", async () => {
    const replies = await chat(["create a CA for being late to open on 10-20-26", "employee name is Test Employee"], "conv-name-is");
    expect(whatHappened(replies[1]!.content)).toBe("being late to open on 10-20-26");
  });
});

/*
 * QA B9 (the sibling app's conv_mvnt8fgs2gh96uh) and this app's S14
 * (conv_mvnt6fj42ny2iuv, Ask Sunny production): a coaching the manager held on
 * the first shift is a prior action, and every one of three typed coachings
 * is listed.
 */
describe("prior actions the manager typed", () => {
  beforeEach(() => {
    intentModel.reading = copiesTheManager;
  });

  it("B9: \"On the first shift I verbally coached her … late on 10/5 and 10/15\" is a verbal coaching on 10/5", async () => {
    const [reply] = await chat(
      [
        "My employee Test Employee has was 10 minutes late on her last two shifts. On the first shift I verbally coached her on our policy and expectations. Then she was late again. Please create a CA form so I can document. She was late on 10/5 and 10/15",
      ],
      "conv-b9",
    );
    expect(priorLine(reply!.content)).toBe("Verbal coaching — 10/05/2026");
  });

  it("S14 conv_mvnt6fj42ny2iuv: all three coachings are listed", async () => {
    const replies = await chat(
      [
        "Can you create me a performance CA?",
        "Test Employee today under performance for September 270 tans below in PPTA, UPTA, LPSVA, CC% and Spa% verbal warning received Open Ended Questions Coaching 9/8/2026, Focus Item Coaching 9/15/2026, New Product Coaching 9/25/2026 not payroll deductible Tanning Consultant",
      ],
      "conv-s14",
    );
    const line = priorLine(replies[1]!.content) ?? "";
    expect(line).toContain("09/08/2026");
    expect(line).toContain("09/15/2026");
    expect(line).toContain("09/25/2026");
  });
});

/*
 * The sibling app's QA B-list turns (conv_mvi98yvkfuehzye and
 * conv_mvlb6ils11qqyexg there), with this app's salon and job title, with
 * REMAP_INCIDENT_FIX + PRIOR_ACTIONS_PARSE on, and with MANAGER_WORDS_ONLY on
 * too.
 */
describe.each([[[] as string[]], [["MANAGER_WORDS_ONLY_ENABLED"]]])("QA B-list, also on: %j", (also) => {
  beforeEach(() => {
    for (const flag of also) vi.stubEnv(flag, "1");
    intentModel.reading = copiesTheManager;
  });

  it("B4: the prior is never What happened, and the register-shortage CA has only its own prior", async () => {
    const replies = await chat(B4, `conv-blist-b4-${also.length}`);
    for (const reply of replies.slice(0, 2)) {
      expect(whatHappened(reply.content)).toBe("violating attendance policy on 10-20-26");
      expect(priorLine(reply.content)).toBe("Coaching — JBA Policy Manual — 01/01/2026");
    }
    expect(whatHappened(replies[2]!.content)).toBe("a register shortage on 10-20-26");
    expect(priorLine(replies[2]!.content)).toBe("Coaching — JBA Policy Manual — 01/20/2026");
  });

  it("G11: What happened is the late open, never the job title at the salon", async () => {
    const [reply] = await chat([G11], `conv-blist-g11-${also.length}`);
    expect(whatHappened(reply!.content)).toBe("late open on 10-21-26");
    expect(priorLine(reply!.content)).toBe("Coaching — JBA Policy Manual — 01/01/1995; Verbal corrective action — 10/05/2026");
  });
});

/*
 * Round 18 (a), conv_mvo1ri4r2q9bnfv (Ask Sunny production, pair 2 on:
 * PLACE_SPAN_GUARD + TITLE_WHOLE_WORD): "create a verbal CA for Test Employee
 * at Omaha Center for being late on 10-20-26" printed the Observation "Test
 * Employee Center for being late on 10-20-26". A two-word salon was trimmed
 * only partly; "at NE Kearney" trims cleanly.
 */
describe("Round 18 (a): a two-word salon is taken out whole", () => {
  const PAIR_2 = ["PLACE_SPAN_GUARD_ENABLED", "TITLE_WHOLE_WORD_ENABLED"] as const;

  // Production had MANAGER_WORDS_ONLY on (its reader printed exactly "Test
  // Employee Center for being late on 10-20-26"); also with the remap fix on.
  it.each([
    [["MANAGER_WORDS_ONLY_ENABLED"], "Test Employee for being late on 10-20-26"],
    [["MANAGER_WORDS_ONLY_ENABLED", "REMAP_INCIDENT_FIX_ENABLED", "PRIOR_ACTIONS_PARSE_ENABLED"], "being late on 10-20-26"],
  ] as const)("conv_mvo1ri4r2q9bnfv (also on: %j): the Observation reads as it does for \"at NE Kearney\"", async (also, expected) => {
    for (const flag of UNDER_TEST) vi.stubEnv(flag, "");
    for (const flag of [...PAIR_2, ...also]) vi.stubEnv(flag, "1");
    intentModel.reading = copiesTheManager;
    const [omaha] = await chat(["create a verbal CA for Test Employee at Omaha Center for being late on 10-20-26"], `conv-r18a-${also.length}`);
    const [kearney] = await chat(["create a verbal CA for Test Employee at NE Kearney for being late on 10-20-26"], `conv-r18k-${also.length}`);
    // Production printed "Test Employee Center for being late on 10-20-26".
    expect(whatHappened(omaha!.content)).toBe(expected);
    expect(whatHappened(kearney!.content)).toBe(expected);
  });
});

/*
 * The sibling app's port (Round 18 (a)) found a salon typed in lower case left
 * whole in What happened on its remap. Here, with the remap fix on and
 * MANAGER_WORDS_ONLY off, the same turn with this app's salons.
 */
describe("Round 18 (a): a salon typed in lower case is taken out too (remap fix on)", () => {
  it.each(["Omaha Center", "omaha center", "NE Kearney", "kearney", "grand island"])(
    "create a verbal CA for Test Employee at %s for being late on 10-20-26",
    async (salon) => {
      for (const flag of ["PLACE_SPAN_GUARD_ENABLED", "TITLE_WHOLE_WORD_ENABLED"]) vi.stubEnv(flag, "1");
      intentModel.reading = copiesTheManager;
      const [reply] = await chat([`create a verbal CA for Test Employee at ${salon} for being late on 10-20-26`], `conv-r18l-${salon}`);
      expect(whatHappened(reply!.content)).toBe("being late on 10-20-26");
    },
  );
});
