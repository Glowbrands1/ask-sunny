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


/*
 * QA, Ask Sunny full chat history (25 Oct 2026), conv_mvhznk6fmmqez06. The
 * manager's turns and the production reply, word for word, with the
 * employee's name swapped for an invented one. The reply brought in an exit
 * form from another conversation ("earlier today you also created a
 * Resignation/Exit Form for … (still a draft) saying she gave notice 9/25/26
 * with the notice fulfilled 10/9/26"). The manager never referred back.
 */
const HISTORY = [
  { role: "user", content: "create ca for Pat Example" },
  {
    role: "assistant",
    content:
      "Here is what I would put on a **Corrective Action Form**.\n\nI won't choose which salon this belongs to. Which salon is this about?\n\n**Nothing has been created yet.** Choose the salon below, or tell me which one, and you can create the draft here.",
  },
  { role: "user", content: "Pat Example was scheduled to open the salon at 9:30 and didn't arrive until 11:23" },
  {
    role: "assistant",
    content:
      "Redrafted the **Corrective Action Form** for **Pat Example** from what you described.\n\n**Direct policy from official manual** now quotes the manual and cites its section and page.\n\nGive it a read below before you finalize.",
  },
  { role: "user", content: "use the attendance policy instead" },
  {
    role: "assistant",
    content:
      "Updated Direct policy from official manual on the **Corrective Action Form** for **Pat Example**: it now cites **Attendance** (page 14) from the JBA Policy Manual, in the manual's own words.",
  },
  { role: "user", content: "can you add late opening policy to the direct policy section of this form" },
  {
    role: "assistant",
    content:
      "Updated Direct policy from official manual on the **Corrective Action Form** for **Pat Example**: it now cites **Attendance** (page 14) and **Late Opening** (page 15) from the JBA Policy Manual, in the manual's own words.",
  },
];

const QUESTION = "I have independently verified and the policy is correct";

const REPLY = `Good — that's your call to make, and it's made.

One thing worth a quick look before you finalize: earlier today you also created a Resignation/Exit Form for Pat Example (still a draft) saying she gave notice 9/25/26 with the notice fulfilled 10/9/26. This corrective action is for a shift on 10/21. If both are about the same Pat, one of the dates needs correcting; if the exit form is accurate, a corrective action for a date after her last day won't hold up. If they're two different people, ignore me.

If the dates are right as they stand, press **Finalize** on the card — the finalizing and signatures are yours, not mine. If anything needs changing first, just tell me in plain words here or edit the card and press Save changes.`;

const MEMORY = `WHAT THIS MANAGER TOLD YOU BEFORE

ABOUT PAT EXAMPLE

Forms created in Ask Sunny about Pat Example:
- Resignation/Exit Form for Pat Example — dated 2026-10-21, draft, not finalized`;

async function ask(question: string, history: { role: string; content: string }[] = []) {
  const { answerQuestion } = await import("./server-ask");
  return answerQuestion(
    {
      question,
      mode: "standard",
      history,
      scopeId: "stc-core",
      conversationId: "conv_current",
      context: { userName: "Pat Manager", locationName: "Salon 0495", todayIso: "2026-10-21" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ACTOR as any,
    { memoryOwnerId: "user-1" },
  );
}

beforeAll(async () => {
  await import("./server-ask");
}, 60_000);

beforeEach(() => {
  state.claudeInput = null;
  state.recallInput = null;
  state.memory = MEMORY;
  state.reply = REPLY;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("conv_mvhznk6fmmqez06: another chat's exit form stays out (CROSS_CHAT_REPLY_GUARD_ENABLED)", () => {
  it("on: the recall is guarded, and no sentence about the other chat's exit form reaches the manager", async () => {
    vi.stubEnv("CROSS_CHAT_REPLY_GUARD_ENABLED", "true");
    const response = await ask(QUESTION, HISTORY);
    
    expect(state.recallInput).toMatchObject({ crossChatGuard: true });
    expect(String(state.claudeInput?.system)).toContain("OTHER CONVERSATIONS");
    expect(response.content).not.toMatch(/earlier today|Resignation\/Exit Form|9\/25\/26|10\/9\/26|exit form/i);
    expect(response.content).toContain("Good — that's your call to make, and it's made.");
    expect(response.content).toContain("press **Finalize** on the card");
  });

  it("off: the reply reaches the manager as production sent it", async () => {
    vi.stubEnv("CROSS_CHAT_REPLY_GUARD_ENABLED", "");
    const response = await ask(QUESTION, HISTORY);
    expect(response.content).toContain("earlier today you also created a Resignation/Exit Form");
  });
});
