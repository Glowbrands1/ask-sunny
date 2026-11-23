import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdmin: () => ({}) }));

import { ownRecords } from "./card-record";

/* Port of Ask Bubbles #1079 (its QA, 23 Nov 2026, the duplicate-tab finding): one tab never gets another tab's records. */
const row = (message_id: string, question_key: string) => ({ message_id, slots: { agent_loop: { question_key } } });
const TAB_A = [row("a1", "ka1"), row("a2", "ka2")];
const TAB_B = [row("b1", "kb1")];

describe("ownRecords (duplicate tab)", () => {
  it("a tab's turn reads only its own records, and those older than its earliest", () => {
    const all = [row("old", "k0"), ...TAB_A, ...TAB_B];
    expect(ownRecords(all, { messageIds: ["b1"], questionKeys: [] }).map((r) => r.message_id)).toEqual(["old", "a1", "a2", "b1"]);
    expect(ownRecords([...TAB_B, ...TAB_A], { messageIds: ["b1"], questionKeys: [] }).map((r) => r.message_id)).toEqual(["b1"]);
  });

  it("a record is this tab's by its question key when its id differs", () => {
    expect(ownRecords([...TAB_B, ...TAB_A], { messageIds: [], questionKeys: ["ka1"] }).map((r) => r.message_id)).toEqual(["b1", "a1"]);
  });

  it("a fresh tab with no turns has no records", () => {
    expect(ownRecords([...TAB_A], { messageIds: [], questionKeys: [] })).toEqual([]);
  });

  it("with nothing of this history found, every record counts, as before", () => {
    expect(ownRecords([...TAB_A], { messageIds: ["zz"], questionKeys: ["kz"] }).map((r) => r.message_id)).toEqual(["a1", "a2"]);
  });
});
