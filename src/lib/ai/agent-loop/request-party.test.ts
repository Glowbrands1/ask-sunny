import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { requestTurns } = await import("./tools");
const { identifiedTurns } = await import("./evidence");

/*
 * Fix batch item 5 (QA's shadow replay, c219; QA's ruling, 16 Nov 2026): a cited turn naming another roster person (a party)
 * is still this person's when it also names them by a one-edit first name no active roster person has, but only once the
 * manager named them in full in this request (limit a), and never when the spelling is one edit from two people (limit b).
 * Invented names: Odalys Fenwick (not on the roster), Juno Paxton, Remy Calder, Odalie Brandt.
 */
const SCRIPT = "Odalis, this meeting is about the text you sent your salon director Juno Paxton on 11/3.";
const history = (later: string) => [
  { id: "m1", role: "user" as const, content: SCRIPT, timestamp: new Date() },
  { id: "a1", role: "assistant" as const, content: "Who is this for?", timestamp: new Date() },
  { id: "m2", role: "user" as const, content: later, timestamp: new Date() },
];
const cite = [{ message_id: "m1", quote: "this meeting is about the text you sent" }];
const roster = ["Juno Paxton", "Remy Calder"];

describe("requestTurns: another person named as a party", () => {
  it("keeps the turn once the manager named the person in full", () => {
    const turns = identifiedTurns(history("For Odalys Fenwick") as never, "use Odalys Fenwick", "m3");
    expect(requestTurns(turns, cite, "Odalys Fenwick", roster, "request_evidence")).toMatchObject({ ok: true, ids: ["m1"] });
  });
  it("limit (a): a one-edit first name alone, with no full name in the request, keeps today's refusal", () => {
    const turns = identifiedTurns(history("make the exit form") as never, "ok", "m3");
    const result = requestTurns(turns, cite, "Odalys", roster, "request_evidence");
    expect(result.ok ? null : result.result.reason_code).toBe("request_evidence_other_person");
  });
  it("limit (b): a spelling one edit from another roster person's first name is not taken; the refusal asks which", () => {
    const turns = identifiedTurns(history("For Odalys Fenwick") as never, "use Odalys Fenwick", "m3");
    const result = requestTurns(turns, cite, "Odalys Fenwick", [...roster, "Odalie Brandt"], "request_evidence");
    // Changed on purpose (QA's ruling, 16 Nov 2026): near_name_ambiguous with one question, not the director's refusal.
    expect(result.ok ? null : result.result).toMatchObject({ reason_code: "near_name_ambiguous", ask_exactly: "In your message, is Odalis **Odalys Fenwick** or **Odalie Brandt**?" });
  });
  it("a possessive near name (\"Odalis's\") still names the person", () => {
    const possessive = [{ id: "m1", role: "user" as const, content: "Odalis's text to your salon director Juno Paxton on 11/3 was disrespectful.", timestamp: new Date() }, ...history("For Odalys Fenwick").slice(1)];
    const turns = identifiedTurns(possessive as never, "use Odalys Fenwick", "m3");
    expect(requestTurns(turns, [{ message_id: "m1", quote: "text to your salon director" }], "Odalys Fenwick", roster, "request_evidence")).toMatchObject({ ok: true, ids: ["m1"] });
  });
});
