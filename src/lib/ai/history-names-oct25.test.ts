import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { TEMPLATE_SEEDS } from "@/lib/forms/library";
import type { DirectoryFact } from "@/lib/forms/employee-roster";
import { continuationFor } from "@/lib/forms/proposal-continuation";
import type { AccessScope, ChatMessage } from "@/types";

/**
 * ============================================================================
 * QA, ASK SUNNY FULL CHAT HISTORY (25 OCT 2026) — NAMES, TITLES AND THE FORM
 * ============================================================================
 *
 * Each case is the manager's turns, word for word, through `answerQuestion`
 * with the production flag profile (INTENT_EXTRACTION, QUERY_REWRITE,
 * GROUNDED_ENTITIES, TYPED_NAME_PROCEEDS, FEWSHOT, SLOT_RETENTION,
 * FIELD_ACCURACY, LONG_CONTEXT, POLICY_CITATION, SECOND_FORM,
 * GLOBAL_SALON_ASK, DRAFT_MERGE) and NOT_A_NAME_GUARD_ENABLED, which is live.
 * The people's names are swapped for invented ones; every other word is the
 * manager's ("On", "When Maddie", "September Promo", "Bed Tech St", "keep",
 * "empolyee", "Tanning Consulatant" are the bug and stay as typed). QA's own
 * test names ("Test Employee", "test testy") are kept.
 *
 * The intent model is a stand-in: it copies the name the manager typed in the
 * latest turn (or nothing, where production's model returned nothing), and
 * the title or form production's model gave, read from chat_traces where the
 * conversation has one.
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
  "NOT_A_NAME_GUARD_ENABLED",
] as const;

const TODAY = "2026-10-24";

const bag = vi.hoisted(() => ({
  forms: new Map<string, unknown>(),
  /** Names the stand-in model copies when the manager's latest turn holds one. */
  intent: { latest: [] as string[], fromAnywhere: [] as string[] },
  turn: 0,
  /** What production's model read on a turn, by turn index. */
  extra: {} as Record<number, Record<string, unknown>>,
}));

const PEOPLE: DirectoryFact[] = [];

function person(name: string, title = "Tanning Consultant"): DirectoryFact {
  const [firstName, lastName] = name.split(" ");
  return {
    id: name.toLowerCase().replace(/\s+/g, "-"),
    firstName: firstName!,
    lastName: lastName!,
    preferredFirstName: null,
    salonIds: ["loc-0468"],
    title,
    primarySalonId: "loc-0468",
    primaryLocationName: "KS Lawrence",
  };
}

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
      ...(bag.extra[bag.turn] ?? {}),
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

// The first import of server-ask is the slow part; under load it alone passed 10s.
beforeAll(async () => {
  ({ answerQuestion } = await import("./server-ask"));
}, 120_000);

beforeEach(() => {
  for (const flag of PROFILE) vi.stubEnv(flag, "true");
  bag.forms.clear();
  bag.intent = { latest: [], fromAnywhere: [] };
  bag.extra = {};
  PEOPLE.splice(0, PEOPLE.length);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

interface Turn {
  readonly question: string;
  readonly employeeName: string | null;
  readonly template: string | null;
  readonly role: string | null;
  readonly payrollDeduct: string | null;
  readonly content: string;
}

let run = 0;

/** `recorded` replaces this app's reply with the one production sent, by turn index. */
async function converse(turns: readonly string[], recorded: Readonly<Record<number, string>> = {}): Promise<Turn[]> {
  run += 1;
  const conversationId = `conv-history-names-${run}`;
  const history: ChatMessage[] = [];
  const out: Turn[] = [];
  for (const [index, question] of turns.entries()) {
    bag.turn = index;
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
      { role: "admin" as never, scope: SCOPE, subject: "manager-history-names", verified: true },
      { memoryOwnerId: "manager-history-names" },
    );
    const card = response.formProposal as
      | { employeeName?: string | null; templateName?: string; employeeRole?: string | null; payrollDeduct?: string | null }
      | undefined;
    out.push({
      question,
      employeeName: card?.employeeName ?? null,
      template: card?.templateName ?? null,
      role: card?.employeeRole ?? null,
      payrollDeduct: card?.payrollDeduct ?? null,
      content: response.content,
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

/** The people a reply offers to pick from or confirm: the bold names on a "which of them" / "did you mean" line. */
function offered(content: string): string[] {
  return content
    .split("\n")
    .filter((line) => /which of them|did you mean|which person|who is this/i.test(line))
    .flatMap((line) => [...line.matchAll(/\*\*([^*]+)\*\*/g)].map((match) => match[1]!.trim().toLowerCase()));
}

/** No turn puts these words on the card as the employee, or offers them as a person. */
function expectNever(turns: readonly Turn[], banned: readonly string[]) {
  for (const [index, turn] of turns.entries()) {
    const where = `turn ${index + 1}: ${turn.question.slice(0, 60)}`;
    const names = offered(turn.content);
    for (const word of banned) {
      const whole = new RegExp(`(?:^|\\s)${word.toLowerCase()}(?:\\s|$)`);
      expect(whole.test(turn.employeeName?.toLowerCase() ?? ""), `${where} — employee ${turn.employeeName}`).toBe(false);
      expect(names.some((name) => whole.test(name)), `${where} — offered ${names.join(", ")}`).toBe(false);
    }
  }
}

const SLOW = { timeout: 120_000 };

/* ------------------------------------------------------------- P2: names -- */

describe("P2: words that are not the employee (NOT_A_NAME_GUARD_ENABLED, live)", SLOW, () => {
  it('conv_mvi6vsex5zjk5sc: "<A>, <B> or On?" — "On" is never offered', async () => {
    bag.intent.latest = ["Dana Quill"];
    const turns = await converse([
      "create a coaching document for Dana Quill regarding On 10-16-26 the Woven policy acknowledgement report reflected that Rory Vance did not complete required policy acknowledgements during her onboarding on 9-28-26. Dana is responsible for making sure all new hires complete required policy acknowledgements during onboarding.",
      "coaching form for Dana Quill",
    ]);
    expectNever(turns, ["On"]);
    for (const turn of turns) expect(turn.employeeName).toBe("Dana Quill");
  });

  // Production's model named nobody in the long turn; the reader then offered "When Maddie".
  it.each([
    ["the model names the employee", ["Jodie Marsh", "jodie marsh"]],
    ["the model names nobody", []],
  ])('conv_mvjrw51zhph0158: "<A> or When Maddie?" — %s', async (_label, names) => {
    bag.intent.latest = [...names];
    const turns = await converse([
      "I need a corrective action for  f",
      "Jodie Marsh, today, - Jodi set up a spray booth, then went into Room 4 and stayed there until the first customer arrived at 7:57am.\n- When we arrived at 8:15am, the lobby lights were still off.\n- When Maddie asked whether she had completed her 10-minute sanitization, Jodi said yes. The footage showed that it had not been completed.\n- She was also not in dress code, was not wearing her nametag, and did not have a goal sheet until she was asked about it. Written warning. previous coaching. verbal (06/25/2026) and written (07/28/2026). no payroll deducation. TC",
      "jodie marsh",
    ]);
    expectNever(turns, ["When Maddie", "Maddie", "Warning Level"]);
    expect(turns[1]!.employeeName).toBe("Jodie Marsh");
    expect(turns[2]!.employeeName).toBe("Jodie Marsh");
  });

  it('conv_mux9q0nkb8frsd3: "<A> or September Promo?" — the coaching it names is not a person', async () => {
    bag.intent.latest = ["Avery Lund", "avery Lund"];
    const turns = await converse([
      "can you help me create a corrective action form for Avery Lund on Must See Behaviors",
      "Avery Lund, she is a TC at  Mo Kansas City Wornall, created today but for the month of September, Avery was below company average in all categories for September, this will be a written warning, she completed September Promo coaching 9/29/26, Hemp nation product coaching form 9/30/26, Shrink coaching 9/31/26, and what would you recommend coaching 9/30/26, there is no payroll deduction applicable",
      "avery Lund",
    ]);
    expectNever(turns, ["September Promo", "September", "Hemp", "Shrink"]);
    for (const turn of turns) expect(turn.employeeName).toBe("Avery Lund");
  });

  it('conv_mv8kjxpm2tnx5y2: "<A> or Bed Tech St?" — the title and salon are not a person', async () => {
    bag.intent.latest = ["casey wendell", "Casey Wendell"];
    const turns = await converse([
      "Create a coaching form.",
      "1. casey wendell 2.today 3. i have observed casey running late for shifts even though she is communicating we want to avoid this from happening  4. bed tech st joe",
      "1.  Casey Wendell 2. today 3. Bed Tech St.Joe",
      "it's a coaching form for employee Casey Wendell who works at the st joe location",
    ]);
    expectNever(turns, ["Bed Tech St", "Bed Tech", "St Joe", "St.Joe"]);
    for (const turn of turns.slice(1)) expect(turn.employeeName).toBe("Casey Wendell");
  });

  /*
   * conv_mvb75wuo2nnsluv. Failed on main with the guard on: "Which of them …
   * — Blair Sutton or empolyee Blair Sutton?", and with a model that copied
   * the role, the card was for "Empolyee Blair Sutton" / "Tanning Consulatant
   * Blair Sutton". A misspelt "employee" and a job title in front of the name
   * are the label every reader already takes off "employee <name>".
   */
  const EMPOLYEE = [
    "corrective action form for empolyee Blair Sutton for opening store late",
    "can you format a corrective action form for Tanning Consulatant Blair Sutton who opened the store late today",
    "make the corrective action form draft printable as is",
  ];

  it.each([
    ["the model copies the name", ["Blair Sutton"]],
    ["the model copies the role with it", ["Blair Sutton", "empolyee Blair Sutton", "Tanning Consulatant Blair Sutton"]],
    ["the model names nobody", []],
  ])("conv_mvb75wuo2nnsluv: empolyee and the job title are not part of the name — %s", async (_label, names) => {
    bag.intent.latest = [...names];
    const turns = await converse(EMPOLYEE);
    for (const turn of turns) {
      expect(turn.employeeName, turn.question).toBe("Blair Sutton");
      expect(offered(turn.content), turn.question).toEqual([]);
      // The card's lead names the person; the manager's own words stay in What happened.
      expect(turn.content, turn.question).not.toMatch(/for \*\*(?:empolyee|tanning)/i);
    }
  });

  it("conv_mvb75wuo2nnsluv: a correctly spelt title in front of the name comes off too", async () => {
    bag.intent.latest = ["Tanning Consultant Blair Sutton"];
    const [turn] = await converse([
      "can you format a corrective action form for Tanning Consultant Blair Sutton who opened the store late today",
    ]);
    expect(turn!.employeeName).toBe("Blair Sutton");
  });

  /*
   * conv_mvh9a9q62mjffk2. Production: "Did you mean <directory name>?" and the
   * manager's "keep <typed>" made the card's employee "keep <typed>". The
   * question is the production reply, with the names swapped. On main the
   * card kept the typed name, but every later reply named the directory
   * person the manager had declined ("for **Karolina Wexler**"): the roster
   * reader read the assistant's question as if the manager had said it.
   */
  const DID_YOU_MEAN_KEEP =
    'Did you mean **Karolina Wexler**? I couldn\'t find **karolyn** exactly in the employee list for your salons, so I want to be sure before it goes on the form. Reply "yes" to use **Karolina Wexler**, or "no" to keep **karolyn** as you typed it.';
  const KEEP = [
    "can you create me a ca form for karolyn",
    "keep karolyn",
    "payroll is deductable",
    "she was caught vaping, given verbal warning",
  ];

  it.each([
    ["the model copies the name", ["karolyn"]],
    ["the model copies keep with it", ["karolyn", "keep karolyn"]],
  ])('conv_mvh9a9q62mjffk2: "keep <name>" keeps the name as typed — %s', async (_label, names) => {
    PEOPLE.push(person("Karolina Wexler"));
    bag.intent.latest = [...names];
    const turns = await converse(KEEP, { 0: DID_YOU_MEAN_KEEP });
    expectNever(turns, ["keep"]);
    for (const turn of turns) {
      expect(turn.employeeName, turn.question).toBe("Karolyn");
      expect(turn.content, turn.question).not.toContain("**Karolina Wexler**");
    }
  });

  /*
   * conv_mvl7ntrk2wg08iy. Production asked "Did you mean <directory name>?",
   * and "yes" got the same question back. A typed first name now proceeds
   * (TYPED_NAME_PROCEEDS_ENABLED); in a conversation that still holds the old
   * question, "yes" is the directory person.
   */
  it('conv_mvl7ntrk2wg08iy: "yes" to "Did you mean <name>?" is that person, not the question again', async () => {
    PEOPLE.push(person("Casey Wendell"));
    bag.intent.latest = ["Casey", "casey wendell"];
    const question =
      'Did you mean **Casey Wendell**? I couldn\'t find **Casey** exactly in the employee list for your salons, so I want to be sure before it goes on the form. Reply "yes" to use **Casey Wendell**, or "no" to keep **Casey** as you typed it.';
    const turns = await converse(
      [
        "I need to upload a document to casey wendel profile",
        "Now that I have Casey's coaching uploaded in my glow for being late, I need a corrective Action document for Casey being late again today.",
        "yes",
        "Yes its casey wendell",
      ],
      { 1: question },
    );
    expect(turns[2]!.employeeName).toBe("Casey Wendell");
    expect(turns[2]!.content).not.toMatch(/^Did you mean/);
    expect(turns[3]!.employeeName).toBe("Casey Wendell");
  });

  // QA G5, conv_mvnt8lbq2rlbp0m: "Which of them … — Test Employee, Video or assessment?" (a regression, live guard on).
  it("conv_mvnt8lbq2rlbp0m: the steps of a training are not people", async () => {
    bag.intent.latest = ["Test Employee"];
    bag.extra = { 0: { title: "ASD", formType: "coaching" }, 1: { title: "ASD", formType: "coaching" } };
    const turns = await converse([
      "Create a coaching form for an ASD on completing TC Training with new hires appropriately. Video, activity, roleplay, assessment.",
      "Test Employee today, she's not consistent when TC Training new hires. It's not being completed in the correct way. For example, following the correct procedure. Video, activity/roleplay, assessment. When the TC Training is complete, uploading the appropriate documentation to their file.",
    ]);
    expectNever(turns, ["Video", "assessment", "activity", "roleplay"]);
    expect(turns[1]!.employeeName).toBe("Test Employee");
  });

  // QA S22, conv_mvnszqiq28bgs9z: the card switched to the new hire named in an edit. Holds on main.
  it('conv_mvnszqiq28bgs9z: the new hire named in "change observation of offense to: …" is not the employee', async () => {
    bag.intent.latest = ["test employee", "Test Employee"];
    bag.extra = { 0: { title: "Salon Director", formType: "dpoa" } };
    const turns = await converse([
      "create a CA for salon director, test employee for violating the standards of conduct",
      "Test Employee, Salon Director",
      "change observation of offense to: Test completed onboarding with new hire Test Newhire on 9-28-26. As of 10-16-26 Test Newhire had not acknowledged onboarding policies in Woven that should have been completed during onboarding.",
      "create the ca",
    ]);
    expectNever(turns, ["Test Newhire", "Newhire"]);
    for (const turn of turns) expect(turn.employeeName?.toLowerCase(), turn.question).toBe("test employee");
  });
});

/* --------------------------------------------------- P4: payroll answer -- */

describe("PAYROLL_DEDUCTIBLE_WORD_ENABLED: conv_mvh9a9q62mjffk2, payroll re-asked", SLOW, () => {
  const TURNS = ["can you create me a ca form for karolyn", "payroll is deductable", "she was caught vaping, given verbal warning"];

  it("defaults off", async () => {
    const { payrollDeductibleWordEnabled } = await import("@/lib/config/chat-quality-flags");
    expect(payrollDeductibleWordEnabled()).toBe(false);
  });

  it('on: "payroll is deductable" is Yes, and the payroll question is not asked again', async () => {
    vi.stubEnv("PAYROLL_DEDUCTIBLE_WORD_ENABLED", "true");
    bag.intent.latest = ["karolyn"];
    const turns = await converse(TURNS);
    for (const turn of turns.slice(1)) {
      expect(turn.payrollDeduct, turn.question).toBe("yes");
      expect(turn.content, turn.question).not.toContain("**Is payroll deduct applicable?**");
    }
  });

  it("off: as production — the question comes back", async () => {
    bag.intent.latest = ["karolyn"];
    const turns = await converse(TURNS);
    expect(turns[1]!.payrollDeduct).toBeNull();
    expect(turns[1]!.content).toContain("**Is payroll deduct applicable?**");
  });
});

/* ------------------------------------------------------------ titles -- */

describe("TITLE_WHOLE_WORD_ENABLED: titles the manager never gave", SLOW, () => {
  beforeEach(() => {
    vi.stubEnv("TITLE_WHOLE_WORD_ENABLED", "true");
  });

  // QA S28 (Ask Bubbles B5): "Job title: HR" — "HR" read inside "three", "throught", "bathrooms" off a directory title.
  it.each([
    [
      "conv_mvnt37jk2gz4xd4",
      [
        "I have an employee Test Employee at our NE Kearney location who has been out of dress code three shifts. I verbally coached her on the second offense and she still is out of dress code",
        "Create a Coaching Form from this conversation.",
        "Yes",
      ],
    ],
    [
      "conv_mvnt7q2521b3uaj",
      [
        "Please make me a coaching form for test employee at the lincoln pine lake location Test did not complete closing duties. Trash was not taken out of the bathrooms, there was no toilet paper in the women's bathroom, and there were no spray towels in the rooms also all the cleaning duties were signed off in the binder and not alll were completed and the way she signed off on the checklist was incorrect she signed one box with a arrown throught the rest each box needs an initial",
      ],
    ],
  ])("%s: no HR title", async (_conv, said) => {
    PEOPLE.push(person("Casey Corp", "HR"));
    bag.intent.latest = ["Test Employee", "test employee"];
    const turns = await converse(said);
    for (const turn of turns) {
      expect(turn.role ?? "", turn.question).not.toMatch(/\bHR\b/);
      expect(turn.content, turn.question).not.toMatch(/Job title:\*\*\s*HR/);
    }
  });

  // QA H10, conv_mvnt9mnt2m0tls0: "4. bed tech st joe" put the salon in the title. Failed with the flag on before this fix.
  it('conv_mvnt9mnt2m0tls0: "bed tech st joe" is the title "bed tech" at St Joseph', async () => {
    bag.intent.latest = ["test employee"];
    bag.extra = { 1: { title: "bed tech st joe", formType: "coaching" } };
    const turns = await converse([
      "Create a coaching form.",
      "1. test employee 2.today 3. i have observed test running late for shifts even though she is communicating we want to avoid this from happening 4. bed tech st joe",
    ]);
    // The card reads the title back from the "Job title: …" state line; the place never reaches it.
    expect(turns[1]!.role ?? "").toMatch(/^bed tech\b/);
    expect(turns[1]!.role ?? "").not.toMatch(/st\.? ?joe/i);
    expect(turns[1]!.content).not.toMatch(/Job title:\*\*[^\n]*st joe/i);
  });
});

/* -------------------------------------------------------- wrong form -- */

describe("FORM_CHOICE_STATED_ENABLED: the form the manager asked for", SLOW, () => {
  beforeEach(() => {
    for (const flag of ["FORM_CHOICE_STATED_ENABLED", "CA_TEMPLATE_MAP_ENABLED", "PRIOR_ACTIONS_PARSE_ENABLED", "TITLE_WHOLE_WORD_ENABLED"]) {
      vi.stubEnv(flag, "true");
    }
  });

  // QA H9 / Ask Bubbles B14 conv_mvntwwn22a8fgi0: "Which form should I start with — …?" after "create a CA". Failed before this fix.
  it("Kearney promo: the coaching in the prior-coaching list is not a second form; the CA is", async () => {
    bag.intent.latest = ["Test Employee"];
    bag.extra = { 0: { formType: "dpoa" } };
    const [turn] = await converse([
      "create a CA for Test Employee at Kearney for not following the promo setup on 10-20-26. Prior coaching: September Promo coaching 9/29/26, product coaching form 9/30/26",
    ]);
    expect(turn!.content).not.toMatch(/which form should I start with/i);
    expect(turn!.template).toBe("Corrective Action Form");
    expect(turn!.employeeName).toBe("Test Employee");
  });

  // conv_muxahcdkiiur2tu: the same list after "this will be a written warning". Failed before this fix.
  it("conv_muxahcdkiiur2tu: completed coachings listed with dates are not a second form", async () => {
    bag.intent.latest = ["Avery Lund", "avery lund"];
    const turns = await converse([
      "create a corrective action form for avery lund",
      "Avery Lund, she is a TC at  Mo Kansas City Wornall, created today but for the month of September, Avery was below company average in all categories for September, this will be a written warning, she completed September Promo coaching 9/29/26, Hemp nation product coaching form 9/30/26, Shrink coaching 9/31/26, and what would you recommend coaching 9/30/26, there is no payroll deduction applicable",
    ]);
    for (const turn of turns) {
      expect(turn.content, turn.question).not.toMatch(/which form should I start with/i);
      expect(turn.template, turn.question).toBe("Corrective Action Form");
    }
  });

  // QA S5, conv_mvnsypd62c90b3f: a CA on every turn. Fixed by FORM_CHOICE_STATED_ENABLED (merged, off).
  it('conv_mvnsypd62c90b3f: "Create a coaching form for a performance concern" stays the Coaching Form', async () => {
    bag.intent.latest = ["test testy"];
    bag.extra = { 0: { formType: "coaching" }, 1: { formType: "dpoa" }, 2: { formType: "dpoa" }, 3: { formType: "dpoa" } };
    const turns = await converse([
      "Create a coaching form for a performance concern.",
      "name is test testy, todays date, shawnee location, test was late opening salon",
      "create coaching form. test testy is ass't salon director. test did not call anyone about opening late",
      "name is test testy and use todays date to create coaching form",
    ]);
    for (const turn of turns) expect(turn.template, turn.question).toBe("Coaching Form");
  });

  // QA S6, conv_mvnsxmep2vvazk2: a Policy Review offered in the middle of the exit form. Fixed by FORM_CHOICE_STATED_ENABLED.
  it("conv_mvnsxmep2vvazk2: the exit form stays the exit form", async () => {
    bag.intent.latest = ["test employee", "Test Employee"];
    bag.extra = { 3: { formType: "policy-review" } };
    const turns = await converse([
      "what does policy say about pets in salon",
      "assist with creating an exit form",
      "test employee, tanning consultant at shawnee",
      "last day worked was 9-20-26. management called her with no response on 9-27-26",
      "its a no call no show",
      "create exit form",
    ]);
    for (const turn of turns.slice(1)) expect(turn.template, turn.question).toBe("Resignation/Exit Form");
  });

  // QA BH4, conv_mvntn2si2hyyz5g: a Corrective Action card for a prep conversation. Failed with the flag on before this fix.
  it("conv_mvntn2si2hyyz5g: preparing for a conversation opens no form", async () => {
    bag.intent.latest = ["Test Employee"];
    bag.extra = { 1: { formType: "dpoa" } };
    const turns = await converse([
      "Help me prepare for a conversation with a team member.",
      "My team member Test Employee is struggling to complete tasks timely and it has been reported that she complains every shift to other team members.",
    ]);
    for (const turn of turns) expect(turn.template, turn.question).toBeNull();
  });

  // QA G4, conv_mvnt06pp2mmgt4k: "Who is this Corrective Action Form for?" after a coaching request that named her.
  it("conv_mvnt06pp2mmgt4k: the coaching form the manager asked to prepare, for the employee they named", async () => {
    bag.intent.latest = ["Test Employee"];
    bag.extra = { 1: { formType: "dpoa", title: "Tanning Consultant" } };
    const turns = await converse([
      "Help me prepare a coaching form for not completing daily cleaning duties and signing off on daily cleaning checklists when the tasks are not completed",
      "Okay let's restart. Test Employee, Tanning Consultant, KS Manhattan. Not completing closing duties and signing off that they were complete when they weren't. Not completing proper sanitation procedures on the equipment.",
      "No prior coaching on file so I think a coaching form is the appropriate way to go",
    ]);
    for (const turn of turns.slice(1)) {
      expect(turn.template, turn.question).toBe("Coaching Form");
      expect(turn.employeeName, turn.question).toBe("Test Employee");
      expect(turn.content, turn.question).not.toMatch(/who is this \*\*/i);
    }
  });

  // QA S12 (Ask Bubbles conv_mvnsowzl20ljr9m). Right in this app already.
  it("follow-up coaching is the Follow-Up Coaching Form", async () => {
    bag.intent.latest = ["Test Employee"];
    const [turn] = await converse([
      "create a follow-up coaching form for Test Employee at Kearney. Follow-up observation: she now greets every guest. Progress level: improving. Specific evidence: greeted 20 of 20 guests on 10-22-26",
    ]);
    expect(turn!.template).toBe("Follow-Up Coaching Form");
  });

  // Ask Bubbles B14 conv_mvntxr592mc1e2l, in this app's words. Right in this app already.
  it("a metric alone opens no Corrective Action card", async () => {
    bag.intent.latest = ["Test Employee"];
    bag.extra = { 0: { formType: "dpoa" } };
    const [turn] = await converse(["Test Employee at Kearney has low sales per hour this month, create a corrective action"]);
    expect(turn!.template).toBeNull();
    expect(turn!.content).toMatch(/won't open formal corrective action off a metric/i);
  });
});

/* ------------------------------------------- P4: right on main already -- */

describe("P4 conversations that are right on main", SLOW, () => {
  // conv_mvh1ho2p2xddypx: "write a CA for <name>" was refused, and "Create a form from this conversation." gave a Coaching Form.
  it("conv_mvh1ho2p2xddypx: write a CA is the Corrective Action Form, and stays it", async () => {
    bag.intent.latest = ["Rowan Pike"];
    const turns = await converse([
      "write a CA for Rowan Pike",
      "create a corrective action form for Rowan Pike",
      "Please create another corrective action from Rowan Pike. This would be a verbal due to not completing her woven courses by the deadline",
      "Payroll is not deducted",
      "I need it to be a corrective action form",
      "Create a form from this conversation.",
    ]);
    for (const turn of turns) expect(turn.template, turn.question).toBe("Corrective Action Form");
  });

  // conv_mv1a3c1629fecum: the card was shown, then "the … Form hasn't been created".
  it("conv_mv1a3c1629fecum: an edit to the exit form brings the card back", async () => {
    bag.intent.latest = ["Quinn Harlow"];
    const turns = await converse([
      "can you make a no call no show exit form for Quinn Harlow please?",
      "can you outline all of Quinn Harlows policy violations from her file?",
      "I need to edit the reason for resignation",
    ]);
    expect(turns[0]!.template).toBe("Resignation/Exit Form");
    expect(turns[2]!.template).toBe("Resignation/Exit Form");
    expect(turns[2]!.content).not.toMatch(/hasn't been created/i);
  });
});
