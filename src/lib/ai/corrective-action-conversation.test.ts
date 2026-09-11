import { beforeEach, describe, expect, it, vi } from "vitest";

import { TEMPLATE_SEEDS } from "@/lib/forms/library";

/**
 * ============================================================================
 * THE ACCEPTANCE CONVERSATION, TURN BY TURN
 * ============================================================================
 *
 * These are the seven turns the business ran against the reference platform,
 * reproduced against `answerQuestion` with the model call and every provider
 * mocked. They exist because the reference platform answered all seven
 * fluently, confidently, and with two documents that did not exist:
 *
 *   "Role-Play Evaluation ... To practice and assess employee skills in a safe
 *    setting ... Realistic scenarios, strengths and weaknesses noted, follow-up
 *    practice assigned."
 *
 *   "Follow-Up Coaching Note/Form ... Observation of improvement, progress
 *    level, evidence, next steps."
 *
 * Neither was a template anybody could open. The second one turned out to be
 * defined by §9.2 of the approved Performance Management Framework and is now a
 * real template; the first is named in §2.3 with no field list anywhere, so Ask
 * Sunny does not carry it and has to say so.
 *
 * ============================================================================
 * WHAT THESE TESTS CAN AND CANNOT ASSERT
 * ============================================================================
 *
 * Turns Ask Sunny answers DETERMINISTICALLY — which forms exist, where they are,
 * whether a named one is published — are asserted on the answer text, because
 * the server writes it and no model is involved.
 *
 * Turns that go to the grounded path are asserted on WHAT THE MODEL WAS SENT:
 * that the real library reached it, that the rules forbidding an unlisted form
 * travelled with it, and that the framework was pinned. Asserting on generated
 * prose would be testing the model rather than the product, and the point of
 * this architecture is that the model is no longer the thing being trusted.
 *
 * THE LIBRARY FIXTURE IS THE REAL LIBRARY. `TEMPLATE_SEEDS` is mapped into
 * summary rows rather than hand-written, so a template added, renamed or
 * retired shows up here without anybody editing this file — and a test that
 * hard-coded the names would be the very prose list this work removed.
 */

const state = vi.hoisted(() => ({
  claudeInput: null as Record<string, unknown> | null,
  claudeCalls: 0,
  matchCalls: 0,
  templates: [] as unknown[],
  /** What `fetchRoleGrounding` returns, keyed by role id. */
  roleResults: {} as Record<string, unknown>,
  roleCalls: [] as string[],
}));

vi.mock("@/lib/config/server-env", () => ({
  liveReadiness: () => ({ mode: "live", missing: [], problems: [], ready: true }),
  MissingConfigurationError: class MissingConfigurationError extends Error {
    missing: string[] = [];
  },
}));

vi.mock("@/lib/forms/repository", () => ({
  listTemplateSummaries: async () => state.templates,
}));

vi.mock("@/lib/knowledge/providers/supabase", () => ({
  SupabaseKnowledgeProvider: class {
    readonly name = "test double";
    async match() {
      state.matchCalls += 1;
      return [
        {
          chunk_id: "kb-1",
          document_id: "doc-manual",
          document_title: "JBA Policy Manual",
          category: "policies_compliance",
          locator: "Page 12",
          page: 12,
          section: null,
          content: "Disciplinary action text.",
          similarity: 0.8,
        },
      ];
    }
    async fetchRoleGrounding(role: { id: string }) {
      state.roleCalls.push(role.id);
      return state.roleResults[role.id] ?? null;
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
  callClaude: async (input: Record<string, unknown>) => {
    state.claudeCalls += 1;
    state.claudeInput = input;
    return "An answer citing [S1].";
  },
}));

/* ------------------------------------------------------------- fixtures -- */

/** The real library, shaped as `listTemplateSummaries` returns it. */
function realLibrary() {
  return TEMPLATE_SEEDS.map((seed) => ({
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
    currentVersion: {
      id: `v-${seed.key}`,
      status: "published",
      variants: seed.variants,
    },
    draftVersion: null,
    versionCount: 1,
    activeAsset: null,
    assetCount: 0,
  }));
}

/** A healthy Performance Management Framework, as `buildRoleGrounding` shapes one. */
function healthyProgressionFramework() {
  const rows = [
    "ASK SUNNY PERFORMANCE MANAGEMENT FRAMEWORK",
    "SECTION 2 – PERFORMANCE MANAGEMENT LADDER",
    "SECTION 3 – COACHING FRAMEWORK",
    "SECTION 5 – EPP FRAMEWORK",
    "SECTION 6 – DPOA FRAMEWORK",
    "SECTION 8 – FOLLOW-UP DOCUMENTATION FRAMEWORK",
  ].map((locator, index) => ({
    chunk_id: `pmf-${index}`,
    document_id: "doc-progression",
    document_title: "ASK SUNNY PERFORMANCE MANAGEMENT FRAMEWORK KB TEXT",
    category: "leadership_coaching",
    locator,
    page: null,
    section: locator,
    content: `Framework text: ${locator}.`,
    similarity: 0,
  }));

  return {
    ok: true as const,
    grounding: {
      role: { id: "performance_management_framework" },
      documentId: "doc-progression",
      documentTitle: "ASK SUNNY PERFORMANCE MANAGEMENT FRAMEWORK KB TEXT",
      matchedBy: "tag" as const,
      rows,
      presentGroups: [
        "escalation_authority",
        "escalation_ladder",
        "coaching_framework",
        "epp_framework",
        "dpoa_framework",
        "follow_up_documentation",
      ],
    },
  };
}

type Role =
  | "salon_director"
  | "district_manager"
  | "regional_manager"
  | "owner"
  | "employee";

async function ask(
  question: string,
  options: {
    role?: Role;
    history?: { id: string; role: string; content: string }[];
    /**
     * The template of the proposal still open on the previous assistant turn.
     *
     * The browser sends this whenever a card is on screen — it is how "Sarah
     * Test", typed as an answer to "who is this for?", stays part of the form
     * request instead of reading as a new subject. Revalidated server-side
     * against the published library like every other key.
     */
    continueTemplateKey?: string;
  } = {},
) {
  const { answerQuestion } = await import("./server-ask");
  return answerQuestion(
    {
      question,
      mode: "standard",
      history: (options.history ?? []) as never,
      scopeId: "sun-tan-city",
      continueProposalTemplateKey: options.continueTemplateKey,
      context: { userName: "Dana Reyes", locationName: "MO Kansas City Wornall", todayIso: "2026-09-09" },
    } as never,
    {
      role: (options.role ?? "salon_director") as never,
      scope: { level: "salon", primaryAreaId: "loc-0101", alsoCoversAreaIds: [] },
    },
  );
}

/** The FORMS LIBRARY block the model was sent, or null if it was not called. */
function libraryBlock(): string | null {
  const value = state.claudeInput?.formsLibrary;
  return typeof value === "string" ? value : null;
}

function systemPrompt(): string {
  return String(state.claudeInput?.system ?? "");
}

/** Names the reference platform claimed existed and the business does not have. */
const FABRICATED_NAMES = ["Role-Play Evaluation", "Role Play Evaluation", "Policy Review Form"];

beforeEach(() => {
  vi.resetModules();
  state.claudeInput = null;
  state.claudeCalls = 0;
  state.matchCalls = 0;
  state.templates = realLibrary();
  state.roleResults = { performance_management_framework: healthyProgressionFramework() };
  state.roleCalls = [];
});

/* ==================================================================== */
/*  THE SEVEN TURNS                                                     */
/* ==================================================================== */

describe("turn 1 — \"corrective action\"", () => {
  it("is a knowledge question, so it is answered from the framework rather than by proposing a DPOA", async () => {
    const answer = await ask("corrective action");

    // The old behaviour: "corrective action" was a DPOA matcher, so this turn
    // produced a proposal card for a formal warning.
    expect(answer.formProposal).toBeUndefined();

    // The new behaviour: the progression framework is pinned and the model
    // answers from it.
    expect(state.roleCalls).toContain("performance_management_framework");
    expect(state.claudeCalls).toBe(1);
    expect(String(state.claudeInput!.grounding)).toContain("PERFORMANCE MANAGEMENT LADDER");
  });

  it("sends the real forms library with it, so the answer can name forms without inventing them", async () => {
    await ask("corrective action");

    const block = libraryBlock();
    expect(block).not.toBeNull();
    expect(block).toContain("Coaching Form");
    expect(block).toContain("Corrective Action Form");
    expect(block).toContain("Follow-Up Coaching Form");
    for (const name of FABRICATED_NAMES) {
      expect(block, name).not.toContain(name);
    }
  });

  it("tells the model the library is the complete list and a step is not a form", async () => {
    await ask("corrective action");

    const prompt = systemPrompt();
    expect(prompt).toContain("COMPLETE list of form templates");
    expect(prompt).toContain("IT DOES NOT EXIST");
    expect(prompt).toContain("A STEP IN A PROCESS IS NOT A FORM");
    expect(prompt).toContain("Knowledge base documents are NOT forms");
  });

  it("refuses rather than describing a plausible progression when the framework is unavailable", async () => {
    state.roleResults = {
      performance_management_framework: {
        ok: false,
        failure: { code: "role_document_not_found", detail: "x" },
      },
    };

    const answer = await ask("corrective action");

    expect(state.claudeCalls).toBe(0);
    expect(answer.content).toContain("Performance Management Framework");
    expect(answer.content).toContain("corrective-action progression");
    expect(answer.coverage).toBe("insufficient");
    // And it still says what DOES work, so the refusal is not mistaken for a
    // broken product: the Forms library is a different source.
    expect(answer.content).toMatch(/which forms exist/i);
  });
});

describe("turn 2 — \"all of it\"", () => {
  it("continues to the grounded path carrying the library", async () => {
    const answer = await ask("all of it", {
      history: [{ id: "m1", role: "user", content: "corrective action" }],
    });

    expect(answer.formProposal).toBeUndefined();
    expect(state.claudeCalls).toBe(1);
    expect(libraryBlock()).toContain("Coaching Form");
  });
});

describe("turn 3 — \"what documents are you referring to in the knowledge base or forms?\"", () => {
  it("answers from the library rather than from the model", async () => {
    const answer = await ask(
      "what documents are you referring to in the knowledge base or forms?",
    );

    expect(state.claudeCalls).toBe(0);
    expect(state.matchCalls).toBe(0);
    expect(answer.coverage).toBe("not_applicable");
    expect(answer.citations).toEqual([]);
  });

  it("names only real, published templates", async () => {
    const answer = await ask(
      "what documents are you referring to in the knowledge base or forms?",
    );

    expect(answer.content).toContain("Coaching Form");
    expect(answer.content).toContain("Corrective Action Form");
    expect(answer.content).toContain("Policy Review");
    expect(answer.content).toContain("Follow-Up Coaching Form");
    for (const name of FABRICATED_NAMES) {
      expect(answer.content, name).not.toContain(name);
    }
  });

  it("uses the real category names and keeps Forms apart from the Knowledge Base", async () => {
    const answer = await ask("and what forms are you using for this?");

    expect(answer.content).toContain("HR & Performance Forms");
    expect(answer.content).toMatch(/templates[\s\S]*in Forms/i);
    expect(answer.content).toMatch(/guidance[\s\S]*Knowledge Base/i);
  });

  it("says which forms this role cannot create rather than listing them as available", async () => {
    const answer = await ask("what forms do we have?", { role: "salon_director" });

    // A Salon Director holds no `create_epp`, so no EPP is offered.
    expect(answer.content).not.toContain("SDIT EPP");
    expect(answer.content).not.toContain("DMIT EPP");
  });
});

describe("turns 4 and 5 — \"where is this information stored\" / \"is this under operations\"", () => {
  /*
   * NEITHER IS CLAIMED BY THE DETERMINISTIC GATE, deliberately. Neither sentence
   * says "form", "document" or "template", so claiming them would mean guessing
   * which of the previous turn's two registers "this information" meant — and
   * the same keyword would hijack "where is the attendance policy?".
   *
   * They go to the grounded path instead, which is given the real library and
   * the rules about where each register lives. What is asserted is therefore
   * what the model was SENT, not what it wrote.
   */
  it.each([
    "where is this information stored",
    "is this under operations",
  ])("%s reaches the grounded path with the library and the register rules", async (question) => {
    await ask(question);

    expect(state.claudeCalls).toBe(1);
    expect(libraryBlock()).toContain("Coaching Form");
    expect(systemPrompt()).toContain("Forms → Create a Form");
    expect(systemPrompt()).toContain(
      "The knowledge base's categories and the Forms library's categories are different lists",
    );
  });

  it("does not hijack an ordinary policy lookup", async () => {
    // The guard on the gate: "where is" plus no library noun is a policy
    // question, and answering it with the Forms menu would be a regression.
    await ask("where is the attendance policy?");
    expect(state.claudeCalls).toBe(1);
  });
});

describe("turn 6 — \"i need to find those documents\"", () => {
  it("says where they are in Ask Sunny, using the real navigation", async () => {
    const answer = await ask("i need to find those documents");

    expect(state.claudeCalls).toBe(0);
    expect(answer.content).toContain("Create a Form");
    expect(answer.content).toContain("HR & Performance Forms");
  });

  it("does not send a Salon Director to a page only administrators can open", async () => {
    const answer = await ask("i need to find those documents", { role: "salon_director" });
    // `manage_form_templates` is a District Manager permission.
    expect(answer.content).not.toContain("Form Templates");
  });

  it("does tell a District Manager about Form Templates", async () => {
    const answer = await ask("i need to find those documents", { role: "district_manager" });
    expect(answer.content).toContain("Form Templates");
  });
});

/* ==================================================================== */
/*  THE WHOLE CONVERSATION, NOT SEVEN SENTENCES                         */
/* ==================================================================== */

/**
 * ============================================================================
 * "THOSE DOCUMENTS" MEANS WHATEVER THE LAST TURN NAMED
 * ============================================================================
 *
 * The turn-6 block above asks the sentence cold, and Forms is the right answer
 * to it in the acceptance conversation - by then the manager has been handed a
 * list of templates. But the sentence carries no register of its own, and asked
 * after a conversation about the two FRAMEWORKS it means something else
 * entirely. A sentence-at-a-time reader cannot tell the difference; only the
 * conversation can.
 *
 * SO THESE PLAY THE TURNS THROUGH IN ORDER, feeding each real answer forward as
 * history. Nothing is hand-written as an antecedent: the history is what Ask
 * Sunny actually said, which is the only version of it that can go stale in the
 * same direction as the product.
 */

/** Plays turns in order, feeding each real answer forward as history. */
async function conversation(
  questions: string[],
  options: { role?: Role } = {},
): Promise<{ content: string; claudeCalls: number }[]> {
  const history: { id: string; role: string; content: string }[] = [];
  const answers: { content: string; claudeCalls: number }[] = [];

  for (const question of questions) {
    state.claudeCalls = 0;
    state.claudeInput = null;
    const answer = await ask(question, { role: options.role, history: [...history] });
    answers.push({ content: answer.content, claudeCalls: state.claudeCalls });
    history.push({ id: `u-${history.length}`, role: "user", content: question });
    history.push({ id: `a-${history.length}`, role: "assistant", content: answer.content });
  }

  return answers;
}

describe("the acceptance conversation, played in order", () => {
  it("still answers turn 6 from Forms, because turn 3 listed templates", async () => {
    const answers = await conversation([
      "corrective action",
      "all of it",
      "what documents are you referring to in the knowledge base or forms?",
      "where is this information stored",
      "is this under operations",
      "i need to find those documents",
    ]);

    const turnSix = answers[5];
    // Deterministic: written by the server from the library, no model call.
    expect(turnSix.claudeCalls).toBe(0);
    expect(turnSix.content).toContain("Create a Form");
    expect(turnSix.content).toContain("HR & Performance Forms");
  });

  /*
   * AND THE MIDDLE TURNS NOW RESOLVE TOO. "Is this under Operations?" carries
   * no library noun, so the one-sentence reader stands down - but turn 3 named
   * the templates, so the question has a definite answer and gets one instead
   * of a retrieved excerpt about the Operations category.
   */
  it("resolves the elliptical middle turns to Forms as well", async () => {
    const answers = await conversation([
      "what forms do we have",
      "where is this information stored",
      "is this under operations",
    ]);

    expect(answers[1].claudeCalls).toBe(0);
    expect(answers[1].content).toContain("Create a Form");
    expect(answers[2].claudeCalls).toBe(0);
    expect(answers[2].content).toContain("Create a Form");
  });
});

describe("the same sentence after a conversation about the frameworks", () => {
  /**
   * The history names the two frameworks and no template - which is what the
   * knowledge path produces when a manager asks how the progression works.
   */
  function frameworkHistory() {
    return [
      { id: "u-1", role: "user", content: "corrective action" },
      {
        id: "a-1",
        role: "assistant",
        content:
          "The Employee Performance Framework explains how to read the metrics, and the Performance Management Framework sets out the corrective-action progression. [S1]",
      },
    ];
  }

  it("sends \"i need to find those documents\" to the knowledge base, not to Forms", async () => {
    const answer = await ask("i need to find those documents", {
      history: frameworkHistory(),
    });

    // THE REGRESSION. Before the anchor walk this returned the Forms menu.
    expect(state.claudeCalls).toBe(1);
    expect(answer.content).not.toContain("HR & Performance Forms");
    expect(answer.citations.length).toBeGreaterThan(0);
  });

  it("still carries the library and the register rules when it does", async () => {
    /*
     * Standing the forms answer down is not the same as hiding the library: the
     * grounded answer still holds the real inventory, so it can say where the
     * templates are if that turns out to be what the manager wanted.
     */
    await ask("i need to find those documents", { history: frameworkHistory() });

    expect(libraryBlock()).toContain("Coaching Form");
    expect(systemPrompt()).toContain(
      "The knowledge base's categories and the Forms library's categories are different lists",
    );
  });

  it.each([
    "where is this information stored",
    "is this under operations",
    "where are they",
  ])("keeps %s on the knowledge path too", async (question) => {
    const answer = await ask(question, { history: frameworkHistory() });

    expect(state.claudeCalls).toBe(1);
    expect(answer.content).not.toContain("HR & Performance Forms");
  });

  it("does not override the manager's own word: \"those forms\" is still Forms", async () => {
    /*
     * The one direction the walk must NOT go. The manager said "forms", and an
     * inference about the previous turn does not get to overrule them.
     */
    const answer = await ask("where do i find those forms?", {
      history: frameworkHistory(),
    });

    expect(state.claudeCalls).toBe(0);
    expect(answer.content).toContain("Create a Form");
  });
});

describe("when the antecedent named both registers", () => {
  it("asks one short question instead of guessing", async () => {
    const answer = await ask("i need to find those documents", {
      history: [
        {
          id: "a-1",
          role: "assistant",
          content:
            "The Performance Management Framework sets the progression, and the Coaching Form records the first step. [S1]",
        },
      ],
    });

    expect(state.claudeCalls).toBe(0);
    expect(answer.content).toMatch(/which do you mean/i);
    // It names what it saw, so the manager can correct the reading.
    expect(answer.content).toContain("performance management framework");
    expect(answer.content).toContain("coaching form");
  });

  it("asks rather than half-answering", async () => {
    const answer = await ask("i need to find those documents", {
      history: [
        {
          id: "a-1",
          role: "assistant",
          content:
            "The Performance Management Framework sets the progression, and the Coaching Form records the first step. [S1]",
        },
      ],
    });

    // Not the forms menu wearing a question mark: no category list.
    expect(answer.content).not.toContain("They are grouped as");
    expect(answer.citations).toEqual([]);
  });
});

/* ==================================================================== */
/*  DIRECT REQUESTS                                                     */
/* ==================================================================== */

/*
 * ============================================================================
 * "CREATE A CORRECTIVE ACTION FOR SARAH." — THE FORM, NOT A LECTURE
 * ============================================================================
 *
 * THIS BLOCK ASSERTS THE OPPOSITE OF WHAT IT USED TO, and the reversal is the
 * point of the rename rather than a relaxation of the rule underneath it.
 *
 * While the seventh rung was called the Corrective Action Form, nothing a
 * manager could type contained "corrective action" AND named a document — so
 * the phrase named the whole progression, and answering it with a formal
 * warning chosen by keyword was the defect. The ladder was the honest answer.
 *
 * The business has renamed that document the Corrective Action Form. A manager
 * who asks to create a corrective action has now named it, and QA's finding
 * was blunt: they were handed a paragraph about the progression and asked to
 * choose a form, one turn after choosing one. So the request resolves to the
 * form and the answer is its intake.
 *
 * WHAT DID NOT CHANGE IS THE RULE THE OLD BEHAVIOUR PROTECTED — see the
 * metric-only block below, which is where it now lives, and where it belongs:
 * on the GROUNDS for formal accountability rather than on the wording of the
 * request.
 */
describe("\"Create a corrective action for Sarah.\"", () => {
  it("resolves to the Corrective Action Form instead of asking which form again", async () => {
    const answer = await ask("Create a corrective action for Sarah.");

    expect(answer.formProposal).toBeDefined();
    expect(answer.formProposal!.templateKey).toBe("dpoa");
    expect(answer.formProposal!.templateName).toBe("Corrective Action Form");
    expect(answer.formProposal!.employeeName).toBe("Sarah");
    // Deterministic: the template, the person and the salon are code decisions.
    expect(state.claudeCalls).toBe(0);
    expect(answer.content).not.toMatch(/covers the whole progression/i);
    expect(answer.content).not.toMatch(/which one do you need/i);
  });

  it("drafts instead of interviewing, and names what is left without asking for it", async () => {
    const answer = await ask("Create a corrective action for Sarah.");

    // Nothing is asked for. The form is offered.
    expect(answer.content).not.toMatch(/please give me/i);
    expect(answer.content).not.toMatch(/^1\. /m);
    expect(answer.content).toMatch(/I'll draft a \*\*Corrective Action Form\*\* for \*\*Sarah\*\*/);
    expect(answer.content).toMatch(/create the draft here/i);

    /*
     * WHAT IS UNRESOLVED IS NAMED, NOT REQUESTED — the manager sets it on the
     * form, which has tick boxes for it and a chat does not.
     */
    expect(answer.content).toMatch(/You'll set .*warning level.* on the form/i);
    expect(answer.content).toMatch(/won't guess/i);
  });

  /*
   * THE POLICY IS THE POINT, AND THE FAST PATH DOES NOT SKIP IT. The manager
   * says what they saw; the corpus decides whether a rule covers it. The
   * promise is made here and kept in the drafting route, which retrieves the
   * approved manual from the manager's own words.
   */
  it("still promises the policy check the whole flow is built around", async () => {
    const answer = await ask("Create a corrective action for Sarah. She wore a mini skirt today.");

    expect(answer.content).toMatch(/check the applicable company policy/i);
    expect(answer.formProposal!.templateKey).toBe("dpoa");
  });

  it("never says the form's old name back to the manager", async () => {
    const answer = await ask("Create a DPOA for Sarah.");

    expect(answer.formProposal!.templateName).toBe("Corrective Action Form");
    expect(answer.content).not.toMatch(/disciplinary/i);
    expect(answer.content).not.toContain("DPOA");
  });
});

/*
 * ============================================================================
 * §7: A LOW NUMBER IS NOT GROUNDS FOR FORMAL ACCOUNTABILITY
 * ============================================================================
 *
 * The rule the block above used to carry, asserted where it actually belongs.
 * The approved progression enters underperformance at coaching and reaches
 * formal accountability through what happens after that — so a metric offered
 * as the grounds for a corrective action gets the ladder, whether the manager
 * named the document or not.
 */
describe("a metric on its own is answered with the progression", () => {
  it("does not open a Corrective Action Form off a low Club Close", async () => {
    const answer = await ask("Their Club Close is low. Create a corrective action.");

    expect(answer.formProposal).toBeUndefined();
    expect(answer.content).toMatch(/low number on its own/i);
    expect(answer.content).toMatch(/enters the ladder at coaching/i);
  });

  it("holds even when the manager names the form", async () => {
    const answer = await ask(
      "Sarah's conversion is the lowest in the district. Create a corrective action form.",
    );

    expect(answer.formProposal).toBeUndefined();
    expect(answer.content).toMatch(/low number on its own/i);
  });

  it("stands down the moment behaviour is described", async () => {
    const answer = await ask(
      "Sarah's Club Close is low and she was late again on Tuesday. Create a corrective action.",
    );

    expect(answer.formProposal).toBeDefined();
    expect(answer.formProposal!.templateKey).toBe("dpoa");
  });

  it("maps each rung to the real form that records it, and says which rungs have none", async () => {
    const answer = await ask("Their Club Close is low. Create a corrective action.");

    expect(answer.content).toContain("Coaching Form");
    expect(answer.content).toContain("Follow-Up Coaching Form");
    expect(answer.content).toContain("Corrective Action Form");

    // The three rungs that are steps rather than documents.
    expect(answer.content).toMatch(/Role Play — .*no separate role-play template/i);
    expect(answer.content).toMatch(/Follow-Up Review — .*re-evaluation section of the EPP/i);
    expect(answer.content).toMatch(/Further Leadership Review — .*Not a form/i);

    // And never the form the reference platform invented for the role-play rung.
    for (const name of FABRICATED_NAMES.slice(0, 2)) {
      expect(answer.content, name).not.toContain(name);
    }
  });

  /*
   * ==========================================================================
   * THE LADDER IS A COPY, AND A COPY IS NOT AUTHORITY
   * ==========================================================================
   *
   * `CORRECTIVE_ACTION_LADDER` maps §2's rungs onto template keys. It was
   * written from the approved framework and checked against it — and it is
   * still a copy in a source file, which cannot know that §2 was re-issued
   * last week.
   *
   * WHICH FORMS EXIST is a different kind of fact, read from `form_templates`
   * for this user, and it stays. So when the framework does not answer, the
   * manager gets the forms and an honest sentence about the sequence, rather
   * than eight numbered steps under a heading that says "approved".
   */
  it("does not present the hard-coded ladder as approved when the framework is down", async () => {
    state.roleResults = {};
    const answer = await ask("Their Club Close is low. Create a corrective action.");

    expect(answer.content).not.toMatch(/approved sequence/i);
    // The rung names are the framework's content, so none of them is asserted.
    expect(answer.content).not.toContain("Further Leadership Review");
    expect(answer.content).not.toContain("Follow-Up Review");
    expect(answer.content).not.toMatch(/^1\. /m);
  });

  it("says why, and still answers the question it can answer", async () => {
    state.roleResults = {};
    const answer = await ask("Their Club Close is low. Create a corrective action.");

    expect(answer.content).toMatch(/Performance Management Framework isn't available/i);
    // The library IS authoritative, so the forms half of the answer survives.
    expect(answer.content).toContain("Coaching Form");
    expect(answer.content).toContain("Create a Form");
    // And it still refuses to choose a document on the manager's behalf.
    expect(answer.formProposal).toBeUndefined();
  });

  it("shows the sequence again as soon as the framework answers", async () => {
    // The healthy case, asserted beside the unhealthy one so the difference is
    // the framework's availability and nothing else.
    const answer = await ask("Their Club Close is low. Create a corrective action.");

    expect(answer.content).toMatch(/approved sequence/i);
    expect(answer.content).toContain("Further Leadership Review");
  });

  it("names the EPPs from the library rather than from a list in the code", async () => {
    const answer = await ask("Their Club Close is low. Create a corrective action.", {
      role: "district_manager",
    });
    // A District Manager holds `create_epp`, so the EPP rung resolves to the
    // real performance plans.
    expect(answer.content).toContain("SDIT EPP");
  });
});

describe("the explicit create requests still resolve to one template each", () => {
  it.each([
    ["Create a written warning for Sarah.", "dpoa"],
    ["Create a DPOA for Sarah.", "dpoa"],
    ["Create a policy review for Sarah.", "policy-review"],
    ["Create a coaching form for Sarah.", "coaching"],
    ["Create a follow-up coaching form for Sarah.", "follow-up-coaching"],
  ])("%s -> %s", async (question, key) => {
    const answer = await ask(question);

    expect(answer.formProposal).toBeDefined();
    expect(answer.formProposal!.templateKey).toBe(key);
    expect(answer.formProposal!.employeeName).toBe("Sarah");
    expect(answer.formProposal!.status).toBe("ready");
  });

  it("offers to create all four of them inside the conversation", async () => {
    for (const question of [
      "Create a DPOA for Sarah.",
      "Create a policy review for Sarah.",
      "Create a coaching form for Sarah.",
      "Create a follow-up coaching form for Sarah.",
    ]) {
      const answer = await ask(question);
      expect(answer.formProposal!.supportsInlineDraft, question).toBe(true);
    }
  });
});

describe("\"Start an EPP for Sarah.\"", () => {
  it("asks which one, because the library publishes six performance plans", async () => {
    const answer = await ask("Start an EPP for Sarah.", { role: "district_manager" });

    expect(answer.formProposal).toBeUndefined();
    expect(answer.content).toMatch(/which form do you need/i);

    /*
     * THE PLANS ARE OFFERED AS CHOICES, NOT LISTED IN THE PROSE. Naming six
     * performance plans in a chat bubble is what the form picker replaced; what
     * matters here is unchanged — the family was named, so every plan is
     * offered and none is chosen.
     */
    const offered = [
      answer.formSelection!.primary.templateName,
      ...answer.formSelection!.additional.map((choice) => choice.templateName),
    ];
    expect(offered).toContain("SDIT EPP");
    expect(offered).toContain("TSD EPP");
  });

  it("never offers an EPP inline, because the chat flow cannot choose its variant", async () => {
    /*
     * The structural guard, at the level a manager would meet it. An EPP prints
     * as a named review — `{{role}}` reviewing `{{roleAbbr}}` — and nothing in
     * the chat flow asks which. An instance created here would pin a variant of
     * `null` and print "In what areas is the the employee currently
     * succeeding?" on a performance plan.
     */
    const { buildFormInventory } = await import("@/lib/forms/inventory");
    const inventory = buildFormInventory(state.templates as never, {
      role: "district_manager",
      scope: null,
    });

    for (const entry of inventory.entries) {
      if (entry.requiredPermission !== "create_epp") continue;
      expect(entry.canCreate, entry.name).toBe(true);
      expect(entry.inlineCreation, entry.name).toBe(false);
    }
  });
});

describe("\"Do we have a role-play evaluation?\"", () => {
  it("says no, without substituting another form", async () => {
    const answer = await ask("Do we have a role-play evaluation?");

    expect(state.claudeCalls).toBe(0);
    expect(answer.content).toMatch(/not as a form/i);
    expect(answer.content).toMatch(/won't stand in for it/i);
    for (const name of FABRICATED_NAMES.slice(0, 2)) {
      expect(answer.content, name).not.toContain(name);
    }
  });

  it("follows the no with what does exist", async () => {
    const answer = await ask("Do we have a role-play form?");
    expect(answer.content).toContain("Coaching Form");
  });

  it("does not read the question as a request to create one", async () => {
    const answer = await ask("Do we have a coaching form?");
    // The failure this gate removes: a question about the library used to
    // produce a proposal card for an employee nobody had named.
    expect(answer.formProposal).toBeUndefined();
    expect(answer.content).toMatch(/^Yes\./);
    expect(answer.content).toContain("Coaching Form");
  });
});

describe("\"Do we have a follow-up coaching form?\"", () => {
  it("says yes now that the framework-defined template is published", async () => {
    const answer = await ask("Do we have a follow-up coaching form?");

    expect(answer.content).toMatch(/^Yes\./);
    expect(answer.content).toContain("Follow-Up Coaching Form");
    expect(answer.content).toContain("HR & Performance Forms");
  });

  it("says no if this deployment has not published it", async () => {
    /*
     * The property that makes the inventory worth having: the answer follows the
     * DATABASE, not this code. An unpublished template is not a form anybody can
     * be told about.
     */
    state.templates = realLibrary().map((row) =>
      row.key === "follow-up-coaching"
        ? { ...row, currentVersion: { ...row.currentVersion, status: "draft" } }
        : row,
    );

    const answer = await ask("Do we have a follow-up coaching form?");
    expect(answer.content).toMatch(/not as a form/i);
  });
});

/* ==================================================================== */
/*  PERMISSIONS                                                         */
/* ==================================================================== */

describe("the inventory follows the role matrix, not a list written in chat", () => {
  const CORRECTIVE = ["coaching", "dpoa", "policy-review", "follow-up-coaching"];

  it.each([
    ["salon_director", true, false],
    ["district_manager", true, true],
    ["regional_manager", true, true],
    ["owner", true, true],
    ["employee", false, false],
  ] as const)(
    "%s: corrective forms %s, EPPs %s",
    async (role, corrective, epp) => {
      const { buildFormInventory, creatable } = await import("@/lib/forms/inventory");
      const inventory = buildFormInventory(state.templates as never, {
        role: role as never,
        scope: null,
      });
      const keys = creatable(inventory).map((entry) => entry.templateKey);

      for (const key of CORRECTIVE) {
        expect(keys.includes(key), `${role} / ${key}`).toBe(corrective);
      }
      expect(keys.includes("sdit-epp"), `${role} / sdit-epp`).toBe(epp);
    },
  );

  it("tells an Employee there is nothing they can start, rather than listing forms", async () => {
    const answer = await ask("what forms do we have?", { role: "employee" });
    expect(answer.content).toMatch(/no forms published in Ask Sunny that your role can start/i);
    expect(answer.content).not.toContain("Coaching Form");
  });

  it("refuses a form the role cannot create instead of proposing it", async () => {
    const answer = await ask("Create a DPOA for Sarah.", { role: "employee" });
    expect(answer.formProposal).toBeUndefined();
    expect(answer.content).toMatch(/cannot create/i);
  });
});

/* ==================================================================== */
/*  THE QA INTAKE CONVERSATION, TURN BY TURN                            */
/* ==================================================================== */

/**
 * ============================================================================
 * WHAT THE BUSINESS ACTUALLY ASKED FOR BACK
 * ============================================================================
 *
 * The previous generation of this product did one thing well: asked for a
 * corrective action form, it asked for the seven details and then built the
 * form. What replaced it asked which form the manager wanted — one turn after
 * they had said — and then, on the second turn, asked all seven again.
 *
 * These are those turns. The prompts are QA's own, typed exactly as they typed
 * them, down to the missing spaces after the list numbers.
 */
/**
 * ============================================================================
 * DRAFT FIRST. THE SEVEN QUESTIONS ARE OPT-IN NOW.
 * ============================================================================
 *
 * THIS BLOCK ASSERTS THE OPPOSITE OF WHAT IT USED TO, and that is the point of
 * the change rather than a relaxation of anything.
 *
 * The intake was restored because the previous behaviour answered a manager who
 * had named a form with a paragraph about the ladder. It fixed that, and
 * overshot: a manager who types "Create a corrective action for Sarah, she wore
 * a mini skirt today" has already said who, what and when, and being handed
 * seven numbered questions is slower than the paperwork the feature replaced.
 *
 * Worse, it asked for things the FORM collects better than a chat can. The
 * warning level is a pair of tick boxes. The prior action is a field. The job
 * title is not on the document at all.
 *
 * So the default is the draft, what is unknown is NAMED rather than asked for,
 * and the questionnaire is reachable only by asking to be walked through it.
 */
describe("the fast path — a draft from what the manager already said", () => {
  it("1. drafts from one sentence, with no questionnaire", async () => {
    const answer = await ask(
      "Create a corrective action for Sarah Test. She wore a mini skirt today.",
    );

    expect(answer.formProposal).toBeDefined();
    expect(answer.formProposal!.templateKey).toBe("dpoa");
    expect(answer.formProposal!.templateName).toBe("Corrective Action Form");
    expect(answer.formProposal!.employeeName).toBe("Sarah Test");
    expect(answer.formProposal!.status).toBe("ready");
    expect(answer.formProposal!.supportsInlineDraft).toBe(true);

    // None of the seven is asked.
    for (const asked of [
      /Employee's full name/i,
      /Salon location/i,
      /Date for the form/i,
      /What happened —/i,
      /Whether this is a verbal or written warning/i,
      /job title/i,
    ]) {
      expect(answer.content, String(asked)).not.toMatch(asked);
    }
    expect(answer.content).not.toMatch(/^1\. /m);
    expect(answer.content).toMatch(/create the draft here/i);
  });

  it("2. treats the legacy DPOA request identically, and answers in the new name", async () => {
    const answer = await ask("Sarah Test was 20 minutes late again today. Create a DPOA.");

    expect(answer.formProposal!.templateKey).toBe("dpoa");
    expect(answer.formProposal!.templateName).toBe("Corrective Action Form");
    expect(answer.formProposal!.employeeName).toBe("Sarah Test");
    expect(answer.formProposal!.status).toBe("ready");

    expect(answer.content).not.toMatch(/disciplinary/i);
    expect(answer.content).not.toContain("DPOA");
    expect(answer.content).not.toMatch(/^1\. /m);
    expect(answer.content).toMatch(/create the draft here/i);
  });

  /*
   * "again" says a history exists and does not say what it was. That is a field
   * on the form, not a reason to stop.
   */
  it("2b. does not stop for a history the manager only gestured at", async () => {
    const answer = await ask("Sarah Test was 20 minutes late again today. Make a corrective action.");

    expect(answer.formProposal!.status).toBe("ready");
    expect(answer.content).not.toMatch(/when was the previous/i);
    expect(answer.content).not.toMatch(/and if so, when/i);
  });

  /* -- 4/5/6. an unknown field is named, never asked for ------------------ */

  it.each([
    ["job title", /job title/i],
    ["date of prior action", /date of (?:the )?previous/i],
    ["what happened, once the person is known", /What happened —/i],
  ])("4-6. never asks for %s", async (_label, pattern) => {
    const answer = await ask("Create a corrective action for Sarah Test. She wore a mini skirt today.");

    expect(answer.content).not.toMatch(pattern);
    expect(answer.formProposal!.status).toBe("ready");
  });

  it("5. leaves the warning level for the form, and says so without asking", async () => {
    const answer = await ask("Create a corrective action for Sarah Test. She wore a mini skirt today.");

    // Named as the manager's to set...
    expect(answer.content).toMatch(/You'll set the verbal\/written warning level/);
    // ...and not asked as a question.
    expect(answer.content).not.toMatch(/Whether this is a verbal or written warning/);
    expect(answer.formProposal!.supportsInlineDraft).toBe(true);
  });

  /* -- 3. the one genuinely blocking fact --------------------------------- */

  /*
   * ==========================================================================
   * A BARE FORM NAME IS NOT THE FAST PATH, AND THIS IS THE LINE BETWEEN THEM
   * ==========================================================================
   *
   * This block used to assert ONE question here — "who is this for?" — on the
   * reasoning that everything else can be fixed on the form. That holds when
   * the manager has DESCRIBED something, which is every other case in this
   * file. It does not hold for "corrective action form" typed on its own, or
   * for the picker's card, which is the same request with no words in it: there
   * is nothing to draft from, so the single question only starts a slower
   * version of the intake, one turn at a time.
   *
   * The business asked for the seven back here, in their own wording. They
   * still do not reach a manager who described an incident — the tests above
   * this one are what hold that.
   */
  it("3. asks the seven when the form is named and nothing else is said", async () => {
    const answer = await ask("corrective action form");

    expect(answer.formProposal).toBeDefined();
    expect(answer.formProposal!.status).toBe("needs_employee");
    expect(answer.content).toMatch(/I can help you create a \*\*Corrective Action Form\*\*/);
    expect(answer.content).toMatch(/^1\. Employee's full name$/m);
    expect(answer.content).toMatch(/^7\. The employee's job title/m);
    // And never under the name the business retired.
    expect(answer.content).not.toMatch(/disciplinar/i);
    expect(answer.content).not.toContain("DPOA");
  });

  it("3. asks who it is for, once, when they described an incident but named nobody", async () => {
    const answer = await ask("corrective action form, she wore a mini skirt today");

    expect(answer.formProposal!.status).toBe("needs_employee");
    expect(answer.content).toMatch(/Who is this \*\*Corrective Action Form\*\* for\?/);
    // ONE question. Not seven, and not the generic five either.
    expect(answer.content).not.toMatch(/^1\. /m);
    expect(answer.content).not.toMatch(/Salon location/i);
    expect(answer.content).not.toMatch(/Date for the form/i);
  });

  it("3. names the candidates rather than asking again when two people were named", async () => {
    const answer = await ask("Corrective action form for Sarah Test and Dana Reyes, they were late.");

    expect(answer.formProposal!.status).toBe("needs_employee");
    expect(answer.content).toMatch(/Which of them is this/i);
    expect(answer.content).toContain("Sarah Test");
    expect(answer.content).toContain("Dana Reyes");
  });

  it("3. drafts as soon as the name arrives, without restarting", async () => {
    const answer = await ask("Sarah Test", {
      // What the browser sends while the card from turn 1 is still on screen.
      continueTemplateKey: "dpoa",
      history: [
        { id: "m1", role: "user", content: "corrective action form, she wore a mini skirt today" },
        { id: "m2", role: "assistant", content: "Who is this Corrective Action Form for?" },
      ],
    });

    expect(answer.formProposal!.employeeName).toBe("Sarah Test");
    expect(answer.formProposal!.status).toBe("ready");
    expect(answer.content).toMatch(/create the draft here/i);
  });

  /* -- the questionnaire, still there for whoever wants it ---------------- */

  it("gives the seven questions to a manager who asks to be walked through it", async () => {
    const answer = await ask("Corrective action form — walk me through it.");

    expect(answer.content).toMatch(/I can help you create a \*\*Corrective Action Form\*\*/);
    for (const line of [
      /1\. Employee's full name/,
      /2\. Salon location/,
      /3\. Date for the form/,
      /4\. What happened/,
      /5\. Whether this is a verbal or written warning/,
      /6\. Whether the employee has previously received corrective action/,
      /7\. The employee's job title/,
    ]) {
      expect(answer.content, String(line)).toMatch(line);
    }
    expect(answer.content).toMatch(/check the applicable company policy/i);
  });

  it.each([
    "corrective action form — what do you need from me?",
    "create a corrective action, guide me through it",
    "corrective action form, step by step please",
  ])("recognises the ask to be led — %s", async (question) => {
    const answer = await ask(question);
    expect(answer.content, question).toMatch(/1\. Employee's full name/);
  });

  /*
   * AND THE NUMBERED REPLY STILL WORKS, because managers who learned the old
   * flow will keep typing it and old conversations are full of it.
   */
  it("still reads a numbered reply and drafts from it", async () => {
    const answer = await ask(
      [
        "1. Sarah Test",
        "2. Kearny",
        "3.today",
        "4.she was wearing mini skirt today",
        "5. verbal warning",
        "6.this is the first time",
      ].join("\n"),
      {
        history: [
          { id: "m1", role: "user", content: "corrective action form" },
          { id: "m2", role: "assistant", content: "…the seven details…" },
        ],
      },
    );

    expect(answer.formProposal!.templateKey).toBe("dpoa");
    expect(answer.formProposal!.employeeName).toBe("Sarah Test");
    expect(answer.formProposal!.status).toBe("ready");
    expect(answer.content).toMatch(/create the draft here/i);
    expect(answer.content).not.toMatch(/^1\. /m);
  });
});

/* ==================================================================== */
/*  BACKWARD COMPATIBILITY                                              */
/* ==================================================================== */

/**
 * The rename is a DISPLAY change. Everything the data addresses is unchanged,
 * and these are the three places that would show it if it were not.
 */
describe("nothing stored by the old name breaks", () => {
  it("still addresses the template by its stored key", async () => {
    const answer = await ask("Create a corrective action form for Sarah.");

    // What travels to `POST /api/forms/instances` — revalidated there against
    // the published library, and it has to be the key the row actually has.
    expect(answer.formProposal!.templateKey).toBe("dpoa");
  });

  it("keeps the template's permission, so no role gains or loses the form", async () => {
    const answer = await ask("Create a corrective action form for Sarah.", {
      role: "employee",
    });

    expect(answer.formProposal).toBeUndefined();
    expect(answer.content).toMatch(/cannot create a \*\*Corrective Action Form\*\*/i);
  });

  it("recognises every legacy naming a manager or an old chat might carry", async () => {
    for (const question of [
      "Create a DPOA for Sarah.",
      "Create a disciplinary plan for Sarah.",
      "Create a disciplinary form for Sarah.",
      "Start a disciplinary action for Sarah.",
      "Create a written warning for Sarah.",
    ]) {
      const answer = await ask(question);
      expect(answer.formProposal, question).toBeDefined();
      expect(answer.formProposal!.templateKey, question).toBe("dpoa");
      expect(answer.formProposal!.templateName, question).toBe("Corrective Action Form");
    }
  });
});
