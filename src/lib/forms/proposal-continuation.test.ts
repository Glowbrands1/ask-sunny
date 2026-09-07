import { describe, expect, it } from "vitest";

import { continuationFor } from "./proposal-continuation";
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

  it("stops when the conversation moved on to an ordinary answer", () => {
    /*
     * ONLY THE LAST ASSISTANT TURN COUNTS. Reviving a proposal from three turns
     * back would be the "conversation state persists forever" mistake in a new
     * shape.
     */
    const hint = continuationFor([
      managerTurn,
      assistant({ id: "m2", formProposal: proposal() }),
      { id: "m3", role: "user", content: "what is the tardiness policy?", createdAt: "" },
      assistant({ id: "m4", content: "Arriving late three times is documented coaching." }),
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
