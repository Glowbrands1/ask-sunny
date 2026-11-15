import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { findPastForms, readForm, openForm, editForm } = await import("./tools");

/*
 * PR 1b of the loop rebuild (owner's audit, 15 Nov 2026): no word list reads the manager's message. A form on file is
 * looked at only on `forms_on_file_evidence` (a manager message id and a real quote from it), and the form open on screen
 * needs none; a level and a payroll answer are kept only on level_evidence / payroll_evidence. Code checks the quote is in
 * the turn; the model reads what it means. (The level and payroll gates through propose_form are replay cases:
 * nov15-agent-loop-pr1b-evidence-cases.ts.)
 */
const FORM_ID = "11111111-2222-4333-8444-555555555555";
const OTHER_ID = "66666666-7777-4888-9999-000000000000";
const turn = (id: string, role: "user" | "assistant", content: string) => ({ id, role, content, createdAt: "2026-11-15T00:00:00Z" });

function context(question: string, history = [] as ReturnType<typeof turn>[], openFormId: string | null = null) {
  return {
    actor: { subject: "u-1", email: "m@example.com", displayName: "Manager", role: "salon_director", scope: { level: "salon", locationIds: [] }, verified: true },
    question,
    questionMessageId: "m-now",
    history,
    openFormId,
  } as never;
}
const effects = { proposal: null, formUpdate: null } as never;
const HISTORY = [turn("m-1", "user", "what is on file for Wren Alder"), turn("a-1", "assistant", "Nothing is on file for Wren Alder."), turn("m-2", "user", "ok thanks")];

describe("find_past_forms needs real evidence that the manager asked", () => {
  it("none → privacy_not_asked", async () => {
    const result = await findPastForms(context("what's on file for Wren Alder"), { employee_name: "Wren Alder" });
    expect(result.reason_code).toBe("privacy_not_asked");
    expect(result.evidence_reason).toBe("evidence_not_manager_turn");
  });
  it("a made-up quote is refused", async () => {
    const result = await findPastForms(context("hi"), { employee_name: "Wren Alder", forms_on_file_evidence: { message_id: "m-now", quote: "show me everything on file for Wren" } });
    expect(result.reason_code).toBe("privacy_not_asked");
    expect(result.evidence_reason).toBe("evidence_quote_not_found");
  });
  it("the app's own reply is not the manager's turn", async () => {
    const result = await findPastForms(context("ok"), { employee_name: "Wren Alder", forms_on_file_evidence: { message_id: "a-1", quote: "Nothing is on file" } }, );
    expect(result.reason_code).toBe("privacy_not_asked");
    expect(result.evidence_reason).toBe("evidence_not_manager_turn");
  });
  it("an old turn (before the previous manager message) does not count", async () => {
    const history = [turn("m-0", "user", "what is on file for Wren Alder"), turn("a-0", "assistant", "Two forms."), ...HISTORY];
    const result = await findPastForms(context("what is the break policy", history), { employee_name: "Wren Alder", forms_on_file_evidence: { message_id: "m-0", quote: "what is on file for Wren Alder" } });
    expect(result.reason_code).toBe("privacy_not_asked");
    expect(result.evidence_reason).toBe("evidence_not_this_turn");
  });
  it("a real quote from this message, or the manager message before it, passes the gate", async () => {
    for (const evidence of [
      { message_id: "m-now", quote: "WHAT'S on file for wren alder" },
      { message_id: "m-2", quote: "ok thanks" },
    ]) {
      const result = await findPastForms(context("what's on file for Wren Alder", HISTORY), { employee_name: "Wren Alder", forms_on_file_evidence: evidence });
      expect(result.reason_code, JSON.stringify(result)).not.toBe("privacy_not_asked");
    }
  });
});

describe("read_form, open_form and edit_form of a form that is not open on screen", () => {
  it.each([
    ["read_form", () => readForm(context("hello"), { instance_id: FORM_ID })],
    ["open_form", () => openForm(context("hello"), effects, { instance_id: FORM_ID })],
    ["edit_form", () => editForm(context("make it a verbal"), effects, { instance_id: FORM_ID, values: { warning_type: "verbal" } })],
  ])("%s without evidence is privacy_not_asked", async (_name, call) => {
    const result = await call();
    expect(result.reason_code).toBe("privacy_not_asked");
  });
  it.each([
    ["read_form", () => readForm(context("hello", [], FORM_ID), { instance_id: FORM_ID })],
    ["edit_form", () => editForm(context("make it a verbal", [], FORM_ID), effects, { instance_id: FORM_ID, values: { warning_type: "verbal" } })],
  ])("%s of the form open on screen needs none", async (_name, call) => {
    const result = await call();
    expect(result.reason_code).not.toBe("privacy_not_asked");
  });
  it("evidence for a form on file opens the gate, for any form id", async () => {
    const result = await readForm(context("pull up wren's CA", [], null), { instance_id: OTHER_ID, forms_on_file_evidence: { message_id: "m-now", quote: "pull up wren's CA" } });
    expect(result.reason_code).not.toBe("privacy_not_asked");
  });
});

describe("edit_form's level and payroll need evidence from THIS message (level_not_stated, payroll_not_stated)", () => {
  const open = (question: string, history = HISTORY) => context(question, history, FORM_ID);
  it("a level with no evidence is level_not_stated", async () => {
    const result = await editForm(open("make it a written"), effects, { instance_id: FORM_ID, values: { warning_type: "written" } });
    expect(result.reason_code).toBe("level_not_stated");
  });
  it("\"she was written up before\" in an earlier turn does not unlock written", async () => {
    const history = [turn("m-1", "user", "she was written up before"), turn("a-1", "assistant", "Noted."), turn("m-2", "user", "ok thanks")];
    const result = await editForm(open("fix the date", history), effects, { instance_id: FORM_ID, values: { warning_type: "written" }, level_evidence: { message_id: "m-1", quote: "she was written up before" } });
    expect(result.reason_code).toBe("level_not_stated");
    expect(result.evidence_reason).toBe("evidence_not_this_turn");
  });
  it("a made-up quote is level_not_stated", async () => {
    const result = await editForm(open("fix the date"), effects, { instance_id: FORM_ID, values: { warning_type: "verbal" }, level_evidence: { message_id: "m-now", quote: "make it a verbal" } });
    expect(result.reason_code).toBe("level_not_stated");
    expect(result.evidence_reason).toBe("evidence_quote_not_found");
  });
  it("payroll with no evidence is payroll_not_stated", async () => {
    const result = await editForm(open("yes payroll $15"), effects, { instance_id: FORM_ID, values: { payroll_deduct: "yes" } });
    expect(result.reason_code).toBe("payroll_not_stated");
  });
  it("a real quote from this message passes both checks", async () => {
    const result = await editForm(open("make it a written, yes payroll"), effects, {
      instance_id: FORM_ID,
      values: { warning_type: "written", payroll_deduct: "yes" },
      level_evidence: { message_id: "m-now", quote: "make it a written" },
      payroll_evidence: { message_id: "m-now", quote: "yes payroll" },
    });
    expect(["level_not_stated", "payroll_not_stated", "not_stated"]).not.toContain(result.reason_code);
  });
});
