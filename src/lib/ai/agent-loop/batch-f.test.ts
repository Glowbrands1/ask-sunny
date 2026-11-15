import { describe, expect, it } from "vitest";

import { doneThisTurn, partialReply, STEP_LIMIT_REPLY, stepLimitReply } from "./run";
import { agentLoopSkipReason, loopCarriedOnly } from "./switch";
import { salonLabel } from "./tools";

/* Batch F (QA, 15 Nov 2026): the facts a reply that stops early is built from (F1, F2), and which turns the loop skips (F5). */

const CARD = { templateName: "Corrective Action Form", employeeName: "Remy Calder" } as never;

describe("what this turn already did (F1, F2)", () => {
  it("nothing done is null, so the old replies stay", () => {
    expect(doneThisTurn({ proposal: null, formUpdate: null })).toBeNull();
    expect(stepLimitReply(null)).toBe(STEP_LIMIT_REPLY);
  });

  it("a card, an opened revision and saved fields, from the effects", () => {
    expect(doneThisTurn({ proposal: CARD, formUpdate: null })).toBe("Here is the **Corrective Action Form** for **Remy Calder** for you to review.");
    expect(doneThisTurn({ proposal: null, formUpdate: { instanceId: "i", updated: ["observation", "payroll_deduct"] } })).toBe(
      "I saved these changes on the form: observation, payroll deduct.",
    );
    expect(doneThisTurn({ proposal: null, formUpdate: null, formOpened: { instanceId: "d" } as never })).toMatch(/new draft revising the finalized form/);
  });

  it("an empty update is nothing saved", () => {
    expect(doneThisTurn({ proposal: null, formUpdate: { instanceId: "i", updated: [] } })).toBeNull();
  });

  it("the error and timeout lines say what was done and that the rest did not finish; never 'Nothing was saved'", () => {
    const done = "I saved the change on the form: observation.";
    expect(partialReply(done, "error")).toMatch(/^I saved the change on the form: observation\. Something went wrong before I could finish the rest/);
    expect(partialReply(done, "timeout")).toMatch(/I ran out of time before finishing the rest/);
    expect(partialReply(done, "error")).not.toMatch(/Nothing was saved/);
    expect(stepLimitReply(done)).toMatch(/What's the one thing still left\?$/);
  });
});

describe("turns the loop does not take yet (F5)", () => {
  it("each field the loop would lose sends the turn to today's path", () => {
    expect(agentLoopSkipReason({ attachedDocumentIds: ["d"] })).toBe("attachments");
    expect(agentLoopSkipReason({ reportContext: { family: "sales-totals" } })).toBe("report_context");
    expect(agentLoopSkipReason({ pendingCopyFromInstanceId: "x" })).toBe("pending_copy");
    expect(agentLoopSkipReason({ mode: "quick" })).toBe("answer_mode");
    expect(agentLoopSkipReason({ mode: "detailed" })).toBe("answer_mode");
  });

  it("a plain turn stays in the loop: standard mode, no attachments, no report, no copy", () => {
    expect(agentLoopSkipReason({ mode: "standard", attachedDocumentIds: [] })).toBeNull();
  });

  it("the card's continuation key is only noted: the browser sends it on nearly every turn after a card", () => {
    expect(agentLoopSkipReason({ mode: "standard" })).toBeNull();
    expect(loopCarriedOnly({ continueProposalTemplateKey: "dpoa" })).toEqual(["continue_proposal"]);
  });
});

describe("a salon by its name, never its id (F7)", () => {
  it("the app's salon list names it; a stored name is the fallback; an unknown id is never shown raw", () => {
    expect(salonLabel("loc-0309")).toBe("NE Kearney");
    expect(salonLabel("loc-9999", "Stored Salon Name")).toBe("Stored Salon Name");
    expect(salonLabel("loc-9999")).toBe("a salon not on the app's salon list");
    expect(salonLabel(null)).toBeNull();
  });
});
