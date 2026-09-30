import { describe, expect, it } from "vitest";

import { CONTINUATION_ANSWER_LOOKBACK, continuationFor, isProposalSuperseded } from "./proposal-continuation";
import type { ChatFormProposal, ChatMessage } from "@/types";

/**
 * ============================================================================
 * REMEDIATION FINDING 3 — ANSWERING SUNNY CONTINUES THE SAME PROPOSAL
 * ============================================================================
 *
 * The hint's job is narrow and its job is the whole safety argument: it names a
 * KIND of form and nothing else. No employee, no salon, no field value, no
 * status — none of what `pendingFormValues` used to carry.
 */

function proposal(overrides: Partial<ChatFormProposal> = {}): ChatFormProposal {
  return {
    proposalId: "prop-1",
    templateKey: "coaching",
    templateName: "Coaching Form",
    supportsInlineDraft: false,
    variantKey: null,
    employeeRole: null,
    employeeName: null,
    locationId: "loc-0101",
    locationName: null,
    locationResolution: "resolved",
    authorizedLocationIds: [],
    status: "needs_employee",
    sourceMessageIds: ["m1"],
    ...overrides,
  };
}

function assistant(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "m2",
    role: "assistant",
    content: "I don't yet know who this form is about.",
    createdAt: "2026-09-07T12:00:00Z",
    ...overrides,
  };
}

const managerTurn: ChatMessage = {
  id: "m1",
  role: "user",
  content: "Build me a coaching form for that.",
  createdAt: "2026-09-07T11:59:00Z",
};

describe("F3. an open proposal on the last assistant turn is continued", () => {
  it("names the template, and only the template", () => {
    const hint = continuationFor([managerTurn, assistant({ formProposal: proposal() })]);

    expect(hint).toEqual({ templateKey: "coaching" });
    // Everything the prototype's `pendingFormValues` used to carry is absent.
    expect(Object.keys(hint!)).toEqual(["templateKey"]);
    expect(JSON.stringify(hint)).not.toMatch(/employee|location|status|value/i);
  });
});

describe("F3. a finished or absent proposal is not continued", () => {
  it("stops once the proposal became a real form", () => {
    // The manager is editing the record now. Another turn is a new request.
    const hint = continuationFor([
      managerTurn,
      assistant({
        formProposal: proposal({ status: "ready" }),
        formInstanceRef: {
          instanceId: "inst-42",
          proposalId: "prop-1",
          templateName: "Coaching Form",
        },
      }),
    ]);
    expect(hint).toBeNull();
  });

  it("looks past an advice answer to the intake still open (production QA, 30 September 2026)", () => {
    /*
     * REVERSED ON PURPOSE. This used to assert that one ordinary answer ended
     * the proposal. Production QA showed what that cost: a single reply sent to
     * retrieval ("employee: avery testperson", read as nobody) ended the
     * Coaching intake, and repeating the name could never bring it back. The
     * server still continues only a turn that reads as intake, so the question
     * in between is still answered as a question.
     */
    const hint = continuationFor([
      managerTurn,
      assistant({ id: "m2", formProposal: proposal() }),
      { id: "m3", role: "user", content: "what is the tardiness policy?", createdAt: "" },
      assistant({ id: "m4", content: "Arriving late three times is documented coaching." }),
    ]);
    expect(hint).toEqual({ templateKey: "coaching" });
  });

  it("stops once too many answers have gone by", () => {
    const answers = Array.from({ length: CONTINUATION_ANSWER_LOOKBACK + 1 }, (_, index) => [
      { id: `u${index}`, role: "user" as const, content: "what is the tardiness policy?", createdAt: "" },
      assistant({ id: `a${index}`, content: "An answer." }),
    ]).flat();
    expect(continuationFor([managerTurn, assistant({ formProposal: proposal() }), ...answers])).toBeNull();
  });

  it("stops when the manager ends the intake themselves", () => {
    const hint = continuationFor([
      managerTurn,
      assistant({ id: "m2", formProposal: proposal() }),
      { id: "m3", role: "user", content: "never mind, no form", createdAt: "" },
      assistant({ id: "m4", content: "No problem." }),
    ]);
    expect(hint).toBeNull();
  });

  it("stops at a form picker, which means no one form is open", () => {
    const hint = continuationFor([
      managerTurn,
      assistant({ id: "m2", formProposal: proposal() }),
      { id: "m3", role: "user", content: "I need a form", createdAt: "" },
      assistant({
        id: "m4",
        content: "Which form do you need?",
        formSelection: { primary: { templateKey: "coaching", templateName: "Coaching Form", description: "" }, additional: [] },
      }),
    ]);
    expect(hint).toBeNull();
  });

  it("stops on a failed turn", () => {
    const hint = continuationFor([
      managerTurn,
      assistant({
        formProposal: proposal(),
        error: { kind: "model_failed", message: "no", retryable: true, question: "x" },
      }),
    ]);
    expect(hint).toBeNull();
  });

  it("is null for a conversation with no assistant turn at all", () => {
    expect(continuationFor([managerTurn])).toBeNull();
    expect(continuationFor([])).toBeNull();
  });
});

describe("the form a later turn may correct", () => {
  const at = "2026-09-28T12:00:00Z";
  const ref = { instanceId: "form-1", proposalId: "p1", templateName: "Demotion Form" };

  it("is the most recently created form", async () => {
    const { activeFormInstanceFor } = await import("./proposal-continuation");
    expect(
      activeFormInstanceFor([
        { id: "u1", role: "user", content: "demote jane to TC", createdAt: at },
        { id: "a1", role: "assistant", content: "…", createdAt: at, formInstanceRef: ref } as never,
        { id: "u2", role: "user", content: "thanks", createdAt: at },
        { id: "a2", role: "assistant", content: "You're welcome.", createdAt: at },
      ]),
    ).toBe("form-1");
  });

  it("is none once a newer, uncreated proposal is on screen, or when nothing was created", async () => {
    const { activeFormInstanceFor } = await import("./proposal-continuation");
    expect(
      activeFormInstanceFor([
        { id: "a1", role: "assistant", content: "…", createdAt: at, formInstanceRef: ref } as never,
        { id: "a2", role: "assistant", content: "…", createdAt: at, formProposal: { templateKey: "coaching" } } as never,
      ]),
    ).toBeUndefined();
    expect(activeFormInstanceFor([{ id: "u1", role: "user", content: "hi", createdAt: at }])).toBeUndefined();
  });
});

describe("an older proposal is superseded by a newer one (production QA, 30 September 2026)", () => {
  const thread: ChatMessage[] = [
    managerTurn,
    assistant({ id: "a1", formProposal: proposal({ proposalId: "old", employeeName: "Jordan Testperson" }) }),
    { id: "u2", role: "user", content: "No, not Jordan Testperson. Avery Testperson.", createdAt: "" },
    assistant({ id: "a2", formProposal: proposal({ proposalId: "new", employeeName: "Avery Testperson" }) }),
  ];

  it("the older card is superseded; the newest is not", () => {
    expect(isProposalSuperseded(thread, "old")).toBe(true);
    expect(isProposalSuperseded(thread, "new")).toBe(false);
  });

  it("a card that already became a form is finished, not superseded", () => {
    const created = thread.map((message) =>
      message.id === "a1" ? { ...message, formInstanceRef: { instanceId: "i1", proposalId: "old", templateName: "Coaching Form" } } : message,
    );
    expect(isProposalSuperseded(created, "old")).toBe(false);
  });

  it("a plain answer after a card does not supersede it", () => {
    expect(
      isProposalSuperseded(
        [managerTurn, assistant({ id: "a1", formProposal: proposal({ proposalId: "only" }) }), assistant({ id: "a3", content: "An answer." })],
        "only",
      ),
    ).toBe(false);
  });
});
