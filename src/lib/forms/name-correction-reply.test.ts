import { describe, expect, it } from "vitest";

import { nameNotCorrectedReply } from "./name-correction-words";

/**
 * QA's live check, 3 Nov 2026: "It reads <name> now." sounded like the claims
 * the honest-reply guard removes ("now reads …"). The reply says plainly what
 * the card shows. Invented person.
 */
describe("the reply when the name is not changed from the chat", () => {
  const reply = nameNotCorrectedReply({ templateName: "Corrective Action Form", employeeName: "Rowan Kestrel" });

  it("says what the card shows, plainly", () => {
    expect(reply.content).toContain("The name on the card is **Rowan Kestrel**.");
  });

  it("never sounds like a change was made", () => {
    expect(reply.content).not.toMatch(/\breads\b|\bnow reads\b|\bupdated\b/i);
  });
});
