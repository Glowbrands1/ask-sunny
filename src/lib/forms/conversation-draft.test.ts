import { describe, expect, it } from "vitest";

import { lastManagerTurnId, pickConversationDraft, separateAskedSince, type ConversationDraftRow } from "./conversation-draft";

/*
 * conv_mvh1ho2p2xddypx (20 Oct 2026), the manager's turns with a synthetic
 * name. A draft was made at m2 and another at m3 ("another"); m5 must open m3's.
 */
const TURNS = [
  { id: "m1", role: "user", content: "write a CA for Tess Varga" },
  { id: "a1", role: "assistant", content: "Ask me for it by name and employee." },
  { id: "m2", role: "user", content: "create a corrective action form for Tess Varga" },
  { id: "a2", role: "assistant", content: "I'll draft a **Corrective Action Form** for **Tess Varga**." },
  {
    id: "m3",
    role: "user",
    content:
      "Please create another corrective action from Tess Varga. This would be a verbal due to not completing her woven courses by the deadline",
  },
  { id: "a3", role: "assistant", content: "I'll draft a **Corrective Action Form** for **Tess Varga**." },
  { id: "m4", role: "user", content: "Payroll is not deducted" },
  { id: "a4", role: "assistant", content: "Got it — payroll deduct: No." },
  { id: "m5", role: "user", content: "I need it to be a corrective action form" },
];

const row = (id: string, lastTurnId: string | null, extra: Partial<ConversationDraftRow> = {}): ConversationDraftRow => ({
  id,
  employeeName: "Tess Varga",
  templateId: "tpl-dpoa",
  createdAt: `2026-10-20T18:5${id.slice(-1)}:00Z`,
  conversation: "m1",
  lastTurnId,
  ...extra,
});

const WANTED = { templateId: "tpl-dpoa", employeeName: "Tess Varga", conversationKey: "m1", turns: TURNS };

describe("separateAskedSince", () => {
  it('"another" after the draft sets it aside; turns before it do not', () => {
    expect(separateAskedSince(TURNS.slice(0, 5), "m2")).toBe(true);
    expect(separateAskedSince(TURNS, "m3")).toBe(false);
  });

  it('"also create a CA for her for dress code on 10-22" is a second document (QA, 24 Oct 2026)', () => {
    const also = [...TURNS, { id: "m6", role: "user", content: "also create a CA for her for dress code on 10-22" }];
    expect(separateAskedSince(also, "m5")).toBe(true);
    expect(separateAskedSince([...TURNS, { id: "m6", role: "user", content: "one more CA for her, dress code" }], "m5")).toBe(true);
    // Saying "also" about this form's facts is not a new document.
    expect(separateAskedSince([...TURNS, { id: "m6", role: "user", content: "she was also late on 10-19" }], "m5")).toBe(false);
  });

  it("a draft that recorded no turn is judged on every turn", () => {
    expect(separateAskedSince(TURNS, null)).toBe(true);
  });

  it("a recorded turn the window no longer holds is older than every turn sent", () => {
    expect(separateAskedSince(TURNS.slice(6), "m3")).toBe(false);
  });
});

describe("pickConversationDraft", () => {
  it("opens the newest draft this chat made for the same form and employee", () => {
    expect(pickConversationDraft([row("d1", "m2"), row("d2", "m3")], WANTED)).toBe("d2");
  });

  it("drafts made in the same instant: the one no later turn set aside", () => {
    const same = "2026-10-20T18:50:00Z";
    expect(pickConversationDraft([row("d1", "m2", { createdAt: same }), row("d2", "m3", { createdAt: same })], WANTED)).toBe("d2");
  });

  it("not when the manager asked for another document since it", () => {
    expect(pickConversationDraft([row("d1", "m2")], { ...WANTED, turns: TURNS.slice(0, 5) })).toBeNull();
  });

  it("not another chat's, another form's or another employee's", () => {
    expect(pickConversationDraft([row("d1", "m2", { conversation: "m9" })], WANTED)).toBeNull();
    expect(pickConversationDraft([row("d1", "m2", { templateId: "tpl-coaching" })], WANTED)).toBeNull();
    expect(pickConversationDraft([row("d1", "m2", { employeeName: "Remy Calder" })], WANTED)).toBeNull();
  });
});

describe("lastManagerTurnId", () => {
  it("is the last user turn with an id", () => {
    expect(lastManagerTurnId(TURNS)).toBe("m5");
    expect(lastManagerTurnId(TURNS.slice(0, 2))).toBe("m1");
    expect(lastManagerTurnId([{ role: "user", content: "no id" }])).toBeNull();
  });
});
