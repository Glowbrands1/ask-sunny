import { describe, expect, it } from "vitest";

import { makeThatUpdateWithAccount } from "./form-content-turn";

/*
 * MAKE_THAT_UPDATE_ACCOUNT_ENABLED: the manager's production wording (relayed 5 Nov 2026), the person invented as in
 * the replay pack (`nov5-coding3-chat-edits-cases.ts`).
 */
const ROWAN_DID = "rowan marked a session as complete but the guest hadn't been sprayed yet";
const COPY_PASTE = "i don't see the details updated in the draft card.  Do i need to copy and paste it?  or should it be automatically updating?";
const history = (reply: string) => [
  { role: "user" as const, content: ROWAN_DID },
  { role: "assistant" as const, content: "I haven't changed the **Coaching Form** for **Rowan Kestrel** — everything on it is as it was." },
  { role: "user" as const, content: COPY_PASTE },
  { role: "assistant" as const, content: reply },
];

describe("makeThatUpdateWithAccount", () => {
  it("after a reply that offered nothing, \"make that update\" carries her own account", () => {
    expect(makeThatUpdateWithAccount({ question: "make that update", history: history("It should update automatically — no copy-and-paste needed."), employeeName: "Rowan Kestrel" })).toBe(
      `make that update: ${ROWAN_DID}`,
    );
  });

  it("after a reply that printed the Details, the reply's update is the one to make (unchanged)", () => {
    expect(makeThatUpdateWithAccount({ question: "make that update", history: history("**Details of Coaching:** Press Start Session only once the guest is in the booth."), employeeName: "Rowan Kestrel" })).toBeNull();
  });

  it("never a question, the copy-and-paste question included, and never another turn", () => {
    expect(makeThatUpdateWithAccount({ question: "make that update", history: [{ role: "user" as const, content: COPY_PASTE }, { role: "assistant" as const, content: "Okay." }], employeeName: "Rowan Kestrel" })).toBeNull();
    expect(makeThatUpdateWithAccount({ question: "what does the policy say?", history: history("Okay."), employeeName: "Rowan Kestrel" })).toBeNull();
  });
});
