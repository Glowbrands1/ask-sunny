import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { editForm } = await import("./tools");

/*
 * PR 1c + PR 4 part 2 (owner's audit, 15 Nov 2026): a level and a payroll answer are kept only on the model's evidence: the
 * id of a manager message and a real quote from it (evidence.ts), never because some word appears in some earlier turn.
 * level_not_stated / payroll_not_stated come with the evidence check's reason. The propose_form side is replay cases
 * (nov15-agent-loop-pr1c-cases.ts).
 */
const FORM_ID = "11111111-2222-4333-8444-555555555555";
const turn = (id: string, role: "user" | "assistant", content: string) => ({ id, role, content, createdAt: "2026-11-15T00:00:00Z" });
const effects = { proposal: null, formUpdate: null } as never;
function open(question: string, history: ReturnType<typeof turn>[] = []) {
  return {
    actor: { subject: "u-1", email: "m@example.com", displayName: "Manager", role: "salon_director", scope: { level: "salon", locationIds: [] }, verified: true },
    question,
    questionMessageId: "m-now",
    history,
    openFormId: FORM_ID,
  } as never;
}

describe("edit_form's level (level_not_stated)", () => {
  it("no evidence", async () => {
    const result = await editForm(open("make it a written"), effects, { instance_id: FORM_ID, values: { warning_type: "written" } });
    expect(result.reason_code).toBe("level_not_stated");
  });
  it("\"she was written up before\" in an earlier turn does not unlock written", async () => {
    const history = [turn("m-1", "user", "she was written up before"), turn("a-1", "assistant", "Noted."), turn("m-2", "user", "ok thanks"), turn("a-2", "assistant", "Anything else?")];
    const result = await editForm(open("fix the date", history), effects, { instance_id: FORM_ID, values: { warning_type: "written" }, level_evidence: { message_id: "m-1", quote: "she was written up before" } });
    expect(result.reason_code).toBe("level_not_stated");
    expect(result.evidence_reason).toBe("evidence_not_this_turn");
  });
  it("a made-up quote is refused", async () => {
    const result = await editForm(open("fix the date"), effects, { instance_id: FORM_ID, values: { warning_type: "verbal" }, level_evidence: { message_id: "m-now", quote: "make it a verbal" } });
    expect(result.reason_code).toBe("level_not_stated");
    expect(result.evidence_reason).toBe("evidence_quote_not_found");
  });
  it("the app's own reply is not evidence", async () => {
    const history = [turn("a-1", "assistant", "I'll make it a written warning.")];
    const result = await editForm(open("ok", history), effects, { instance_id: FORM_ID, values: { warning_type: "written" }, level_evidence: { message_id: "a-1", quote: "make it a written" } });
    expect(result.reason_code).toBe("level_not_stated");
    expect(result.evidence_reason).toBe("evidence_not_manager_turn");
  });
});

describe("edit_form's payroll (payroll_not_stated)", () => {
  it("no evidence", async () => {
    const result = await editForm(open("yes payroll $15"), effects, { instance_id: FORM_ID, values: { payroll_deduct: "yes" } });
    expect(result.reason_code).toBe("payroll_not_stated");
  });
  it("another message's payroll answer is not this one's", async () => {
    const history = [turn("m-1", "user", "yes payroll for the other one"), turn("a-1", "assistant", "Done.")];
    const result = await editForm(open("now fix her date", history), effects, { instance_id: FORM_ID, values: { payroll_deduct: "yes" }, payroll_evidence: { message_id: "m-1", quote: "yes payroll" } });
    expect(result.reason_code).toBe("payroll_not_stated");
    expect(result.evidence_reason).toBe("evidence_not_this_turn");
  });
});

describe("a real quote from this message passes both checks", () => {
  it("level and payroll together", async () => {
    const result = await editForm(open("make it a written, yes payroll"), effects, {
      instance_id: FORM_ID,
      values: { warning_type: "written", payroll_deduct: "yes" },
      level_evidence: { message_id: "m-now", quote: "make it a written" },
      payroll_evidence: { message_id: "m-now", quote: "Yes Payroll" },
    });
    expect(["level_not_stated", "payroll_not_stated", "not_stated"]).not.toContain(result.reason_code);
  });
});
