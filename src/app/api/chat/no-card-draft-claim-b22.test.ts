import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ============================================================================
 * QA B22-2 — "A NEW DRAFT IS OPEN" WITH NO CARD
 * ============================================================================
 *
 * Reported on the sibling app's production chat (25 Oct 2026); the same
 * route and answer path run here. In ONE chat, after a Corrective Action card
 * for "Test Employee", the manager typed:
 *
 *   "now one for Test Employee Two, Tanning Consultant, late today"
 *
 * and the reply said "A new Corrective Action Form draft is open for Test
 * Employee Two … for arriving late on today's date, 2026-10-25" and told the
 * manager to "press Finalize on the card". No card came with it, and no draft
 * for Test Employee Two existed: the only card on screen was the first one.
 *
 * Through POST /api/chat with the open-form paths answering nothing, so the
 * ordinary answer is the one returned. Faked: identity, the open form's
 * summary, the answering model (it returns the reply QA saw), the database.
 * "Test Employee" and "Test Employee Two" are invented placeholder names.
 */

const ORIGINAL = { ...process.env };
const INSTANCE = "0b6b6f0e-1111-4c2a-9a55-000000000b22";

const QUESTION =
  "now one for Test Employee Two, Tanning Consultant, late today";

/** The reply QA saw, with no card beside it. */
const PHANTOM_REPLY =
  "A new Corrective Action Form draft is open for Test Employee Two, Tanning Consultant, for arriving late on today's date, 2026-10-25. Look it over, and when it reads right, press Finalize on the card.\n\nLate arrivals are recorded as an attendance concern.";

const HONEST =
  "I haven't created a form for Test Employee Two yet — say \"create a corrective action for Test Employee Two\" and I'll put a card here.";

async function load(reply: Record<string, unknown>) {
  vi.resetModules();
  const seen = { answered: 0 };
  vi.doMock("@/lib/auth/server", () => ({
    authorizeRequest: async (_request: Request, permission: string) => ({
      identity: {
        subject: "user-1",
        email: "sd@example.com",
        displayName: "SD",
        role: "salon_director",
        scope: {
          level: "salon",
          primaryAreaId: "loc-0310",
          alsoCoversAreaIds: [],
        },
        verified: true,
      },
      permission,
      provider: "supabase",
    }),
  }));
  vi.doMock("@/lib/ai/server-ask", () => ({
    answerQuestion: async () => {
      seen.answered += 1;
      return { citations: [], recommendedVideoIds: [], ...reply };
    },
  }));
  vi.doMock("@/lib/forms/chat-correction", () => ({
    correctActiveForm: async () => null,
  }));
  vi.doMock("@/lib/forms/chat-policy-change", () => ({
    changeActiveFormPolicy: async () => null,
  }));
  vi.doMock("@/lib/forms/chat-redraft", () => ({
    redraftActiveForm: async () => null,
  }));
  vi.doMock("@/lib/forms/chat-revision", () => ({
    reviseActiveForm: async () => null,
  }));
  vi.doMock("@/lib/forms/chat-reopen", () => ({
    reopenRequestedForm: async () => null,
  }));
  vi.doMock("@/lib/forms/open-form-summary", () => ({
    describeOpenForm: async () => ({
      templateName: "Corrective Action Form",
      employeeName: "Test Employee",
      status: "draft",
      lines: [],
      unverifiedPolicy: [],
    }),
  }));
  vi.doMock("@/lib/supabase/server", () => ({
    getSupabaseAdmin: () => ({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
        insert: async () => ({ error: null }),
        update: () => ({ eq: async () => ({ error: null }) }),
      }),
    }),
  }));
  const route = await import("./route");
  return { route, seen };
}

function ask(question = QUESTION, overrides: Record<string, unknown> = {}): Request {
  return new Request("https://app.test/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      question,
      activeFormInstanceId: INSTANCE,
      history: [
        {
          id: "m1",
          role: "user",
          content: "create a corrective action for Test Employee, late today",
        },
        {
          id: "m2",
          role: "assistant",
          content: "Here's the Corrective Action Form for Test Employee.",
        },
      ],
      ...overrides,
    }),
  });
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_DEMO_MODE = "false";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
  process.env.SUPABASE_SECRET_KEY = ["sb", "secret", "TESTFIXTURE"].join("_");
  process.env.ANTHROPIC_API_KEY = "test";
  delete process.env.NO_CARD_NO_DRAFT_CLAIM_ENABLED;
});

afterEach(() => {
  process.env = { ...ORIGINAL };
  for (const path of [
    "@/lib/auth/server",
    "@/lib/ai/server-ask",
    "@/lib/forms/chat-correction",
    "@/lib/forms/chat-policy-change",
    "@/lib/forms/chat-redraft",
    "@/lib/forms/chat-revision",
    "@/lib/forms/chat-reopen",
    "@/lib/forms/open-form-summary",
    "@/lib/supabase/server",
  ]) {
    vi.doUnmock(path);
  }
  vi.resetModules();
});

describe("QA B22-2: a reply with no card never says a draft is open (NO_CARD_NO_DRAFT_CLAIM_ENABLED)", () => {
  it("replaces the invented draft and its Finalize line with an honest one, keeping the rest", async () => {
    process.env.NO_CARD_NO_DRAFT_CLAIM_ENABLED = "true";
    const { route, seen } = await load({ content: PHANTOM_REPLY });
    const response = await route.POST(ask());
    const payload = await response.json();

    expect(response.status, JSON.stringify(payload)).toBe(200);
    expect(seen.answered).toBe(1);
    expect(payload.formProposal).toBeUndefined();
    expect(payload.content).not.toMatch(/draft is open/i);
    expect(payload.content).not.toMatch(/press Finalize/i);
    expect(payload.content).toBe(
      `${HONEST}\n\nLate arrivals are recorded as an attendance concern.`,
    );
  });

  it("leaves a reply that comes with its card as it came", async () => {
    process.env.NO_CARD_NO_DRAFT_CLAIM_ENABLED = "true";
    const content =
      "Here's a new Corrective Action Form draft for Test Employee Two. Review it, then press Create on the card.";
    const { route } = await load({
      content,
      formProposal: {
        proposalId: "p-1",
        templateKey: "dpoa",
        templateName: "Corrective Action Form",
      },
    });
    const payload = await (await route.POST(ask())).json();
    expect(payload.content).toBe(content);
    expect(payload.formProposal).toMatchObject({ templateKey: "dpoa" });
  });

  it("leaves a true line about the form already open as it came", async () => {
    process.env.NO_CARD_NO_DRAFT_CLAIM_ENABLED = "true";
    const content =
      "It reads right to me. When you've checked it, press Finalize on the card.";
    const { route } = await load({ content });
    const payload = await (await route.POST(ask("I think it's ready"))).json();
    expect(payload.content).toBe(content);
  });

  it("off (the default), returns the answer exactly as it came", async () => {
    const { route } = await load({ content: PHANTOM_REPLY });
    const payload = await (await route.POST(ask())).json();
    expect(payload.content).toBe(PHANTOM_REPLY);
  });

  /*
   * Register rule (Pau): the manager's turn and the model's echo of it, all
   * lowercase and in sentence case with the names lowercase or Capitalized.
   * On, the invented draft goes and the honest line names the employee in
   * every one; off, the answer comes back exactly as it came.
   */
  const lower = (text: string) => text.toLowerCase();
  const sentenceCase = (text: string) =>
    text.toLowerCase().replace(/(^|[.!?]\s+|\n+)([a-z])/g, (_m, lead: string, first: string) => `${lead}${first.toUpperCase()}`);
  const namesCapitalized = (text: string) =>
    sentenceCase(text).replace(/\btest employee( two)?\b/gi, (name) =>
      name.replace(/\b[a-z]/g, (letter) => letter.toUpperCase()),
    );
  const registers = [
    ["all lowercase", lower],
    ["sentence case, names lowercase", sentenceCase],
    ["sentence case, names Capitalized", namesCapitalized],
  ] as const;

  it.each(registers)("on (%s): the invented draft and its Finalize line are replaced", async (_label, recase) => {
    process.env.NO_CARD_NO_DRAFT_CLAIM_ENABLED = "true";
    const { route } = await load({ content: recase(PHANTOM_REPLY) });
    const payload = await (await route.POST(ask(recase(QUESTION)))).json();
    expect(payload.content).not.toMatch(/draft is open/i);
    expect(payload.content).not.toMatch(/press finalize/i);
    expect(payload.content).toMatch(/^I haven't created a form for test employee two yet/i);
    expect(payload.content).toMatch(/late arrivals are recorded as an attendance concern\.$/i);
  });

  it.each(registers)("off (%s): returns the answer exactly as it came", async (_label, recase) => {
    const { route } = await load({ content: recase(PHANTOM_REPLY) });
    const payload = await (await route.POST(ask(recase(QUESTION)))).json();
    expect(payload.content).toBe(recase(PHANTOM_REPLY));
  });
});

/*
 * QA-7 (flag on, a reply with no card), through POST /api/chat. Conditional
 * and instructional truths are kept; a two-clause sentence keeps its true
 * clause and names the person of the false one; a policy answer's closing
 * "Press Create draft on the card below." with no card is dropped and names
 * nobody. In lowercase, sentence case and CAPS. "Rook Pemberly" stands in for
 * QA's second name (invented, the same in both apps).
 */
describe("QA-7: conditional and instructional truths are kept, a claim is rewritten by the clause (NO_CARD_NO_DRAFT_CLAIM_ENABLED)", () => {
  const lower = (text: string) => text.toLowerCase();
  const sentenceCase = (text: string) =>
    text.toLowerCase().replace(/(^|[.!?]\s+|\n+)([a-z])/g, (_m, lead: string, first: string) => `${lead}${first.toUpperCase()}`);
  const registers = [
    ["as typed", (text: string) => text],
    ["all lowercase", lower],
    ["sentence case", sentenceCase],
    ["CAPS", (text: string) => text.toUpperCase()],
  ] as const;
  const POLICY = "Arriving late three times in 30 days is an attendance concern under the JBA Policy Manual.";

  it.each(registers)("%s: \"Once you press Create, the draft for Test Employee Two will open.\" comes back as it came", async (_label, recase) => {
    process.env.NO_CARD_NO_DRAFT_CLAIM_ENABLED = "true";
    const content = recase("Once you press Create, the draft for Test Employee Two will open.");
    const { route } = await load({ content });
    const payload = await (await route.POST(ask(recase(QUESTION)))).json();
    expect(payload.content).toBe(content);
  });

  it.each(registers)("%s: \"…not created because the salon was missing. Press Create after you add it.\" comes back as it came", async (_label, recase) => {
    process.env.NO_CARD_NO_DRAFT_CLAIM_ENABLED = "true";
    const content = recase("The form was not created because the salon was missing. Press Create after you add it.");
    const { route } = await load({ content });
    const payload = await (await route.POST(ask(recase(QUESTION)))).json();
    expect(payload.content).toBe(content);
  });

  it.each(registers)("%s: a policy answer's \"Press Create draft on the card below.\" with no card is dropped, naming nobody", async (_label, recase) => {
    process.env.NO_CARD_NO_DRAFT_CLAIM_ENABLED = "true";
    const { route } = await load({ content: recase(`${POLICY} Press Create draft on the card below.`) });
    const question = recase("Test Employee Two was late again, what does the policy say?");
    for (const overrides of [{}, { activeFormInstanceId: undefined, history: [] }]) {
      const payload = await (await route.POST(ask(question, overrides))).json();
      expect(payload.content).toBe(recase(POLICY));
    }
  });

  it.each(registers)("%s: two clauses keep the true one and name Rook Pemberly", async (_label, recase) => {
    process.env.NO_CARD_NO_DRAFT_CLAIM_ENABLED = "true";
    const { route } = await load({
      content: recase("The draft for Test Employee is open, and I've created a new draft for Rook Pemberly."),
    });
    const payload = await (await route.POST(ask(recase("and one for Rook Pemberly, late today")))).json();
    const kept = `${recase("The draft for Test Employee is open")}. `;
    expect(payload.content.startsWith(kept), payload.content).toBe(true);
    expect(payload.content.slice(kept.length)).toMatch(
      /^I haven't created a form for rook pemberly yet — say "create a corrective action for rook pemberly" and I'll put a card here\.$/i,
    );
  });

  it.each(registers)("off (%s): every QA-7 reply comes back exactly as it came", async (_label, recase) => {
    for (const content of [
      "Once you press Create, the draft for Test Employee Two will open.",
      "The form was not created because the salon was missing. Press Create after you add it.",
      `${POLICY} Press Create draft on the card below.`,
      "The draft for Test Employee is open, and I've created a new draft for Rook Pemberly.",
    ]) {
      const { route } = await load({ content: recase(content) });
      const payload = await (await route.POST(ask(recase(QUESTION)))).json();
      expect(payload.content).toBe(recase(content));
    }
  });
});

/*
 * QA-6 re-probe (flag on, a reply with no card), through POST /api/chat, with
 * Test Employee's form open. "Wren Alder" is an invented name, the same in
 * both apps. Lowercase, sentence case and CAPS; off, each comes back as it came.
 */
describe("QA-6: claims in capitals, policy prose, and a known name that runs on (NO_CARD_NO_DRAFT_CLAIM_ENABLED)", () => {
  const sentenceCase = (text: string) =>
    text.toLowerCase().replace(/(^|[.!?]\s+|\n+)([a-z])/g, (_m, lead: string, first: string) => `${lead}${first.toUpperCase()}`);
  const registers = [
    ["all lowercase", (text: string) => text.toLowerCase()],
    ["sentence case", sentenceCase],
    ["CAPS", (text: string) => text.toUpperCase()],
  ] as const;
  const POLICY_PROSE = "The policy says a draft form is open to review by the manager.";

  it.each(registers)("%s: \"A draft for Wren Alder is open.\" and \"…has been created.\" are rewritten, naming Wren Alder", async (_label, recase) => {
    process.env.NO_CARD_NO_DRAFT_CLAIM_ENABLED = "true";
    for (const claim of ["A draft for Wren Alder is open.", "The draft for Wren Alder has been created."]) {
      const { route } = await load({ content: recase(claim) });
      const payload = await (await route.POST(ask(recase("now one for Wren Alder, late today")))).json();
      expect(payload.content, claim).toMatch(/^I haven't created a form for wren alder yet/i);
    }
  });

  it.each(registers)("%s: policy prose about a draft form comes back as it came", async (_label, recase) => {
    process.env.NO_CARD_NO_DRAFT_CLAIM_ENABLED = "true";
    const { route } = await load({ content: recase(POLICY_PROSE) });
    const question = recase("what does the policy say for Wren Alder?");
    for (const overrides of [{}, { activeFormInstanceId: undefined, history: [] }]) {
      const payload = await (await route.POST(ask(question, overrides))).json();
      expect(payload.content).toBe(recase(POLICY_PROSE));
    }
  });

  it.each(registers)("%s: \"the form has been created for test employee two late today.\" is rewritten, naming Test Employee Two", async (_label, recase) => {
    process.env.NO_CARD_NO_DRAFT_CLAIM_ENABLED = "true";
    const { route } = await load({ content: recase("the form has been created for test employee two late today.") });
    const payload = await (await route.POST(ask(recase("is it ready?")))).json();
    expect(payload.content).toMatch(/^I haven't created a form for test employee two yet/i);
  });

  it.each(registers)("off (%s): every QA-6 reply comes back exactly as it came", async (_label, recase) => {
    for (const content of [
      "A draft for Wren Alder is open.",
      "The draft for Wren Alder has been created.",
      POLICY_PROSE,
      "the form has been created for test employee two late today.",
    ]) {
      const { route } = await load({ content: recase(content) });
      const payload = await (await route.POST(ask(recase("now one for Wren Alder, late today")))).json();
      expect(payload.content).toBe(recase(content));
    }
  });
});
