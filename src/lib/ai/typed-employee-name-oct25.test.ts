import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { TEMPLATE_SEEDS } from "@/lib/forms/library";
import type { DirectoryFact } from "@/lib/forms/employee-roster";
import { continuationFor } from "@/lib/forms/proposal-continuation";
import type { AccessScope, ChatMessage } from "@/types";

import { keepFormEmployeeEnabled } from "@/lib/config/chat-quality-flags";



/**
 * ============================================================================
 * "TEST EMPLOYEE" IS THE NAME THE MANAGER TYPED (QA, 25 OCT 2026)
 * ============================================================================
 *
 * QA's C-list turn, replayed word for word through `answerQuestion` with the
 * production flag profile plus NOT_A_NAME_GUARD, WARNING_LEVEL_MANAGER_ONLY
 * and CROSS_CHAT_REPLY_GUARD:
 *
 *   "create a written CA for Test Employee at Kearney for missing the
 *    10-15-26 woven deadline"
 *        → "I'll draft a Corrective Action Form for **Test**"
 *
 * and the exit request "Create an exit form for Test Employee at Lawrence,
 * she resigned and her last day was 10-20" → **Name:** Test whenever the slot
 * model gave no employee.
 *
 * WHERE IT WAS CUT. The proposal's one sentence reader
 * (`readEmployeeMentions` in forms/proposal.ts) ends a capitalised name at a
 * word that names a form, and "Employee" is form vocabulary ("Employee
 * Performance Plan"), so "Test Employee" reads as "Test". The stored
 * employee reaches the proposal only as the "The employee is …" line put
 * ahead of a form turn, and two things kept that line away:
 *   - "create a written CA" is the corrective-action request, not the
 *     form's name, so the code reading sets no form, and when the slot model
 *     does not call it a form turn the question goes to the proposal bare;
 *   - when the slot model gives no employee, the code reading drops the
 *     one-word "Test" and stores nobody.
 * KEEP_FORM_EMPLOYEE_ENABLED: a capitalised "<First> Employee" the manager
 * typed as the person ("for Test Employee", "name is Test Employee") is the
 * employee, and its line is put ahead of the form request; with intent
 * extraction off, the card is given the typed name after the slot keeper. A
 * lower-case "an employee", "my employee", "the employee" is still nobody's
 * name.
 */

const PROFILE = [
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
  "MANAGER_WORDS_ONLY_ENABLED",
  "WARNING_LEVEL_MANAGER_ONLY_ENABLED",
  "NOT_A_NAME_GUARD_ENABLED",
  "CROSS_CHAT_REPLY_GUARD_ENABLED",
] as const;

const TODAY = "2026-10-25";

const bag = vi.hoisted(() => ({
  forms: new Map<string, unknown>(),
  /** What the slot model copies: a name in the manager's latest turn, and whether it calls the turn a form turn. */
  intent: { latest: [] as string[], formTurn: false },
}));

/** A directory of synthetic people. The QA test employee is not on it, as in production. */
const PEOPLE: DirectoryFact[] = [
  ["dana", "Dana", "Rowtest", "Tanning Consultant", "loc-0312", "NE Lincoln Pine Lake"],
  ["casey", "Casey", "Linetest", "Salon Director", "loc-0312", "NE Lincoln Pine Lake"],
  ["riley", "Riley", "Northtest", "Assistant Salon Director", "loc-0312", "NE Lincoln Pine Lake"],
  ["morgan", "Morgan", "Deskline", "HR", "loc-0312", "NE Lincoln Pine Lake"],
  ["avery", "Avery", "Fieldtest", "District Manager", "loc-0312", "NE Lincoln Pine Lake"],
  ["quinn", "Quinn", "Ledgertest", "Accounting", "loc-0312", "NE Lincoln Pine Lake"],
  ["reese", "Reese", "Toolbench", "Maintenance", "loc-0312", "NE Lincoln Pine Lake"],
  ["sky", "Sky", "Opsline", "Operations", "loc-0312", "NE Lincoln Pine Lake"],
].map(([id, firstName, lastName, title, salon, place]) => ({
  id: id!,
  firstName: firstName!,
  lastName: lastName!,
  preferredFirstName: null,
  salonIds: [salon!],
  title: title!,
  primarySalonId: salon!,
  primaryLocationName: place!,
}));

const LIBRARY = TEMPLATE_SEEDS.map((seed) => ({
  id: `tpl-${seed.key}`,
  key: seed.key,
  name: seed.name,
  shortName: seed.shortName,
  description: seed.description,
  category: seed.category,
  layoutFamily: seed.layoutFamily,
  requiredPermission: seed.requiredPermission,
  active: true,
  displayOrder: seed.displayOrder,
  currentVersion: { id: `v-${seed.key}`, status: "published", document: seed.document, variants: seed.variants },
  draftVersion: null,
  versionCount: 1,
  activeAsset: null,
  assetCount: 0,
}));

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
  loadFormState: async (userId: string, conversationId: string) => bag.forms.get(`${userId}:${conversationId}`) ?? null,
  saveFormState: async (userId: string, conversationId: string, state: unknown) => {
    bag.forms.set(`${userId}:${conversationId}`, state);
  },
}));

vi.mock("@/lib/knowledge/providers/supabase", async () => {
  const { JBA_MANUAL_CHUNKS, JBA_MANUAL_DOCUMENT } = await import("@/lib/ai/__fixtures__/jba-policy-manual");
  return {
    SupabaseKnowledgeProvider: class {
      readonly name = "replay";
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
  };
});

vi.mock("@/lib/reporting/read/report-briefing", () => ({ loadReportBriefing: async () => null }));
vi.mock("@/lib/reporting/read/employee-facts", () => ({
  loadEmployeeFacts: async () => null,
  NO_EMPLOYEE_DATASET_REASON: "no dataset",
  EMPLOYEE_DATA_HEADING: "CURRENT EMPLOYEE PERFORMANCE DATA",
}));
vi.mock("@/lib/reviews/overview-block-read", () => ({
  loadReviewsOverviewBlock: async () => ({ status: "ready", totalReviews: 0, averageRating: 0, salonCount: 0 }),
}));

vi.mock("./call-claude", () => ({
  callClaude: async () => "An answer.",
  callClaudeTool: async (input: { tool?: { name?: string }; messages?: { content?: unknown }[] }) => {
    if (input.tool?.name === "choose_salon_data") return { read: "none" };
    if (input.tool?.name !== "record_intent_slots") return null;
    const text = JSON.stringify(input.messages ?? []).toLowerCase();
    const latest = text.split("manager:").pop() ?? "";
    const employee =
      [...bag.intent.latest].reverse().find((name) => latest.includes(name.toLowerCase())) ?? null;
    return {
      employee,
      salon: null,
      title: null,
      incidentType: null,
      incidentDate: text.includes("10-15-26") ? "2026-10-15" : null,
      payrollAmount: null,
      warningLevel: null,
      formType: null,
      formTurn: bag.intent.formTurn,
      policyHeading: null,
    };
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

beforeAll(async () => {
  ({ answerQuestion } = await import("./server-ask"));
});

beforeEach(() => {
  for (const flag of PROFILE) vi.stubEnv(flag, "true");
  bag.forms.clear();
  bag.intent = { latest: [], formTurn: false };
});

afterEach(() => {
  vi.unstubAllEnvs();
});

interface Turn {
  readonly question: string;
  readonly employeeName: string | null;
  readonly employeeRole?: string | null;
  readonly content: string;
  readonly formDate?: string | null;
}

let run = 0;

/** `recorded` replaces this app's reply with the one production sent, by turn index. */
async function converse(
  turns: readonly string[],
  recorded: Readonly<Record<number, string>> = {},
  beforeTurn?: (index: number) => void,
): Promise<Turn[]> {
  run += 1;
  const conversationId = `conv-typed-employee-${run}`;
  const history: ChatMessage[] = [];
  const out: Turn[] = [];
  for (const [index, question] of turns.entries()) {
    beforeTurn?.(index);
    const response = await answerQuestion(
      {
        question,
        mode: "standard",
        // The route keeps the last 20 turns (`LIMITS.historyTurns`).
        history: history.slice(-20),
        scopeId: "stc-core",
        questionMessageId: `msg-te-${run}-${index}`,
        conversationId,
        continueProposalTemplateKey: continuationFor(history)?.templateKey,
        context: { userName: "Pat Manager", locationName: "All salons", todayIso: TODAY },
      },
      { role: "admin" as never, scope: SCOPE, subject: "manager-typed-employee", verified: true },
      { memoryOwnerId: "manager-typed-employee" },
    );
    out.push({
      question,
      employeeName: response.formProposal?.employeeName ?? null,
      employeeRole: response.formProposal?.employeeRole ?? null,
      content: response.content,
      formDate: response.formProposal?.formDate ?? null,
    });
    history.push({ id: `u-${run}-${index}`, role: "user", content: question, createdAt: `${TODAY}T15:00:00Z` });
    history.push({
      id: `a-${run}-${index}`,
      role: "assistant",
      content: recorded[index] ?? response.content,
      createdAt: `${TODAY}T15:01:00Z`,
      ...(response.formProposal ? { formProposal: response.formProposal } : {}),
    });
  }
  return out;
}





const CLIST = "create a written CA for Test Employee at Kearney for missing the 10-15-26 woven deadline";
const EXIT = "Create an exit form for Test Employee at Lawrence, she resigned and her last day was 10-20";

/**
 * What the slot model may hand back for the turn: the full name, the first
 * word only, or no employee; and a form turn or not.
 */
const READINGS = [
  ["the full name, not a form turn", ["Test Employee"], false],
  ["the first word only, not a form turn", ["Test"], false],
  ["no employee, not a form turn", [], false],
  ["no employee, a form turn", [], true],
] as const;

function read(names: readonly string[], formTurn: boolean) {
  bag.intent.latest = [...names];
  bag.intent.formTurn = formTurn;
}

describe("the typed name is the employee (KEEP_FORM_EMPLOYEE_ENABLED on)", { timeout: 120_000 }, () => {
  beforeEach(() => {
    vi.stubEnv("KEEP_FORM_EMPLOYEE_ENABLED", "true");
  });

  it.each(READINGS)("C-list: the card's employee is Test Employee — slot model gave %s", async (_name, names, formTurn) => {
    read(names, formTurn);
    const [turn] = await converse([CLIST]);
    expect(turn!.employeeName).toBe("Test Employee");
    expect(turn!.content).toMatch(/\*\*Test Employee\*\*/);
    expect(turn!.content).not.toMatch(/\*\*Test\*\*/);
  });

  it.each(READINGS)("exit: the card's employee is Test Employee — slot model gave %s", async (_name, names, formTurn) => {
    read(names, formTurn);
    const [turn] = await converse([EXIT]);
    expect(turn!.employeeName).toBe("Test Employee");
    expect(turn!.content).not.toMatch(/\*\*Name:\*\* Test\n/);
  });

  it('control: "my employee Jordan Hale was late" stays Jordan Hale', async () => {
    read(["Jordan Hale"], false);
    const turns = await converse(["create a coaching form", "my employee Jordan Hale was late"]);
    expect(turns[1]!.employeeName).toBe("Jordan Hale");
  });

  it('control: "an employee was late" gives no name', async () => {
    read([], false);
    const turns = await converse(["create a coaching form", "an employee was late"]);
    expect(turns[1]!.employeeName).toBeNull();
    expect(turns[1]!.content).not.toMatch(/\*\*(?:An )?Employee\*\*/i);
  });
});

/*
 * The same reader cuts the name on the proposal path with intent extraction
 * off (no stored employee line), so the card keeps the typed name there too.
 */
describe("intent extraction off: the proposal path keeps the typed name", { timeout: 120_000 }, () => {
  beforeEach(() => {
    vi.stubEnv("KEEP_FORM_EMPLOYEE_ENABLED", "true");
    vi.stubEnv("INTENT_EXTRACTION_ENABLED", "");
  });

  it.each([CLIST, EXIT])("%s → Test Employee", async (question) => {
    const [turn] = await converse([question]);
    expect(turn!.employeeName).toBe("Test Employee");
    expect(turn!.content).not.toMatch(/\*\*Test\*\*|\*\*Name:\*\* Test\n/);
  });

  it('controls: "my employee Jordan Hale was late" stays Jordan Hale; "an employee was late" gives no name', async () => {
    expect((await converse(["create a coaching form", "my employee Jordan Hale was late"]))[1]!.employeeName).toBe("Jordan Hale");
    expect((await converse(["create a coaching form", "an employee was late"]))[1]!.employeeName).toBeNull();
  });
});

describe("flag off: unchanged", { timeout: 120_000 }, () => {
  it("default off", () => {
    expect(keepFormEmployeeEnabled()).toBe(false);
  });

  it('the controls read as before: "my employee Jordan Hale was late", "an employee was late"', async () => {
    read(["Jordan Hale"], false);
    expect((await converse(["create a coaching form", "my employee Jordan Hale was late"]))[1]!.employeeName).toBe("Jordan Hale");
    read([], false);
    expect((await converse(["create a coaching form", "an employee was late"]))[1]!.employeeName).toBeNull();
  });
});
