import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { notANameGuardEnabled } from "@/lib/config/chat-quality-flags";
import { TEMPLATE_SEEDS } from "@/lib/forms/library";
import type { DirectoryFact } from "@/lib/forms/employee-roster";
import { continuationFor } from "@/lib/forms/proposal-continuation";
import type { AccessScope, ChatMessage } from "@/types";

import { groundFormSlots, type FormRemapSlots } from "./form-full-remap";

/**
 * ============================================================================
 * QA ROUND 4, 24 OCT 2026 — WORDS THAT ARE NOT A PERSON WERE TAKEN AS ONE
 * ============================================================================
 *
 * Four low-rated chats, replayed word for word through `answerQuestion` with
 * the production flag profile (INTENT_EXTRACTION, QUERY_REWRITE,
 * GROUNDED_ENTITIES, TYPED_NAME_PROCEEDS, FEWSHOT, SLOT_RETENTION,
 * FIELD_ACCURACY, LONG_CONTEXT, POLICY_CITATION, SECOND_FORM,
 * GLOBAL_SALON_ASK, DRAFT_MERGE on; CODE_SLOTS, FORM_STATE, FORM_FULL_REMAP
 * unset):
 *
 *   conv_mvmvo5wf2p0o2b7  "1. employee name is blank"        → employee "Blank"
 *                         the October promo list              → "Which of them … Red Light
 *                                                               Visits … BOT Restored Prep Spray?"
 *   conv_mvmvmo6w2bvg7ub  the assistant's "require practice"  → employee "require practice"
 *   conv_mvmvxluj2j5fqmw  "coaching form for lawrence location tanning consultant, test testy"
 *                                                             → "test testy or lawrence?"
 *   conv_mvmw5z9x2txk4it  "coaching form for EFT's and spa"   → "EFT or spa?", then "spa Here"
 *
 * The manager's turns are unchanged; the people in them were already QA test
 * names. Off the directory, so the card can only take the name as typed.
 * NOT_A_NAME_GUARD_ENABLED keeps every one of those words off the card and
 * out of any "which of them" / "did you mean" question.
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

const TODAY = "2026-10-24";

const bag = vi.hoisted(() => ({
  forms: new Map<string, unknown>(),
  /**
   * What the intent model copied as the employee in production: a name in
   * the manager's latest turn, or (`fromAnywhere`) a phrase it lifted from
   * an assistant reply — the chat_traces slot for conv_mvmvmo6w2bvg7ub was
   * "require practice".
   */
  intent: { latest: [] as string[], fromAnywhere: [] as string[] },
}));

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
});

beforeEach(() => {
  for (const flag of PROFILE) vi.stubEnv(flag, "true");
  bag.forms.clear();
  bag.intent = { latest: [], fromAnywhere: [] };
});

afterEach(() => {
  vi.unstubAllEnvs();
});

interface Turn {
  readonly question: string;
  readonly employeeName: string | null;
  readonly content: string;
}

let run = 0;

/** `recorded` replaces this app's reply with the one production sent, by turn index. */
async function converse(turns: readonly string[], recorded: Readonly<Record<number, string>> = {}): Promise<Turn[]> {
  run += 1;
  const conversationId = `conv-not-a-name-${run}`;
  const history: ChatMessage[] = [];
  const out: Turn[] = [];
  for (const [index, question] of turns.entries()) {
    const response = await answerQuestion(
      {
        question,
        mode: "standard",
        history: [...history],
        scopeId: "stc-core",
        questionMessageId: `msg-${run}-${index}`,
        conversationId,
        continueProposalTemplateKey: continuationFor(history)?.templateKey,
        context: { userName: "Pat Manager", locationName: "All salons", todayIso: TODAY },
      },
      { role: "admin" as never, scope: SCOPE, subject: "manager-not-a-name", verified: true },
      { memoryOwnerId: "manager-not-a-name" },
    );
    out.push({ question, employeeName: response.formProposal?.employeeName ?? null, content: response.content });
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

/** The lines that ask the manager to pick or confirm a person. */
function personQuestions(content: string): string {
  return content
    .split("\n")
    .filter((line) => /which of them|did you mean|which person|who is this/i.test(line))
    .join("\n");
}

function expectNever(turns: readonly Turn[], banned: readonly string[]) {
  for (const [index, turn] of turns.entries()) {
    const where = `turn ${index + 1}: ${turn.question.slice(0, 60)}`;
    const asked = personQuestions(turn.content).toLowerCase();
    for (const word of banned) {
      expect(turn.employeeName?.toLowerCase() ?? "", `${where} — employee`).not.toContain(word.toLowerCase());
      expect(asked, `${where} — asked`).not.toContain(word.toLowerCase());
    }
  }
}

const PROMO = `Timeline: October 1 – October 31
Offers:
• $5 Red Light Visits
• Eight Red Light Visits for $35
• Wellness Product Bundle: KIT Restored Red Light for $79.99 ($64.98 Savings + $6 Bonus)
➢ BOT Restored Prep Spray
➢ BOT Restored Post Cream
➢ BOT Restored Target Serum
➢ Five Wellness Visits`;

/** conv_mvmvo5wf2p0o2b7, the manager's turns as sent (the promo block was pasted seven times). */
const PROMOTIONS = [
  "help me create a coaching form",
  "1.  Can I keep this field blank to use this coaching form with multiple staff?\n2. October 1st\n3. it's for october promotions, can i upload the pdf to read off of?\n4. tanning consultant",
  "1. employee name is blank\n2. knowledge on october promotions",
  Array.from({ length: 7 }, () => PROMO).join("\n"),
  "for test employe.  all of it if possible",
  "oh lets create a follow-up coaching form instead then",
  "red light visits and mentioning them on every client check-in.",
  "ok, create a follow-up coaching form for test employe.  for a must see behavior.  i trained her on the promotions, specificslly the $5 red light therapy promo, and  i roleplayed a couple objections with her. the follow-up is that i'll listen in on her with client engagment, tie the mention of redlight into the reason the client is there in the first place",
  "Oops, it's Test Employee",
  "create a follow-up coaching form for test employee",
];

const PROMO_ITEMS = [
  "blank",
  "Red Light",
  "BOT Restored",
  "Prep Spray",
  "Post Cream",
  "Target Serum",
  "Wellness",
  "Product Bundle",
  "Timeline",
];

/** conv_mvmvmo6w2bvg7ub. The first reply is the production answer, word for word. */
const COACHING_PREP_REPLY = `Happy to help. To make it specific, tell me who it's with and what you've observed — but here's the prep structure to work from in the meantime.

**Answer these before you walk in**
1. What exact behavior or result needs to change?
2. What facts support the conversation?
3. Is this a skill, knowledge, confidence, effort, policy, or leadership gap?
4. What is the correct behavior you want to see?
5. Can you demonstrate it yourself?
6. What role-play scenario will prove they understood?
7. What follow-up will happen?
8. Does this need coaching, EPP, DPOA, or leadership review?

A difficult conversation should start with clarity, not frustration.

**Structure the conversation itself** — use the Management Diamond: WHAT behavior you want, HOW to do it (exact verbiage), WHY it matters, WHEN it should happen, and PRACTICE. Document, demonstrate, duplicate.

**What to actually say** — state the observed behavior, explain why it matters, demonstrate the correct behavior or verbiage, require practice, set a follow-up expectation, and capture the employee's acknowledgement.

**Pick the right rung.** Solve it at the lowest appropriate level — observation, then coaching, then role play, then follow-up coaching — and escalate only if it repeats or it's a policy issue [S4]. If you haven't observed the behavior live yet, start there; reports show what is happening, observation explains why.

As a general approach, hold it privately, early in the shift when there's still time to practice and watch it play out, and keep it to one focus so the person leaves knowing exactly what to do on the next client.

If you want this documented, ask me to create a coaching form for the employee and I'll open the draft. Tell me the name and what you've seen, and I'll help you tighten the language first.`;

const COACHING_PREP = [
  "Help me prepare for a coaching conversation.",
  "I have an employee that is not verifying documents are signed",
  "The NCR and Fitzpatrick Skin Type Chart, EFT Agreements",
  "Can you create a coaching form and a policy review? I'd like to see both",
  "Can you make it generic so if the problem occurs elsewhere it can be used for any employee?",
];

/** conv_mvmvxluj2j5fqmw. */
const LAWRENCE = [
  "create coaching form for employee test testy who is a tanning consultant at manhattan. on 9-29-26 test was out of dress code",
  "employee name is test testy",
  "create coaching form for test testy",
  "sunny created a coaching form for an employee who was not in dress code and reflected it as underperformance and should be retraining",
  "create a coaching form for lawrence location tanning consultant, test testy, who was talking on her cell phone for 25 minutes on 9-29-26 when customers were waiting to check in",
  "salon location is lawrence, ks",
  "Create a Coaching Form from this conversation.",
];

/** conv_mvmw5z9x2txk4it. */
const SPA = ["Can you create a coaching form for EFT's and spa", "Can you make a weekly coaching for how to get efts"];

describe("NOT_A_NAME_GUARD_ENABLED", () => {
  it("defaults off", () => {
    vi.unstubAllEnvs();
    expect(notANameGuardEnabled()).toBe(false);
  });
});

// A replay is several full turns; under a loaded runner one takes longer than the 5s default.
describe("QA round 4: non-names are never the employee (guard on)", { timeout: 60_000 }, () => {
  beforeEach(() => {
    vi.stubEnv("NOT_A_NAME_GUARD_ENABLED", "true");
  });

  it('conv_mvmvo5wf2p0o2b7: "employee name is blank" and the promo list name nobody; "test employe" still does', async () => {
    bag.intent.latest = ["blank", "Red Light Visits", "test employe", "Test Employee"];
    const turns = await converse(PROMOTIONS);
    expectNever(turns, PROMO_ITEMS);
    expect(turns[4]!.employeeName?.toLowerCase()).toBe("test employe");
    // "Oops, it's Test Employee" does not replace the one-letter-short spelling
    // with the guard on or off — a correction issue, not a non-name. The
    // person stays the one the manager typed.
    for (const turn of turns.slice(4)) expect(turn.employeeName?.toLowerCase()).toMatch(/^test employee?$/);
  });

  it('conv_mvmvmo6w2bvg7ub: the assistant\'s "require practice" is not the employee; a typed name still is', async () => {
    bag.intent.fromAnywhere = ["require practice"];
    const turns = await converse([...COACHING_PREP, "create a coaching form for Jordan Testperson"], { 0: COACHING_PREP_REPLY });
    expectNever(turns, ["require", "practice", "Fitzpatrick", "Skin Type", "EFT", "NCR"]);
    expect(turns.at(-1)!.employeeName).toBe("Jordan Testperson");
  });

  it('conv_mvmvxluj2j5fqmw: "lawrence location" is the salon, never a person; "test testy" stays', async () => {
    const turns = await converse(LAWRENCE);
    expectNever(turns, ["lawrence", "manhattan"]);
    for (const turn of turns.slice(4)) expect(turn.employeeName?.toLowerCase()).toBe("test testy");
  });

  it('conv_mvmw5z9x2txk4it: "EFT\'s and spa" name nobody, and "spa Here" never appears; a typed name still does', async () => {
    const turns = await converse([...SPA, "create a coaching form for Jordan Testperson"]);
    expectNever(turns, ["spa", "EFT", "Here"]);
    expect(turns.at(-1)!.employeeName).toBe("Jordan Testperson");
  });
});

/**
 * The full-remap reader (FORM_FULL_REMAP_ENABLED, off in this app's
 * production, on in Ask Bubbles'): the same turns, with a stand-in model that
 * copies the non-name a model copied in production. The guard is the same
 * one Ask Bubbles' live path runs.
 */
describe("QA round 4 through the full remap reader (guard on)", () => {
  beforeEach(() => {
    vi.stubEnv("NOT_A_NAME_GUARD_ENABLED", "true");
    vi.stubEnv("FORM_FULL_REMAP_ENABLED", "true");
  });

  function remap(turns: readonly string[], model: readonly (string | null)[], recorded: Readonly<Record<number, string>> = {}) {
    const seen: Turn[] = [];
    const history: { role: string; content: string }[] = [];
    let saved: Partial<FormRemapSlots> | null = null;
    for (const [index, question] of turns.entries()) {
      const { slots, response } = groundFormSlots({
        raw: { templateKey: null, employeeName: model[index] ?? null, observation: null, actionPlan: null },
        history: [...history],
        question,
        today: TODAY,
        people: [],
        saved,
      });
      saved = slots;
      seen.push({ question, employeeName: response.formProposal?.employeeName ?? slots.employeeName, content: response.content });
      history.push({ role: "user", content: question }, { role: "assistant", content: recorded[index] ?? response.content });
    }
    return seen;
  }

  it("conv_mvmvo5wf2p0o2b7: blank and the offers are nobody; test employe stays", () => {
    const turns = remap(PROMOTIONS.slice(0, 6), [null, null, "blank", "Red Light Visits", "test employe", "test employe"]);
    expectNever(turns, PROMO_ITEMS);
    for (const turn of turns.slice(4)) expect(turn.employeeName?.toLowerCase()).toBe("test employe");
  });

  it("conv_mvmvmo6w2bvg7ub: the assistant's require practice is nobody; a typed name stays", () => {
    const turns = remap(
      [...COACHING_PREP, "create a coaching form for Jordan Testperson"],
      [null, "require practice", "require practice", "require practice", "require practice", "Jordan Testperson"],
      { 0: COACHING_PREP_REPLY },
    );
    expectNever(turns, ["require", "practice", "Fitzpatrick", "Skin Type", "EFT", "NCR"]);
    expect(turns.at(-1)!.employeeName).toBe("Jordan Testperson");
  });

  it("conv_mvmvxluj2j5fqmw: lawrence is the salon; test testy stays", () => {
    const turns = remap(LAWRENCE, ["test testy", "test testy", "test testy", "test testy", "lawrence", "lawrence", "test testy"]);
    expectNever(turns, ["lawrence", "manhattan"]);
    for (const turn of turns) expect(turn.employeeName?.toLowerCase()).toBe("test testy");
  });

  it("conv_mvmw5z9x2txk4it: EFT's and spa are nobody; a typed name stays", () => {
    const turns = remap([...SPA, "create a coaching form for Jordan Testperson"], ["EFT's", "spa", "Jordan Testperson"]);
    expectNever(turns, ["spa", "EFT", "Here"]);
    expect(turns.at(-1)!.employeeName).toBe("Jordan Testperson");
  });
});
