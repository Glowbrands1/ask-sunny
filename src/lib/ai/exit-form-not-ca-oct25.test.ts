import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { TEMPLATE_SEEDS } from "@/lib/forms/library";
import type { DirectoryFact } from "@/lib/forms/employee-roster";
import { continuationFor } from "@/lib/forms/proposal-continuation";
import type { AccessScope, ChatFormProposal, ChatMessage } from "@/types";

/**
 * ============================================================================
 * AN EXIT FORM IS NOT A CORRECTIVE ACTION — PORTED FROM ASK BUBBLES, 25 OCT 2026
 * ============================================================================
 *
 * In the sibling app (full remap on in its production) "Create an exit form
 * for <name> at <location>, she resigned and her last day was 10-20" came back
 * as the Corrective Action Form with "Verbal or written?" and "Is payroll
 * deduct applicable?", and the next "Yes" set payroll deduct. The same request
 * in this app's wording is replayed through `answerQuestion`:
 *
 *   - with this app's production profile (intent extraction on, the full
 *     remap off), and
 *   - with FORM_FULL_REMAP_ENABLED on, where the extraction model guesses the
 *     Corrective Action Form on every turn, as the sibling's did.
 *
 * Either way it is the Resignation/Exit Form, with no level or payroll
 * question and no Observation of Offense pasted from the request, and the
 * "Yes" after it sets no payroll deduct. "separation / resignation /
 * termination paperwork" names the exit form too, although the glossary's
 * bare "paperwork" is the Corrective Action Form. A Corrective Action
 * that mentions "she resigned" is still a Corrective Action, and Coaching and
 * Policy Review requests are unchanged. Synthetic names.
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
] as const;

const TODAY = "2026-10-25";

const bag = vi.hoisted(() => ({ forms: new Map<string, unknown>() }));

const PEOPLE: DirectoryFact[] = [
  {
    id: "jordan",
    firstName: "Jordan",
    lastName: "Testperson",
    preferredFirstName: null,
    salonIds: ["loc-0468"],
    title: "Tanning Consultant",
    primarySalonId: "loc-0468",
    primaryLocationName: "KS Lawrence",
  },
  {
    id: "jordan-hale",
    firstName: "Jordan",
    lastName: "Hale",
    preferredFirstName: null,
    salonIds: ["loc-0462"],
    title: "Tanning Consultant",
    primarySalonId: "loc-0462",
    primaryLocationName: "KS Manhattan",
  },
];

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
  callClaudeTool: async (input: { tool?: { name?: string } }) => {
    if (input.tool?.name === "choose_salon_data") return { read: "none" };
    // The full remap's read: the sibling's production model guessed the Corrective Action Form.
    if (input.tool?.name === "extract_form_fields") {
      return { templateKey: "dpoa", employeeName: null, observation: null, actionPlan: null };
    }
    if (input.tool?.name !== "record_intent_slots") return null;
    return {
      employee: null,
      salon: null,
      title: null,
      incidentType: null,
      incidentDate: null,
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
}, 60_000);

beforeEach(() => {
  for (const flag of PROFILE) vi.stubEnv(flag, "true");
  bag.forms.clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

interface Turn {
  readonly question: string;
  readonly content: string;
  readonly proposal: ChatFormProposal | null;
}

let run = 0;

/** `recorded` replaces this app's reply with the one production sent, by turn index. */
async function converse(turns: readonly string[], recorded: Readonly<Record<number, string>> = {}): Promise<Turn[]> {
  run += 1;
  const conversationId = `conv-exit-not-ca-${run}`;
  const history: ChatMessage[] = [];
  const out: Turn[] = [];
  for (const [index, question] of turns.entries()) {
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
      { role: "admin" as never, scope: SCOPE, subject: "manager-exit-not-ca", verified: true },
      { memoryOwnerId: "manager-exit-not-ca" },
    );
    out.push({ question, content: response.content, proposal: response.formProposal ?? null });
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

/* The sibling's conv_mvnmfb21286uhtq turn 1, in this app's wording (synthetic name). */
const EXIT_REQUEST = "Create an exit form for Test Employee at Lawrence, she resigned and her last day was 10-20";
const CA_QUESTIONS = /Verbal or written\?|Is payroll deduct applicable\?|Payroll deduction amount\?/i;
/* The sibling's production reply to that turn, in this app's wording. */
const RECORDED_CA_REPLY =
  "Here is the Corrective Action Form.\n**Employee:** Test Employee\n**Salon:** KS Lawrence, as you said\n**Date:** 2026-10-20\n**What happened:** Create an exit form for\n\nWhat is their job title?\nVerbal or written?\nIs payroll deduct applicable?";

const PATHS = [
  ["the live intent path (full remap off)", false],
  ["the full remap (FORM_FULL_REMAP_ENABLED on)", true],
] as const;

describe.each(PATHS)("an exit form request gets the exit form — %s", (_name, remap) => {
  beforeEach(() => {
    if (remap) vi.stubEnv("FORM_FULL_REMAP_ENABLED", "true");
  });

  it("T1: the Resignation/Exit Form, with no level or payroll question", async () => {
    const [reply] = await converse([EXIT_REQUEST]);
    expect(reply!.proposal?.templateKey).toBe("stc-exit");
    expect(reply!.content).not.toMatch(/Corrective Action/i);
    expect(reply!.content).not.toMatch(CA_QUESTIONS);
    expect(reply!.content).not.toContain("Create an exit form for");
    expect(reply!.proposal?.warningLevel ?? null).toBeNull();
    expect(reply!.proposal?.payrollDeduct ?? null).toBeNull();
  });

  /*
   * The two T2 tests fail with LATE_OPEN_DATE_ENABLED=1 in the env (production)
   * unless LATE_OPEN_PAYROLL_FROM_FORM_ENABLED is on too: LATE_OPEN_DATE reads
   * the payroll answer over the whole thread and stores the bare "Yes" as
   * payroll deduct Yes. That is the live bug, kept here as main has it; the
   * pins at the end of this file set both flags.
   */
  it('T2: "Yes" sets no payroll deduct and keeps the exit form', async () => {
    const turns = await converse([EXIT_REQUEST, "Yes"]);
    const last = turns.at(-1)!;
    expect(last.proposal?.payrollDeduct ?? null).toBeNull();
    expect(last.proposal?.payrollDeductAmount ?? null).toBeNull();
    // The exit form's own blank "Payroll Deduction" box may be listed; no answer is read back.
    expect(last.content).not.toMatch(/\*\*Payroll deduct:\*\*/i);
    expect(last.content).not.toMatch(CA_QUESTIONS);
    expect(last.content).not.toMatch(/Corrective Action/i);
    if (last.proposal) expect(last.proposal.templateKey).toBe("stc-exit");
  });

  it('T2 after the sibling\'s recorded Corrective Action reply: "Yes" is not a payroll deduct', async () => {
    const turns = await converse([EXIT_REQUEST, "Yes"], { 0: RECORDED_CA_REPLY });
    const last = turns.at(-1)!;
    expect(last.proposal?.payrollDeduct ?? null).toBeNull();
    expect(last.content).not.toMatch(/Corrective Action/i);
    expect(last.content).not.toMatch(CA_QUESTIONS);
  });

  it.each([
    "Create a resignation form for Test Employee at Lawrence, her last day was 10-20",
    // "paperwork" alone is the Corrective Action Form's shorthand; these name the exit form.
    "Create the separation paperwork for Test Employee at Lawrence, last day 10-20",
    "Create the resignation paperwork for Test Employee at Lawrence, last day 10-20",
    "Create the termination paperwork for Test Employee at Lawrence, last day 10-20",
    "Create a termination form for Test Employee at Lawrence, her last day was 10-20",
    "Create a demotion form for Test Employee at Lawrence",
    "Create a position transfer form for Test Employee at Lawrence",
  ])("%s: not a Corrective Action Form", async (question) => {
    const [reply] = await converse([question]);
    expect(reply!.proposal?.templateKey ?? null).not.toBe("dpoa");
    expect(reply!.content).not.toMatch(/Here is the Corrective Action Form/i);
    expect(reply!.content).not.toMatch(CA_QUESTIONS);
  });

  it('"create a CA for Test Employee, she resigned …" is still a Corrective Action Form', async () => {
    const [reply] = await converse([
      "create a CA for Test Employee at Lawrence, she resigned and walked out mid-shift on 10-20 without telling anyone",
    ]);
    expect(reply!.proposal?.templateKey).toBe("dpoa");
    expect(reply!.content).toMatch(/Corrective Action Form/);
  });

  it.each([
    ["create a coaching form for Test Employee, tanning consultant at Lawrence, late to her shift on 10-20", "coaching"],
    ["create a follow-up coaching form for Test Employee at Lawrence", "follow-up-coaching"],
    ["Create a Policy Review for Test Employee at Lawrence, cell phone on the floor 10-20", "policy-review"],
    ["CA for Test Employee at Lawrence, out of dress code 10/11", "dpoa"],
  ])("unchanged: %s → %s", async (question, key) => {
    const [reply] = await converse([question]);
    expect(reply!.proposal?.templateKey).toBe(key);
  });
});

describe("remapShouldRun reads only the manager's words", () => {
  let remapShouldRun: typeof import("./form-full-remap").remapShouldRun;
  beforeAll(async () => {
    ({ remapShouldRun } = await import("./form-full-remap"));
  });
  const user = (content: string) => ({ role: "user", content });
  const assistant = (content: string) => ({ role: "assistant", content });

  it("the exit request, and the bare Yes after it, leave the remap", () => {
    expect(remapShouldRun({ question: EXIT_REQUEST, history: [], formsTurn: true })).toBe(false);
    expect(
      remapShouldRun({
        question: "Yes",
        history: [user(EXIT_REQUEST), assistant(RECORDED_CA_REPLY)],
        formsTurn: true,
        continueTemplateKey: "dpoa",
      }),
    ).toBe(false);
  });

  it("an open exit card with no form named leaves the remap; an open Corrective Action card does not", () => {
    expect(remapShouldRun({ question: "Yes", history: [], formsTurn: true, continueTemplateKey: "stc-exit" })).toBe(false);
    expect(remapShouldRun({ question: "Yes", history: [], formsTurn: true, continueTemplateKey: "dpoa" })).toBe(true);
  });

  it("Sunny naming the exit form does not move a Corrective Action off the remap", () => {
    expect(
      remapShouldRun({
        question: "verbal, no payroll",
        history: [
          user("CA for Test Employee at Lawrence, out of dress code 10/11"),
          assistant("If she is leaving, the Resignation/Exit Form is separate. Here is the Corrective Action Form."),
        ],
        formsTurn: true,
        continueTemplateKey: "dpoa",
      }),
    ).toBe(true);
  });
});

/*
 * ============================================================================
 * LATE_OPEN_PAYROLL_FROM_FORM_ENABLED (QA, 26 Oct 2026): A BARE YES OR NO IS
 * PAYROLL DEDUCT ONLY WHERE THE FORM ASKED IT
 * ============================================================================
 *
 * With LATE_OPEN_DATE_ENABLED on (production), a bare "yes" or "no" after an
 * exit form, a resignation or — after another app's Corrective Action reply —
 * was stored as payroll deduct: a wrong fact on an exit form. With the fix,
 * payroll deduct is read from this form only: the manager's own statement, or
 * a bare reply to the payroll question just asked on a Corrective Action
 * Form. Each turn in lowercase, Sentence case and CAPS; the twin pins main
 * (the fix off) exactly. Jordan Hale and Test Employee are synthetic.
 */
describe("LATE_OPEN_PAYROLL_FROM_FORM_ENABLED, with LATE_OPEN_DATE_ENABLED on as in production", () => {
  type Answer = "yes" | "no" | null;
  const RESIGNATION = "Create a resignation form for Test Employee at Lawrence, her last day was 10-20";
  const COACHING = "Create a coaching form for Test Employee at Lawrence about her cell phone use";
  const LATE_CA = "create a verbal ca for Jordan Hale at Manhattan for being late to open on 10-20";
  /* [label, request, reply, the reply recorded before it, main (lowercase, Sentence case, CAPS), with the fix]. */
  const PINS: readonly (readonly [string, string, string, string | null, readonly [Answer, Answer, Answer], Answer])[] = [
    ["an exit form, then yes", EXIT_REQUEST, "Yes", null, [null, "yes", null], null],
    ["an exit form, then no", EXIT_REQUEST, "No", null, [null, "no", null], null],
    ["an exit form after the sibling's CA reply, then yes", EXIT_REQUEST, "Yes", RECORDED_CA_REPLY, ["yes", "yes", "yes"], null],
    ["an exit form after the sibling's CA reply, then no", EXIT_REQUEST, "No", RECORDED_CA_REPLY, ["no", "no", "no"], null],
    ["a resignation, then yes", RESIGNATION, "Yes", null, [null, "yes", "yes"], null],
    ["a resignation, then no", RESIGNATION, "No", null, [null, "no", "no"], null],
    ["a Coaching Form, then yes", COACHING, "Yes", null, [null, null, null], null],
    ["a Coaching Form, then no", COACHING, "No", null, [null, null, null], null],
  ];
  const CASES = PINS.flatMap(([label, request, reply, recorded, main, fixed]) => [
    [`${label} (lowercase)`, request.toLowerCase(), reply.toLowerCase(), recorded, main[0], fixed] as const,
    [`${label} (Sentence case)`, request, reply, recorded, main[1], fixed] as const,
    [`${label} (CAPS)`, request.toUpperCase(), reply.toUpperCase(), recorded, main[2], fixed] as const,
  ]);

  async function payrollAfter(request: string, reply: string, recorded: string | null): Promise<Answer> {
    const turns = await converse([request, reply], recorded ? { 0: recorded } : {});
    return (turns.at(-1)!.proposal?.payrollDeduct ?? null) as Answer;
  }

  beforeEach(() => {
    vi.stubEnv("LATE_OPEN_DATE_ENABLED", "1");
  });

  it.each(CASES)("fix on, %s: not stored", async (_label, request, reply, recorded, _main, fixed) => {
    vi.stubEnv("LATE_OPEN_PAYROLL_FROM_FORM_ENABLED", "1");
    expect(await payrollAfter(request, reply, recorded)).toBe(fixed);
  });

  it.each(CASES)("fix off reads it as main, %s", async (_label, request, reply, recorded, main) => {
    vi.stubEnv("LATE_OPEN_PAYROLL_FROM_FORM_ENABLED", "");
    expect(await payrollAfter(request, reply, recorded)).toBe(main);
  });

  const CA_CASES = (["Yes", "No"] as const).flatMap((reply) => [
    [`${reply} (lowercase)`, LATE_CA.toLowerCase(), reply.toLowerCase(), reply.toLowerCase()] as const,
    [`${reply} (Sentence case)`, LATE_CA.replace(/^c/, "C").replace(" ca ", " CA "), reply, reply.toLowerCase()] as const,
    [`${reply} (CAPS)`, LATE_CA.toUpperCase(), reply.toUpperCase(), reply.toLowerCase()] as const,
  ]);

  it.each(CA_CASES)("a late-opening CA asks the payroll question, and the reply %s is stored, fix on or off", async (_label, request, reply, stored) => {
    for (const fix of ["1", ""]) {
      vi.stubEnv("LATE_OPEN_PAYROLL_FROM_FORM_ENABLED", fix);
      const [first, second] = await converse([request, reply]);
      expect(first!.content).toMatch(/Is payroll deduct applicable\?/);
      expect(second!.proposal?.templateKey).toBe("dpoa");
      expect(second!.proposal?.payrollDeduct ?? null, `fix "${fix}"`).toBe(stored);
    }
  });

  it.each([
    ["lowercase", `${LATE_CA}, no payroll`.toLowerCase()],
    ["Sentence case", "Create a verbal CA for Jordan Hale at Manhattan for being late to open on 10-20. No payroll."],
    ["CAPS", `${LATE_CA}, no payroll`.toUpperCase()],
  ])("\"no payroll\" stated in the CA request is stored as No, fix on or off (%s)", async (_label, request) => {
    for (const fix of ["1", ""]) {
      vi.stubEnv("LATE_OPEN_PAYROLL_FROM_FORM_ENABLED", fix);
      const [first] = await converse([request]);
      expect(first!.proposal?.payrollDeduct ?? null, `fix "${fix}"`).toBe("no");
    }
  });
});
