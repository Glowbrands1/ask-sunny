import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { TEMPLATE_SEEDS } from "@/lib/forms/library";
import type { DirectoryFact } from "@/lib/forms/employee-roster";
import { continuationFor } from "@/lib/forms/proposal-continuation";
import type { AccessScope, ChatMessage } from "@/types";

import { keepFormEmployeeEnabled, titleWholeWordEnabled } from "@/lib/config/chat-quality-flags";
import { dateAnswerTurns } from "@/lib/forms/incident-dates";

import { titleInWords } from "./title-in-words";


/**
 * ============================================================================
 * QA ROUND 10, 25 OCT 2026 — A NAME AND A TITLE THE MANAGER NEVER GAVE
 * ============================================================================
 *
 * Two chats, replayed word for word through `answerQuestion` with the
 * production flag profile (INTENT_EXTRACTION, QUERY_REWRITE,
 * GROUNDED_ENTITIES, TYPED_NAME_PROCEEDS, FEWSHOT, SLOT_RETENTION,
 * FIELD_ACCURACY, LONG_CONTEXT, POLICY_CITATION, SECOND_FORM,
 * GLOBAL_SALON_ASK, DRAFT_MERGE, FULL_MANUAL_CONTEXT, MANAGER_WORDS_ONLY,
 * WARNING_LEVEL_MANAGER_ONLY on):
 *
 *   R02 conv_mvnjix4r2wm7u7r  "create the ca", right after Ask Sunny asked
 *                             "Which date goes on the form?"
 *                             → "I'll draft a Corrective Action Form for
 *                               **Test Newhire**", the new hire the manager's
 *                               account described. The slot stayed
 *                               "test employee" (chat_traces). The question
 *                               the proposal read carried the app's own
 *                               "It happened on 10/16/2026." line, so the turn
 *                               was taken as the date answer and dropped from
 *                               the name readers, and with it the line
 *                               "The employee is test employee.".
 *   L17 conv_mvnjo8k22hy75ii  "… she signed one box with a arrown throught the
 *                             rest …" → **Job title:** HR. The directory has
 *                             the title "HR", and "throught" contains "hr".
 *
 * The people in the manager's turns were already QA test names. The QA test
 * employees are not in the directory, as in production.
 * KEEP_FORM_EMPLOYEE_ENABLED and TITLE_WHOLE_WORD_ENABLED fix them.
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
] as const;

const TODAY = "2026-10-25";

const bag = vi.hoisted(() => ({
  forms: new Map<string, unknown>(),
  /**
   * What the intent model copied as the employee in production: a name in
   * the manager's latest turn, or (`fromAnywhere`) a phrase it lifted from
   * an assistant reply — the chat_traces slot for conv_mvmvmo6w2bvg7ub was
   * "require practice".
   */
  intent: { latest: [] as string[], fromAnywhere: [] as string[], title: null as string | null },
}));

/**
 * A directory with the titles the production directory carries, among them
 * the two-letter "HR". The QA test employees are not on it.
 */
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
      [...bag.intent.latest].reverse().find((name) => latest.includes(name.toLowerCase())) ??
      bag.intent.fromAnywhere.find((name) => text.includes(name.toLowerCase())) ??
      null;
    return {
      employee,
      salon: null,
      title: bag.intent.title,
      incidentType: null,
      incidentDate: text.includes("10-16-26") ? "2026-10-16" : null,
      payrollAmount: null,
      warningLevel: null,
      formType: null,
      formTurn: false,
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
  bag.intent = { latest: [], fromAnywhere: [], title: null };
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
  const conversationId = `conv-r10-${run}`;
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
        questionMessageId: `msg-${run}-${index}`,
        conversationId,
        continueProposalTemplateKey: continuationFor(history)?.templateKey,
        context: { userName: "Pat Manager", locationName: "All salons", todayIso: TODAY },
      },
      { role: "admin" as never, scope: SCOPE, subject: "manager-r10", verified: true },
      { memoryOwnerId: "manager-r10" },
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


/** conv_mvnjix4r2wm7u7r, the manager's turns as sent. */
const R02 = [
  "create a CA for salon director, test employee for violating the standards of conduct",
  "Test Employee, Salon Director",
  "change observation of offense to: Test completed onboarding with new hire Test Newhire on 9-28-26. As of 10-16-26 Test Newhire had not acknowledged onboarding policies in Woven that should have been completed during onboarding.",
  "create the ca",
  "create ca for test employee, salon director. the offense is: change observation of offense to: Test completed onboarding with new hire Test Newhire on 9-28-26. As of 10-16-26 Test Newhire had not acknowledged onboarding policies in Woven that should have been completed during onboarding. the policy violated is standards of conduct.",
  "test",
];

/** conv_mvnjo8k22hy75ii, the manager's turns as sent (the line break is theirs). */
const L17 = [
  "Please make me a coaching form for test employee at the lincoln pine lake location Test did not complete closing duties. Trash was not taken out of the bathrooms, there was no\ntoilet paper in the women's bathroom, and there were no spray towels in the rooms also all the cleaning duties were signed off in the binder and not alll were completed and the way she signed off on the checklist was incorrect she signed one box with a arrown throught the rest each box needs an initial",
  "Can you make coaching work sheets for the team ? on closing duties at night ?",
];

/** The name the reply's "I'll draft a … for **name**" sentence gives. */
function draftedFor(content: string): string | null {
  return /\bfor \*\*([^*]+)\*\* from what you've described/.exec(content)?.[1] ?? null;
}

describe("round 10 flags", () => {
  it("default off", () => {
    vi.unstubAllEnvs();
    expect(keepFormEmployeeEnabled()).toBe(false);
    expect(titleWholeWordEnabled()).toBe(false);
  });
});

// A replay is several full turns; under a loaded runner one takes longer than the 5s default.
describe("QA round 10 replays (fixes on)", { timeout: 120_000 }, () => {
  beforeEach(() => {
    vi.stubEnv("KEEP_FORM_EMPLOYEE_ENABLED", "true");
    vi.stubEnv("TITLE_WHOLE_WORD_ENABLED", "true");
  });

  it('R02 conv_mvnjix4r2wm7u7r: "create the ca" keeps test employee; the new hire is never the employee', async () => {
    // What the slot model copied in production: the employee when the latest turn names them.
    bag.intent.latest = ["test employee"];
    bag.intent.title = "Salon Director";
    const turns = await converse(R02);
    for (const [index, turn] of turns.entries()) {
      const where = `turn ${index + 1}: ${turn.question.slice(0, 40)}`;
      expect(turn.employeeName?.toLowerCase() ?? "", `${where} — card`).toBe("test employee");
      expect(turn.content, `${where} — reply`).not.toMatch(/\*\*Test Newhire\*\*/);
      const named = draftedFor(turn.content);
      if (named) expect(named.toLowerCase(), `${where} — drafted for`).toBe("test employee");
    }
    expect(draftedFor(turns[3]!.content)?.toLowerCase()).toBe("test employee");
  });

  it('L17 conv_mvnjo8k22hy75ii: "throught the rest" is not the HR title; no title is on the card', async () => {
    bag.intent.latest = ["test employee"];
    const turns = await converse(L17);
    for (const [index, turn] of turns.entries()) {
      const where = `turn ${index + 1}: ${turn.question.slice(0, 40)}`;
      expect(turn.employeeRole ?? null, `${where} — card`).toBeNull();
      expect(turn.content, `${where} — reply`).not.toMatch(/\*\*Job title:\*\*\s*HR\b/);
    }
  });

  it("L17: a title the slot model typed that the manager never wrote is not kept", async () => {
    bag.intent.latest = ["test employee"];
    bag.intent.title = "HR";
    const turns = await converse(L17.slice(0, 1));
    expect(turns[0]!.employeeRole ?? null).toBeNull();
  });
});

describe("the mechanisms, one at a time", () => {
  const question =
    "The form is the Corrective Action Form.\nThe employee is test employee. Job title: Salon Director. It happened on 10/16/2026. Policy reference: Standards of Conduct, JBA Policy Manual p.12.\ncreate the ca";
  const history = [
    { role: "user", content: R02[0]! },
    { role: "assistant", content: "I'll draft a **Corrective Action Form** for **test employee** from what you've described." },
    { role: "user", content: R02[1]! },
    { role: "assistant", content: "I'll draft a **Corrective Action Form** for **test employee** from what you've described." },
    { role: "user", content: R02[2]! },
    {
      role: "assistant",
      content:
        'You mentioned more than one date (**9/28**, **10/16**). Which date goes on the form? Say "most recent" (10/16), pick one, or say "today" for the day you create it.',
    },
  ];

  it('"create the ca" is not an answer to "Which date goes on the form?"; "most recent" still is', () => {
    vi.stubEnv("KEEP_FORM_EMPLOYEE_ENABLED", "true");
    expect(dateAnswerTurns([...history, { role: "user", content: question }]).size).toBe(0);
    expect([...dateAnswerTurns([...history, { role: "user", content: "most recent" }])]).toEqual(["most recent"]);
  });

  it("a directory title is a whole word, and HR only as typed", () => {
    expect(titleInWords("HR", L17[0]!)).toBe(false);
    expect(titleInWords("HR", "she was 1 hr late")).toBe(false);
    expect(titleInWords("HR", "coaching form for test employee, HR")).toBe(true);
    expect(titleInWords("Salon Director", "create a CA for salon director, test employee")).toBe(true);
    expect(titleInWords("Owner", "the owners asked")).toBe(false);
  });
});
