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
      // Changed on purpose (PR 3, QA's review of #1035): field labels as a manager reads them, not raw keys.
      "I saved these changes on the form: Observation, Payroll deduct.",
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
    // Changed on purpose (QA's live finding, 16 Nov 2026): the code-written step-limit reply states only what was saved, then asks for the change again.
    expect(stepLimitReply(done, true)).toBe("I saved the change on the form: observation. Please send the change you still need again, and I'll make it.");
  });

  it("the step limit names the saved fields from the effects, or says nothing else was saved yet (QA's live finding)", () => {
    const saved = doneThisTurn({ proposal: null, formOpened: { instanceId: "r", templateName: "Corrective Action Form", revisesInstanceId: "f" }, formUpdate: { instanceId: "r", updated: ["form_date"], saved: [{ field: "form_date", before: "2026-11-10", after: "2026-11-09" }] } });
    expect(stepLimitReply(saved, true)).toMatch(/^I opened a new draft revising the finalized form; the original stays as it was\. I saved the change on the form: .+\. Please send the change you still need again, and I'll make it\.$/);
    expect(stepLimitReply(saved, true)).not.toMatch(/Nothing else was saved|couldn't finish|one thing still left/);
    const openedOnly = doneThisTurn({ proposal: null, formOpened: { instanceId: "r", templateName: "Corrective Action Form", revisesInstanceId: "f" }, formUpdate: null });
    expect(stepLimitReply(openedOnly, false)).toBe("I opened a new draft revising the finalized form; the original stays as it was. Nothing else was saved yet. Please send the change you still need again, and I'll make it.");
  });
});

describe("turns the loop does not take yet (F5)", () => {
  it("each field the loop would lose sends the turn to today's path", () => {
    /* Changed on purpose (Pau, 26 Nov 2026): attached files stay in the loop, which reads them (`lib/chat/attachments.server.ts`). */
    expect(agentLoopSkipReason({ attachments: [{ filename: "d.pdf", mediaType: "application/pdf", url: "data:application/pdf;base64,AA==" }] } as never)).toBeNull();
    expect(agentLoopSkipReason({ reportContext: { family: "sales-totals" } })).toBe("report_context");
    expect(agentLoopSkipReason({ pendingCopyFromInstanceId: "x" })).toBe("pending_copy");
    expect(agentLoopSkipReason({ mode: "quick" })).toBe("answer_mode");
    expect(agentLoopSkipReason({ mode: "detailed" })).toBe("answer_mode");
  });

  it("a plain turn stays in the loop: standard mode, no attachments, no report, no copy", () => {
    expect(agentLoopSkipReason({ mode: "standard" })).toBeNull();
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

/*
 * QA's code audit on main d7960a5f (item 14b, 20 Nov 2026): coach_team's "create all" saves drafts that never reached
 * the effects, so a later model error said "Nothing was saved" over them; and a tool still saving when the turn stopped
 * could save after a reply that said nothing was. Both are now what the turn did.
 */
describe("drafts made and work still saving count as done (QA audit 14b)", () => {
  it("coach_team's drafts are named, so an error after them never says nothing was saved", () => {
    const done = doneThisTurn({ proposal: null, formUpdate: null, draftsCreated: 12 });
    expect(done).toBe("I created 12 draft Coaching Forms in Form Monitoring.");
    expect(partialReply(done!, "error")).not.toMatch(/Nothing was saved/);
    expect(doneThisTurn({ proposal: null, formUpdate: null, draftsCreated: 1 })).toBe("I created 1 draft Coaching Form in Form Monitoring.");
  });

  it("a tool still running when the turn stopped: the reply says to check the form, never that nothing was saved", () => {
    const done = doneThisTurn({ proposal: null, formUpdate: null, workUnfinished: true });
    expect(done).toMatch(/may still be saving, so please check the form before you send it again/);
    expect(partialReply(done!, "timeout")).not.toMatch(/Nothing was (?:saved|sent)/);
  });
});
