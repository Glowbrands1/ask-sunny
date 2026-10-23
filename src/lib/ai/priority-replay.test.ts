import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DirectoryFact } from "@/lib/forms/employee-roster";
import { correctiveActionDocument } from "@/lib/forms/library";
import type { ManualChunk } from "@/lib/forms/official-policy-manual";
import type { AccessScope, ChatMessage } from "@/types";

/**
 * The 14 live chats that returned no form card.
 *
 * Pau's script (`/workspace/replay/priority14.md`) and `replay_set.json` are
 * not in this repository. The turns below are reconstructed from the 24 Oct
 * 2026 replay results for these ids (employee names there were substituted
 * with Marissa Lempka) and from the live symptoms: an unverified name must
 * stay on the card, Erin's Woven primary salon must be used, and "CA",
 * "coaching", and "exit" are the form.
 *
 * Each case goes through `answerQuestion` with the seven flags on. The model
 * is a fixture that returns nothing, so a slot counts only when the roster,
 * the salon list, or the manual reader can see it in the manager's words.
 */

const FLAGS = [
  "INTENT_EXTRACTION_ENABLED",
  "FEWSHOT_EXAMPLES_ENABLED",
  "SELF_CHECK_ENABLED",
  "QUERY_REWRITE_ENABLED",
  "GROUNDED_ENTITIES_ENABLED",
  "DRAFT_MERGE_ENABLED",
  "ACTION_PLAN_SENTENCES_ENABLED",
] as const;

const savedFlags = new Map<string, string | undefined>();

const stateBag = vi.hoisted(() => ({
  forms: new Map<string, unknown>(),
}));

const PEOPLE: DirectoryFact[] = [
  {
    id: "erin",
    firstName: "Erin",
    lastName: "Nelson",
    preferredFirstName: null,
    salonIds: ["loc-0313", "loc-0410"],
    title: "Tanning Consultant",
    primaryLocationName: "NE Omaha 132nd and Maple",
    primarySalonId: "loc-0313",
  },
  {
    id: "marissa-lawrence",
    firstName: "Marissa",
    lastName: "Lempka",
    preferredFirstName: null,
    salonIds: ["loc-0468"],
    title: "Salon Director",
    primaryLocationName: "KS Lawrence",
    primarySalonId: "loc-0468",
  },
  {
    id: "marissa-joseph",
    firstName: "Marissa",
    lastName: "Lempka",
    preferredFirstName: null,
    salonIds: ["loc-0495"],
    title: "Shift Lead",
    primaryLocationName: "MO St Joseph",
    primarySalonId: "loc-0495",
  },
];

function chunk(section: string, page: number, body: string): ManualChunk {
  return {
    chunkIndex: page,
    page,
    printedPage: page,
    section,
    content: `${section}\n${body}`,
    sections: [{ heading: section, page }],
  };
}

const MANUAL = {
  ok: true as const,
  documentId: "doc-jba",
  documentTitle: "JBA Policy Manual Edited 5.2025",
  documentCategory: "policies_compliance" as const,
  matchedBy: "fallback" as const,
  chunks: [
    chunk("Late Opening", 15, "A salon that opens late is a Late Opening."),
    chunk("Attendance", 14, "Be on time for a scheduled shift."),
    chunk("Standards of Conduct", 12, "Employees follow the standards of conduct."),
    chunk("Cell Phone/Smart Watch Policy", 19, "Phones are put away during the shift."),
  ],
};

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
  template({
    id: "tpl-exit",
    key: "stc-exit",
    name: "Resignation/Exit Form",
    shortName: "Exit",
    description: "An employee who is leaving.",
    category: "separation",
    layoutFamily: "exit",
    requiredPermission: "create_exit_form",
    displayOrder: 15,
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
  priorFormsReadingForChat: async () => ({ attach: [], mention: [], possible: [] }),
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
    readonly name = "replay";
    async match() {
      return [];
    }
    async fetchRoleGrounding() {
      return { ok: false, failure: { code: "missing", detail: "not used", missingGroups: [] } };
    }
    async fetchOfficialPolicyManual() {
      return MANUAL;
    }
  },
}));

vi.mock("@/lib/reporting/read/report-briefing", () => ({
  loadReportBriefing: async () => null,
}));

vi.mock("@/lib/reporting/read/employee-facts", () => ({
  loadEmployeeFacts: async () => null,
  NO_EMPLOYEE_DATASET_REASON: "no dataset",
  EMPLOYEE_DATA_HEADING: "CURRENT EMPLOYEE PERFORMANCE DATA",
}));

vi.mock("./call-claude", () => ({
  callClaude: async () => "An answer.",
  callClaudeTool: async () => null,
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

interface ReplayCase {
  readonly id: string;
  readonly turns: readonly string[];
  /** 1-based turn on which a proposal card has to exist. */
  readonly cardBy: number;
  readonly templateKey: string;
  readonly employee?: string;
  readonly employeeNot?: RegExp;
  readonly locationId?: string;
  readonly formDate?: string;
}

const CASES: readonly ReplayCase[] = [
  {
    id: "s4",
    turns: ["CA for Marissa Lempka at KS Lawrence. She was late opening the salon on 9/20/26. Job title Salon Director. $25 payroll deduction."],
    cardBy: 1,
    templateKey: "dpoa",
    employee: "Marissa Lempka",
    employeeNot: /job/i,
    locationId: "loc-0468",
    formDate: "2026-09-20",
  },
  {
    id: "s9",
    turns: ["coaching form for Marissa Lempka at KS Lawrence. The salon opened late on 10/2/26"],
    cardBy: 1,
    templateKey: "coaching",
    employee: "Marissa Lempka",
    locationId: "loc-0468",
    formDate: "2026-10-02",
  },
  {
    id: "s11",
    turns: ["CA for Marissa Lempka at Lawrence, she was rude on 9/28/26"],
    cardBy: 1,
    templateKey: "dpoa",
    employee: "Marissa Lempka",
    employeeNot: /^lawrence$/i,
    locationId: "loc-0468",
    formDate: "2026-09-28",
  },
  {
    id: "s5",
    turns: ["CA for Marissa Lempka, standards of conduct on 9/28/26", "1"],
    cardBy: 2,
    templateKey: "dpoa",
    employee: "Marissa Lempka",
    formDate: "2026-09-28",
  },
  {
    id: "s27",
    turns: ["CA for Marissa Lempka at KS Lawrence. Job title Salon Director. Standards of conduct on 9/28/26. She ignored the dress standard."],
    cardBy: 1,
    templateKey: "dpoa",
    employee: "Marissa Lempka",
    employeeNot: /job/i,
    locationId: "loc-0468",
    formDate: "2026-09-28",
  },
  {
    id: "s28",
    turns: ["CA for Marissa Lempka at KS Lawrence, standards of conduct, 9/28/26"],
    cardBy: 1,
    templateKey: "dpoa",
    employee: "Marissa Lempka",
    locationId: "loc-0468",
    formDate: "2026-09-28",
  },
  {
    id: "s29",
    turns: ["CA for Erin Nelson, she was rude to a guest on 9/28/26"],
    cardBy: 1,
    templateKey: "dpoa",
    employee: "Erin Nelson",
    locationId: "loc-0313",
    formDate: "2026-09-28",
  },
  {
    id: "s17",
    turns: ["CA for Marissa Lempka Job title Salon Director at KS Lawrence on 9/28/26, standards of conduct"],
    cardBy: 1,
    templateKey: "dpoa",
    employee: "Marissa Lempka",
    employeeNot: /job/i,
    locationId: "loc-0468",
    formDate: "2026-09-28",
  },
  {
    id: "s20",
    turns: ["coaching form based on attendance at KS Lawrence on 9/20/26"],
    cardBy: 1,
    templateKey: "coaching",
    employeeNot: /based/i,
    locationId: "loc-0468",
    formDate: "2026-09-20",
  },
  {
    id: "s21",
    turns: ["written CA for Erin Nelson at NE Omaha Pacific on 9/28/26, she was rude"],
    cardBy: 1,
    templateKey: "dpoa",
    employee: "Erin Nelson",
    locationId: "loc-0410",
    formDate: "2026-09-28",
  },
  {
    id: "s25",
    turns: ["CA for Marisa Lempka at KS Lawrence on 9/28/26"],
    cardBy: 1,
    templateKey: "dpoa",
    employee: "Marissa Lempka",
    locationId: "loc-0468",
    formDate: "2026-09-28",
  },
  {
    id: "s8",
    turns: ["exit form for Casey Quinn at KS Lawrence, last day 9/28/26"],
    cardBy: 1,
    templateKey: "stc-exit",
    employee: "Casey Quinn",
    locationId: "loc-0468",
    formDate: "2026-09-28",
  },
  {
    id: "s12",
    turns: [
      "Resignation/Exit Form for Erin Nelson. Notice given 9/15/26. Last day 9/28/26. Resigned via Woven.",
      "2",
    ],
    cardBy: 2,
    templateKey: "stc-exit",
    employee: "Erin Nelson",
    locationId: "loc-0313",
    formDate: "2026-09-28",
  },
  {
    id: "s16",
    turns: [
      "exit for Erin Nelson at NE Kearney. Notice given 9/25/26, last day 10/9/26. Payroll N/A. Eligible for rehire.",
      "2",
    ],
    cardBy: 2,
    templateKey: "stc-exit",
    employee: "Erin Nelson",
    locationId: "loc-0309",
    formDate: "2026-10-09",
  },
];

async function ask(question: string, history: ChatMessage[], conversationId: string) {
  const { answerQuestion } = await import("./server-ask");
  return answerQuestion(
    {
      question,
      mode: "standard",
      history,
      scopeId: "stc-core",
      questionMessageId: `msg-${history.length}`,
      conversationId,
      context: { userName: "Pat Manager", locationName: "All salons", todayIso: "2026-10-23" },
    },
    { role: "salon_director", scope: SCOPE, subject: "manager-replay", verified: true },
    { memoryOwnerId: "manager-replay" },
  );
}

beforeEach(() => {
  stateBag.forms.clear();
  for (const name of FLAGS) {
    if (!savedFlags.has(name)) savedFlags.set(name, process.env[name]);
    process.env[name] = "1";
  }
});

describe("priority replay: a form card with the seven flags on", () => {
  it.each(CASES)("$id has a card by turn $cardBy", async (item) => {
    const history: ChatMessage[] = [];
    let response = await ask(item.turns[0]!, history, `conv-${item.id}`);
    for (let index = 0; index < item.turns.length; index += 1) {
      if (index > 0) response = await ask(item.turns[index]!, history, `conv-${item.id}`);
      if (index + 1 < item.cardBy) {
        history.push({
          id: `u-${item.id}-${index}`,
          role: "user",
          content: item.turns[index]!,
          createdAt: "2026-10-23T15:00:00Z",
        });
        history.push({
          id: `a-${item.id}-${index}`,
          role: "assistant",
          content: response.content,
          createdAt: "2026-10-23T15:01:00Z",
        });
        continue;
      }
      const proposal = response.formProposal;
      expect(proposal, `${item.id} content: ${response.content.slice(0, 400)}`).toBeTruthy();
      expect(response.content, item.id).not.toMatch(/^I still need\b/);
      expect(response.content, item.id).not.toMatch(/You mentioned Lisa Smith/i);
      expect(response.content, item.id).not.toMatch(/earlier today/i);
      expect(proposal?.templateKey, item.id).toBe(item.templateKey);
      if (item.employee) expect(proposal?.employeeName, item.id).toBe(item.employee);
      if (item.employeeNot) expect(proposal?.employeeName ?? "", item.id).not.toMatch(item.employeeNot);
      if (item.locationId) expect(proposal?.locationId, item.id).toBe(item.locationId);
      if (item.formDate) expect(proposal?.formDate, item.id).toBe(item.formDate);
      if (item.employee === "Casey Quinn") {
        expect(response.content, item.id).toMatch(/couldn't find|didn't find|not in the Woven roster/i);
      }
      return;
    }
  });
});
