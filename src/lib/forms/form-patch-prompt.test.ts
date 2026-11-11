import { describe, expect, it } from "vitest";

import { buildFormPatchUserMessage, FORM_PATCH_SYSTEM_PROMPT, type FormPatchInput } from "./form-patch-prompt";

/** The approved system text (STEP_B_PROPOSAL section (b)), inlined so a change to the prompt is a change to this test. */
const APPROVED = [
    "You update one open HR form from the manager's latest message. Return the patch only; do not answer the manager.",
    "turn: \"this_form\" when the latest message gives content for this form, asks to change it, or accepts text the assistant offered for it (\"make that update\", \"yes, do that\"); \"question\" when it asks something and gives nothing for the form; \"other\" when it is about another person, another form, or copying another form.",
    "set: one entry per field the latest message changes. value is the text for a text field; options are option keys for a checkbox field. how \"add\" keeps what the field says and adds to it; \"replace\" only when the manager asked for that field's text to be replaced. evidence: the words the value came from, copied exactly — from the manager's messages, or from the assistant's last reply only when the latest message accepts it.",
    "Write dates, payroll deductions and amounts exactly as the manager gave them. A date field takes YYYY-MM-DD and only a date the manager stated. Never invent a date, amount, name, policy or detail; leave out a field the manager gave nothing for.",
    "clear: only fields the manager asked to have removed, with their words as evidence. Never change a field marked \"manager\" unless the latest message asks to change that field.",
].join("\n");

describe("the form-patch prompt", () => {
  it("is the approved system text, character for character", () => {
    expect(FORM_PATCH_SYSTEM_PROMPT).toBe(APPROVED);
  });

  const input: FormPatchInput = {
    today: "2026-11-03",
    templateName: "Corrective Action",
    employeeName: "Rowan Tessaly",
    fields: [
      { key: "observation", label: "Observation", kind: "long text", filledBy: "manager", value: "Drawer short at close.\nCounted twice." },
      { key: "incident_date", label: "Date", kind: "date", filledBy: "empty", value: "" },
      { key: "level", label: "Level", kind: "checkbox", filledBy: "assistant", value: ["written"], options: ["verbal", "written"], single: true },
    ],
    readOnly: [{ label: "Policy", value: "Cash Handling" }],
    turns: Array.from({ length: 14 }, (_, at) => ({ role: at % 2 === 0 ? ("manager" as const) : ("assistant" as const), content: `turn ${at + 1}` })),
    latest: "  make that update ",
  };

  it("builds the user message in the approved shape", () => {
    expect(buildFormPatchUserMessage(input)).toBe(
      [
        "Today is 2026-11-03.",
        "FORM: Corrective Action",
        "EMPLOYEE: Rowan Tessaly",
        "FIELDS YOU MAY SET (key | label | kind | filled by | current value):",
        "observation | Observation | long text | manager | Drawer short at close. / Counted twice.",
        "incident_date | Date | date | empty | (empty)",
        "level | Level | checkbox (one of: verbal, written) | assistant | written",
        "READ-ONLY (shown for context):",
        "Policy: Cash Handling",
        "CONVERSATION (oldest first, last 12 turns):",
        ...Array.from({ length: 12 }, (_, at) => `${(at + 2) % 2 === 0 ? "MANAGER" : "ASSISTANT"}: turn ${at + 3}`),
        "LATEST MESSAGE FROM THE MANAGER: make that update",
      ].join("\n"),
    );
  });

  it("names the whole team when there is no employee, and marks empty sections", () => {
    const message = buildFormPatchUserMessage({ ...input, employeeName: null, fields: [], readOnly: [], turns: [] });
    expect(message).toContain("EMPLOYEE: the whole team");
    expect(message).toContain("current value):\n(none)\nREAD-ONLY");
    expect(message).toContain("12 turns):\n(none)\nLATEST");
  });
});
