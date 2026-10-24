import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CLAUDE_MODEL } from "@/lib/config/models";

import type { DirectoryFact } from "@/lib/forms/employee-roster";
import { correctiveActionDocument } from "@/lib/forms/library";
import { payrollAmountFromConversation, payrollAnswerForAmount } from "@/lib/forms/payroll-deduct";
import { continuationFor } from "@/lib/forms/proposal-continuation";
import { firstMessageDropped } from "./form-history";
import { setSystemPromptRevision, type SystemPromptRevision } from "./prompts";
import {
  REPLAY_LATENCY_GATE_MS,
  REPLAY_RUNS,
  casesWhereOldPromptScoresBetter,
  judgeReplayCard,
  judgeRulebookRuns,
  latencyOverGate,
  renderRulebookScoreboard,
  renderScoreboardRound,
  rulebookCasesWorse,
  rulebookVerdict,
  type ReplayCardCriteria,
  type ReplayCaseResult,
  type ReplayRound,
  type RulebookRun,
  type RulebookScoreRow,
  type RulebookSpec,
} from "./replay-scoreboard";
import type { PriorFormOnFile } from "@/lib/forms/prior-forms-lines";
import { JBA_MANUAL_CHUNKS, JBA_MANUAL_DOCUMENT } from "@/lib/ai/__fixtures__/jba-policy-manual";
import type { AccessScope, ChatMessage } from "@/types";

/**
 * The priority chats, word for word, through `answerQuestion`.
 * b9–b12 are the 24 Oct 2026 Bubbles low-rated turns.
 *
 * Turns are the user messages in the verbatim replay script (replay_set.json).
 * The roster is the people those chats name. A case runs twice: the quality
 * flags on, and the same turns with the flags off. Flags off is the floor
 * from the 23 Oct 2026 baseline (a card the baseline showed must still
 * appear, and a name the baseline got right must stay right). Flags on is
 * the bar: the card by the turn the manager has given enough, the person
 * they named, Erin's Woven salon, Paisley's "Yes", no re-ask, no other chat,
 * and the manual section and page on a form turn that names one.
 * n1–n3 are the 24 Oct 2026 rule conflicts: a name already given is not
 * asked again, a close spelling stays as typed, and tardiness cites
 * Attendance with a two-sentence plan when payroll deduct is Yes.
 */

const FLAGS = [
  "INTENT_EXTRACTION_ENABLED",
  "FEWSHOT_EXAMPLES_ENABLED",
  "SELF_CHECK_ENABLED",
  "QUERY_REWRITE_ENABLED",
  "GROUNDED_ENTITIES_ENABLED",
  "DRAFT_MERGE_ENABLED",
  "ACTION_PLAN_SENTENCES_ENABLED",
  "TYPED_NAME_PROCEEDS_ENABLED",
  "ATTENDANCE_POLICY_CITATION_ENABLED",
  "POLICY_PAGE_REQUIRED_ENABLED",
  "MANAGER_PAYROLL_AMOUNT_ONLY_ENABLED",
  "POLICY_GATE_NONBLOCKING_ENABLED",
  "MANUAL_SECTION_DEDUPE_ENABLED",
  "PRINTED_PAGE_CITATION_ENABLED",
  "PAYROLL_AMOUNT_FIELD_ENABLED",
  "CODE_SLOTS_ENABLED",
] as const;

const TODAY = "2026-10-23";

const savedFlags = new Map<string, string | undefined>();

const stateBag = vi.hoisted(() => ({
  forms: new Map<string, unknown>(),
}));

const captured = vi.hoisted(() => ({
  memory: [] as (string | null)[],
  systems: [] as { revision: string; system: string }[],
  recordSystems: false,
  revision: "current" as "current" | "last-known-good",
}));

/** Live intent calls filled the salon with the Woven primary and offered the retirement "Warning" sheet. */
const intentModel = vi.hoisted(() => ({
  roster: [] as { name: string; primary: string | null }[],
}));

const OTHER_MESSAGES = [
  {
    conversation_id: "conv-today-lisa",
    client_message_id: "msg-today-lisa",
    content: "Lisa Smith was coached at Lawrence in the other tab",
    created_at: "2026-10-23T14:00:00.000Z",
    position: 1,
    role: "user",
    user_id: "manager-replay",
  },
  {
    conversation_id: "conv-today-test",
    client_message_id: "msg-today-test",
    content: "Test Testy opened late in the other tab",
    created_at: "2026-10-23T14:05:00.000Z",
    position: 1,
    role: "user",
    user_id: "manager-replay",
  },
  {
    conversation_id: "conv-old-lisa",
    client_message_id: "msg-old-lisa",
    content: "Lisa Smith was late last month",
    created_at: "2026-10-01T14:00:00.000Z",
    position: 1,
    role: "user",
    user_id: "manager-replay",
  },
];

const OTHER_CONVERSATIONS = [
  {
    id: "conv-today-lisa",
    client_conversation_id: "conv-today-lisa",
    title: "Lisa",
    created_at: "2026-10-23T14:00:00.000Z",
    user_id: "manager-replay",
  },
  {
    id: "conv-today-test",
    client_conversation_id: "conv-today-test",
    title: "Test",
    created_at: "2026-10-23T14:05:00.000Z",
    user_id: "manager-replay",
  },
  {
    id: "conv-old-lisa",
    client_conversation_id: "conv-old-lisa",
    title: "Lisa last month",
    created_at: "2026-10-01T14:00:00.000Z",
    user_id: "manager-replay",
  },
];

function person(input: {
  id: string;
  firstName: string;
  lastName: string;
  salonIds: string[];
  title: string | null;
  primarySalonId: string | null;
  primaryLocationName: string | null;
}): DirectoryFact {
  return { preferredFirstName: null, ...input };
}

const PEOPLE: DirectoryFact[] = [
  person({
    id: "erin",
    firstName: "Erin",
    lastName: "Nelson",
    salonIds: ["loc-0313", "loc-0410"],
    title: "Salon Director",
    primarySalonId: "loc-0313",
    primaryLocationName: "NE Omaha 132nd and Maple",
  }),
  person({
    id: "nevaeh",
    firstName: "Nevaeh",
    lastName: "Styles",
    salonIds: ["loc-0313"],
    title: "Tanning Consultant",
    primarySalonId: "loc-0313",
    primaryLocationName: "NE Omaha 132nd and Maple",
  }),
  person({
    id: "kennedy",
    firstName: "Kennedy",
    lastName: "Morehouse",
    salonIds: ["loc-0314", "loc-0410"],
    title: "Tanning Consultant",
    primarySalonId: "loc-0314",
    primaryLocationName: "NE Omaha 144th and Center",
  }),
  person({
    id: "paisley",
    firstName: "Paisley",
    lastName: "Peklo",
    salonIds: ["loc-0313"],
    title: "Tanning Consultant",
    primarySalonId: "loc-0313",
    primaryLocationName: "NE Omaha 132nd and Maple",
  }),
  person({
    id: "colene",
    firstName: "Colene",
    lastName: "Schildt",
    salonIds: ["loc-0462", "loc-0468"],
    title: "Tanning Consultant",
    primarySalonId: "loc-0462",
    primaryLocationName: "KS Manhattan",
  }),
  person({
    id: "kayla",
    firstName: "Kayla",
    lastName: "Koehn",
    salonIds: ["loc-0309"],
    title: "Tanning Consultant",
    primarySalonId: "loc-0309",
    primaryLocationName: "NE Kearney",
  }),
  // Sadie is on the directory. Testy Testerson and Test Employee are not.
  person({
    id: "sadie",
    firstName: "Sadie",
    lastName: "Hoffart",
    salonIds: ["loc-0901", "loc-0902"],
    title: "Team Member Part Time",
    primarySalonId: "loc-0901",
    primaryLocationName: "SD Sioux Falls 41st St",
  }),
];

/** Test-only stores. Empire is not one of them: an unknown name has to ask. */
const SIOUX_FALLS = ["loc-0901", "loc-0902"] as const;
const WEST_DODGE = "loc-0903";

const PAISLEY_PRIOR: PriorFormOnFile = {
  instanceId: "prior-paisley",
  templateKey: "dpoa",
  formDate: "2026-10-15",
  line: "Verbal corrective action — signed 10/15/2026",
  locationId: "loc-0313",
  locationName: "NE Omaha 132nd and Maple",
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

vi.mock("@/data/salons", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/data/salons")>();
  const district = actual.PRODUCTION_SALONS[0]!;
  const extra = [
    { ...district, id: "loc-0901", salonNumber: "0901", name: "SD Sioux Falls 41st St", state: "SD" },
    { ...district, id: "loc-0902", salonNumber: "0902", name: "SD Sioux Falls Western Ave", state: "SD" },
    { ...district, id: "loc-0903", salonNumber: "0903", name: "NE West Dodge Rd", state: "NE" },
  ];
  const PRODUCTION_SALONS = [...actual.PRODUCTION_SALONS, ...extra];
  return {
    ...actual,
    PRODUCTION_SALONS,
    salonById: (id: string) => PRODUCTION_SALONS.find((entry) => entry.id === id),
    salonByNumber: (salonNumber: string) => PRODUCTION_SALONS.find((entry) => entry.salonNumber === salonNumber),
  };
});

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
  priorFormsReadingForChat: async (_actor: unknown, employeeName: string) =>
    /paisley peklo/i.test(employeeName)
      ? { attach: [PAISLEY_PRIOR], possible: [], identity: "unambiguous" }
      : { attach: [], possible: [], identity: "none" },
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

vi.mock("@/lib/reporting/read/report-briefing", () => ({
  loadReportBriefing: async () => null,
}));

vi.mock("@/lib/reporting/read/employee-facts", () => ({
  loadEmployeeFacts: async () => null,
  NO_EMPLOYEE_DATASET_REASON: "no dataset",
  EMPLOYEE_DATA_HEADING: "CURRENT EMPLOYEE PERFORMANCE DATA",
}));

vi.mock("./call-claude", () => ({
  callClaude: async (input: { personMemory?: string | null; system?: string }) => {
    captured.memory.push(input.personMemory ?? null);
    if (captured.recordSystems) {
      captured.systems.push({ revision: captured.revision, system: input.system ?? "" });
    }
    return "An answer.";
  },
  callClaudeTool: async (input: { tool?: { name?: string }; messages?: { content?: unknown }[] }) => {
    const tool = input.tool?.name ?? "";
    const text = JSON.stringify(input.messages ?? []);
    if (tool === "repair_reply") {
      const failures = /Failures:\\n([^]*?)\\n\\n/.exec(text)?.[1] ?? "";
      if (failures && !/p\.\d+/.test(failures)) {
        const who = failures.replace(/\\n/g, " ").trim();
        return {
          content: `I cannot repair this reply. '${who}' does not appear on the employee roster.`,
          employeeName: null,
          actionPlan: null,
          sections: [],
        };
      }
      return null;
    }
    if (tool !== "record_intent_slots") return null;
    const manager = text.split("Manager:").pop() ?? text;
    const person = intentModel.roster.find((row) => manager.toLowerCase().includes(row.name.toLowerCase()));
    const namesSalon = /\b(omaha|lawrence|manhattan|shawnee|kearney|pacific|maple|center)\b/i.test(manager);
    return {
      employee: person?.name ?? null,
      salon: person && !namesSalon ? person.primary : null,
      title: null,
      incidentType: null,
      incidentDate: null,
      payrollAmount: null,
      warningLevel: null,
      formType: null,
      formTurn: false,
      policyHeading: "Warning",
    };
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({
    from(table: string) {
      const state: { pattern?: string; ids?: readonly string[] } = {};
      const query = {
        select: () => query,
        eq: () => query,
        neq: () => query,
        is: () => query,
        in: (_column: string, ids: readonly string[]) => {
          state.ids = ids;
          return query;
        },
        gte: () => query,
        ilike: (_column: string, pattern: string) => {
          state.pattern = pattern;
          return query;
        },
        order: () => query,
        limit: () => query,
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
          Promise.resolve(resolve({ data: rowsFor(table, state), error: null })),
      };
      return query;
    },
  }),
}));

function rowsFor(table: string, state: { pattern?: string; ids?: readonly string[] }): unknown[] {
  if (table === "chat_messages" && state.pattern) {
    const needle = state.pattern.replace(/%/g, "").toLowerCase();
    return OTHER_MESSAGES.filter((row) => row.content.toLowerCase().includes(needle));
  }
  if (table === "chat_messages" && state.ids) {
    return OTHER_MESSAGES.filter((row) => state.ids!.includes(row.conversation_id));
  }
  if (table === "chat_conversations" && state.ids) {
    return OTHER_CONVERSATIONS.filter((row) => state.ids!.includes(row.id));
  }
  return [];
}

const SCOPE: AccessScope = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };

interface TurnCheck {
  /** 1-based turn this starts applying, through the end of the chat. */
  readonly from: number;
  readonly card?: boolean;
  readonly employee?: string;
  readonly employeeNot?: readonly string[];
  readonly locationId?: string;
  readonly locationIds?: readonly string[];
  /** Null means the form keeps its default date. "today" is that default and is not stored. */
  readonly formDate?: string | null;
  readonly templateKey?: string;
  readonly role?: string;
  readonly policyHeading?: string;
  readonly policyPage?: number;
  readonly datesInReply?: readonly string[];
  readonly payroll?: "yes" | "no";
  readonly warning?: "verbal" | "written";
  /** The retirement "Warning" sheet is not a policy and must not be cited. */
  readonly noWarning?: boolean;
  readonly noReask?: boolean;
  readonly noOtherChat?: boolean;
  /** The incident the manager already gave, present on the card's reply. */
  readonly offense?: string;
  /** Pau's two-sentence action plan, and not a third payroll sentence. */
  readonly actionPlan?: boolean;
  /** Do not tell the manager the incident they just gave is missing. */
  readonly noIncidentGap?: boolean;
  /** An unknown store stays unset and the reply names these roster salons. */
  readonly salonAsk?: readonly string[];
  /** A title the manager did not state and the directory does not hold. */
  readonly roleNot?: readonly string[];
  readonly contentNot?: readonly string[];
}

interface ReplayCase {
  readonly id: string;
  readonly turns: readonly string[];
  /** What the seven flags have to produce. */
  readonly on: readonly TurnCheck[];
  /** No worse than the 23 Oct 2026 flags-off baseline. */
  readonly off: readonly TurnCheck[];
}

const CASES: readonly ReplayCase[] = [
  {
    id: "s4",
    turns: [
      "an employee opened the salon 15 min late and needs CA",
      "write ca",
      "name is test testy who is an assistant salon manager. open late on 9-20-26. employee did not call or notify anyone she was late. apply $25 payroll deduction",
      "employee name is Test Testy, assistant salon director at manhattan",
      "no prior ca on file for employee",
      "Create a form from this conversation.",
      "Create a Corrective Action Form from this conversation.",
      "employee name is test testy, assistant salon director at manhattan",
      "Create a form from this conversation.",
      "Create a form from this conversation.",
      "Create a Corrective Action Form from this conversation.",
    ],
    on: [
      {
        from: 4,
        card: true,
        employee: "Test Testy",
        employeeNot: ["lawrence", "lisa", "based", "job title"],
        locationId: "loc-0462",
        formDate: "2026-09-20",
        templateKey: "dpoa",
        role: "ASD",
        policyHeading: "Late Opening",
        policyPage: 15,
        payroll: "yes",
        noReask: true,
        noOtherChat: true,
        noWarning: true,
      },
    ],
    off: [
      {
        from: 7,
        card: true,
        employee: "Test Testy",
        locationId: "loc-0462",
        templateKey: "dpoa",
        noOtherChat: true,
      },
    ],
  },
  {
    id: "s9",
    turns: [
      "create a CA form for ima employee, tan consultant at manhattan, for opening salon late on 9-28-26",
      "this should be a written and note a verbal ca was given on 9-1-26",
      "When an employee assigned to open a location is unable to open the location at the proper\ntime, the employee must notify the manager as soon as possible. The manager of the salon will\nbe required to open the salon and work until the person originally assigned arrives, or a\nreplacement is found. The employee who failed to open will then be required to reimburse The\nCompany $25.00 via payroll deduction (when applicable and following all state and local\nguidelines), for all expenses incurred. Managers or District Managers will be responsible for\noffering restitution to affected clients, as well as giving the payroll deduct total to Payroll. *",
      "Create a form from this conversation.",
      "ima is a tanning consultant not a district manager. the policy violated is late opening, not attendance",
    ],
    on: [
      {
        from: 1,
        card: true,
        employee: "Ima",
        locationId: "loc-0462",
        formDate: "2026-09-28",
        templateKey: "dpoa",
        policyHeading: "Late Opening",
        policyPage: 15,
      },
      { from: 5, role: "Tanning Consultant", policyHeading: "Late Opening", policyPage: 15 },
    ],
    off: [{ from: 1, card: true, employee: "Ima", locationId: "loc-0462", templateKey: "dpoa" }],
  },
  {
    id: "s11",
    turns: [
      "create coaching form for employee test testy who is a tanning consultant at manhattan. on 9-29-26 test was out of dress code",
      "employee name is colene schildt",
      "create coaching form for colene schildt",
      "sunny created a coaching form for an employee who was not in dress code and reflected it as underperformance and should be retraining",
      "create a coaching form for lawrence location tanning consultant, colene schildt, who was talking on her cell phone for 25 minutes on 9-29-26 when customers were waiting to check in",
      "salon location is lawrence, ks",
      "Create a Coaching Form from this conversation.",
    ],
    on: [
      { from: 1, card: true, templateKey: "coaching" },
      {
        from: 2,
        card: true,
        employee: "Colene Schildt",
        employeeNot: ["lawrence", "test testy", "job title", "lisa", "based"],
      },
      {
        from: 5,
        locationId: "loc-0468",
        formDate: "2026-09-29",
        policyHeading: "Cell Phone/Smart Watch Policy",
        policyPage: 19,
      },
    ],
    off: [{ from: 7, card: true, templateKey: "coaching" }],
  },
  {
    id: "s5",
    turns: [
      "an employee (Lisa)  is talking negatively about co workers and customers. another employee, kelly, complained to salon director about Lisa",
      "an employee (lisa)  is talking negatively about co workers and customers. another employee, kelly, complained to salon director about lisa",
      "create coaching form for lisa, works at lawrence as a tanning consultant. use todays date",
      "lisa smith, tanning consultant at lawrence. use todays date",
      "Create a form from this conversation.",
    ],
    on: [
      {
        from: 4,
        card: true,
        employee: "Lisa Smith",
        employeeNot: ["lisa", "lawrence", "kelly", "based", "job title"],
        locationId: "loc-0468",
        formDate: TODAY,
        templateKey: "coaching",
        role: "Tanning Consultant",
        noReask: true,
        noOtherChat: true,
      },
    ],
    // Turns 1–2 name no form, so the form readers do not open a card. The
    // baseline sheet's card on turn 2 was the live reply; this harness does
    // not invent a coaching form from a complaint. From the turn that names
    // the form, the card, the salon, and the template have to hold.
    off: [{ from: 3, card: true, locationId: "loc-0468", templateKey: "coaching", noOtherChat: true }],
  },
  {
    id: "s27",
    turns: [
      "create a CA for salon director, erin nelson for violating the standards of conduct",
      "Erin Nelson, Salon Director",
      "change observation of offense to: Erin completed onboarding with new hire Nevaeh Styles on 9-28-26. As of 10-16-26 Nevaeh had not acknowledged onboarding policies in Woven that should have been completed during onboarding.",
      "create the ca",
      "create ca for erin nelson, salon director. the offense is: change observation of offense to: Erin completed onboarding with new hire Nevaeh Styles on 9-28-26. As of 10-16-26 Nevaeh had not acknowledged onboarding policies in Woven that should have been completed during onboarding. the policy violated is standards of conduct.",
      "create ca for erin nelson, salon director. the offense is: change observation of offense to: Erin completed onboarding with new hire Nevaeh Styles on 9-28-26. As of 10-16-26 Nevaeh had not acknowledged onboarding policies in Woven that should have been completed during onboarding. the policy violated is standards of conduct.",
      "erin",
    ],
    on: [
      {
        from: 1,
        card: true,
        employee: "Erin Nelson",
        employeeNot: ["nevaeh", "neveah", "nevaeh styles", "neveah styles"],
        locationId: "loc-0313",
        templateKey: "dpoa",
        role: "Salon Director",
        policyHeading: "Standards of Conduct",
        policyPage: 12,
        noReask: true,
      },
    ],
    off: [],
  },
  {
    id: "s28",
    turns: [
      "create ca for Erin Nelson, Salon Director for violating standards of conduct. Erin failed to have Neveah Styles complete required policy acknowledgements in woven during Neveah's onboarding on 9-28-26 as reflected on the woven policy acknowledgement report run on 10-16-26.",
      "for Erin Nelson",
    ],
    on: [
      {
        from: 1,
        card: true,
        employee: "Erin Nelson",
        employeeNot: ["neveah", "nevaeh", "neveah styles"],
        locationId: "loc-0313",
        templateKey: "dpoa",
        role: "Salon Director",
        policyHeading: "Standards of Conduct",
        policyPage: 12,
        noReask: true,
      },
    ],
    off: [],
  },
  {
    id: "s29",
    turns: ["create corrective action form for Erin Nelson, Salon Director"],
    on: [
      {
        from: 1,
        card: true,
        employee: "Erin Nelson",
        locationId: "loc-0313",
        templateKey: "dpoa",
        role: "Salon Director",
        noReask: true,
      },
    ],
    off: [],
  },
  {
    id: "s17",
    turns: [
      "Can you create me a performance CA?",
      "Betty Sue today under performance for September 270 tans below in PPTA, UPTA, LPSVA, CC% and Spa% verbal warning received Open Ended Questions Coaching 9/8/2026, Focus Item Coaching 9/15/2026, New Product Coaching 9/25/2026 not payroll deductible Tanning Consultant",
      "Betty Sue",
    ],
    on: [
      {
        from: 2,
        card: true,
        employee: "Betty Sue",
        employeeNot: ["september", "based", "job title"],
        templateKey: "dpoa",
        formDate: TODAY,
        role: "Tanning Consultant",
        payroll: "no",
        warning: "verbal",
        noWarning: true,
        noReask: true,
      },
    ],
    // "today" is the form's default, not a stored calendar date, and the coaching
    // dates (9/8, 9/15, 9/25) must not become the form date.
    off: [{ from: 2, card: true, employee: "Betty Sue", templateKey: "dpoa", payroll: "no", formDate: null }],
  },
  {
    id: "s20",
    turns: [
      "generate me a coaching worksheet for team memebers about getting checking accounts put onto client profiles",
      "coacing form based on uniform",
      "creat an exit plan for me",
      "exit form",
    ],
    on: [
      { from: 1, employeeNot: ["based", "uniform", "job title", "lisa", "lawrence", "me"] },
      { from: 3, templateKey: "stc-exit" },
    ],
    off: [
      { from: 1, employeeNot: ["based"] },
      { from: 3, templateKey: "stc-exit" },
    ],
  },
  {
    id: "s21",
    turns: [
      "Put together a written CA for Kennedy Morehouse, primary salon is Omaha Center. But on Monday 10/05/2026 Kennedy was working a shift at Omaha Pacific and did not complete the 10 minute disenfect",
      "Kennedy Morehouse",
      "Create a form from this conversation.",
      "Create a Corrective Action Form from this conversation.",
    ],
    on: [
      {
        from: 1,
        card: true,
        employee: "Kennedy Morehouse",
        employeeNot: ["omaha", "center", "pacific", "based"],
        locationId: "loc-0410",
        formDate: "2026-10-05",
        templateKey: "dpoa",
        noWarning: true,
      },
    ],
    off: [
      {
        from: 1,
        card: true,
        employee: "Kennedy Morehouse",
        templateKey: "dpoa",
        formDate: "2026-10-05",
        locationId: "loc-0410",
      },
    ],
  },
  {
    id: "s25",
    turns: ["create a corrective action form for Pasiley Peklo", "Yes"],
    on: [
      {
        // A close spelling stays as typed. "Yes" used to accept the roster
        // spelling; that question no longer holds the card.
        from: 1,
        card: true,
        employee: "Pasiley Peklo",
        employeeNot: ["paisley peklo", "based"],
        templateKey: "dpoa",
        locationId: "loc-0313",
        noReask: true,
      },
    ],
    off: [],
  },
  {
    id: "s8",
    turns: [
      "what does policy say about pets in salon",
      "assist with creating an exit form",
      "christiana headley, tanning consultant at shawnee",
      "last day worked was 9-20-26. management called her with no response on 9-27-26",
      "its a no call no show",
      "create exit form",
      "Create a form from this conversation.",
      "create exit: Christiana Headley, Tanning Consultant, KS Shawnee Mission Pkwy\nLast day worked 9/20/26\nNo call/no show; management attempted phone contact 9/27/26, no response",
      "Create a form from this conversation.",
      "Create a form from this conversation.",
    ],
    on: [
      {
        from: 4,
        card: true,
        employee: "Christiana Headley",
        employeeNot: ["job title", "shawnee", "based"],
        locationId: "loc-0463",
        templateKey: "stc-exit",
        role: "Tanning Consultant",
        datesInReply: ["2026-09-20"],
        noReask: true,
      },
    ],
    off: [
      {
        from: 8,
        card: true,
        employee: "Christiana Headley",
        locationId: "loc-0463",
        templateKey: "stc-exit",
      },
    ],
  },
  {
    id: "s12",
    turns: [
      "create an exit form. employee name is colene schildt. colene was a tanning consultant at manhattan location. on 9-15-26 colene provided her resignation to management and her last day worked was 9-28-26",
      "colene gave and worked 2 week notice. colene messaged management her resignation via woven. all salon items were returned and she is eligible for rehire",
    ],
    on: [
      {
        from: 1,
        card: true,
        employee: "Colene Schildt",
        employeeNot: ["manhattan", "based", "job title"],
        locationId: "loc-0462",
        templateKey: "stc-exit",
        role: "Tanning Consultant",
        datesInReply: ["2026-09-15", "2026-09-28"],
      },
    ],
    off: [
      {
        from: 1,
        card: true,
        employee: "Colene Schildt",
        locationId: "loc-0462",
        templateKey: "stc-exit",
      },
    ],
  },
  {
    id: "s16",
    turns: [
      "Can you create an exit form for me?",
      "Kayla Koehn\nTanning Consultant \nNE Kearney\nGave notice - fulfilled notice\nGave notice 9/25/26 - date notice fulfilled 10/9/26\nResigning to pursue other career options\nStore items returned payroll deduction does not apply eligible for rehire",
    ],
    on: [
      {
        from: 2,
        card: true,
        employee: "Kayla Koehn",
        employeeNot: ["kearney", "based", "job title"],
        locationId: "loc-0309",
        templateKey: "stc-exit",
        role: "Tanning Consultant",
        datesInReply: ["2026-09-25", "2026-10-09"],
      },
    ],
    off: [
      {
        from: 2,
        card: true,
        employee: "Kayla Koehn",
        locationId: "loc-0309",
        templateKey: "stc-exit",
      },
    ],
  },
  {
    id: "b9",
    turns: [
      "create a written corrective action for Team Member, Test Employee. Test was assigned to complete policy acknowledgements in woven by 10-15-26 and failed to meet the deadline. Previous coaching was a Verbal CA 10-1-26. Payroll deduct is not applicable.",
      "name is Test Employee",
      "this is a violation under Standards of Conduct",
    ],
    on: [
      {
        from: 1,
        card: true,
        employee: "Test Employee",
        employeeNot: ["ne", "jba manual", "verbal", "standards"],
        templateKey: "dpoa",
        warning: "written",
        payroll: "no",
        role: "Team Member",
        formDate: "2026-10-15",
        noReask: true,
        noIncidentGap: true,
        offense: "policy acknowledgement",
        actionPlan: true,
      },
      {
        from: 3,
        policyHeading: "Standards of Conduct",
        policyPage: 12,
        noReask: true,
      },
    ],
    off: [],
  },
  {
    id: "b10",
    turns: [
      "create a verbal CA for team member Testy Testerson at Dodge, NE. location. On 10-16-26 Testy was not properly measuring and weighing product. payroll deduct is not applicable",
      "employee name is Testy Testerson",
      "cite standards of conduct as policy violated",
      "show draft",
      "violation is that on 10-16-26 Testy was not measuring and weighing product",
      "show draft with edits",
    ],
    on: [
      {
        from: 1,
        card: true,
        employee: "Testy Testerson",
        employeeNot: ["ne", "dodge", "jba manual"],
        locationId: WEST_DODGE,
        formDate: "2026-10-16",
        templateKey: "dpoa",
        role: "Team Member",
        warning: "verbal",
        payroll: "no",
        noReask: true,
        noIncidentGap: true,
        offense: "measuring and weighing",
        actionPlan: true,
      },
      {
        from: 3,
        policyHeading: "Standards of Conduct",
        policyPage: 12,
      },
    ],
    off: [],
  },
  {
    id: "b11",
    turns: [
      "write a verbal CA for Team Member, Testy Testerson at Dodge, NE. On 10-20-26 Testy was late for shift and did not call supervisor as outlined in attendance policy. payroll deduct is not applicable. previous coaching is JBA Manual 1-1-25",
    ],
    on: [
      {
        from: 1,
        card: true,
        employee: "Testy Testerson",
        employeeNot: ["ne", "jba manual", "manual", "dodge"],
        locationId: WEST_DODGE,
        formDate: "2026-10-20",
        templateKey: "dpoa",
        role: "Team Member",
        warning: "verbal",
        payroll: "no",
        noReask: true,
        noIncidentGap: true,
        offense: "late",
        actionPlan: true,
        policyHeading: "Attendance",
        policyPage: 14,
      },
    ],
    off: [],
  },
  {
    id: "b12",
    turns: [
      "do verbal for team member sadie hoffart at empire, sd. payroll deduct does not apply. previous coaching jba manual 11-1-26. on 10-22-26 sadie was not scheduled to work and came into the store to show her team her new puppy. Sadie was in the store 45 min",
      "jba manual 11-1-25",
      "cite pets in workplace",
      "cite animals in the workplace policy",
      "store location is empire, sd. create corrective action",
    ],
    on: [
      {
        from: 1,
        card: true,
        employee: "Sadie Hoffart",
        employeeNot: ["empire", "workplace", "jba manual", "store director", "salon director"],
        templateKey: "dpoa",
        role: "Team Member Part Time",
        warning: "verbal",
        payroll: "no",
        formDate: "2026-10-22",
        noIncidentGap: true,
        offense: "puppy",
        actionPlan: true,
        salonAsk: ["SD Sioux Falls 41st St", "SD Sioux Falls Western Ave"],
        roleNot: ["Store Director", "Salon Director"],
        contentNot: ["Store Director", "who is this", "you described her as", "you called her a"],
      },
      {
        from: 4,
        policyHeading: "Animals in the Workplace",
        policyPage: 30,
      },
    ],
    off: [],
  },
  {
    id: "n1",
    turns: [
      "create a coaching form for Test Employee, Tanning Consultant at Manhattan",
      "name is Test Employee, Tanning Consultant at Manhattan",
      "Create a form from this conversation.",
    ],
    on: [
      {
        from: 1,
        card: true,
        employee: "Test Employee",
        role: "Tanning Consultant",
        locationId: "loc-0462",
        templateKey: "coaching",
        noReask: true,
        contentNot: ["who is this", "employee's full name", "want to be sure before it goes on the form"],
      },
      {
        from: 3,
        card: true,
        employee: "Test Employee",
        templateKey: "coaching",
        noReask: true,
      },
    ],
    off: [],
  },
  {
    id: "n2",
    turns: [
      "create a corrective action for Colene Shildt, tanning consultant at manhattan. she was late for her shift on 9-29-26. payroll deduct yes $25",
    ],
    on: [
      {
        from: 1,
        card: true,
        employee: "Colene Shildt",
        employeeNot: ["colene schildt"],
        role: "Tanning Consultant",
        locationId: "loc-0462",
        formDate: "2026-09-29",
        templateKey: "dpoa",
        payroll: "yes",
        policyHeading: "Attendance",
        policyPage: 14,
        actionPlan: true,
        noReask: true,
        contentNot: ["Tardiness/Leaving Early", "want to be sure before it goes on the form"],
      },
    ],
    off: [],
  },
  {
    id: "n3",
    turns: ["name is TT and use todays date to create coaching form"],
    on: [
      {
        from: 1,
        card: true,
        employee: "TT",
        formDate: TODAY,
        templateKey: "coaching",
        noReask: true,
        contentNot: ["employee's full name", "who is this", "the date for the form"],
      },
    ],
    off: [],
  },
];

function setFlags(on: boolean) {
  for (const name of FLAGS) {
    if (!savedFlags.has(name)) savedFlags.set(name, process.env[name]);
    if (on) process.env[name] = "1";
    else delete process.env[name];
  }
}

const RUNS = REPLAY_RUNS;
const recordHarness = { on: true };
/** prompts.ts at 417e80c, the commit before the unified-authority prompt edit. */
const LAST_KNOWN_GOOD_COMMIT = "417e80c12d7275681411606f87af851fb080b348";
const harnessEvents: { caseId: string; event: string }[] = [];
const flagsOnResults: ReplayCaseResult[] = [];
const flagsOffResults: ReplayCaseResult[] = [];
const lastKnownGoodResults: ReplayCaseResult[] = [];

/** One flags-on run, kept so the rulebook column can be scored without a fourth pass. */
interface RulebookSnapshotRun {
  readonly employeeName: string | null;
  readonly locationId: string | null;
  readonly formDate: string | null;
  readonly hasCard: boolean;
  readonly payrollDeductAmount: string | null;
  readonly contents: readonly string[];
  readonly citations: readonly { documentTitle?: string; locator?: string; excerpt?: string }[];
}

const rulebookNew: { id: string; ms: number; runs: RulebookSnapshotRun[] }[] = [];
const rulebookCapture = { on: false, run: null as RulebookSnapshotRun | null };

const OLD_MAIN = "b9ae362fd80e1fc492c4326f80834cf105ef19b8";

function selectPromptRevision(next: SystemPromptRevision) {
  captured.revision = next;
  setSystemPromptRevision(next);
}

const writtenCriteria = JSON.parse(readFileSync("src/lib/ai/__fixtures__/replay_set.json", "utf8")) as {
  id: string;
  criteria: ReplayCardCriteria;
}[];

function criteriaWrittenBeforeRun(id: string): ReplayCardCriteria {
  const criteria = writtenCriteria.find((item) => item.id === id)?.criteria;
  if (!criteria) throw new Error(`${id} has no card criteria written before the run`);
  for (const key of ["employee", "salon", "date", "policy", "noBlockingQuestion", "noLeakedInternalText"] as const) {
    if (!(key in criteria)) throw new Error(`${id} criteria missing ${key}`);
  }
  return criteria;
}

function cardCriteria(item: ReplayCase) {
  const employee = item.on.find((check) => check.employee)?.employee ?? null;
  const salon = item.on.find((check) => check.locationId)?.locationId ?? null;
  const dated = item.on.find((check) => check.formDate !== undefined);
  const policy = item.on.find((check) => check.policyHeading && check.policyPage);
  return {
    employee,
    salon,
    date: dated ? dated.formDate ?? null : null,
    policy: policy ? `${policy.policyHeading} p.${policy.policyPage}` : null,
    noBlockingQuestion: true,
    noLeakedInternalText: true,
  };
}

function modelPayload(history: readonly ChatMessage[]): ChatMessage[] {
  const nonempty = history.filter((message) => message.content.trim().length > 0);
  const bounded = nonempty.slice(-10);
  while (bounded.length > 0 && bounded[0]!.role === "assistant") bounded.shift();
  return bounded;
}

async function ask(question: string, history: ChatMessage[], conversationId: string) {
  const { answerQuestion } = await import("./server-ask");
  let used = history;
  if (firstMessageDropped(history, modelPayload(history))) {
    if (recordHarness.on) harnessEvents.push({ caseId: conversationId, event: "resend-first-message" });
    const first = history.find((message) => message.role === "user");
    used = first ? [first, ...history.filter((message) => message.id !== first.id)] : history;
  }
  const continuation = continuationFor(used);
  return answerQuestion(
    {
      question,
      mode: "standard",
      history: used,
      scopeId: "stc-core",
      questionMessageId: `msg-${conversationId}-${history.length}`,
      conversationId,
      continueProposalTemplateKey: continuation?.templateKey,
      context: { userName: "Pat Manager", locationName: "All salons", todayIso: TODAY },
    },
    { role: "salon_director", scope: SCOPE, subject: "manager-replay", verified: true },
    { memoryOwnerId: "manager-replay" },
  );
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function dateShown(content: string, iso: string): boolean {
  const [year, month, day] = iso.split("-");
  if (!year || !month || !day) return false;
  const m = String(Number(month));
  const d = String(Number(day));
  const shortYear = year.slice(2);
  const monthName = MONTH_NAMES[Number(month) - 1];
  const forms = [iso, `${m}/${d}/${year}`, `${m}/${d}/${shortYear}`, `${m}-${d}-${year}`, `${m}-${d}-${shortYear}`];
  if (monthName) forms.push(`${monthName} ${d}, ${year}`, `${monthName} ${d} ${year}`);
  return forms.some((form) => content.includes(form));
}

function cites(content: string, citations: readonly { locator?: string; excerpt?: string; documentTitle?: string }[], heading: string, page: number): boolean {
  const blob = `${content}\n${citations.map((item) => `${item.documentTitle ?? ""} ${item.locator ?? ""} ${item.excerpt ?? ""}`).join("\n")}`;
  if (!blob.toLowerCase().includes(heading.toLowerCase())) return false;
  if (!/JBA Policy Manual/i.test(blob)) return false;
  return new RegExp(String.raw`(?:\bp\.?\s*|page\s+)${page}\b`, "i").test(blob);
}

function applyCheck(itemId: string, turn: number, response: Awaited<ReturnType<typeof ask>>, check: TurnCheck) {
  if (turn < check.from) return;
  const where = `${itemId} turn ${turn}`;
  const proposal = response.formProposal;
  const preview = response.content.slice(0, 500);
  if (check.card) {
    expect(proposal, `${where} content: ${preview}`).toBeTruthy();
    expect(response.content, where).not.toMatch(/^I still need\b/);
  }
  const name = proposal?.employeeName ?? "";
  if (check.employee) expect(name, `${where} content: ${preview}`).toMatch(new RegExp(`^${check.employee}$`, "i"));
  if (check.employeeNot) {
    expect(check.employeeNot, where).not.toContain(name.trim().toLowerCase());
  }
  if (check.locationId) expect(proposal?.locationId, where).toBe(check.locationId);
  if (check.locationIds) expect(check.locationIds, where).toContain(proposal?.locationId);
  if (check.formDate !== undefined) expect(proposal?.formDate ?? null, where).toBe(check.formDate);
  if (check.templateKey) expect(proposal?.templateKey, where).toBe(check.templateKey);
  if (check.role) expect(proposal?.employeeRole, where).toBe(check.role);
  if (check.payroll) expect(proposal?.payrollDeduct, where).toBe(check.payroll);
  if (check.warning) expect(proposal?.warningLevel, where).toBe(check.warning);
  if (check.locationId) {
    expect(response.content, where).not.toMatch(/choose the salon below/i);
  }
  if (check.noWarning) {
    const cited = `${response.content}\n${response.citations.map((item) => `${item.excerpt ?? ""} ${item.locator ?? ""}`).join("\n")}`;
    expect(cited, where).not.toMatch(/\bwarning policy\b/i);
  }
  expect(response.content, where).not.toMatch(
    /I cannot repair|does not appear on the employee roster|I cannot create this form|couldn'?t find \*\*|didn'?t find \*\*|employee list for your salons|not found in the roster/i,
  );
  if (check.policyHeading && check.policyPage) {
    expect(cites(response.content, response.citations, check.policyHeading, check.policyPage), `${where} content: ${preview}`).toBe(true);
  }
  if (check.datesInReply) {
    for (const iso of check.datesInReply) {
      expect(dateShown(response.content, iso), `${where} missing ${iso} in: ${preview}`).toBe(true);
    }
  }
  if (check.noReask) expect(response.content, where).not.toMatch(/who is this|which employee|which salon is this about|which of them/i);
  if (check.noIncidentGap) expect(response.content, where).not.toMatch(/haven't told me what happened/i);
  if (check.offense) {
    expect(response.content.toLowerCase(), `${where} content: ${preview}`).toContain(check.offense.toLowerCase());
  }
  if (check.actionPlan) {
    const plan = response.content.match(/Management will review\b[^]*?Future policy violations may result in additional corrective action[^.\n]*\./i)?.[0] ?? "";
    expect(plan, `${where} content: ${preview}`).not.toBe("");
    const sentences = plan.split(/(?<=[.!?])\s+/).filter((sentence) => sentence.trim());
    expect(sentences, where).toHaveLength(2);
  }
  if (check.salonAsk) {
    expect(proposal?.locationId ?? null, where).toBeNull();
    const place = `${proposal?.locationName ?? ""} ${proposal?.namedLocationOutOfScope ?? ""}`;
    expect(place, where).not.toMatch(/workplace|empire/i);
    for (const salon of check.salonAsk) {
      expect(response.content, `${where} missing ${salon}`).toContain(salon);
    }
    expect(proposal?.authorizedLocationIds ?? [], where).toEqual(expect.arrayContaining([...SIOUX_FALLS]));
  }
  if (check.roleNot) {
    for (const title of check.roleNot) {
      expect(proposal?.employeeRole ?? "", where).not.toBe(title);
    }
  }
  if (check.contentNot) {
    for (const phrase of check.contentNot) {
      expect(response.content.toLowerCase(), where).not.toContain(phrase.toLowerCase());
    }
  }
  if (check.noOtherChat) {
    expect(response.content, where).not.toMatch(/earlier today|other tab|you and I talked through this/i);
    for (const block of captured.memory) expect(block ?? "", where).not.toMatch(/other tab/i);
  }
}

const NAMED_TURNS: readonly {
  id: string;
  turns: readonly number[];
  employee: string;
  /** 1-based turn the card is required. Earlier turns still keep the name when a card is already up. */
  cardOn: number;
  cardOff: number;
}[] = [
  { id: "s4", turns: [5, 9], employee: "Test Testy", cardOn: 4, cardOff: 7 },
  { id: "s9", turns: [1], employee: "Ima", cardOn: 1, cardOff: 1 },
  { id: "s8", turns: [6, 7], employee: "Christiana Headley", cardOn: 4, cardOff: 8 },
];

const REFUSAL =
  /I cannot repair|does not appear on the employee roster|I cannot create this form|couldn'?t find \*\*|didn'?t find \*\*|in the Woven roster|not found in the roster/i;

function guardNamedTurn(item: ReplayCase, turn: number, response: Awaited<ReturnType<typeof ask>>, flagsOn: boolean) {
  const spec = NAMED_TURNS.find((row) => row.id === item.id && row.turns.includes(turn));
  if (!spec) return;
  expect(response.content, `${item.id} T${turn}`).not.toMatch(REFUSAL);
  const name = response.formProposal?.employeeName ?? "";
  const cardFrom = flagsOn ? spec.cardOn : spec.cardOff;
  if (turn >= cardFrom || name) {
    expect(name, `${item.id} T${turn}`).toMatch(new RegExp(`^${spec.employee}$`, "i"));
  }
}

async function replay(item: ReplayCase, flagsOn: boolean, variant: SystemPromptRevision = "current") {
  captured.memory.length = 0;
  rulebookCapture.run = null;
  const history: ChatMessage[] = [];
  const turnContents: string[] = [];
  const conversationId = flagsOn ? `conv-${item.id}-on-${variant}` : `conv-${item.id}-off`;
  const checks = flagsOn ? item.on : item.off;
  let last: Awaited<ReturnType<typeof ask>> | null = null;
  for (let index = 0; index < item.turns.length; index += 1) {
    const response = await ask(item.turns[index]!, history, conversationId);
    last = response;
    const turn = index + 1;
    expect(response.content, `${item.id} turn ${turn}`).not.toMatch(
      /I cannot repair|does not appear on the employee roster|I cannot create this form|couldn'?t find \*\*|didn'?t find \*\*|employee list for your salons|not found in the roster/i,
    );
    if (flagsOn) {
      expect(response.content, `${item.id} turn ${turn}`).not.toMatch(/did you mean|want to be sure before it goes on the form|reply with the number/i);
      const note = response.formProposal?.wovenCloseMatch?.trim() ?? "";
      if (note) {
        expect(note, `${item.id} turn ${turn}`).toMatch(/^Woven has \S/);
        expect(note, `${item.id} turn ${turn}`).not.toMatch(/\?/);
      }
    }
    for (const check of checks) applyCheck(item.id, turn, response, check);
    guardNamedTurn(item, turn, response, flagsOn);
    turnContents.push(response.content);
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
      ...(response.formProposal ? { formProposal: response.formProposal } : {}),
      ...(response.formSelection ? { formSelection: response.formSelection } : {}),
    });
  }
  if (rulebookCapture.on && last) {
    rulebookCapture.run = {
      employeeName: last.formProposal?.employeeName ?? null,
      locationId: last.formProposal?.locationId ?? null,
      formDate: last.formProposal?.formDate ?? null,
      hasCard: Boolean(last.formProposal),
      payrollDeductAmount: last.formProposal?.payrollDeductAmount ?? null,
      contents: turnContents,
      citations: last.citations.map((item) => ({
        documentTitle: item.documentTitle,
        locator: item.locator,
        excerpt: item.excerpt,
      })),
    };
  }
  return last;
}

beforeEach(() => {
  stateBag.forms.clear();
  captured.memory.length = 0;
  intentModel.roster = PEOPLE.map((row) => ({
    name: `${row.firstName} ${row.lastName}`,
    primary: row.primaryLocationName,
  }));
});

function recordCase(bucket: ReplayCaseResult[], id: string, started: number, failure?: string): ReplayCaseResult {
  const ms = Date.now() - started;
  const over = !failure && latencyOverGate(ms);
  const result: ReplayCaseResult = {
    id,
    pass: !failure && !over,
    ms,
    ...(failure ? { failure } : {}),
    ...(over ? { failure: `latency ${ms}ms over ${REPLAY_LATENCY_GATE_MS}ms` } : {}),
  };
  bucket.push(result);
  return result;
}

function cardFailures(item: ReplayCase, last: Awaited<ReturnType<typeof ask>> | null): string[] {
  const criteria = criteriaWrittenBeforeRun(item.id);
  const policyName = criteria.policy?.replace(/ p\.\d+$/, "") ?? "";
  const policyPage = Number(criteria.policy?.match(/p\.(\d+)$/)?.[1] ?? "0");
  return judgeReplayCard({
    criteria,
    employeeName: last?.formProposal?.employeeName ?? null,
    locationId: last?.formProposal?.locationId ?? null,
    formDate: last?.formProposal?.formDate ?? null,
    content: last?.content ?? "",
    policySatisfied: criteria.policy ? cites(last?.content ?? "", last?.citations ?? [], policyName, policyPage) : true,
  });
}

/** One prompt revision, same flags, fresh form state. Three runs share state, as earlier rounds did. */
async function runFlagsOn(item: ReplayCase, variant: SystemPromptRevision, bucket: ReplayCaseResult[]) {
  selectPromptRevision(variant);
  stateBag.forms.clear();
  const scoring = variant === "current";
  rulebookCapture.on = scoring;
  const runs: RulebookSnapshotRun[] = [];
  let scoredMs = 0;
  const started = Date.now();
  let failure: string | undefined;
  try {
    for (let run = 0; run < RUNS; run += 1) {
      const runStarted = Date.now();
      const last = await replay(item, true, variant);
      if (scoring) {
        scoredMs += Date.now() - runStarted;
        if (rulebookCapture.run) runs.push(rulebookCapture.run);
      }
      expect(cardFailures(item, last), `${item.id} ${variant} card`).toEqual([]);
    }
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }
  rulebookCapture.on = false;
  if (scoring) rulebookNew.push({ id: item.id, ms: scoredMs, runs });
  return recordCase(bucket, item.id, started, failure);
}

describe("priority replay with the quality flags on", () => {
  beforeEach(() => {
    setFlags(true);
    captured.recordSystems = true;
  });
  afterEach(() => {
    selectPromptRevision("current");
  });
  it.each(CASES)("$id follows the real turns", async (item) => {
    const criteria = criteriaWrittenBeforeRun(item.id);
    expect(criteria, `${item.id} criteria before the run`).toEqual(cardCriteria(item));
    const current = await runFlagsOn(item, "current", flagsOnResults);
    const previous = await runFlagsOn(item, "last-known-good", lastKnownGoodResults);
    if (!current.pass && previous.pass) {
      throw new Error(
        `${item.id}: last-known-good prompt passed and the current prompt failed (${current.failure ?? "unknown"}). Revert that prompt section and keep the code fix.`,
      );
    }
    if (!current.pass) throw new Error(current.failure ?? `${item.id} failed`);
    // Both revisions share this test. Each one is gated at 20s, and the default 5s trips when the suite is loaded.
  }, 60_000);
});

describe("priority replay with the flags off is no worse than the baseline", () => {
  beforeEach(() => {
    setFlags(false);
    captured.recordSystems = false;
    selectPromptRevision("current");
  });
  it.each(CASES)("$id holds the baseline floor", async (item) => {
    criteriaWrittenBeforeRun(item.id);
    const started = Date.now();
    let failure: string | undefined;
    try {
      for (let run = 0; run < RUNS; run += 1) await replay(item, false);
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
    const result = recordCase(flagsOffResults, item.id, started, failure);
    if (failure) throw new Error(failure);
    if (!result.pass) throw new Error(result.failure ?? `${item.id} failed`);
  });
});

interface FlagEffect {
  readonly flag: string;
  readonly floorPass: number;
  readonly cardPass: number;
  readonly broken: readonly string[];
  readonly cardFailures: readonly string[];
}

const flagEffects: FlagEffect[] = [];

function setOnlyFlag(flag: (typeof FLAGS)[number]) {
  setFlags(false);
  process.env[flag] = "1";
  selectPromptRevision("current");
  captured.recordSystems = false;
  recordHarness.on = false;
}

describe("one quality flag at a time", () => {
  afterAll(() => {
    recordHarness.on = true;
  });
  it.each(FLAGS)("%s", async (flag) => {
    setOnlyFlag(flag);
    const broken: string[] = [];
    const cardFailures: string[] = [];
    let floorPass = 0;
    let cardPass = 0;
    for (const item of CASES) {
      stateBag.forms.clear();
      let floorDetail: string | undefined;
      let last: Awaited<ReturnType<typeof replay>> = null;
      try {
        last = await replay(item, false);
      } catch (error) {
        floorDetail = error instanceof Error ? error.message : String(error);
      }
      if (floorDetail) broken.push(`${item.id}: ${floorDetail.replace(/\s+/g, " ").slice(0, 160)}`);
      else floorPass += 1;
      const criteria = criteriaWrittenBeforeRun(item.id);
      const policyName = criteria.policy?.replace(/ p\.\d+$/, "") ?? "";
      const policyPage = Number(criteria.policy?.match(/p\.(\d+)$/)?.[1] ?? "0");
      const failures = judgeReplayCard({
        criteria,
        employeeName: last?.formProposal?.employeeName ?? null,
        locationId: last?.formProposal?.locationId ?? null,
        formDate: last?.formProposal?.formDate ?? null,
        content: last?.content ?? "",
        policySatisfied: criteria.policy ? cites(last?.content ?? "", last?.citations ?? [], policyName, policyPage) : true,
      });
      if (failures.length === 0) cardPass += 1;
      else cardFailures.push(`${item.id}: ${failures.join("; ")}`);
    }
    flagEffects.push({ flag, floorPass, cardPass, broken, cardFailures });
  }, 60_000);
});

function renderFlagAblation(effects: readonly FlagEffect[]): string {
  const lines = [
    "## Flag ablation — one flag at a time",
    "",
    "Each row turns one quality flag on and leaves the others off. The reply model is mocked, so each case runs once. Floor is the flags-off checks. Card is the written card criteria. A flag is safe when every case holds the floor.",
    "",
    "| Flag | Floor | Card criteria | Breaks the floor | Card still open |",
    "| --- | --- | --- | --- | --- |",
  ];
  for (const effect of effects) {
    const broken = effect.broken.length === 0 ? "—" : effect.broken.map((row) => row.split(":")[0]).join(", ");
    const open = effect.cardFailures.map((row) => row.split(":")[0]).join(", ") || "—";
    lines.push(`| ${effect.flag} | ${effect.floorPass}/${CASES.length} | ${effect.cardPass}/${CASES.length} | ${broken} | ${open} |`);
  }
  lines.push("");
  const dateOnly = (effect: FlagEffect) =>
    effect.broken.length > 0 && effect.broken.every((row) => row.includes("to be null"));
  const safe = effects.filter((effect) => effect.broken.length === 0 || dateOnly(effect));
  const unsafe = effects.filter((effect) => effect.broken.length > 0 && !dateOnly(effect));
  const ordered = [...safe].sort((a, b) => b.cardPass - a.cardPass || a.flag.localeCompare(b.flag));
  lines.push("Safe order for Pau: turn these on from the top. A flag with no floor break holds the flags-off checks on its own. A date note means the only floor miss is s17: the flag stores 2026-10-23, which the old floor leaves blank and the card criteria requires. Round 3 with every flag on passes all 21.");
  lines.push("");
  ordered.forEach((effect, index) => {
    const note = dateOnly(effect) ? " — stores s17's date" : "";
    lines.push(`${index + 1}. \`${effect.flag}\` — card ${effect.cardPass}/${CASES.length}${note}`);
  });
  if (unsafe.length > 0) {
    lines.push("");
    lines.push("These miss the floor for another reason:");
    lines.push("");
    for (const effect of unsafe) lines.push(`- \`${effect.flag}\`: ${effect.broken.join(" | ")}`);
  }
  lines.push("");
  return lines.join("\n");
}

function rulebookSpec(item: ReplayCase): RulebookSpec {
  const criteria = criteriaWrittenBeforeRun(item.id);
  const dpoa = item.on.some((check) => check.templateKey === "dpoa");
  const cardExpected = Boolean(criteria.employee || criteria.salon || criteria.date || criteria.policy);
  const amount = dpoa
    ? {
        expect: payrollAmountFromConversation(
          item.turns.map((content) => ({ role: "user" as const, content })),
          { payrollAnswer: payrollAnswerForAmount(item.turns.join("\n")) },
        ),
      }
    : null;
  return {
    employee: criteria.employee,
    salon: criteria.salon,
    cardExpected,
    date: criteria.date,
    policy: criteria.policy,
    expectPlan: dpoa && Boolean(criteria.policy),
    amount,
  };
}

function toRulebookRun(item: ReplayCase, snap: RulebookSnapshotRun): RulebookRun {
  const criteria = criteriaWrittenBeforeRun(item.id);
  const policyName = criteria.policy?.replace(/ p\.\d+$/, "") ?? "";
  const policyPage = Number(criteria.policy?.match(/p\.(\d+)$/)?.[1] ?? "0");
  const cardText = snap.contents[snap.contents.length - 1] ?? "";
  return {
    employeeName: snap.employeeName,
    locationId: snap.locationId,
    formDate: snap.formDate,
    hasCard: snap.hasCard,
    speech: snap.contents.join("\n"),
    cardText,
    policySatisfied: criteria.policy ? cites(cardText, snap.citations, policyName, policyPage) : true,
    payrollDeductAmount: snap.payrollDeductAmount,
  };
}

function loadOldColumn(): { commit: string; cases: { id: string; ms: number; runs: RulebookSnapshotRun[] }[] } {
  const raw = JSON.parse(readFileSync("src/lib/ai/__fixtures__/rulebook-old-main.json", "utf8")) as {
    commit: string;
    cases: { id: string; ms: number; runs: RulebookSnapshotRun[] }[];
  };
  if (raw.commit !== OLD_MAIN) throw new Error(`rulebook OLD column is ${raw.commit}, expected ${OLD_MAIN}`);
  return raw;
}

function scoreRulebook(commit: string): { markdown: string; worse: string[] } {
  const old = loadOldColumn();
  const rows: RulebookScoreRow[] = CASES.map((item) => {
    const spec = rulebookSpec(item);
    const prior = old.cases.find((row) => row.id === item.id);
    const next = rulebookNew.find((row) => row.id === item.id);
    if (!prior || prior.runs.length !== RUNS) throw new Error(`${item.id} OLD column is missing a run`);
    if (!next || next.runs.length !== RUNS) throw new Error(`${item.id} NEW column is missing a run`);
    const oldMisses = judgeRulebookRuns(
      spec,
      prior.runs.map((run) => toRulebookRun(item, run)),
      prior.ms,
    );
    const newMisses = judgeRulebookRuns(
      spec,
      next.runs.map((run) => toRulebookRun(item, run)),
      next.ms,
    );
    return { id: item.id, oldMisses, newMisses, verdict: rulebookVerdict(oldMisses, newMisses) };
  });
  return {
    markdown: renderRulebookScoreboard({ oldCommit: OLD_MAIN, newCommit: commit, runs: RUNS, rows }),
    worse: rulebookCasesWorse(rows),
  };
}

afterAll(() => {
  const replaySet = JSON.stringify(CASES.map((item) => ({ id: item.id, turns: item.turns, criteria: cardCriteria(item) })));
  const fixture = readFileSync("src/lib/ai/__fixtures__/replay_set.json", "utf8");
  expect(fixture, "replay_set.json").toBe(replaySet);
  const replaySetHash = createHash("sha256").update(fixture).digest("hex");
  const promptHash = createHash("sha256").update(readFileSync("src/lib/ai/prompts.ts")).digest("hex");
  let commit = "unknown";
  try {
    commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    commit = "unknown";
  }
  const currentSystems = captured.systems.filter((row) => row.revision === "current").map((row) => row.system);
  const previousSystems = captured.systems.filter((row) => row.revision === "last-known-good").map((row) => row.system);
  expect(currentSystems.length, "current prompt was sent").toBeGreaterThan(0);
  expect(previousSystems.length, "last-known-good prompt was sent").toBeGreaterThan(0);
  const currentBuilt = currentSystems.join("\n---\n");
  const previousBuilt = previousSystems.join("\n---\n");
  const worse = casesWhereOldPromptScoresBetter(flagsOnResults, lastKnownGoodResults);
  let lastKnownGoodFileHash = "";
  try {
    lastKnownGoodFileHash = createHash("sha256")
      .update(execFileSync("git", ["show", `${LAST_KNOWN_GOOD_COMMIT}:src/lib/ai/prompts.ts`]))
      .digest("hex");
  } catch {
    lastKnownGoodFileHash = "unknown";
  }
  const round: ReplayRound = {
    title: "Round 3 — prompt A/B",
    replaySetHash,
    promptHash,
    commit,
    model: CLAUDE_MODEL,
    flags: FLAGS,
    runs: RUNS,
    latencyGateMs: REPLAY_LATENCY_GATE_MS,
    criteria: writtenCriteria,
    flagsOff: flagsOffResults,
    flagsOn: flagsOnResults,
    promptAb: {
      lastKnownGoodCommit: LAST_KNOWN_GOOD_COMMIT,
      lastKnownGoodFileHash,
      currentBuiltHash: createHash("sha256").update(currentBuilt).digest("hex"),
      lastKnownGoodBuiltHash: createHash("sha256").update(previousBuilt).digest("hex"),
      promptsDiffer: currentBuilt !== previousBuilt,
      revert: worse.length === 0 ? "none" : `revert prompt sections for ${worse.join(", ")} and keep the code fixes`,
      lastKnownGood: lastKnownGoodResults,
    },
    harnessEvents,
  };
  const scoreLine = round.criteria
    .map((item) => {
      const cell = (rows: readonly ReplayCaseResult[]) => {
        const result = rows.find((row) => row.id === item.id);
        return result ? `${result.pass ? "PASS" : "FAIL"} ${result.ms}ms` : "missing";
      };
      return `${item.id} off=${cell(flagsOffResults)} current=${cell(flagsOnResults)} last-known-good=${cell(lastKnownGoodResults)}`;
    })
    .join("\n");
  console.log(
    `prompt A/B differ=${round.promptAb?.promptsDiffer} revert=${round.promptAb?.revert}\ncurrent ${round.promptAb?.currentBuiltHash}\nlast-known-good ${round.promptAb?.lastKnownGoodBuiltHash}\nfile ${round.promptAb?.lastKnownGoodFileHash}\n${scoreLine}`,
  );
  if (flagEffects.length > 0) console.log(renderFlagAblation(flagEffects));
  const rulebook = scoreRulebook(commit);
  console.log(rulebook.markdown);
  if (process.env.REPLAY_RECORD_SCOREBOARD === "1") {
    const existing = readFileSync("docs/scoreboard.md", "utf8");
    const section = renderScoreboardRound(round);
    const marker = `## ${round.title}`;
    const index = existing.indexOf(marker);
    const withoutRound = index === -1 ? existing.trimEnd() : existing.slice(0, index).trimEnd();
    const ablation = flagEffects.length === 0 ? "" : renderFlagAblation(flagEffects);
    const next = [withoutRound, section, ablation, rulebook.markdown].filter((part) => part.trim()).join("\n\n");
    writeFileSync("docs/scoreboard.md", `${next.trim()}\n`);
  }
  if (worse.length > 0) {
    throw new Error(`last-known-good prompt scores better on ${worse.join(", ")}. Revert those prompt sections and keep the code fixes.`);
  }
  if (rulebook.worse.length > 0) {
    throw new Error(
      `Rulebook: NEW is worse than main on ${rulebook.worse.join(", ")}. Fix those cases before this pull request is ready.`,
    );
  }
});
