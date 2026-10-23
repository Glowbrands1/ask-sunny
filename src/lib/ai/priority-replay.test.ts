import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DirectoryFact } from "@/lib/forms/employee-roster";
import { correctiveActionDocument } from "@/lib/forms/library";
import { continuationFor } from "@/lib/forms/proposal-continuation";
import type { PriorFormOnFile } from "@/lib/forms/prior-forms-lines";
import { JBA_MANUAL_CHUNKS, JBA_MANUAL_DOCUMENT } from "@/lib/ai/__fixtures__/jba-policy-manual";
import type { AccessScope, ChatMessage } from "@/types";

/**
 * The 14 priority chats, word for word, through `answerQuestion`.
 *
 * Turns are the user messages in the verbatim replay script (replay_set.json).
 * The roster is the people those chats name. A case runs twice: the seven
 * flags on, and the same turns with the flags off. Flags off is the floor
 * from the 23 Oct 2026 baseline (a card the baseline showed must still
 * appear, and a name the baseline got right must stay right). Flags on is
 * the bar: the card by the turn the manager has given enough, the person
 * they named, Erin's Woven salon, Paisley's "Yes", no re-ask, no other chat,
 * and the manual section and page on a form turn that names one.
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

const TODAY = "2026-10-23";

const savedFlags = new Map<string, string | undefined>();

const stateBag = vi.hoisted(() => ({
  forms: new Map<string, unknown>(),
}));

const captured = vi.hoisted(() => ({
  memory: [] as (string | null)[],
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
    id: "lisa",
    firstName: "Lisa",
    lastName: "Smith",
    salonIds: ["loc-0468"],
    title: "Tanning Consultant",
    primarySalonId: "loc-0468",
    primaryLocationName: "KS Lawrence",
  }),
  person({
    id: "paisley",
    firstName: "Paisley",
    lastName: "Peklo",
    salonIds: ["loc-0468"],
    title: "Tanning Consultant",
    primarySalonId: "loc-0468",
    primaryLocationName: "KS Lawrence",
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
  person({
    id: "betty",
    firstName: "Betty",
    lastName: "Sue",
    salonIds: [],
    title: "Tanning Consultant",
    primarySalonId: null,
    primaryLocationName: null,
  }),
  person({
    id: "christiana",
    firstName: "Christiana",
    lastName: "Headley",
    salonIds: ["loc-0463"],
    title: "Tanning Consultant",
    primarySalonId: "loc-0463",
    primaryLocationName: "KS Shawnee Mission Pkwy",
  }),
];

const PAISLEY_PRIOR: PriorFormOnFile = {
  instanceId: "prior-paisley",
  templateKey: "dpoa",
  formDate: "2026-09-01",
  line: "Written corrective action — signed 09/01/2026",
  locationId: "loc-0468",
  locationName: "KS Lawrence",
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
  callClaude: async (input: { personMemory?: string | null }) => {
    captured.memory.push(input.personMemory ?? null);
    return "An answer.";
  },
  callClaudeTool: async () => null,
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
  readonly formDate?: string;
  readonly templateKey?: string;
  readonly role?: string;
  readonly policyHeading?: string;
  readonly policyPage?: number;
  readonly datesInReply?: readonly string[];
  readonly noReask?: boolean;
  readonly noOtherChat?: boolean;
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
        noReask: true,
        noOtherChat: true,
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
      },
    ],
    off: [{ from: 2, card: true, employee: "Betty Sue", templateKey: "dpoa" }],
  },
  {
    id: "s20",
    turns: [
      "generate me a coaching worksheet for team memebers about getting checking accounts put onto client profiles",
      "coacing form based on uniform",
      "creat an exit plan for me",
      "exit form",
    ],
    on: [{ from: 1, employeeNot: ["based", "uniform", "job title", "lisa", "lawrence"] }],
    off: [{ from: 1, employeeNot: ["based"] }],
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
        locationIds: ["loc-0410", "loc-0314"],
        formDate: "2026-10-05",
        templateKey: "dpoa",
      },
    ],
    off: [
      {
        from: 1,
        card: true,
        employee: "Kennedy Morehouse",
        templateKey: "dpoa",
        formDate: "2026-10-05",
      },
    ],
  },
  {
    id: "s25",
    turns: ["create a corrective action form for Pasiley Peklo", "Yes"],
    on: [
      {
        from: 2,
        card: true,
        employee: "Paisley Peklo",
        employeeNot: ["pasiley", "pasiley peklo", "based"],
        templateKey: "dpoa",
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
];

function setFlags(on: boolean) {
  for (const name of FLAGS) {
    if (!savedFlags.has(name)) savedFlags.set(name, process.env[name]);
    if (on) process.env[name] = "1";
    else delete process.env[name];
  }
}

async function ask(question: string, history: ChatMessage[], conversationId: string) {
  const { answerQuestion } = await import("./server-ask");
  const continuation = continuationFor(history);
  return answerQuestion(
    {
      question,
      mode: "standard",
      history,
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
  if (check.formDate) expect(proposal?.formDate, where).toBe(check.formDate);
  if (check.templateKey) expect(proposal?.templateKey, where).toBe(check.templateKey);
  if (check.role) expect(proposal?.employeeRole, where).toBe(check.role);
  if (check.policyHeading && check.policyPage) {
    expect(cites(response.content, response.citations, check.policyHeading, check.policyPage), `${where} content: ${preview}`).toBe(true);
  }
  if (check.datesInReply) {
    for (const iso of check.datesInReply) {
      expect(dateShown(response.content, iso), `${where} missing ${iso} in: ${preview}`).toBe(true);
    }
  }
  if (check.noReask) expect(response.content, where).not.toMatch(/who is this|which employee|which salon is this about|which of them/i);
  if (check.noOtherChat) {
    expect(response.content, where).not.toMatch(/earlier today|other tab|you and I talked through this/i);
    for (const block of captured.memory) expect(block ?? "", where).not.toMatch(/other tab/i);
  }
}

async function replay(item: ReplayCase, flagsOn: boolean) {
  captured.memory.length = 0;
  const history: ChatMessage[] = [];
  const conversationId = `conv-${item.id}-${flagsOn ? "on" : "off"}`;
  const checks = flagsOn ? item.on : item.off;
  for (let index = 0; index < item.turns.length; index += 1) {
    const response = await ask(item.turns[index]!, history, conversationId);
    const turn = index + 1;
    for (const check of checks) applyCheck(item.id, turn, response, check);
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
}

beforeEach(() => {
  stateBag.forms.clear();
  captured.memory.length = 0;
});

describe("priority replay with the seven flags on", () => {
  beforeEach(() => setFlags(true));
  it.each(CASES)("$id follows the real turns", async (item) => {
    await replay(item, true);
  });
});

describe("priority replay with the flags off is no worse than the baseline", () => {
  beforeEach(() => setFlags(false));
  it.each(CASES)("$id holds the baseline floor", async (item) => {
    await replay(item, false);
  });
});
