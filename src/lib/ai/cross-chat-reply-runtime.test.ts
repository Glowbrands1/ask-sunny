import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ============================================================================
 * QA: THE REPLY BROUGHT OTHER CHATS INTO THE TEXT — THE LIVE ANSWER PATH
 * ============================================================================
 *
 * `answerQuestion` with the providers mocked and the model returning the
 * reply production gave (conv_mvmtj8ia2qwr8pu, conv_mvmvugx525mtd2v), names
 * swapped for invented ones. CROSS_CHAT_REPLY_GUARD_ENABLED on: the recall is
 * asked to guard, the prompt carries the rule, and the sentence claiming the
 * manager raised it in another chat is taken out while every other word
 * stays. Off: exactly as production today.
 */

const state = vi.hoisted(() => ({
  claudeInput: null as Record<string, unknown> | null,
  recallInput: null as Record<string, unknown> | null,
  memory: null as string | null,
  reply: "",
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

vi.mock("@/lib/forms/repository", () => ({
  listTemplateSummaries: async () => [],
}));

vi.mock("@/lib/knowledge/providers/supabase", () => ({
  SupabaseKnowledgeProvider: class {
    readonly name = "test double";
    async match() {
      return [
        {
          chunk_id: "c1",
          document_id: "d1",
          document_title: "Salon Coaching Guide",
          category: "leadership_coaching",
          locator: "Page 2",
          page: 2,
          section: null,
          content: "Coach in private, soon after the behaviour.",
          similarity: 0.9,
        },
      ];
    }
    async fetchRoleGrounding() {
      return null;
    }
    // A turn that names the policy manual reads it; none here.
    async fetchOfficialPolicyManual() {
      return null;
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

vi.mock("@/lib/chat/person-memory-store", () => ({
  recallPeople: async (input: Record<string, unknown>) => {
    state.recallInput = input;
    return state.memory;
  },
}));

vi.mock("./call-claude", () => ({
  callClaude: async (input: Record<string, unknown>) => {
    state.claudeInput = input;
    return state.reply;
  },
}));

const ACTOR = { role: "salon_director" as const, scope: { level: "salon" as const, salonIds: ["loc-0495"] } };

const SITUATION =
  "an employee (Wren)  is talking negatively about co workers and customers. another employee, marlo, complained to salon director about Wren";

const REPLY_OCT_23 = `You raised this same situation with me on October 23, and in that conversation you asked for a coaching form for Wren Calder, tanning consultant at Lawrence. Worth checking Forms → Form Monitoring to see whether that one was actually created.

For the conversation itself, keep it on behavior and impact, not personality.`;

const REPLY_AUG_26 = `I'm not sure what you're after — that came through as a stray keystroke. (You sent the same thing back on August 26, so if there was a real question behind it, it didn't make it through either time.)

Tell me what you need and I'll take it from there.`;

const MEMORY = `WHAT THIS MANAGER TOLD YOU BEFORE

ABOUT WREN

Forms Rosalyn created in Ask Sunny about Wren:
- Coaching Form for Wren Calder — dated 2026-10-23, draft, not finalized`;

async function ask(question: string, history: { role: string; content: string }[] = []) {
  const { answerQuestion } = await import("./server-ask");
  return answerQuestion(
    {
      question,
      mode: "standard",
      history,
      scopeId: "stc-core",
      conversationId: "conv_current",
      context: { userName: "Rosalyn", locationName: "Salon 0495", todayIso: "2026-10-24" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ACTOR as any,
    { memoryOwnerId: "user-1" },
  );
}

const saved = process.env.CROSS_CHAT_REPLY_GUARD_ENABLED;

// The first import of server-ask is the slow part; under load it alone passed 5s.
beforeAll(async () => {
  await import("./server-ask");
}, 60_000);

beforeEach(() => {
  state.claudeInput = null;
  state.recallInput = null;
  state.memory = null;
  state.reply = "";
});

afterEach(() => {
  if (saved === undefined) delete process.env.CROSS_CHAT_REPLY_GUARD_ENABLED;
  else process.env.CROSS_CHAT_REPLY_GUARD_ENABLED = saved;
});

describe("CROSS_CHAT_REPLY_GUARD_ENABLED on the live answer path", () => {
  it('"You raised this same situation with me on October 23" does not reach the manager', async () => {
    process.env.CROSS_CHAT_REPLY_GUARD_ENABLED = "true";
    state.reply = REPLY_OCT_23;
    state.memory = MEMORY;

    const response = await ask(SITUATION);

    expect(response.content).not.toMatch(/you raised|October 23/i);
    expect(response.content).toContain("Worth checking Forms → Form Monitoring to see whether that one was actually created.");
    expect(response.content).toContain("For the conversation itself, keep it on behavior and impact, not personality.");
    expect(state.recallInput).toMatchObject({ crossChatGuard: true });
    expect(typeof state.recallInput?.roster).toBe("function");
    const system = String(state.claudeInput?.system);
    expect(system).toContain("OTHER CONVERSATIONS");
    expect(system).toContain("Never tell the manager they raised, said, sent, asked or mentioned something in another conversation");
    expect(system).not.toContain("Last time you mentioned that");
  });

  it('"You sent the same thing back on August 26" does not reach the manager after "asdasd"', async () => {
    process.env.CROSS_CHAT_REPLY_GUARD_ENABLED = "true";
    state.reply = REPLY_AUG_26;

    const response = await ask("asdasd");

    expect(response.content).not.toMatch(/you sent|August 26/i);
    expect(response.content).toContain("I'm not sure what you're after — that came through as a stray keystroke.");
    expect(response.content).toContain("Tell me what you need and I'll take it from there.");
    expect(String(state.claudeInput?.system)).toContain("OTHER CONVERSATIONS");
  });

  it("leaves the reply alone when the manager refers back to the earlier chat", async () => {
    process.env.CROSS_CHAT_REPLY_GUARD_ENABLED = "true";
    state.reply = REPLY_OCT_23;

    const response = await ask("Wren is talking negatively about co workers again, same as last time");

    expect(response.content).toContain("You raised this same situation with me on October 23");
  });

  it("off, the reply and the recall are exactly as before", async () => {
    delete process.env.CROSS_CHAT_REPLY_GUARD_ENABLED;
    state.reply = REPLY_OCT_23;
    state.memory = MEMORY;

    const response = await ask(SITUATION);

    expect(response.content).toContain("You raised this same situation with me on October 23");
    expect(state.recallInput).not.toHaveProperty("crossChatGuard");
    expect(String(state.claudeInput?.system)).not.toContain("OTHER CONVERSATIONS");
    expect(String(state.claudeInput?.system)).toContain("Last time you mentioned that");
  });

  /*
   * QA, second pass: a reply made of nothing but QA's two live carryover
   * sentences (verbatim) comes back as the neutral line, and the removal is
   * logged by count — never by the manager's words.
   */
  const ONLY_CARRYOVER =
    "Your last two write-ups for this name were at Empire, SD and Dodge, NE. This would be a third documented issue for Test Employee that you've told me about — a verbal for the Dodge, NE attendance/no-call issue (10-20-26) and a verbal for the Empire, SD puppy visit (10-22-26).";
  const EMPIRE_TURN =
    "do verbal for team member Test Employee at empire, sd. payroll deduct does not apply. previous coaching jba manual 11-1-26. on 10-22-26 Test was not scheduled to work and came into the store to show her team her new puppy. Test was in the store 45 min";

  it("a reply that was only other chats comes back as the neutral line, and is logged", async () => {
    process.env.CROSS_CHAT_REPLY_GUARD_ENABLED = "true";
    state.reply = ONLY_CARRYOVER;
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      const response = await ask(EMPIRE_TURN);
      expect(response.content).toBe("Tell me what happened in this case and I'll help from there.");
      const logged = info.mock.calls.map((call) => String(call[0])).filter((line) => line.includes("reply.cross_chat.removed"));
      expect(logged.map((line) => JSON.parse(line))).toEqual([
        { event: "reply.cross_chat.removed", sentences: 2, neutral: true },
      ]);
      expect(logged.join("")).not.toContain("Empire");
    } finally {
      info.mockRestore();
    }
  });

  it("off, that reply reaches the manager exactly as written", async () => {
    delete process.env.CROSS_CHAT_REPLY_GUARD_ENABLED;
    state.reply = ONLY_CARRYOVER;

    const response = await ask(EMPIRE_TURN);

    expect(response.content).toBe(ONLY_CARRYOVER);
  });
});
