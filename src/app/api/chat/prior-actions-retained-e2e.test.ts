import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { draftNotesFromConversation } from "@/lib/forms/draft-notes";
import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";
import { JBA_MANUAL_CA_CHUNKS } from "@/test/fixtures/jba-manual-ca-sections";
import type { ChatFormProposal, ChatMessage } from "@/types";

/**
 * ============================================================================
 * PRIOR_ACTIONS_RETAINED_ENABLED — A PRIOR STATED IN TURN 2 STAYS ON THE CARD
 * ============================================================================
 *
 * Sunny tester, 26 Oct 2026, 18 live runs on every deploy since 00:21Z
 * (conv_mvopmg322bsgexf). A new chat, the tester's words ("Mara Quill" is an
 * invented name):
 *
 *   T1 "create a verbal corrective action for mara quill for missing the
 *       10-15-26 woven deadline" (the 13 other runs: "… the 10-15 closing
 *       checklist")
 *   T2 "prior coaching JBA Policy Manual 7-29-26"
 *       → "**Prior actions:** Coaching — JBA Policy Manual — 07/29/2026, as
 *          you said. …"
 *   T3 "no payroll deduct"
 *       → no Prior actions line, and "You'll set any prior coaching or
 *          corrective action on the form — I won't guess at it." (5/5, 13/13)
 *
 * The chat_traces rows show why: each turn reaches the proposal as the stored
 * slots and then the manager's words ("The form is the Corrective Action
 * Form.\nThe employee is mara quill. It happened on 10/15/2026. Warning level:
 * verbal. No payroll deduction. Policy reference: Standards of Conduct, JBA
 * Policy Manual p.12.\nno payroll deduct"). The proposal reads that turn as a
 * new request for the same employee that says more than the request, so the
 * form's turns start again at it (the card's sources were the latest turn
 * only), and the prior actions are read from it alone. The stored slots carry
 * no prior actions.
 *
 * Every turn through POST /api/chat with this app's production profile
 * (intent extraction on, the full remap off, PRIOR_ACTIONS_PARSE_ENABLED on).
 * The stand-in slot model copies the manager's words and, as the live traces
 * show, names Standards of Conduct for a missed deadline or checklist. Faked:
 * identity (a global district manager, as the tester), the database (in
 * memory), the models, analytics. The directory is empty: the typed name
 * proceeds, as it did live.
 */

const store = {
  form_instances: [],
  form_instance_values: [],
  form_instance_events: [],
  form_template_versions: [],
  form_templates: [],
  form_template_current: [],
  form_template_assets: [],
  chat_conversations: [],
  chat_messages: [],
  chat_traces: [],
  chat_form_state: [],
  chat_form_incidents: [],
} as unknown as FakeStore & Record<string, Record<string, unknown>[]>;

vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdmin: () => fakeSupabase(store) }));

vi.mock("@/lib/api/respond", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/respond")>();
  return { ...actual, assertLiveMode: () => {}, assertNoConfigurationProblems: () => {}, assertWithinRateLimit: () => {} };
});

vi.mock("@/lib/config/server-env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/config/server-env")>();
  return { ...actual, liveReadiness: () => ({ mode: "live", missing: [], problems: [], ready: true }) };
});

vi.mock("@/lib/auth/server", async () => {
  const { DEFAULT_PERMISSION_MATRIX, hasPermission } = await import("@/lib/permissions");
  const { AuthError } = await import("@/lib/auth/types");
  return {
    authorizeRequest: async (_request: Request, permission: string) => {
      if (!hasPermission(DEFAULT_PERMISSION_MATRIX, "district_manager" as never, permission as never)) {
        throw new AuthError("forbidden", "Your role does not have permission to do that.");
      }
      return {
        identity: {
          subject: "qa-manager",
          email: "qa-manager@example.test",
          displayName: "QA Manager",
          role: "district_manager",
          scope: { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] },
          verified: true,
        },
        permission,
        provider: "supabase",
      };
    },
  };
});

vi.mock("@/lib/analytics/record", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/analytics/record")>()),
  openTurn: async () => "turn-qa",
  closeTurn: async () => {},
  recordActivity: async () => {},
  recordActivityAsync: () => {},
}));

/** The slot model: the manager's words copied, nothing guessed. */
vi.mock("@/lib/ai/call-claude", () => ({
  callClaude: async () => "A grounded answer from the policy manual.",
  callClaudeTool: async (input: { tool?: { name?: string }; messages?: { content?: unknown }[] }) => {
    if (input.tool?.name !== "record_intent_slots") return null;
    const conversation = JSON.stringify(input.messages ?? []);
    const manager = (conversation.split("Manager:").pop() ?? conversation).replace(/\\n/g, "\n");
    const date = /\b\d{1,2}[-/]\d{1,2}(?:[-/]\d{2,4})?\b/.exec(manager)?.[0] ?? null;
    const named = /mara quill/i.exec(manager)?.[0] ?? /ilsa varrow/i.exec(manager)?.[0] ?? null;
    return {
      employee: named,
      salon: null,
      title: null,
      incidentType: /deadline|checklist/i.test(manager) ? "missed a required deadline" : null,
      incidentDate: date,
      payrollAmount: null,
      warningLevel: /\bverbal\b/i.test(manager) ? "verbal" : /\bwritten\b/i.test(manager) ? "written" : null,
      formType: /corrective action/i.test(manager) ? "Corrective Action Form" : null,
      formTurn: /corrective action/i.test(manager),
      policyHeading: /deadline|checklist/i.test(conversation) ? "Standards of Conduct" : null,
    };
  },
}));

vi.mock("@/lib/ai/anthropic", () => ({
  getAnthropicClient: () => ({
    messages: {
      create: async () => ({ stop_reason: "tool_use", content: [{ type: "tool_use", name: "write_form_fields", input: {} }] }),
    },
  }),
}));

vi.mock("@/lib/knowledge/providers/supabase", () => ({
  SupabaseKnowledgeProvider: class {
    async search() {
      return [];
    }
    async match() {
      return [];
    }
    async fetchRoleGrounding() {
      return { ok: false, failure: { code: "missing", detail: "not used", missingGroups: [] } };
    }
    async fetchOfficialPolicyManual() {
      return {
        ok: true,
        documentId: "doc-manual",
        documentTitle: "2025 JBA Policy Manual - Edited 5-2025",
        documentCategory: "policies_compliance",
        matchedBy: "tag",
        chunks: JBA_MANUAL_CA_CHUNKS,
      };
    }
  },
}));

vi.mock("@/lib/knowledge", () => ({
  getKnowledgeProvider: () => {
    throw new Error("getKnowledgeProvider() is the browser knowledge client and must not be used on the server");
  },
}));

vi.mock("@/lib/reporting/read/report-briefing", () => ({ loadReportBriefing: async () => null }));
vi.mock("@/lib/reporting/read/employee-facts", () => ({
  loadEmployeeFacts: async () => null,
  NO_EMPLOYEE_DATA_REASON: "no dataset",
  NO_EMPLOYEE_DATASET_REASON: "no dataset",
  EMPLOYEE_DATA_HEADING: "CURRENT EMPLOYEE PERFORMANCE DATA",
}));

vi.mock("@/lib/forms/employee-roster", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/forms/employee-roster")>()),
  readDirectoryFacts: async () => [],
  loadScopedRoster: async () => [],
}));

vi.mock("@/lib/forms/prior-forms", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/forms/prior-forms")>()),
  priorFormsReadingForChat: async () => ({ attach: [], possible: [], identity: "none" }),
}));

process.env.NEXT_PUBLIC_DEMO_MODE = "false";

vi.setConfig({ hookTimeout: 60_000, testTimeout: 60_000 });

const { ensureTemplateLibrary } = await import("@/lib/forms/repository");
const chatRoute = await import("./route");

const TODAY = "2026-10-26";

/** This app's production profile: intent extraction on, the full remap off. */
const PRODUCTION = [
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
  "PRIOR_ACTIONS_PARSE_ENABLED",
] as const;

/** The integration bundle's flags, default off, turned on together. */
const BUNDLE = [
  "PLACE_SPAN_GUARD_ENABLED",
  "MANAGER_WORDS_ONLY_ENABLED",
  "CONVERSATION_DRAFT_REUSE_ENABLED",
  "DRAFT_ACTIONS_ENABLED",
  "LATE_OPEN_DATE_ENABLED",
  "CA_TEMPLATE_MAP_ENABLED",
  "FORM_CHOICE_STATED_ENABLED",
  "REMAP_INCIDENT_FIX_ENABLED",
  "KEEP_FORM_EMPLOYEE_ENABLED",
  "TITLE_WHOLE_WORD_ENABLED",
  "NOT_A_NAME_GUARD_ENABLED",
  "WARNING_LEVEL_MANAGER_ONLY_ENABLED",
  "INTENT_PAYROLL_MANAGER_ONLY_ENABLED",
] as const;

const FLAG = "PRIOR_ACTIONS_RETAINED_ENABLED";

type Answer = { content: string; formProposal?: ChatFormProposal };

/** One new chat, every turn through POST /api/chat, the browser's messages as history. */
async function chat(turns: readonly string[]): Promise<{ answers: Answer[]; messages: ChatMessage[] }> {
  const conversationId = `conv-${randomUUID()}`;
  const messages: ChatMessage[] = [];
  const answers: Answer[] = [];
  let proposal: ChatFormProposal | null = null;
  for (const [index, question] of turns.entries()) {
    const id = `m${index}`;
    const response = await chatRoute.POST(
      new Request("https://app.test/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          question,
          mode: "standard",
          history: messages.map(({ id: messageId, role, content }) => ({ id: messageId, role, content })),
          questionMessageId: id,
          conversationId,
          ...(proposal ? { continueProposalTemplateKey: proposal.templateKey } : {}),
        }),
      }),
    );
    const payload = (await response.json()) as Answer & { error?: string };
    expect(response.status, JSON.stringify(payload)).toBe(200);
    messages.push(
      { id, role: "user", content: question, createdAt: `${TODAY}T03:41:3${index}Z` } as ChatMessage,
      {
        id: `a${index}`,
        role: "assistant",
        content: payload.content,
        createdAt: `${TODAY}T03:41:4${index}Z`,
        ...(payload.formProposal ? { formProposal: payload.formProposal } : {}),
      } as ChatMessage,
    );
    if (payload.formProposal) proposal = payload.formProposal;
    answers.push(payload);
  }
  return { answers, messages };
}

/** The card's Prior actions line, or null. */
const priorLine = (content: string) => /^\*\*Prior actions:\*\*[^\n]*$/m.exec(content)?.[0] ?? null;
const PRIORS_HELD = "You'll set any prior coaching or corrective action on the form — I won't guess at it.";
const STATED = /^\*\*Prior actions:\*\* Coaching — JBA Policy Manual — 07\/29\/2026, as you said\. I'll list it on the form — tell me if that should change\.$/i;

const T1 = "create a verbal corrective action for mara quill for missing the 10-15 closing checklist";
const T1_LIVE = "create a verbal corrective action for mara quill for missing the 10-15-26 woven deadline";
const T2 = "prior coaching JBA Policy Manual 7-29-26";
const T3 = "no payroll deduct";

const REGISTERS = [
  ["all lowercase", [T1, T2.toLowerCase(), T3]],
  ["the live chat (conv_mvopmg322bsgexf)", [T1_LIVE, T2, T3]],
  [
    "Sentence case",
    [
      "Create a verbal corrective action for Mara Quill for missing the 10-15 closing checklist",
      "Prior coaching JBA Policy Manual 7-29-26",
      "No payroll deduct",
    ],
  ],
  ["ALL CAPS", [T1.toUpperCase(), T2.toUpperCase(), T3.toUpperCase()]],
] as const;

const saved = new Map<string, string | undefined>();

beforeEach(async () => {
  for (const key of Object.keys(store)) store[key] = [];
  for (const name of [...PRODUCTION, ...BUNDLE, FLAG]) saved.set(name, process.env[name]);
  for (const name of PRODUCTION) process.env[name] = "1";
  for (const name of [...BUNDLE, FLAG, "FORM_FULL_REMAP_ENABLED", "CODE_SLOTS_ENABLED"]) delete process.env[name];
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${TODAY}T03:41:33Z`));
  await ensureTemplateLibrary("system");
});

afterEach(() => {
  vi.useRealTimers();
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("flag on: the prior stated in turn 2 stays on the card through turn 3", () => {
  beforeEach(() => {
    process.env[FLAG] = "1";
  });

  it.each(REGISTERS)("%s", async (_register, turns) => {
    const { answers, messages } = await chat(turns);
    const [, second, third] = answers;
    expect(priorLine(second!.content), second!.content).toMatch(STATED);
    expect(priorLine(third!.content), third!.content).toBe(priorLine(second!.content));
    expect(third!.content).not.toContain(PRIORS_HELD);
    expect(third!.formProposal?.payrollDeduct).toBe("no");
    expect(third!.formProposal?.warningLevel).toBe("verbal");
    // Create lists it on the form too: the turn that stated it is one of the card's sources.
    expect(third!.formProposal?.sourceMessageIds).toEqual(["m1", "m2"]);
    expect(draftNotesFromConversation(messages, third!.formProposal!.sourceMessageIds).text).toContain(turns[1]);
  });

  it.each([
    ["no payroll deduct", "no", "verbal"],
    ["no payroll deduction", "no", "verbal"],
    ["verbal", null, "verbal"],
    ["written warning please", null, "written"],
    ["yes 25 dollars", "yes", "verbal"],
  ] as const)('T3 "%s" keeps it', async (third, payroll, level) => {
    const { answers } = await chat([T1, T2, third]);
    const last = answers[2]!;
    expect(priorLine(last.content), last.content).toBe(priorLine(answers[1]!.content));
    expect(priorLine(last.content)).toMatch(STATED);
    expect(last.content).not.toContain(PRIORS_HELD);
    expect(last.formProposal?.payrollDeduct ?? null).toBe(payroll);
    expect(last.formProposal?.warningLevel).toBe(level);
  });

  it.each(["she is a tanning consultant", "NE Kearney", "the date should be 10-16-26"])(
    'a position, salon or date answer keeps it: "%s"',
    async (third) => {
      const { answers } = await chat([T1, T2, third]);
      expect(priorLine(answers[2]!.content), answers[2]!.content).toMatch(STATED);
    },
  );

  it("it stays through more than one slot answer", async () => {
    const { answers } = await chat([T1, T2, "no payroll deduct", "verbal"]);
    expect(priorLine(answers[3]!.content), answers[3]!.content).toMatch(STATED);
  });

  it.each(["no prior coaching", "remove the prior", "No prior coaching", "REMOVE THE PRIOR"])(
    'T3 "%s" clears it, and it stays cleared',
    async (third) => {
      const { answers } = await chat([T1, T2, third, "no payroll deduct"]);
      // "remove the prior" is answered "You'll set any prior coaching …"; "no prior coaching" is an answer, so neither line.
      for (const answer of answers.slice(2)) expect(priorLine(answer.content), answer.content).toBeNull();
    },
  );

  it("a T3 that changes the prior shows the new one only", async () => {
    const { answers } = await chat([T1, T2, "prior coaching JBA Policy Manual 8-1-26"]);
    const line = priorLine(answers[2]!.content);
    expect(line, answers[2]!.content).toMatch(/08\/01\/2026/);
    expect(line).not.toMatch(/07\/29\/2026/);
  });

  it("a new request for somebody else does not carry this employee's prior", async () => {
    const { answers } = await chat([
      T1,
      T2,
      "create a verbal corrective action for ilsa varrow for missing the 10-20 closing checklist",
    ]);
    const last = answers[2]!;
    expect(last.formProposal?.employeeName?.toLowerCase()).toBe("ilsa varrow");
    expect(priorLine(last.content), last.content).toBeNull();
  });

  it("a prior given in the first turn is read as before (no second line)", async () => {
    const { answers } = await chat([`${T1}. prior coaching JBA Policy Manual 7-29-26`, T3]);
    expect(priorLine(answers[0]!.content), answers[0]!.content).toMatch(STATED);
    expect(priorLine(answers[1]!.content), answers[1]!.content).toMatch(STATED);
    expect(answers[1]!.content.match(/\*\*Prior actions:\*\*/g)).toHaveLength(1);
  });

  it("with the bundle's flags (REMAP_INCIDENT_FIX_ENABLED lists it at the end) the line is not doubled", async () => {
    for (const name of BUNDLE) process.env[name] = "1";
    const { answers } = await chat([T1, T2, T3]);
    expect(answers[2]!.content.match(/\*\*Prior actions:\*\*/g), answers[2]!.content).toHaveLength(1);
  });
});

describe("flag off: exactly as main (the live defect, pinned)", () => {
  it.each(REGISTERS)("%s: turn 3 drops the prior", async (_register, turns) => {
    const { answers, messages } = await chat(turns);
    const [first, second, third] = answers;
    expect(priorLine(first!.content)).toBeNull();
    expect(priorLine(second!.content), second!.content).toMatch(STATED);
    expect(priorLine(third!.content), third!.content).toBeNull();
    expect(third!.content).toContain(PRIORS_HELD);
    expect(third!.formProposal?.sourceMessageIds).toEqual(["m2"]);
    expect(draftNotesFromConversation(messages, third!.formProposal!.sourceMessageIds).text).toBe(turns[2]);
  });

  it("turns 1 and 2 read the same with the flag on as off", async () => {
    const off = await chat([T1, T2]);
    process.env[FLAG] = "1";
    const on = await chat([T1, T2]);
    const strip = (answer: Answer) => ({ content: answer.content, proposal: { ...answer.formProposal, proposalId: null } });
    expect(on.answers.map(strip)).toEqual(off.answers.map(strip));
  });
});

describe("flag off: the reader returns the response it was given", () => {
  it("the same object, untouched", async () => {
    const { withRetainedPriorActions } = await import("@/lib/ai/prior-actions-retained");
    const { answers } = await chat([T1, T2, T3]);
    const response = { content: answers[2]!.content, formProposal: answers[2]!.formProposal };
    const before = JSON.stringify(response);
    const input = {
      question: T3,
      questionMessageId: "m2",
      history: [
        { id: "m0", role: "user", content: T1 },
        { id: "m1", role: "user", content: T2 },
      ],
      today: TODAY,
    };
    expect(withRetainedPriorActions(response as never, input)).toBe(response);
    expect(JSON.stringify(response)).toBe(before);
    process.env[FLAG] = "1";
    expect(priorLine(withRetainedPriorActions(response as never, input).content)).toMatch(STATED);
  });
});
