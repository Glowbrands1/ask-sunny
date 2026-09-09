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
  options: { role?: Role; history?: { id: string; role: string; content: string }[] } = {},
) {
  const { answerQuestion } = await import("./server-ask");
  return answerQuestion(
    {
      question,
      mode: "standard",
      history: (options.history ?? []) as never,
      scopeId: "sun-tan-city",
      context: { userName: "Dana Reyes", locationName: "Riverbend", todayIso: "2026-09-09" },
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
    expect(block).toContain("Disciplinary Plan of Action");
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
    expect(answer.content).toContain("Disciplinary Plan of Action");
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

describe("\"Create a corrective action for Sarah.\"", () => {
  it("classifies rather than defaulting to a Disciplinary Plan of Action", async () => {
    const answer = await ask("Create a corrective action for Sarah.");

    expect(answer.formProposal).toBeUndefined();
    expect(state.claudeCalls).toBe(0);
    expect(answer.content).toMatch(/covers the whole progression/i);
    expect(answer.content).toMatch(/which one do you need/i);
  });

  it("maps each rung to the real form that records it, and says which rungs have none", async () => {
    const answer = await ask("Create a corrective action for Sarah.");

    expect(answer.content).toContain("Coaching Form");
    expect(answer.content).toContain("Follow-Up Coaching Form");
    expect(answer.content).toContain("Disciplinary Plan of Action");

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
    const answer = await ask("Create a corrective action for Sarah.");

    expect(answer.content).not.toMatch(/approved sequence/i);
    // The rung names are the framework's content, so none of them is asserted.
    expect(answer.content).not.toContain("Further Leadership Review");
    expect(answer.content).not.toContain("Follow-Up Review");
    expect(answer.content).not.toMatch(/^1\. /m);
  });

  it("says why, and still answers the question it can answer", async () => {
    state.roleResults = {};
    const answer = await ask("Create a corrective action for Sarah.");

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
    const answer = await ask("Create a corrective action for Sarah.");

    expect(answer.content).toMatch(/approved sequence/i);
    expect(answer.content).toContain("Further Leadership Review");
  });

  it("names the EPPs from the library rather than from a list in the code", async () => {
    const answer = await ask("Create a corrective action for Sarah.", {
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
    expect(answer.content).toContain("SDIT EPP");
    expect(answer.content).toContain("TSD EPP");
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
