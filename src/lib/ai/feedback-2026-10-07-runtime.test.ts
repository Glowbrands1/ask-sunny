import { beforeEach, describe, expect, it, vi } from "vitest";

import { appGuideChunks } from "@/test/app-guide-chunks";

/**
 * ============================================================================
 * ASK SUNNY FEEDBACK, 6–8 OCTOBER 2026, THROUGH `answerQuestion`
 * ============================================================================
 *
 * What reaches the model for each reported question: the retrieval it asks
 * for, the documents pinned for it, the rows it is shown and cited, and the
 * rules it is given. The model and the database are stand-ins; everything
 * between the question and the prompt is the real code.
 *
 *   SD      "generate me a coaching worksheet … checking accounts …"
 *   1★ SD    "How can I change the password on this platform"
 *   SD      "Can you make me a training worksheet for closing duties at night?"
 */

const state = vi.hoisted(() => ({
  claudeInput: null as Record<string, unknown> | null,
  answer: "An answer citing [S1].",
  retrieved: [] as unknown[],
  matchQueries: [] as Record<string, unknown>[],
  appKnowledge: null as unknown,
  pinnedLookups: [] as string[],
}));

vi.mock("@/lib/config/server-env", () => ({
  liveReadiness: () => ({ mode: "live", missing: [], problems: [], ready: true }),
  MissingConfigurationError: class MissingConfigurationError extends Error {
    missing: string[] = [];
  },
}));

vi.mock("./form-proposal", () => ({
  proposeFormForTurn: async () => null,
  suggestFormsForTurn: () => null,
}));

vi.mock("@/lib/forms/repository", () => ({ listTemplateSummaries: async () => [] }));

vi.mock("@/lib/knowledge/providers/supabase", () => ({
  SupabaseKnowledgeProvider: class {
    readonly name = "test double";
    async match(query: Record<string, unknown>) {
      state.matchQueries.push(query);
      return state.retrieved;
    }
    async fetchRoleGrounding() {
      return null;
    }
    async fetchOfficialPolicyManual(_scope: string, identity?: { id: string }) {
      state.pinnedLookups.push(identity?.id ?? "official_policy_manual");
      return identity?.id === "ask_sunny_app_knowledge" ? state.appKnowledge : { ok: false, reason: "none" };
    }
  },
}));

vi.mock("@/lib/reporting/read/report-briefing", () => ({ loadReportBriefing: async () => null }));

vi.mock("@/lib/reporting/read/employee-facts", () => ({
  loadEmployeeFacts: async () => ({ available: false, block: null, reason: "no dataset" }),
  NO_EMPLOYEE_DATASET_REASON: "no dataset",
  EMPLOYEE_DATA_HEADING: "CURRENT EMPLOYEE PERFORMANCE DATA",
}));

vi.mock("./call-claude", () => ({
  callClaude: async (input: Record<string, unknown>) => {
    state.claudeInput = input;
    return state.answer;
  },
}));

/* ------------------------------------------------------------- fixtures -- */

const CHECKING_ACCOUNTS =
  "generate me a coaching worksheet for team memebers about getting checking accounts put onto client profiles";
const PASSWORD_FIRST = "How can I change my password";
const PASSWORD_QUESTION = "How can I change the password on this platform";
const TRAINING_SHEET = "Can you make me a training worksheet for closing duties at night?";

function hit(id: string, title: string, locator: string, content: string, similarity: number) {
  return {
    chunk_id: id,
    document_id: `doc-${title}`,
    document_title: title,
    category: "other",
    locator,
    page: null,
    section: null,
    content,
    similarity,
  };
}

/* What hybrid retrieval returns for the checking-account question, as the integration test shows. */
const CHECKING_RETRIEVAL = [
  hit("fw-1", "ASK SUNNY EMPLOYEE PERFORMANCE FRAMEWORK KB TEXT", "Coaching Connection", "Coach the behavior, not the number.", 0.86),
  hit("tcm-1", "3 KEY TC Mastery Services 10.2024", "Page 1 — Services 1", "Activity - Properly explain the benefits of signing up for a membership with a checking account. Answer: Using your checking account limits the need for updating billing & any billing errors.", 0),
];

/* The New Hire Password Process, with stand-in values. */
const NEW_HIRE = hit(
  "sd-40",
  "Salon Director SD Manual 9.21.2026",
  "Page 40 — Integrity Guide",
  "New Hire Password Process\n1. SunLync: create a password, the SunLync default password is *example1\n2. MyGlow: the MyGlow default password is Ex4mple! plus the last four numbers of the new hire's social security number.",
  0.84,
);

const CLOSING = hit(
  "tc-closing",
  "TC Tanning Consultant Manual 8.4.2026",
  "Closing Duties",
  "Closing Duties:\n• Empty trash.\n• Clean bathrooms.\n• Vacuum or sweep the entire salon.",
  0.87,
);

function appKnowledgeLookup() {
  const chunks = appGuideChunks();
  return {
    ok: true as const,
    documentId: "app-guide-doc",
    documentTitle: "ask sunny app knowledge",
    documentCategory: "other",
    matchedBy: "fallback" as const,
    chunks,
  };
}

async function ask(question: string) {
  const { answerQuestion } = await import("./server-ask");
  return answerQuestion(
    {
      question,
      mode: "standard",
      history: [],
      scopeId: "stc-core",
      context: { userName: "Manager", locationName: "NE Lincoln O Street", todayIso: "2026-10-08" },
    } as never,
    {
      role: "salon_director" as never,
      scope: { level: "salon", primaryAreaId: "loc-0311", alsoCoversAreaIds: [] },
    },
  );
}

const grounding = () => String(state.claudeInput?.grounding ?? "");
const system = () => String(state.claudeInput?.system ?? "");
const NO_KNOWLEDGE = "no company documents matched this question";

beforeEach(() => {
  vi.resetModules();
  state.claudeInput = null;
  state.answer = "An answer citing [S1].";
  state.retrieved = [];
  state.matchQueries = [];
  state.appKnowledge = appKnowledgeLookup();
  state.pinnedLookups = [];
});

/* ================================================================ checking accounts == */

describe("The checking-account answer reaches the model", () => {
  it("asks retrieval for keywords as well as meaning", async () => {
    state.retrieved = CHECKING_RETRIEVAL;
    await ask(CHECKING_ACCOUNTS);
    expect(state.matchQueries[0]).toMatchObject({ query: CHECKING_ACCOUNTS, scopeId: "stc-core", hybrid: true });
  });

  it("grounds and cites the TC Mastery activity", async () => {
    state.retrieved = CHECKING_RETRIEVAL;
    state.answer = "Checking accounts limit billing errors [S2].";

    const answer = await ask(CHECKING_ACCOUNTS);

    expect(grounding()).toContain("Using your checking account limits the need for updating billing");
    expect(system()).not.toContain(NO_KNOWLEDGE);
    expect(answer.citations.map((citation) => citation.documentTitle)).toContain("3 KEY TC Mastery Services 10.2024");
  });
});

/* ============================================================= app password == */

describe("The 1★ password feedback: a question about Ask Sunny is answered from its app guide", () => {
  it("pins the signing-in section even when retrieval finds only other systems", async () => {
    state.retrieved = [
      hit("mye-18", "MT- MYE with Pro Idiom Manual", "Page 18 — Enter Old Password", "Change Password. Enter Old Password.", 0.8),
    ];

    await ask(PASSWORD_QUESTION);

    expect(state.pinnedLookups).toContain("ask_sunny_app_knowledge");
    expect(grounding()).toContain("SIGNING IN AND ACCOUNTS");
    expect(grounding()).toContain('select "Forgot your password?" on the sign-in page');
    expect(grounding()).not.toMatch(/account menu \(the user's avatar\)/);
    expect(system()).not.toContain(NO_KNOWLEDGE);
  });

  it("pins it when retrieval finds nothing at all", async () => {
    state.retrieved = [];
    await ask(PASSWORD_QUESTION);
    expect(grounding()).toContain("There is no \"change password\" option inside Ask Sunny");
    expect(system()).not.toContain(NO_KNOWLEDGE);
  });

  it("answers as before when the app guide is not in the knowledge base", async () => {
    state.appKnowledge = { ok: false, reason: "not found" };
    state.retrieved = [];
    await ask(PASSWORD_QUESTION);
    expect(system()).toContain(NO_KNOWLEDGE);
  });

  it("does not look the guide up for a question about another system", async () => {
    state.retrieved = [CLOSING];
    await ask("How do I reset my SunLync password?");
    expect(state.pinnedLookups).not.toContain("ask_sunny_app_knowledge");
  });
});

/* ========================================================= credentials == */

describe("default passwords stay in the manual", () => {
  it("are withheld from the grounding and the source card for the 1★ password question's first turn", async () => {
    state.retrieved = [NEW_HIRE];
    // The app guide is pinned too, so the manual's marker comes after it; cite them all.
    state.answer = "See the New Hire Password Process [S1] [S2] [S3] [S4] [S5].";

    const answer = await ask(PASSWORD_FIRST);

    expect(grounding()).not.toContain("*example1");
    expect(grounding()).not.toContain("Ex4mple!");
    expect(grounding()).toContain("New Hire Password Process");
    const card = answer.citations.find((citation) => citation.documentTitle === "Salon Director SD Manual 9.21.2026");
    expect(card).toBeDefined();
    expect(card!.excerpt).not.toContain("*example1");
    expect(card!.excerpt).toContain("New Hire Password Process");
  });

  it("are given to a manager setting up a new hire", async () => {
    state.retrieved = [NEW_HIRE];
    await ask("How do new hires set up their SunLync and MyGlow passwords?");
    expect(grounding()).toContain("*example1");
  });

  it("and the model is told not to repeat one either way", async () => {
    state.retrieved = [NEW_HIRE];
    await ask(PASSWORD_FIRST);
    expect(system()).toContain("Never repeat a password, PIN or access code from the sources");
    // Equipment codes are not account passwords, so technician answers keep them.
    expect(system()).toMatch(/Equipment codes from a manufacturer's manual .* are not account passwords; give them when the question needs them/);
  });
});

/* ============================================================= training sheet == */

describe("A training worksheet is written, an HR form is not", () => {
  it("reaches the model with the training-material rule beside the form rule", async () => {
    state.retrieved = [CLOSING];

    await ask(TRAINING_SHEET);

    expect(grounding()).toContain("Closing Duties");
    expect(system()).toContain("TRAINING MATERIAL IS NOT A FORM");
    expect(system()).toMatch(/training checklist, worksheet, study guide, quiz, role-play script/);
    expect(system()).toMatch(/tick boxes \("☐"\) and short blanks for the trainee's answers are fine/);
    expect(system()).toMatch(/do not add steps, standards or numbers the sources do not state/);
  });

  it("keeps every HR form protection", async () => {
    state.retrieved = [CLOSING];

    await ask(TRAINING_SHEET);

    const prompt = system();
    expect(prompt).toContain("NEVER WRITE A FACSIMILE OF A COMPANY FORM.");
    for (const record of ["Coaching Form", "corrective action or DPOA write-up", "an EPP", "a policy review", "disciplinary, termination, demotion, transfer or exit document"]) {
      expect(prompt).toContain(record);
    }
    expect(prompt).toMatch(/never tell a manager to paste your text into an official form/);
    expect(prompt).toMatch(/Do not title it as an official company form, add employee signature or disciplinary lines, or present it as company policy/);
    expect(prompt).toContain("NEVER SAY YOU ARE CREATING, HAVE CREATED, FILED OR SAVED A FORM.");
    // Code review, 8 October: a "worksheet" about one named employee is a form.
    expect(prompt).toMatch(/Material about ONE NAMED EMPLOYEE'S performance or conduct.*is a form whatever it is called/);
    expect(prompt).toContain('"a coaching worksheet for Dana" is a Coaching Form');
    expect(prompt).toMatch(/Never state a .* policy, number, deadline, threshold or entitlement that is not in the provided sources/);
  });
});
