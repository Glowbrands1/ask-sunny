import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ============================================================================
 * QA B22, 25 OCT 2026 — A RESENT DRAFT IS REOPENED ONLY IN THE CHAT THAT MADE IT
 * ============================================================================
 *
 * With DRAFT_DEDUPE_ENABLED, `reopenSameIncident` looked for a resent draft
 * across the whole account. A new chat asking "Draft a corrective action for
 * Test Employee at the Test Salon. She was a no call no show today." got
 * the tardiness draft (dated 2026-10-20) another chat had made: "… is still a
 * draft, so it's open to edit." DRAFT_REUSE_SAME_CHAT_ONLY_ENABLED already
 * keeps the create route's reuse to the same chat; this lookup now does too.
 */

const TURN = "Draft a corrective action for Test Employee at the Test Salon. She was a no call no show today.";

const lookups = vi.hoisted(() => ({ calls: [] as Record<string, unknown>[] }));

/* The other chat's draft: found unless the lookup is kept to a different chat. */
vi.mock("@/lib/forms/draft-reopen", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  findResentDraft: async (input: Record<string, unknown>) => {
    lookups.calls.push(input);
    const sameChat = input.sameChat as { conversationKey: string | null } | undefined;
    if (sameChat && sameChat.conversationKey !== "conv_other_chat") return null;
    return {
      id: "ca-other-chat",
      templateName: "Corrective Action Form",
      employeeName: "Test Employee",
      status: "draft",
      revisesInstanceId: null,
    };
  },
}));

const { deliverFormProposal } = await import("./grounded-turn");

const proposal = {
  content: "I'll draft a **Corrective Action Form** for **Test Employee**.",
  citations: [],
  coverage: "not_applicable",
  formProposal: {
    proposalId: "p-1",
    templateKey: "dpoa",
    templateName: "Corrective Action Form",
    employeeName: "Test Employee",
    locationId: "loc-1",
    formDate: null,
  },
};

const turn = (conversationId: string) =>
  deliverFormProposal({
    request: {
      question: TURN,
      history: [],
      context: { todayIso: "2026-10-25" },
      conversationId,
    } as never,
    actor: { role: "salon_director", scope: null, subject: "user-1", verified: true } as never,
    question: TURN,
    propose: async () => structuredClone(proposal) as never,
    decorate: async (response) => response,
  });

beforeEach(() => {
  lookups.calls = [];
  vi.stubEnv("DRAFT_DEDUPE_ENABLED", "true");
});
afterEach(() => vi.unstubAllEnvs());

describe("DRAFT_REUSE_SAME_CHAT_ONLY_ENABLED on", () => {
  beforeEach(() => vi.stubEnv("DRAFT_REUSE_SAME_CHAT_ONLY_ENABLED", "true"));

  it("a new chat gets its own card, never another chat's draft", async () => {
    const response = await turn("conv_new_chat");
    expect(lookups.calls[0]!.sameChat).toEqual({ conversationKey: "conv_new_chat" });
    expect(response!.formOpened).toBeUndefined();
    expect(response!.formProposal!.employeeName).toBe("Test Employee");
    expect(response!.content).not.toContain("is still a draft");
  });

  it("the same chat sending it again still reopens its own draft", async () => {
    const response = await turn("conv_other_chat");
    expect(response!.formOpened!.instanceId).toBe("ca-other-chat");
    expect(response!.content).toContain("is still a draft, so it's open to edit");
  });
});

describe("DRAFT_REUSE_SAME_CHAT_ONLY_ENABLED off: as production today", () => {
  it("the lookup spans the account and reopens the other chat's draft", async () => {
    const response = await turn("conv_new_chat");
    expect(lookups.calls[0]!.sameChat).toBeUndefined();
    expect(response!.formOpened!.instanceId).toBe("ca-other-chat");
  });
});
