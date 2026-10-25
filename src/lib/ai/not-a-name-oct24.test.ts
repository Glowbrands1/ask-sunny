import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { notANameGuardEnabled } from "@/lib/config/chat-quality-flags";
import { TEMPLATE_SEEDS } from "@/lib/forms/library";
import type { DirectoryFact } from "@/lib/forms/employee-roster";
import { continuationFor } from "@/lib/forms/proposal-continuation";
import type { AccessScope, ChatMessage } from "@/types";

import { groundFormSlots, type FormRemapSlots } from "./form-full-remap";
import { EMPTY_FORM_STATE } from "./form-state";

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
  const conversationId = `conv-not-a-name-${run}`;
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
      { role: "admin" as never, scope: SCOPE, subject: "manager-not-a-name", verified: true },
      { memoryOwnerId: "manager-not-a-name" },
    );
    out.push({
      question,
      employeeName: response.formProposal?.employeeName ?? null,
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

/**
 * ============================================================================
 * EVERY NAME GUARD ON AT ONCE — THE EARLIER NAME FIXES STILL HOLD (25 OCT 2026)
 * ============================================================================
 *
 * The production profile plus NOT_A_NAME_GUARD, MANAGER_WORDS_ONLY,
 * WARNING_LEVEL_MANAGER_ONLY and CROSS_CHAT_REPLY_GUARD. CROSS_CHAT_REPLY_GUARD
 * (the bare-name roster rule for memory recall) is not on main yet; the
 * variable is set so this test covers it the day it lands, and is inert
 * until then. That rule may gate memory recall only: a name the manager
 * typed is never dropped from the form.
 *
 * Synthetic names only. Jordan Hale is on the directory; "jordan ha" is a
 * partial surname and stays as typed; Avery Testperson is off the directory.
 */
const ALL_ON = [
  "NOT_A_NAME_GUARD_ENABLED",
  "MANAGER_WORDS_ONLY_ENABLED",
  "WARNING_LEVEL_MANAGER_ONLY_ENABLED",
  "CROSS_CHAT_REPLY_GUARD_ENABLED",
] as const;

describe("every name guard on: typed names still reach the form", { timeout: 60_000 }, () => {
  beforeEach(() => {
    for (const flag of ALL_ON) vi.stubEnv(flag, "true");
  });

  function savedState(): { employeeId?: string | null; employeeName?: string | null } | undefined {
    return bag.forms.get(`manager-not-a-name:conv-not-a-name-${run}`) as never;
  }

  function expectNoNameQuestion(turn: Turn) {
    expect(personQuestions(turn.content), turn.question).not.toMatch(/did you mean|which of them|which person/i);
  }

  it("a lowercase full name is the directory's person", async () => {
    bag.intent.latest = ["jordan hale"];
    const [turn] = await converse(["create a coaching form for jordan hale, she was late on 10/20"]);
    expect(turn!.employeeName).toBe("Jordan Hale");
    expect(savedState()?.employeeId).toBe("jordan-hale");
    expectNoNameQuestion(turn!);
  });

  it("a lowercase first name and partial surname stays as typed", async () => {
    bag.intent.latest = ["jordan ha"];
    const [turn] = await converse(["create a coaching form for jordan ha, she was late on 10/20"]);
    expect(turn!.employeeName?.toLowerCase()).toBe("jordan ha");
    expectNoNameQuestion(turn!);
  });

  it.each([
    ["jordan ha", /^jordan ha$/i],
    ["jordan hale", /^Jordan Hale$/],
    ["avery testperson", /^avery testperson$/i],
  ])("%s, typed as the bare reply to who the form is for, is the employee", async (reply, expected) => {
    bag.intent.latest = [reply];
    const turns = await converse(["create a coaching form", reply]);
    expect(turns[0]!.employeeName).toBeNull();
    expect(turns[1]!.employeeName ?? "").toMatch(expected);
    expectNoNameQuestion(turns[1]!);
  });

  it("ALL CAPS: the directory's person in the directory's spelling", async () => {
    bag.intent.latest = ["JORDAN HALE"];
    const [turn] = await converse(["COACHING FORM JORDAN HALE LATE 3 TIMES"]);
    expect(turn!.employeeName).toBe("Jordan Hale");
    expect(savedState()?.employeeId).toBe("jordan-hale");
    expectNoNameQuestion(turn!);
  });

  it("ALL CAPS: a name off the directory is still the employee", async () => {
    bag.intent.latest = ["AVERY TESTPERSON"];
    const [turn] = await converse(["COACHING FORM AVERY TESTPERSON LATE 3 TIMES"]);
    // The live card prints a typed name capitalised ("Avery Testperson"),
    // with these guards on or off; the person is what this checks.
    expect(turn!.employeeName?.toLowerCase()).toBe("avery testperson");
    expectNoNameQuestion(turn!);
  });

  it.each([
    ["Jordan Hale's coaching form, she was late on 10/20", "Jordan Hale"],
    ["Avery Testperson's coaching form, she was late on 10/20", "Avery Testperson"],
  ])("a possessive: %s", async (question, expected) => {
    bag.intent.latest = [expected];
    const [turn] = await converse([question]);
    expect(turn!.employeeName).toBe(expected);
    expectNoNameQuestion(turn!);
  });
});

/**
 * ============================================================================
 * QA L23, conv_mvnjp3362vbremz (25 OCT 2026) — "ONE TANNER" ON AN EXIT FORM
 * ============================================================================
 *
 * The manager asked about pets; the answer cited the manual heading "One
 * Tanner per Room". The exit form that followed was drafted for "One Tanner"
 * on every turn, including after "test employee, tanning consultant at
 * shawnee" and "create exit: Test Employee, …". The intent read ran the name
 * reader over a blob holding that reply, saved "One Tanner", and the saved
 * "The employee is One Tanner." then outvoted the name the manager typed.
 *
 * The manager's ten turns as sent, and the production reply to the first.
 * The intent model is a stand-in that copies only a name in the manager's
 * latest turn; every other name is the code's reading.
 */
const L23_TURNS = [
  "what does policy say about pets in salon",
  "assist with creating an exit form",
  "test employee, tanning consultant at shawnee",
  "last day worked was 9-20-26. management called her with no response on 9-27-26",
  "its a no call no show",
  "create exit form",
  "Create a form from this conversation.",
  "create exit: Test Employee, Tanning Consultant, KS Shawnee Mission Pkwy\nLast day worked 9/20/26\nNo call/no show; management attempted phone contact 9/27/26, no response",
  "Create a form from this conversation.",
  "Create a form from this conversation.",
];

const L23_PETS_REPLY = `Pets are out; service animals are in.

- The Company is responsible for the health and safety of everyone in the workplace, and because animals may pose a threat of infection, cause allergic reactions, make employees or customers feel threatened or distracted, or have accidents and damage company property, employees are asked not to bring pets into the workplace ("Animals in the Workplace", JBA Policy Manual p.30 [p.30]).
- An employee who requires the help of a service animal — defined by 28 CFR 36.104 as any dog individually trained to do work or perform tasks for the benefit of an individual with a disability — is permitted to bring that service animal to the office, provided its presence does not create a danger to others and does not impose an undue hardship on The Company ("Animals in the Workplace", JBA Policy Manual p.30 [p.30]).
- On the client side: only one client is allowed per tanning room, but service animals are allowed in the tanning room with a client ("One Tanner per Room", JBA Policy Manual p.50 [p.50]).
- Also worth knowing for visitors: unauthorized animals are not permitted in areas within the workplace, including parking lots ("Visitors in the Workplace", JBA Policy Manual p.29 [p.29]).

One thing the manual doesn't spell out is a verification process for service animals, so if a team member is unsure how to handle a specific situation at the counter, route it to HR rather than improvising.`;

describe("QA L23: the exit form is for the person the manager typed", { timeout: 120_000 }, () => {
  beforeEach(() => {
    for (const flag of ["MANAGER_WORDS_ONLY_ENABLED", "WARNING_LEVEL_MANAGER_ONLY_ENABLED", "NOT_A_NAME_GUARD_ENABLED"]) {
      vi.stubEnv(flag, "true");
    }
    bag.intent.latest = ["test employee", "Test Employee"];
  });

  it('never "One Tanner"; "Test Employee" from the turn the manager typed it', async () => {
    const turns = await converse(L23_TURNS, { 0: L23_PETS_REPLY });
    for (const turn of turns) {
      expect(turn.content.toLowerCase(), turn.question).not.toContain("one tanner");
      expect(turn.employeeName?.toLowerCase() ?? "", turn.question).not.toContain("tanner");
    }
    expect(turns[1]!.employeeName).toBeNull();
    for (const turn of turns.slice(2)) expect(turn.employeeName, turn.question).toBe("Test Employee");
    const saved = bag.forms.get(`manager-not-a-name:conv-not-a-name-${run}`) as { employeeName?: string | null } | undefined;
    expect(saved?.employeeName).toBe("Test Employee");
  });

  /*
   * A conversation that already saved "One Tanner" before the guard was on
   * (as conv_mvnjp3362vbremz did): the saved name was never typed by the
   * manager, so it does not survive, and "Test Employee" replaces it.
   */
  it("a saved name the manager never typed gives way to the one they type", async () => {
    let savedAfterTurn2: string | null | undefined;
    const turns = await converse(L23_TURNS, { 0: L23_PETS_REPLY }, (index) => {
      if (index === 2) {
        savedAfterTurn2 = (bag.forms.get(`manager-not-a-name:conv-not-a-name-${run}`) as { employeeName?: string | null } | undefined)
          ?.employeeName;
      }
      vi.stubEnv("NOT_A_NAME_GUARD_ENABLED", index < 2 ? "" : "true");
    });
    // Before the guard: the card is for "One Tanner", and the state saved it.
    expect(turns[1]!.content).toContain("for **One Tanner**");
    expect(savedAfterTurn2).toBe("One Tanner");
    for (const turn of turns.slice(2)) {
      expect(turn.employeeName, turn.question).toBe("Test Employee");
      expect(turn.content.toLowerCase(), turn.question).not.toContain("one tanner");
    }
  });

  /*
   * The same rule for any name: one the state holds and an assistant reply in
   * the window says, but the manager never typed (a synthetic "Pat Example",
   * saved before the guard), is not kept, and is not carried from the card.
   */
  it("a saved name that came from a reply is dropped, and the typed one replaces it", async () => {
    bag.forms.set(`manager-not-a-name:conv-not-a-name-${run + 1}`, {
      ...EMPTY_FORM_STATE,
      employeeName: "Pat Example",
      templateKey: "stc-exit",
    });
    const turns = await converse(
      [
        "who fills in the exit paperwork?",
        "assist with creating an exit form",
        "test employee, tanning consultant at shawnee",
        "create exit form",
      ],
      { 0: "The salon director fills it in. I can start the Resignation/Exit Form for Pat Example whenever you're ready." },
    );
    for (const turn of turns.slice(1)) expect(turn.content, turn.question).not.toContain("Pat Example");
    expect(turns[1]!.employeeName).toBeNull();
    for (const turn of turns.slice(2)) expect(turn.employeeName, turn.question).toBe("Test Employee");
  });

  /*
   * History is capped at 20 turns. A name the manager typed in the first
   * turn of a long form chat falls out of the window; with no reply saying
   * it either, that is no evidence it came from a reply, and it stays.
   */
  it("a name typed before the history window stays on the form", async () => {
    bag.intent.latest = ["Avery Testperson"];
    const turns = await converse([
      "create a coaching form for Avery Testperson",
      "she was late on 10/20",
      "it was the third time this month",
      "she was 25 minutes late",
      "the coaching covers attendance",
      "I explained the attendance policy",
      "she said traffic was bad",
      "we agreed she will leave earlier",
      "follow up in two weeks",
      "job title is tanning consultant",
      "it happened at lawrence",
      "add that she was apologetic",
      "Create a form from this conversation.",
    ]);
    for (const turn of turns) expect(turn.employeeName?.toLowerCase(), turn.question).toBe("avery testperson");
  });

  /*
   * The 9/27 form date in production came from the intent model's
   * incidentDate ("management called her … on 9-27-26" is in the manager's
   * words, so the date reader accepts it). This stand-in names no date, so
   * the card keeps "the day the draft is created"; with the model's 9-27 the
   * card's formDate is 2026-09-27 while Last Day Worked stays September 20.
   */
  it("the last day worked is September 20, and the form date is not the call on 9-27", async () => {
    const turns = await converse(L23_TURNS, { 0: L23_PETS_REPLY });
    for (const turn of turns.slice(3)) {
      expect(turn.content, turn.question).toContain("**Last Day Worked:** September 20, 2026");
      expect(turn.formDate ?? null, turn.question).not.toBe("2026-09-27");
    }
  });
});
