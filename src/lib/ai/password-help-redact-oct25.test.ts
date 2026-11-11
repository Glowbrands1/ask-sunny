import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { isAppPasswordQuestion } from "./app-password-help";
import { isSensitiveSentence, redactSensitiveDefaults } from "./sensitive-defaults";

/**
 * ============================================================================
 * PASSWORD QUESTIONS: THIS APP'S LINK, AND NO DEFAULT PASSWORD FORMAT OR SSN
 * DIGITS (APP_PASSWORD_HELP_ENABLED, SENSITIVE_DEFAULTS_REDACT_ENABLED)
 * ============================================================================
 *
 * QA P0, 25 Oct 2026 (conv_mvohwwbi2z2lavh): "I forgot my Ask Sunny password
 * and I cannot log in, how do I reset it?" was answered with a default
 * password pattern built from SSN digits, quoted from a manager-side reset
 * page, and never mentioned this app's own "Forgot your password?" link.
 *
 * The reset page below is INVENTED: its format is not the real one, and no
 * real pattern appears anywhere in this repository. Through `answerQuestion`.
 */

/** An invented reset page with the same shape: steps, a default format, SSN digits. */
const RESET_PAGE = [
  "Resetting an Employee's Password",
  "Open the employee's profile and choose Reset Password.",
  "The default password is the Example format with the store code.",
  "The default is built from the employee's social security number.",
  "The employee is asked to choose a new password at next sign-in.",
].join("\n");

const state = vi.hoisted(() => ({
  queries: [] as string[],
  system: "",
  grounding: "",
  reply: "",
  rewrites: [] as string[],
}));

vi.mock("./query-rewrite-claude", () => ({
  rewriteToManualTerms: async (input: { question: string }) => {
    state.rewrites.push(input.question);
    return input.question;
  },
}));

vi.mock("@/lib/config/server-env", () => ({
  liveReadiness: () => ({ mode: "live", missing: [], problems: [], ready: true }),
  MissingConfigurationError: class MissingConfigurationError extends Error {
    missing: string[] = [];
  },
}));
vi.mock("./form-proposal", () => ({ proposeFormForTurn: async () => null, suggestFormsForTurn: () => null }));
vi.mock("@/lib/forms/repository", () => ({ listTemplateSummaries: async () => [] }));
vi.mock("@/lib/knowledge/providers/supabase", () => ({
  SupabaseKnowledgeProvider: class {
    readonly name = "test double";
    async match(query: { query: string }) {
      state.queries.push(query.query);
      return [
        {
          chunk_id: "c1",
          document_id: "d1",
          document_title: "Invented Portal Guide",
          category: "other",
          locator: "Page 28 — Resetting an Employee's Password",
          page: 28,
          section: null,
          content: RESET_PAGE,
          similarity: 0.8,
        },
      ];
    }
    async fetchRoleGrounding() {
      return null;
    }
    async fetchOfficialPolicyManual() {
      return { ok: false, reason: "not needed" };
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
  callClaude: async (input: { system: string; grounding: string }) => {
    state.system = input.system;
    state.grounding = input.grounding;
    return state.reply;
  },
}));

const ACTOR = { role: "salon_director" as never, scope: { level: "salon", primaryAreaId: "loc-0314", alsoCoversAreaIds: [] } };

const turn = (id: string, role: "user" | "assistant", content: string) => ({
  id,
  role,
  content,
  createdAt: "2026-10-25T08:59:00Z",
});
async function ask(question: string, history: ReturnType<typeof turn>[]) {
  const { answerQuestion } = await import("./server-ask");
  return answerQuestion(
    {
      question,
      mode: "standard",
      history,
      scopeId: "stc-core",
      context: { userName: "Dana Reyes", locationName: "All areas", todayIso: "2026-10-25" },
    } as never,
    ACTOR as never,
  );
}

beforeAll(async () => {
  await import("./server-ask");
}, 60_000);

beforeEach(() => {
  state.queries = [];
  state.system = "";
  state.grounding = "";
  state.reply = "An answer.";
  state.rewrites = [];
});
afterEach(() => vi.unstubAllEnvs());
// Each test sets the flags it needs; flag-off pins hold whatever the environment has on.
beforeEach(() => {
  vi.stubEnv("SENSITIVE_DEFAULTS_REDACT_ENABLED", "");
  vi.stubEnv("APP_PASSWORD_HELP_ENABLED", "");
});


const SENSITIVE = /default password is|default is built|social security number/i;

/** The live wording, then lowercase and sentence case (Pau's register rule). */
const APP_QUESTIONS = [
  "I forgot my Ask Sunny password and I cannot log in, how do I reset it?",
  "i forgot my ask sunny password how do i reset it",
  "how do i chnge my passwrd",
  "How do i chnge my passwrd",
  "forgot password",
  "Forgot password",
  "cant log in",
  "Can't log in, locked out",
  "how do i change my password",
  "How do I reset my password?",
];

describe("APP_PASSWORD_HELP_ENABLED", () => {
  it.each(APP_QUESTIONS)("flag on: %s -> the Forgot your password? link, no model call", async (question) => {
    vi.stubEnv("APP_PASSWORD_HELP_ENABLED", "true");
    const answer = await ask(question, []);
    expect(answer.content).toContain("click **Forgot your password?** on the log-in screen");
    expect(answer.content).toContain("Ask Sunny");
    expect(answer.content).not.toMatch(/mygl[o0]w|revel|paycor|woven/i);
    expect(state.system).toBe("");
  });

  it('flag on: "just reset it" after "forgot password" gets the same answer, not a second question', async () => {
    vi.stubEnv("APP_PASSWORD_HELP_ENABLED", "true");
    const answer = await ask("just reset it", [
      turn("h1", "user", "forgot password"),
      turn("h2", "assistant", "Which password do you mean?"),
    ]);
    expect(answer.content).toContain("Forgot your password?");
  });

  it("flag off: the question goes to the model as before (the bug)", async () => {
    await ask(APP_QUESTIONS[0]!, []);
    expect(state.system).not.toBe("");
  });

  it.each([
    "how do i reset my paycor password",
    "How do I reset my Paycor password?",
    "how do i reset my revel password",
    "How do I reset my Revel password?",
    "how do i reset my myglow password",
    "How do I reset my myGLOW password",
    "how do i reset an employee's password",
    "whats our password policy",
    "what is the default password for managers",
    "i lost my buddy pass",
  ])("flag on: %s is not this app's sign-in, and is answered as before", async (question) => {
    vi.stubEnv("APP_PASSWORD_HELP_ENABLED", "true");
    expect(isAppPasswordQuestion(question)).toBe(false);
  });
});

describe("SENSITIVE_DEFAULTS_REDACT_ENABLED", () => {
  const QUESTIONS = [
    "i forgot my ask sunny password how do i reset it",
    "how do i reset my mygLOW password",
    "How do I reset my myGLOW password",
    "what is the default password for managers",
    "What is the default password for managers?",
  ];

  it.each(QUESTIONS)("flag on: %s -> neither the model nor the reply sees the format or SSN digits", async (question) => {
    vi.stubEnv("SENSITIVE_DEFAULTS_REDACT_ENABLED", "true");
    // The model repeats what it was given, as production did.
    state.reply = "To reset it, open the employee's profile. The default password is the Example format with the store code. The default is built from the employee's social security number [S1].";
    const answer = await ask(question, []);
    expect(state.grounding).not.toMatch(SENSITIVE);
    expect(state.grounding).toContain("Open the employee's profile and choose Reset Password.");
    expect(answer.content).not.toMatch(SENSITIVE);
    // 26 Oct (QA live): the reworded note, and only when the question asks for
    // a default password; a reset question just loses the sentence.
    if (/default/i.test(question)) {
      expect(answer.content).toContain("use **Forgot your password?** on the log-in screen, or ask your manager to reset it");
    } else {
      expect(answer.content).not.toContain("I can't share anyone's password");
      expect(answer.content).toContain("To reset it, open the employee's profile.");
    }
    for (const citation of answer.citations) expect(citation.excerpt).not.toMatch(SENSITIVE);
  });

  it("flag off: the format reaches the model and the reply (the bug)", async () => {
    state.reply = "The default password is the Example format with the store code [S1].";
    const answer = await ask(QUESTIONS[3]!, []);
    expect(state.grounding).toMatch(SENSITIVE);
    expect(answer.content).toMatch(SENSITIVE);
  });

  it("keeps ordinary password sentences", () => {
    vi.stubEnv("SENSITIVE_DEFAULTS_REDACT_ENABLED", "true");
    for (const sentence of [
      "Your password is case sensitive.",
      "The password is reset from the Forgot your password? link.",
      "Enter the employee's Social Security number on the I-9 form.",
      "Passwords must be at least 12 characters.",
      // The manual's Confidential Information Policy lists these as confidential; it states no format.
      "Confidential information includes Social Security numbers, passwords and pay rates.",
    ]) {
      expect(isSensitiveSentence(sentence), sentence).toBe(false);
      expect(redactSensitiveDefaults(sentence)).toBe(sentence);
    }
  });
});
