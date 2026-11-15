import { describe, expect, it } from "vitest";

import type { ChatMessage } from "@/types";

import { CURRENT_MESSAGE_ID, identifiedTurns, messageIdTag, readEvidence, verifyEvidence, withoutMessageIdTags } from "./evidence";

/* The rebuild plan's shared evidence check (owner's audit, 15 Nov 2026). People are invented. */

const history = [
  { id: "m1", role: "user", content: "CA for Remy Calder, she was late on 11/14." },
  { id: "m2", role: "assistant", content: "Here's the Corrective Action Form for **Remy Calder**. Payroll deduct isn't set; tell me if it applies." },
  { id: "m3", role: "user", content: "She’s  had a   VERBAL — last month" },
  { id: "m4", role: "assistant", content: "Something went wrong.", error: true },
  { role: "user", content: "no id on this one" },
] as unknown as ChatMessage[];

const turns = identifiedTurns(history, "make it a written please", "m9");

describe("identifiedTurns", () => {
  it("gives each shown turn its id, the history place when it has none, and the message answered now last", () => {
    expect(turns.map((turn) => turn.id)).toEqual(["m1", "m2", "m3", "h4", "m9"]);
    expect(turns.at(-1)).toMatchObject({ role: "user", content: "make it a written please", index: 4 });
  });
  it("names the message answered now CURRENT_MESSAGE_ID when the chat gave it no id", () => {
    expect(identifiedTurns([], "hi").at(-1)!.id).toBe(CURRENT_MESSAGE_ID);
  });
});

describe("verifyEvidence", () => {
  it("ok: the quote is in that manager turn, case-, space-, curly-quote- and dash-insensitively", () => {
    const check = verifyEvidence({ message_id: "m3", quote: "she's had a verbal - LAST month" }, turns);
    expect(check).toMatchObject({ ok: true, turn: { id: "m3" } });
  });
  it("evidence_not_manager_turn: an unknown id, the app's own reply, or no evidence at all", () => {
    expect(verifyEvidence({ message_id: "m7", quote: "late" }, turns)).toEqual({ ok: false, reason: "evidence_not_manager_turn" });
    expect(verifyEvidence({ message_id: "m2", quote: "Payroll deduct" }, turns)).toEqual({ ok: false, reason: "evidence_not_manager_turn" });
    expect(verifyEvidence(null, turns)).toEqual({ ok: false, reason: "evidence_not_manager_turn" });
    expect(verifyEvidence({ message_id: 3, quote: "late" }, turns)).toEqual({ ok: false, reason: "evidence_not_manager_turn" });
  });
  it("evidence_quote_not_found: words the manager did not type in that turn, or an empty quote", () => {
    expect(verifyEvidence({ message_id: "m1", quote: "she was written up" }, turns)).toEqual({ ok: false, reason: "evidence_quote_not_found" });
    expect(verifyEvidence({ message_id: "m1", quote: "  " }, turns)).toEqual({ ok: false, reason: "evidence_quote_not_found" });
    // The app's own tag is never the manager's words.
    expect(verifyEvidence({ message_id: "m1", quote: "message_id" }, identifiedTurns([{ id: "m1", role: "user", content: `late ${messageIdTag("m1")}` }] as unknown as ChatMessage[], "x"))).toEqual({ ok: false, reason: "evidence_quote_not_found" });
  });
  it("evidence_not_this_turn: the check needs this message's words and the quote is from an earlier one", () => {
    expect(verifyEvidence({ message_id: "m3", quote: "verbal" }, turns, { thisTurnOnly: true })).toEqual({ ok: false, reason: "evidence_not_this_turn" });
    expect(verifyEvidence({ message_id: "m9", quote: "a written" }, turns, { thisTurnOnly: true })).toMatchObject({ ok: true });
  });
  it("evidence_after_card: the answer must come after the card asked; a quote from before it (QA's example) is refused", () => {
    const asked = identifiedTurns(
      [
        { id: "a1", role: "user", content: "CA for Remy Calder, she was written up before, now late on 11/14" },
        { id: "a2", role: "assistant", content: "Here's the Corrective Action Form for **Remy Calder**. Verbal or Written?" },
      ] as unknown as ChatMessage[],
      "written",
      "a3",
    );
    expect(verifyEvidence({ message_id: "a1", quote: "she was written up before" }, asked, { afterMessageId: "a2" })).toEqual({ ok: false, reason: "evidence_after_card" });
    expect(verifyEvidence({ message_id: "a3", quote: "written" }, asked, { afterMessageId: "a2" })).toMatchObject({ ok: true });
  });
});

describe("the tags", () => {
  it("are taken out whole, and readEvidence reads only well-formed evidence", () => {
    expect(withoutMessageIdTags(`she was late\n\n${messageIdTag("m1")}`)).toBe("she was late");
    expect(readEvidence({ message_id: " m1 ", quote: "late" })).toEqual({ message_id: "m1", quote: "late" });
    expect(readEvidence("m1: late")).toBeNull();
  });
});
