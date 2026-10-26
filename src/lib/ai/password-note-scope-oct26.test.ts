import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { REPLY_NOTE } from "./sensitive-defaults";

/**
 * ============================================================================
 * THE NOTE ONLY ANSWERS A DEFAULT-PASSWORD QUESTION
 * (SENSITIVE_DEFAULTS_REDACT_ENABLED, APP_PASSWORD_HELP_ENABLED)
 * ============================================================================
 *
 * QA live, 26 Oct 2026, both apps with the flags on: the refusal was spliced
 * into ordinary answers. "whats our password policy" / "Whats our password
 * policy" (conv_mvomxql02j81mpj, conv_mvomxrzj27gtetf) lost the manual's
 * guidance, because its own "Do not use default passwords" line read as a
 * default being handed out; "How do I reset my myGLOW password"
 * (conv_mvomvytb2au4z78) and the Paycor and Revel reset questions got the
 * note appended. Now: a line that forbids default passwords is kept; a reply
 * sentence that is taken out is taken out silently unless the question asks
 * for a default password; and every question below reads the same with the
 * flags on as with them off. The removal is keyed on the sentence, the note
 * on the question.
 *
 * The page below is INVENTED, with the shape of the manual's password rules.
 */

/** Invented: the manual's password rules and a manager-side reset page. */
const KB_PAGE = [
  "Password Requirements",
  "Do not use a word or phrase of special importance to you.",
  "Do not use default passwords, i.e., password123.",
  "The password should be 8-16 characters long.",
  "Open the employee's profile and choose Reset Password.",
  "The default password is the Example format with the store code.",
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
          content: KB_PAGE,
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

async function ask(question: string, history: readonly never[]) {
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

const flagsOn = () => {
  vi.stubEnv("SENSITIVE_DEFAULTS_REDACT_ENABLED", "true");
  vi.stubEnv("APP_PASSWORD_HELP_ENABLED", "true");
};

/** What the model wrote for each, in the shape of the live replies. */
const POLICY_REPLY =
  "Here's the password policy:\n\n- The password should be 8-16 characters long [S1].\n- Do not use default passwords, i.e., password123 [S1].\n- Do not use a word or phrase of special importance to you [S1].";
const PAYCOR_REPLY =
  "Log into Paycor with your username and password. If you forgot your login credentials, click Forgot Password on the Paycor log-in page [S1].";
const MYGLOW_REPLY =
  "Log into myGLOW and select Change My Password under Your Services. Passwords must be at least 8 characters with one number and one letter [S1].";

const UNCHANGED: readonly (readonly [string, string])[] = [
  ["whats our password policy", POLICY_REPLY],
  ["Whats our password policy", POLICY_REPLY],
  ["What's our password policy", POLICY_REPLY],
  ["What's our password policy?", POLICY_REPLY],
  ["how do i reset my paycor password", PAYCOR_REPLY],
  ["How do I reset my Paycor password", PAYCOR_REPLY],
  ["how do i reset my revel password", PAYCOR_REPLY.replace(/Paycor/g, "Revel")],
  ["How do I reset my Revel password", PAYCOR_REPLY.replace(/Paycor/g, "Revel")],
  ["how do i reset my mygLOW password", MYGLOW_REPLY],
  ["How do I reset my myGLOW password", MYGLOW_REPLY],
  ["what is my default password for paycor", PAYCOR_REPLY],
  ["What is my default password for MyGlow?", MYGLOW_REPLY],
];

describe("ordinary password answers read the same with the flags on and off", () => {
  it.each(UNCHANGED)("%s", async (question, reply) => {
    state.reply = reply;
    const off = await ask(question, []);
    flagsOn();
    const on = await ask(question, []);
    expect(on.content).toBe(off.content);
    expect(on.content).not.toContain(REPLY_NOTE);
    expect(on.content).not.toMatch(/I can't share|social\s+security|default password formats/i);
  });

  it.each(["whats our password policy", "What's our password policy"])("%s: the manual's own rule reaches the model", async (question) => {
    flagsOn();
    await ask(question, []);
    expect(state.grounding).toContain("Do not use default passwords, i.e., password123.");
    expect(state.grounding).not.toContain("The default password is the Example format");
  });
});

describe("a reset answer that repeats the default loses only that sentence, with no note", () => {
  it.each(["how do i reset my mygLOW password", "How do I reset my myGLOW password"])("%s", async (question) => {
    flagsOn();
    state.reply = `${MYGLOW_REPLY} The default password is the Example format with the store code [S1].`;
    const answer = await ask(question, []);
    expect(answer.content).toContain("select Change My Password under Your Services. Passwords must be at least 8 characters");
    expect(answer.content).not.toMatch(/Example format|I can't share/);
  });
});

describe("a default-password question still gets the note", () => {
  it.each(["what is the default password for managers", "What is the default password for managers?"])("%s", async (question) => {
    flagsOn();
    state.reply = "There isn't a shared manager login. The default password is the Example format with the store code [S1].";
    const answer = await ask(question, []);
    expect(answer.content).toContain(REPLY_NOTE);
    expect(answer.content.split(REPLY_NOTE)).toHaveLength(2);
    expect(answer.content).toContain("There isn't a shared manager login.");
    expect(answer.content).not.toMatch(/Example format/);
  });
});

describe("the default password for this app is the reset answer (conv_mvomvy4m207c8vn, conv_mvomw5uu26es0ag, conv_mvomwrt624ro9x6 wording)", () => {
  it.each(["what is the default password for ask sunny", "What is the default password for Ask Sunny", "What is the default password for Ask Sunny?"])(
    "%s",
    async (question) => {
      flagsOn();
      const answer = await ask(question, []);
      expect(answer.content).toContain("click **Forgot your password?** on the log-in screen");
      expect(state.system).toBe("");
    },
  );
});
