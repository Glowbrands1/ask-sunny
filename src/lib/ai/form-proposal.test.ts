import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AccessScope, ChatMessage } from "@/types";

/**
 * ============================================================================
 * REQUIREMENTS 37–43 — WHAT HAS TO BE TRUE BEFORE A PROPOSAL EXISTS
 * ============================================================================
 *
 * `proposal.ts` reads a conversation. This layer decides whether what it read
 * corresponds to a form THIS PERSON MAY ACTUALLY CREATE, and it is the layer
 * the prototype had nothing at all in place of: `detectTemplate` returned an
 * invented `tpl-coaching` id that no published template answered to, and
 * `publishedTemplateKeyFor` mapped it across afterwards.
 *
 * NOTHING HERE WRITES. Asserted, not assumed — see requirement 42.
 */

const SALON: AccessScope = {
  level: "salon",
  primaryAreaId: "loc-0101",
  alsoCoversAreaIds: [],
};

function template(overrides: Record<string, unknown> = {}) {
  return {
    id: "tpl-coaching-id",
    key: "coaching",
    name: "Coaching Form",
    shortName: "Coaching",
    description: "The everyday documented coaching conversation.",
    layoutFamily: "coaching",
    requiredPermission: "create_coaching_form",
    active: true,
    displayOrder: 1,
    currentVersion: { id: "v1", status: "published" },
    draftVersion: null,
    versionCount: 1,
    activeAsset: null,
    assetCount: 0,
    ...overrides,
  };
}

function dpoa(overrides: Record<string, unknown> = {}) {
  return template({
    id: "tpl-dpoa-id",
    key: "dpoa",
    name: "Corrective Action Form",
    shortName: "DPOA",
    description: "The formal corrective step after coaching.",
    layoutFamily: "corrective",
    requiredPermission: "create_corrective_action",
    displayOrder: 2,
    ...overrides,
  });
}

function epp(overrides: Record<string, unknown> = {}) {
  return template({
    id: "tpl-sdit-epp-id",
    key: "sdit-epp",
    name: "SDIT EPP",
    shortName: "SDIT EPP",
    description: "Employee Performance Plan for a Salon Director in training.",
    layoutFamily: "epp",
    requiredPermission: "create_epp",
    displayOrder: 4,
    ...overrides,
  });
}

/**
 * The library snapshot the turn under test carries.
 *
 * `proposeFormForTurn` no longer reads the library itself — `answerQuestion`
 * reads it ONCE per turn and passes the same rows to the proposal, to the
 * inventory the prompt is given, and to any inventory answer. Two reads could
 * land either side of a publish, and then a proposal card would offer a form
 * the sentence beside it said did not exist.
 *
 * Held in a module-scoped variable so every existing `turn(...)` call keeps
 * working unchanged: `load()` sets it, `turn()` attaches it.
 */
let library: Record<string, unknown>[] = [];

async function load(summaries: Record<string, unknown>[]) {
  vi.resetModules();
  library = summaries;
  const calls: string[] = [];

  /*
   * BOTH READS THROW. This module is now a pure function of what it was given:
   * if it ever reaches for the library or starts writing, these are what say so
   * rather than a silently different answer.
   */
  vi.doMock("@/lib/forms/repository", () => ({
    listTemplateSummaries: async () => {
      calls.push("listTemplateSummaries");
      throw new Error("form-proposal must take the library from its caller, not read it");
    },
    getTemplateByKey: async () => {
      throw new Error("form-proposal must not read or write the library");
    },
  }));

  const proposals = await import("./form-proposal");
  return { proposals, calls };
}

function turn(
  question: string,
  options: {
    role?: string | null;
    scope?: AccessScope | null;
    history?: ChatMessage[];
    continueTemplateKey?: string;
  } = {},
) {
  return {
    history: options.history ?? [],
    question,
    questionMessageId: "msg-current",
    actor: {
      role: (options.role === undefined ? "salon_director" : options.role) as never,
      scope: options.scope === undefined ? SALON : options.scope,
    },
    summaries: library as never,
    ...(options.continueTemplateKey ? { continueTemplateKey: options.continueTemplateKey } : {}),
  };
}

function managerTurn(id: string, content: string): ChatMessage {
  return { id, role: "user", content, createdAt: "2026-09-07T12:00:00Z" };
}

/**
 * Every form name the manager is offered — the visible one and the collapsed
 * ones together.
 *
 * WHAT IS OFFERED IS THE WHOLE SELECTION, not what happens to be on screen. A
 * form behind "See more forms" is still being offered, so a permission filter
 * that let one through would be a real leak whichever side of the disclosure it
 * landed on, and this reads both.
 */
function offered(response: { formSelection?: { primary: { templateName: string }; additional: { templateName: string }[] } }): string[] {
  const selection = response.formSelection;
  if (!selection) return [];
  return [selection.primary.templateName, ...selection.additional.map((entry) => entry.templateName)];
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.doUnmock("@/lib/forms/repository");
  vi.resetModules();
});

/* ============================================================ the happy == */

describe("37. an explicit, published, permitted template becomes a proposal", () => {
  it("names the template from the LIBRARY, not from the sentence", async () => {
    const { proposals } = await load([template(), dpoa()]);
    const response = await proposals.proposeFormForTurn(
      turn("I need a coaching form for Sarah Jones"),
    );

    expect(response).not.toBeNull();
    expect(response!.formProposal).toBeDefined();
    expect(response!.formProposal!.templateKey).toBe("coaching");
    // The published name, which is what will appear on the document — never a
    // label this module made up.
    expect(response!.formProposal!.templateName).toBe("Coaching Form");
    expect(response!.formProposal!.employeeName).toBe("Sarah Jones");
    expect(response!.formProposal!.locationId).toBe("loc-0101");
    expect(response!.formProposal!.status).toBe("ready");
  });
});

/* ==================================================== template validation == */

describe("38. a named template the library does not publish is refused, not substituted", () => {
  it.each([
    ["absent from the library", [dpoa()]],
    ["present but inactive", [template({ active: false }), dpoa()]],
    ["present but never published", [template({ currentVersion: null }), dpoa()]],
    ["present with only a draft version", [template({ currentVersion: { id: "v1", status: "draft" } }), dpoa()]],
  ])("%s", async (_name, summaries) => {
    const { proposals } = await load(summaries);
    const response = await proposals.proposeFormForTurn(
      turn("I need a coaching form for Sarah Jones"),
    );

    expect(response).not.toBeNull();
    // No proposal at all: a card with no validated template behind it is a
    // frame around nothing.
    expect(response!.formProposal).toBeUndefined();
    expect(response!.content).toMatch(/not published/i);
    // And specifically NOT quietly answered with the other form that is.
    expect(response!.content).not.toMatch(/here is what I would put on/i);
  });
});

/* ========================================================== permissions == */

describe("39. the TEMPLATE's own permission decides, and chat cannot widen it", () => {
  it("refuses a DPOA to a role that cannot create corrective action", async () => {
    const { proposals } = await load([template(), dpoa()]);
    // An Assistant Salon Director holds `create_coaching` — which is a
    // different permission from `create_coaching_form` — and no form
    // permission at all.
    const response = await proposals.proposeFormForTurn(
      turn("write a DPOA for Sarah Jones", { role: "assistant_salon_director" }),
    );

    expect(response!.formProposal).toBeUndefined();
    expect(response!.content).toMatch(/your role cannot create/i);
  });

  it("refuses everything to an actor with no role at all", async () => {
    const { proposals } = await load([template(), dpoa()]);
    const response = await proposals.proposeFormForTurn(
      turn("coaching form for Sarah Jones", { role: null }),
    );
    expect(response!.formProposal).toBeUndefined();
  });

  it("allows a Salon Director the forms they already hold", async () => {
    const { proposals } = await load([template(), dpoa()]);
    const response = await proposals.proposeFormForTurn(
      turn("write a DPOA for Sarah Jones", { role: "salon_director" }),
    );
    expect(response!.formProposal!.templateKey).toBe("dpoa");
  });

  it("offers only what the asking role may actually create", async () => {
    const { proposals } = await load([template(), dpoa(), epp()]);
    const response = await proposals.proposeFormForTurn(
      // Ambiguous, so the answer is the choices.
      turn("can you create a form for me", { role: "salon_director" }),
    );

    /*
     * THE CHOICES ARE DATA NOW, not prose. They used to be written into the
     * message as a bullet list; the assertion follows them onto
     * `formSelection`, which is what the picker renders. What is being pinned
     * is unchanged: the permission filter decides what is offered.
     */
    expect(offered(response!)).toContain("Coaching Form");
    expect(offered(response!)).toContain("Corrective Action Form");
    // A Salon Director does not hold `create_epp`, so offering it would be an
    // invitation to a refusal — collapsed behind "See more forms" included.
    expect(offered(response!)).not.toContain("SDIT EPP");
  });
});

/* ============================================================ ambiguity == */

describe("40. an ambiguous request produces a question, never a default", () => {
  it("returns no proposal and does not reach for the Coaching Form", async () => {
    const { proposals } = await load([template(), dpoa()]);
    const response = await proposals.proposeFormForTurn(turn("create a form for Sarah Jones"));

    expect(response!.formProposal).toBeUndefined();
    expect(response!.content).toMatch(/which form do you need/i);
    // The regression in one line: this must not have become a coaching form.
    expect(response!.content).not.toMatch(/here is what I would put on/i);
  });

  it("says so plainly when the role may create nothing", async () => {
    const { proposals } = await load([template(), dpoa()]);
    const response = await proposals.proposeFormForTurn(
      turn("create a form", { role: "employee" }),
    );

    expect(response!.formProposal).toBeUndefined();
    expect(response!.content).toMatch(/no published forms available to you/i);
  });
});

/* ====================================================== not a form turn == */

describe("41. a question that is not a form request falls through untouched", () => {
  it.each([
    "what is the tardiness policy?",
    "how do I coach someone who keeps arriving late?",
  ])("%s", async (question) => {
    const { proposals, calls } = await load([template()]);
    const response = await proposals.proposeFormForTurn(turn(question));

    // null, so `answerQuestion` continues to retrieval and Claude.
    expect(response).toBeNull();
    /*
     * And this module read nothing to decide that. Whether a knowledge question
     * costs a library query at all is now `answerQuestion`'s decision — it runs
     * the two pure detectors first and only fetches on a forms turn — and it is
     * asserted there. What is asserted HERE is that the proposal layer is a
     * pure function of the rows it was handed.
     */
    expect(calls).toEqual([]);
  });
});

/* ======================================================= nothing is written == */

describe("42. a proposal creates nothing", () => {
  it("never touches the instances module", async () => {
    const source = (await import("node:fs")).readFileSync("src/lib/ai/form-proposal.ts", "utf8");

    expect(source).not.toContain("createInstance");
    expect(source).not.toContain("forms/instances");
    expect(source).not.toContain("getSupabaseAdmin");
    // No PDF, no finalize, no follow-up scheduling either.
    expect(source).not.toMatch(/finalize|renderPdf|follow_up/i);
  });

  it("returns no field values, no handoff and no pending bag", async () => {
    const { proposals } = await load([template()]);
    const response = await proposals.proposeFormForTurn(
      turn("coaching form for Sarah Jones about attendance"),
    );

    expect(Object.keys(response!)).not.toContain("formHandoff");
    expect(Object.keys(response!)).not.toContain("pendingFormTemplateId");
    expect(Object.keys(response!)).not.toContain("pendingFormValues");
    expect(response!.citations).toEqual([]);
    expect(response!.recommendedVideoIds).toEqual([]);
  });

  it("never claims a form exists before one does", async () => {
    const { proposals } = await load([template()]);
    const response = await proposals.proposeFormForTurn(
      turn("coaching form for Sarah Jones"),
    );

    // A ready Coaching proposal invites creation; it does not report one.
    expect(response!.content).toMatch(/create the draft here/i);
    expect(response!.content).toMatch(/nothing is saved to anyone's file until you do/i);
    expect(response!.content).not.toMatch(/\bcreated\b(?!.*ready)/i);
    expect(response!.formProposal!.supportsInlineDraft).toBe(true);
  });

  /**
   * ==========================================================================
   * THE DPOA IS CREATABLE INLINE NOW, AND THE ESCAPE COPY GOES WITH IT
   * ==========================================================================
   *
   * This test used to assert the opposite, and the assertion was correct at the
   * time: `INLINE_DRAFT_TEMPLATE_KEYS` held only `coaching`, so a Disciplinary
   * Plan of Action was proposed and then handed off to the standalone builder.
   *
   * What changed is not the rule but the verification behind it — the renderer
   * has a case for every block kind, `POST /api/forms/instances` applies the
   * template's own permission, and the drafting route reads its field list from
   * the pinned version and withholds policy-quoting fields when retrieval finds
   * no approved policy. Those were the three things that had to be true of the
   * DPOA specifically, and they are. See `lib/forms/inline-draft.ts`.
   */
  it("offers inline creation for the corrective forms too, not only Coaching", async () => {
    const { proposals } = await load([template(), dpoa()]);
    const response = await proposals.proposeFormForTurn(turn("write a DPOA for Sarah Jones"));

    expect(response!.formProposal!.templateKey).toBe("dpoa");
    expect(response!.formProposal!.supportsInlineDraft).toBe(true);
    // And therefore NOT the escape copy: sending them to the standalone builder
    // from the one card that can create the form here is the feature arguing
    // against itself.
    expect(response!.content).toMatch(/create the draft here/i);
    expect(response!.content).not.toMatch(/use Create a Form/i);
  });

  it("says nothing was created where nothing can be", async () => {
    /*
     * A TEMPLATE WITH VARIANTS IS REFUSED INLINE WHATEVER THE KEY LIST SAYS.
     *
     * `dpoa` is in the inline set, so this row is the structural guard on its
     * own: `createInlineForm` sends no `variantKey`, so an instance created from
     * chat would pin `null` and interpolate `{{role}}` to "the employee" — which
     * is how the EPPs would print "In what areas is the the employee currently
     * succeeding?" on a performance plan. The variants are read off the
     * PUBLISHED VERSION rather than off the seed, because at runtime the
     * database is the authority and an administrator may have added them.
     *
     * So the escape copy is still true here, and still shown.
     */
    const { proposals } = await load([
      template(),
      dpoa({
        currentVersion: {
          id: "v1",
          status: "published",
          variants: [{ key: "tsd", label: "TSD review", role: "TSD", roleAbbr: "SD" }],
        },
      }),
    ]);
    const response = await proposals.proposeFormForTurn(turn("write a DPOA for Sarah Jones"));

    expect(response!.formProposal!.templateKey).toBe("dpoa");
    expect(response!.formProposal!.supportsInlineDraft).toBe(false);
    expect(response!.content).toMatch(/nothing has been created/i);
    expect(response!.content).toMatch(/use Create a Form/i);
  });

  it("does not send the manager to the standalone builder on the inline path", async () => {
    /*
     * The requirement Marissa's workflow turns on. The escape copy was correct
     * in Phase 2 and is the feature arguing against itself now: the one card
     * that CAN create the form inline must not point away from itself.
     */
    const { proposals } = await load([template()]);
    const response = await proposals.proposeFormForTurn(
      turn("coaching form for Sarah Jones"),
    );

    expect(response!.content).not.toMatch(/Create a Form/);
    expect(response!.content).not.toContain("/forms/create");
  });
});

describe("43. the proposal id is the server's, not the caller's", () => {
  it("differs between two identical requests", async () => {
    const { proposals } = await load([template()]);
    const first = await proposals.proposeFormForTurn(turn("coaching form for Sarah Jones"));
    const second = await proposals.proposeFormForTurn(turn("coaching form for Sarah Jones"));

    expect(first!.formProposal!.proposalId).not.toBe(second!.formProposal!.proposalId);
  });

  it("is not read from the request", async () => {
    const source = (await import("node:fs")).readFileSync("src/lib/ai/form-proposal.ts", "utf8");
    expect(source).toContain("randomUUID()");
    expect(source).not.toMatch(/input\.proposalId|body\.proposalId/);
  });
});


/* ==================================================================== */
/*  REMEDIATION FINDING 3 — CONTINUING AN OPEN PROPOSAL                 */
/* ==================================================================== */

/**
 * ============================================================================
 * "SARAH TEST" IS AN ANSWER, NOT A KNOWLEDGE QUERY
 * ============================================================================
 *
 *   Manager: "Build me a coaching form for that."
 *   Sunny:   "I don't yet know who this form is about..."
 *   Manager: "Sarah Test"
 *
 * That third turn was routed into retrieval, because `detectTemplateIntent`
 * found no form words in a person's name. The manager answered a direct
 * question and got a knowledge-base answer; the proposal silently ended.
 */
describe("F3. the follow-up continues the same proposal", () => {
  const opening = managerTurn("msg-1", "Build me a coaching form for that.");

  it("resolves 'Sarah Test' into the open Coaching proposal", async () => {
    const { proposals } = await load([template(), dpoa()]);
    const response = await proposals.proposeFormForTurn(
      turn("Sarah Test", { history: [opening], continueTemplateKey: "coaching" }),
    );

    expect(response).not.toBeNull();
    expect(response!.formProposal).toBeDefined();
    expect(response!.formProposal!.templateKey).toBe("coaching");
    expect(response!.formProposal!.employeeName).toBe("Sarah Test");
    expect(response!.formProposal!.status).toBe("ready");
  });

  it("falls through to retrieval without the hint", async () => {
    // The guard on the guard: the same turn, no open proposal, is an ordinary
    // question — so the test above is measuring the hint and not the sentence.
    const { proposals } = await load([template()]);
    const response = await proposals.proposeFormForTurn(
      turn("Sarah Test", { history: [opening] }),
    );
    expect(response).toBeNull();
  });

  it("re-derives every fact from the manager's turns, carrying none across", async () => {
    /*
     * The distinction from `pendingFormValues`, made concrete: the hint holds a
     * template key, so a NEW name in the follow-up simply wins. Nothing is
     * merged out of a bag of half-filled values on an earlier turn.
     */
    const { proposals } = await load([template()]);
    const response = await proposals.proposeFormForTurn(
      turn("Actually it's for Marcus Webb", {
        history: [opening, managerTurn("msg-2", "Sarah Test")],
        continueTemplateKey: "coaching",
      }),
    );

    expect(response!.formProposal!.employeeName).toBe("Marcus Webb");
  });
});

describe("F3. a hint never swallows the conversation", () => {
  it.each([
    "what is the tardiness policy?",
    "how do I coach someone who keeps arriving late?",
    "never mind",
    "what should I document afterwards?",
  ])("%s still goes to retrieval", async (question) => {
    /*
     * The narrowing that makes the hint safe: it is honoured only when the turn
     * reads as an ANSWER — it must yield an employee name. Without this gate,
     * every turn after a proposal would be routed into the form flow.
     */
    const { proposals } = await load([template()]);
    const response = await proposals.proposeFormForTurn(
      turn(question, { continueTemplateKey: "coaching" }),
    );
    expect(response).toBeNull();
  });

  it("does not read a capitalised instruction as a name", async () => {
    // `extractEmployeeNames` refuses a capitalised leading word — the same
    // conservatism that stopped "Create a coaching form..." naming an employee
    // called Create.
    const { proposals } = await load([template()]);
    const response = await proposals.proposeFormForTurn(
      turn("Show me the attendance policy instead", { continueTemplateKey: "coaching" }),
    );
    expect(response).toBeNull();
  });
});

describe("F3. a tampered hint gains nothing", () => {
  it("is revalidated against the published library", async () => {
    const { proposals } = await load([template()]);
    const response = await proposals.proposeFormForTurn(
      turn("Sarah Test", { continueTemplateKey: "a-template-that-does-not-exist" }),
    );

    expect(response!.formProposal).toBeUndefined();
    expect(response!.content).toMatch(/not published/i);
  });

  it("is refused when the role could not have asked for that template", async () => {
    /*
     * The escalation a forged hint would attempt: name a DPOA in the hint and
     * receive one without typing "DPOA". The template's own
     * `required_permission` applies to a continued turn exactly as it does to a
     * typed one.
     */
    const { proposals } = await load([template(), dpoa()]);
    const response = await proposals.proposeFormForTurn(
      turn("Sarah Test", {
        role: "assistant_salon_director",
        continueTemplateKey: "dpoa",
      }),
    );

    expect(response!.formProposal).toBeUndefined();
    expect(response!.content).toMatch(/your role cannot create/i);
  });

  it("is refused when the template is not published", async () => {
    const { proposals } = await load([template({ currentVersion: null })]);
    const response = await proposals.proposeFormForTurn(
      turn("Sarah Test", { continueTemplateKey: "coaching" }),
    );
    expect(response!.formProposal).toBeUndefined();
  });

  it("still authorizes the salon from the authenticated scope, not the hint", async () => {
    const { proposals } = await load([template()]);
    const response = await proposals.proposeFormForTurn(
      turn("Sarah Test", {
        continueTemplateKey: "coaching",
        scope: { level: "district", primaryAreaId: "dist-01", alsoCoversAreaIds: [] },
      }),
    );

    expect(response!.formProposal!.locationId).toBeNull();
    expect(response!.formProposal!.supportsInlineDraft).toBe(false);
  });
});


/* ==================================================================== */
/*  PHASE 4 ROOT CAUSE — THE ONLY REAL ACCOUNT COULD NEVER CREATE ONE   */
/* ==================================================================== */

/**
 * ============================================================================
 * A GLOBAL ADMINISTRATOR IS NOT "MISSING A SALON"
 * ============================================================================
 *
 * WHAT QA SAW. Asked for a coaching form, Ask Sunny wrote a pseudo-form in
 * prose — "here's a draft body you can paste into whichever official form" —
 * and told the manager the knowledge base contains no coaching template.
 *
 * WHY. The live project's administrator account is `scope_level: global`, and
 * `proposeLocation` answered `needs_selection` with an EMPTY list for a global
 * actor. `needs_selection` is not `ready`, `ready` gates "Create draft", so the
 * card had no action and fell back to the "use Create a Form instead" copy. The
 * manager's next turn had no proposal to continue, went to ordinary retrieval,
 * and Claude — reading the KNOWLEDGE BASE, which has no coaching template in it
 * — wrote a facsimile and paraphrased the escape copy it could see in the
 * history.
 *
 * The Forms LIBRARY decides whether a Coaching Form exists, and it does: the
 * template is active with a published current version. The knowledge base never
 * had a say and should never have been asked.
 */
describe("P4-RC. a global actor can create a coaching form", () => {
  const GLOBAL: AccessScope = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };

  it("is ready, and offers inline creation", async () => {
    const { proposals } = await load([template()]);
    const response = await proposals.proposeFormForTurn(
      turn("Build me a coaching form for Sarah Test for that.", {
        role: "admin",
        scope: GLOBAL,
      }),
    );

    expect(response!.formProposal!.status).toBe("ready");
    expect(response!.formProposal!.supportsInlineDraft).toBe(true);
    expect(response!.formProposal!.employeeName).toBe("Sarah Test");
  });

  it("names no salon, and says so rather than asking", async () => {
    const { proposals } = await load([template()]);
    const response = await proposals.proposeFormForTurn(
      turn("Build me a coaching form for Sarah Test for that.", {
        role: "admin",
        scope: GLOBAL,
      }),
    );

    expect(response!.formProposal!.locationId).toBeNull();
    expect(response!.formProposal!.locationResolution).toBe("not_applicable");
    expect(response!.content).toMatch(/covers every salon, so this form won't name one/i);
    // The question that had nothing to answer it is gone.
    expect(response!.content).not.toMatch(/which salon is this about/i);
  });

  it("does not send them to the standalone builder", async () => {
    // The escape copy the model then paraphrased into a pseudo-form.
    const { proposals } = await load([template()]);
    const response = await proposals.proposeFormForTurn(
      turn("Build me a coaching form for Sarah Test for that.", {
        role: "admin",
        scope: GLOBAL,
      }),
    );

    expect(response!.content).not.toMatch(/Create a Form/);
    expect(response!.content).not.toMatch(/nothing has been created/i);
  });
});

describe("P4-RC. the FORMS LIBRARY decides the template exists, never the knowledge base", () => {
  it("resolves the template without consulting retrieval at all", async () => {
    /*
     * The conceptual error in the wrong answer: "the knowledge base contains no
     * coaching template". Availability is a fact about `form_templates`.
     */
    const { proposals, calls } = await load([template()]);
    const response = await proposals.proposeFormForTurn(
      turn("Build me a coaching form for Sarah Test for that."),
    );

    // Resolved from the injected library rows, with no read of its own.
    expect(calls).toEqual([]);
    expect(response!.formProposal!.templateKey).toBe("coaching");
  });

  it("holds no knowledge-base dependency in the proposal path", () => {
    const source = readFileSync("src/lib/ai/form-proposal.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");

    for (const forbidden of ["knowledge", "Knowledge", "match(", "groundPolicy"]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });

  it("returns the answer BEFORE retrieval runs in answerQuestion", () => {
    // A recognized form request must never reach the RAG path, which is what
    // produced the facsimile.
    const source = readFileSync("src/lib/ai/server-ask.ts", "utf8");
    expect(source.indexOf("proposeFormForTurn")).toBeLessThan(
      source.indexOf("knowledge.match("),
    );
    expect(source).toContain("if (proposal) return proposal;");
  });
});

describe("P4-RC. Claude is forbidden from writing a facsimile form", () => {
  it("says so in the system prompt, for the turns that do reach retrieval", () => {
    /*
     * Belt and braces. The proposal path now catches a recognized form request,
     * but a manager can phrase one in a way no matcher recognizes — and the
     * answer to that must be "ask me to create it", not a pasteable imitation
     * with signature lines.
     */
    const prompts = readFileSync("src/lib/ai/prompts.ts", "utf8");

    expect(prompts).toContain("NEVER WRITE A FACSIMILE OF A COMPANY FORM");
    expect(prompts).toMatch(/never tell a manager to paste your text into an official form/i);
    expect(prompts).toMatch(/ask me to create a coaching form/i);
  });
});


/* ==================================================================== */
/*  RIGHT RAIL — "CREATE A FORM FROM THIS CONVERSATION", SERVER SIDE    */
/* ==================================================================== */

/**
 * The button sends an ordinary turn, so everything below is the SAME code path
 * a typed request takes. What these pin is what that path does with a request
 * that names no template — which is what the button deliberately sends.
 */
describe("RR-E. with no form established, it asks rather than defaulting", () => {
  const BUTTON = "Create a form from this conversation.";

  it("does not silently choose the Coaching Form", async () => {
    const { proposals } = await load([template(), dpoa()]);
    const response = await proposals.proposeFormForTurn(
      turn(BUTTON, {
        history: [managerTurn("m1", "Sarah Test was late today at Kearney.")],
      }),
    );

    expect(response!.formProposal).toBeUndefined();
    expect(response!.content).toMatch(/which form do you need/i);
  });

  it("offers only the templates this manager may actually create", async () => {
    /*
     * From the canonical library, filtered by published/active and by the
     * TEMPLATE's own required_permission — never a hard-coded or demo list.
     */
    const { proposals, calls } = await load([template(), dpoa(), epp()]);
    const response = await proposals.proposeFormForTurn(
      turn(BUTTON, { role: "salon_director" }),
    );

    // Nothing read here: the library arrives on the turn, read once upstream.
    expect(calls).toEqual([]);
    expect(offered(response!)).toContain("Coaching Form");
    expect(offered(response!)).toContain("Corrective Action Form");
    // A Salon Director holds no `create_epp`.
    expect(offered(response!)).not.toContain("SDIT EPP");
  });

  it("offers a template the library publishes beyond Coaching", async () => {
    // Not Coaching-only: whatever the library publishes and the role permits.
    const { proposals } = await load([template(), dpoa(), epp()]);
    const response = await proposals.proposeFormForTurn(
      turn(BUTTON, { role: "district_manager" }),
    );

    expect(offered(response!)).toContain("SDIT EPP");
  });
});

describe("RR-F. with a form already established, it continues that one", () => {
  const BUTTON = "Create a form from this conversation.";

  it("continues the open proposal instead of asking again", async () => {
    /*
     * A manager mid-proposal who presses the button means the form on screen.
     * Asking them to choose again would be the assistant forgetting what it
     * offered one turn earlier.
     *
     * Not the forbidden default: the key comes from a proposal this
     * conversation produced, and is revalidated like any other.
     */
    const { proposals } = await load([template(), dpoa()]);
    const response = await proposals.proposeFormForTurn(
      turn(BUTTON, {
        history: [managerTurn("m1", "Sarah Test was late today.")],
        continueTemplateKey: "coaching",
      }),
    );

    expect(response!.formProposal!.templateKey).toBe("coaching");
    expect(response!.formProposal!.employeeName).toBe("Sarah Test");
  });

  it("still revalidates the continued key against the role", async () => {
    const { proposals } = await load([template(), dpoa()]);
    const response = await proposals.proposeFormForTurn(
      turn(BUTTON, { role: "assistant_salon_director", continueTemplateKey: "dpoa" }),
    );

    expect(response!.formProposal).toBeUndefined();
    expect(response!.content).toMatch(/your role cannot create/i);
  });

  it("keeps the manager's own facts rather than asking for them again", async () => {
    const { proposals } = await load([template()]);
    const response = await proposals.proposeFormForTurn(
      turn(BUTTON, {
        history: [
          managerTurn("m1", "Sarah Test was late today."),
          managerTurn("m2", "I already spoke with her about arriving on time."),
        ],
        continueTemplateKey: "coaching",
      }),
    );

    // The employee came from the conversation, and both manager turns are the
    // provenance the eventual draft is written from.
    expect(response!.formProposal!.employeeName).toBe("Sarah Test");
    expect(response!.formProposal!.sourceMessageIds).toContain("m1");
    expect(response!.formProposal!.sourceMessageIds).toContain("m2");
  });

  it("never takes a fact from Sunny's own prose", async () => {
    const { proposals } = await load([template()]);
    const response = await proposals.proposeFormForTurn(
      turn(BUTTON, {
        history: [
          managerTurn("m1", "Someone was late today."),
          {
            id: "m2",
            role: "assistant",
            content: "Understood — was this about Jane Kowalski?",
            createdAt: "2026-09-07T12:00:00Z",
          },
        ],
        continueTemplateKey: "coaching",
      }),
    );

    expect(response!.formProposal!.employeeName).toBeNull();
    expect(JSON.stringify(response!.formProposal)).not.toMatch(/Jane|Kowalski/i);
  });
});

describe("RR-G. the typed flow is unchanged", () => {
  it("still resolves an explicit coaching request the same way", async () => {
    const { proposals } = await load([template(), dpoa()]);
    const response = await proposals.proposeFormForTurn(
      turn("Create a coaching form for Sarah Test"),
    );

    expect(response!.formProposal!.templateKey).toBe("coaching");
    expect(response!.formProposal!.employeeName).toBe("Sarah Test");
    expect(response!.formProposal!.status).toBe("ready");
    expect(response!.formProposal!.supportsInlineDraft).toBe(true);
  });

  it("an ambiguous TYPED request with nothing open still asks", async () => {
    const { proposals } = await load([template(), dpoa()]);
    const response = await proposals.proposeFormForTurn(turn("create a form for Sarah Test"));

    expect(response!.formProposal).toBeUndefined();
    expect(response!.content).toMatch(/which form do you need/i);
  });
});

/**
 * ============================================================================
 * THE RAIL BUTTON READS THE CONVERSATION IT IS NAMED AFTER
 * ============================================================================
 *
 * Reported from Preview: the manager typed "Coaching Form for Sarah Test, she
 * was late today", pressed "Create a form from this conversation", and was
 * answered with the whole library — a question they had already answered, about
 * a sentence still on their screen.
 *
 * Two separate faults met there, and both are covered here: the rail's own
 * sentence is generic, and the employee reader was counting "Coaching Form" as a
 * second person. Together they made the flow feel broken twice over.
 */
describe("F5. the rail picks up the form the manager already named", () => {
  const RAIL = "Create a form from this conversation.";

  it("proposes the form named in an earlier manager turn", async () => {
    const { proposals } = await load([template(), dpoa()]);
    const response = await proposals.proposeFormForTurn(
      turn(RAIL, {
        history: [managerTurn("m1", "Coaching Form for Sarah Test, she was late today")],
      }),
    );

    expect(response?.formProposal?.templateKey).toBe("coaching");
    // And the employee comes with it — this is the redundancy that was reported.
    expect(response?.formProposal?.employeeName).toBe("Sarah Test");
    expect(response?.formProposal?.status).not.toBe("needs_employee");
    expect(response?.content).not.toMatch(/Which form do you need/);
  });

  it("still asks when the manager has never named one", async () => {
    /*
     * THE RULE THIS WHOLE MODULE EXISTS FOR SURVIVES THE FIX. With nothing
     * said, an ambiguous request is a question — never the Coaching Form.
     */
    const { proposals } = await load([template(), dpoa()]);
    const response = await proposals.proposeFormForTurn(
      turn(RAIL, { history: [managerTurn("m1", "Sarah was late again this morning.")] }),
    );

    expect(response?.formProposal).toBeUndefined();
    expect(response?.content).toMatch(/Which form do you need/);
  });

  it("does not take the form from the ASSISTANT's own words", async () => {
    // The assistant names every template when it asks which one; that listing
    // must never become the answer to its own question.
    const { proposals } = await load([template(), dpoa()]);
    const response = await proposals.proposeFormForTurn(
      turn(RAIL, {
        history: [
          {
            id: "a1",
            role: "assistant",
            content: "Which form do you need? Coaching Form — the everyday documented coaching conversation.",
            createdAt: "2026-09-07T12:00:00Z",
          },
        ],
      }),
    );

    expect(response?.formProposal).toBeUndefined();
    expect(response?.content).toMatch(/Which form do you need/);
  });

  it("prefers the open proposal over the look-back", async () => {
    // A proposal on screen is more recent than anything said before it.
    const { proposals } = await load([template(), dpoa()]);
    const response = await proposals.proposeFormForTurn(
      turn(RAIL, {
        history: [managerTurn("m1", "Coaching Form for Sarah Test")],
        continueTemplateKey: "dpoa",
      }),
    );

    expect(response?.formProposal?.templateKey).toBe("dpoa");
  });

  it("takes the most recent form the manager named", async () => {
    const { proposals } = await load([template(), dpoa()]);
    const response = await proposals.proposeFormForTurn(
      turn(RAIL, {
        history: [
          managerTurn("m1", "Coaching Form for Sarah Test"),
          managerTurn("m2", "Actually I need a Corrective Action Form for Sarah Test"),
        ],
      }),
    );

    expect(response?.formProposal?.templateKey).toBe("dpoa");
  });

  it("still applies the template's own permission to a looked-back key", async () => {
    /*
     * The look-back is a hint about WHICH form, never a grant. A Salon Director
     * has no `create_epp`, and naming one earlier cannot change that.
     */
    const { proposals } = await load([template(), epp()]);
    const response = await proposals.proposeFormForTurn(
      turn(RAIL, { history: [managerTurn("m1", "I need an SDIT EPP for Sarah Test")] }),
    );

    expect(response?.formProposal).toBeUndefined();
  });
});

describe("F5. naming the form does not cost you the employee", () => {
  it("reads Sarah Test out of the sentence reported from Preview", async () => {
    const { proposals } = await load([template()]);
    const response = await proposals.proposeFormForTurn(
      turn("Coaching Form for Sarah Test, she was late today"),
    );

    expect(response?.formProposal?.templateKey).toBe("coaching");
    expect(response?.formProposal?.employeeName).toBe("Sarah Test");
    expect(response?.content).not.toMatch(/don't yet know who this form is about/);
  });
});

/* ====================================================== the form picker == */

/**
 * ============================================================================
 * THE CHOICES, WITHOUT EMPTYING THE LIBRARY INTO THE CONVERSATION
 * ============================================================================
 *
 * An ambiguous request used to answer with every permitted template written
 * into the prose. These tests pin the replacement: the same templates, as
 * structured choices, with the everyday form separated from the rest so the
 * message can hold one card instead of thirteen.
 *
 * The rule underneath is unchanged and asserted here too — offering is not
 * choosing. No proposal, no template key resolved, nothing created.
 */
describe("PICK. an ambiguous request offers structured choices", () => {
  const BUTTON = "Create a form from this conversation.";

  it("suggests the Coaching Form first when the manager may create it", async () => {
    const { proposals } = await load([template(), dpoa(), epp()]);
    const response = await proposals.proposeFormForTurn(
      turn(BUTTON, { role: "district_manager" }),
    );

    expect(response!.formSelection!.primary.templateKey).toBe("coaching");
    expect(response!.formSelection!.primary.templateName).toBe("Coaching Form");
  });

  it("carries the library's own description, not one written in chat", async () => {
    const { proposals } = await load([template(), dpoa()]);
    const response = await proposals.proposeFormForTurn(turn(BUTTON));

    // `template()` builds the row; whatever description it carries is what the
    // card must show. A component with its own copy would drift from the DB.
    expect(response!.formSelection!.primary.description).toBe(
      template().description,
    );
  });

  it("holds the rest back, without repeating the primary form", async () => {
    const { proposals } = await load([template(), dpoa(), epp()]);
    const response = await proposals.proposeFormForTurn(
      turn(BUTTON, { role: "district_manager" }),
    );

    const additional = response!.formSelection!.additional;
    expect(additional.map((entry) => entry.templateKey)).not.toContain("coaching");
    expect(additional.map((entry) => entry.templateName)).toEqual([
      "Corrective Action Form",
      "SDIT EPP",
    ]);
  });

  it("does not name a form in the prose any more", async () => {
    const { proposals } = await load([template(), dpoa(), epp()]);
    const response = await proposals.proposeFormForTurn(
      turn(BUTTON, { role: "district_manager" }),
    );

    // The wall of forms this replaced. The question stays; the list goes.
    expect(response!.content).toMatch(/which form do you need/i);
    for (const name of ["Coaching Form", "Corrective Action Form", "SDIT EPP"]) {
      expect(response!.content, name).not.toContain(name);
    }
  });

  it("offers no form the role cannot create, collapsed or not", async () => {
    const { proposals } = await load([template(), dpoa(), epp()]);
    const response = await proposals.proposeFormForTurn(
      turn(BUTTON, { role: "salon_director" }),
    );

    expect(offered(response!)).toEqual(["Coaching Form", "Corrective Action Form"]);
  });

  it("leads with a form they CAN create when Coaching is not theirs", async () => {
    /*
     * A deployment that has not published the Coaching Form, or a role without
     * `create_coaching_form`, must not be shown it as the suggestion — and must
     * not be shown an empty picker either. The first permitted form leads.
     */
    const { proposals } = await load([
      template({ requiredPermission: "create_epp" }),
      dpoa(),
    ]);
    const response = await proposals.proposeFormForTurn(
      turn(BUTTON, { role: "salon_director" }),
    );

    expect(response!.formSelection!.primary.templateKey).toBe("dpoa");
    expect(offered(response!)).not.toContain("Coaching Form");
  });

  it("offers nothing at all when nothing is published for this person", async () => {
    const { proposals } = await load([]);
    const response = await proposals.proposeFormForTurn(turn(BUTTON));

    expect(response!.formSelection).toBeUndefined();
    expect(response!.content).toMatch(/no published forms/i);
  });

  it("still proposes nothing — offering is not choosing", async () => {
    const { proposals } = await load([template(), dpoa()]);
    const response = await proposals.proposeFormForTurn(
      turn(BUTTON, {
        history: [managerTurn("m1", "Sarah Test was late today at Kearney.")],
      }),
    );

    // Everything needed for a coaching proposal is in that history. It is still
    // not made, because the manager has not said which form.
    expect(response!.formProposal).toBeUndefined();
    expect(response!.formSelection).toBeDefined();
  });

  it("gives an explicitly named form its proposal, and no picker", async () => {
    const { proposals } = await load([template(), dpoa()]);
    const response = await proposals.proposeFormForTurn(
      turn("Create a Policy Review from this conversation.", {
        role: "salon_director",
      }),
    );

    // `policy-review` is not in this fixture library, so the answer is the
    // honest "not published here" — the point being that it did NOT ask which
    // form, and did not substitute one.
    expect(response!.formSelection).toBeUndefined();
    expect(response!.content).not.toMatch(/which form do you need/i);
  });

  it("proposes the form a picker card asks for, through the same path", async () => {
    /*
     * THE ROUND TRIP. A card sends `formRequestPhrase(name)` through the
     * composer; this is that sentence arriving at the server. It must produce
     * the proposal a typed request produces — no card-only entry point.
     */
    const { proposals } = await load([template(), dpoa()]);
    const { formRequestPhrase } = await import("@/lib/forms/template-intent");

    const response = await proposals.proposeFormForTurn(
      turn(formRequestPhrase("Corrective Action Form"), {
        role: "salon_director",
        history: [managerTurn("m1", "Sarah Test was late three times.")],
      }),
    );

    expect(response!.formSelection).toBeUndefined();
    expect(response!.formProposal!.templateKey).toBe("dpoa");
  });
});
