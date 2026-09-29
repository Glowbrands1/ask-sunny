import { describe, expect, it } from "vitest";

import { parseFormDocument, checkboxGroupsForVariant } from "./document";
import { selectStatedFacts } from "./employment-change";
import { TEMPLATE_SEEDS } from "./library";
import {
  PAYROLL_DEDUCT_KEY,
  PAYROLL_DEDUCT_LABEL,
  PAYROLL_DEDUCT_STATED_KEYS,
  payrollDeductChecked,
  payrollDeductCorrection,
  payrollDeductFromConversation,
  statedPayrollDeduct,
} from "./payroll-deduct";
import { enforcePersonEdit, enforceResponsibilities } from "./responsibility";

/**
 * "Is payroll deduct applicable?" — Operations' addition to the Corrective
 * Action Form (29 September 2026). The answer is the manager's; nothing here
 * may invent one, and an unanswered question must stay unanswered.
 */

const corrective = TEMPLATE_SEEDS.find((seed) => seed.key === "dpoa")!;
const document = parseFormDocument(corrective.document);

describe("the template", () => {
  it("asks the question in Maddie's words, as a Yes / No", () => {
    const group = checkboxGroupsForVariant(document, null).find((entry) => entry.key === PAYROLL_DEDUCT_KEY);
    expect(group).toEqual({
      key: "payroll_deduct",
      label: "Is payroll deduct applicable?",
      options: [
        { key: "yes", label: "Yes" },
        { key: "no", label: "No" },
      ],
      responsibility: "manager",
      single: true,
    });
    expect(PAYROLL_DEDUCT_LABEL).toBe("Is payroll deduct applicable?");
  });

  it("is on the Corrective Action Form only — no other template gained it", () => {
    for (const seed of TEMPLATE_SEEDS) {
      const keys = checkboxGroupsForVariant(parseFormDocument(seed.document), seed.variants[0]?.key ?? null).map(
        (group) => group.key,
      );
      expect(keys.includes(PAYROLL_DEDUCT_KEY), seed.key).toBe(seed.key === "dpoa");
    }
  });

  it("survives the document parser — the stored version keeps `single`", () => {
    const reparsed = parseFormDocument(JSON.parse(JSON.stringify(corrective.document)));
    const block = reparsed.blocks.find(
      (entry) => entry.kind === "checkbox_group" && entry.key === PAYROLL_DEDUCT_KEY,
    );
    expect(block).toMatchObject({ kind: "checkbox_group", single: true, responsibility: "manager" });
  });

  it("leaves every other checkbox group multi-select, as it was", () => {
    for (const seed of TEMPLATE_SEEDS) {
      for (const group of checkboxGroupsForVariant(parseFormDocument(seed.document), seed.variants[0]?.key ?? null)) {
        if (group.key === PAYROLL_DEDUCT_KEY) continue;
        expect(group.single, `${seed.key}.${group.key}`).toBeUndefined();
      }
    }
  });
});

describe("what the manager may store", () => {
  it("accepts one answer", () => {
    for (const answer of ["yes", "no"]) {
      const result = enforcePersonEdit(document, null, { checked: { payroll_deduct: [answer] } });
      expect(result.checked).toEqual({ payroll_deduct: [answer] });
      expect(result.rejected).toEqual([]);
    }
  });

  it("refuses both boxes at once rather than choosing one", () => {
    const result = enforcePersonEdit(document, null, { checked: { payroll_deduct: ["yes", "no"] } });
    expect(result.checked).toEqual({});
    expect(result.rejected).toEqual([{ key: "payroll_deduct", reason: "only one answer can be ticked" }]);
  });

  it("clears back to unanswered", () => {
    const result = enforcePersonEdit(document, null, { checked: { payroll_deduct: [] } });
    expect(result.checked).toEqual({ payroll_deduct: [] });
  });

  it("is never the model's to tick", () => {
    const result = enforceResponsibilities(document, null, { checked: { payroll_deduct: ["no"] } });
    expect(result.checked).toEqual({});
    expect(result.rejected.map((entry) => entry.key)).toContain("payroll_deduct");
  });

  it("is written from a statement only into an unanswered question, and only this key", () => {
    const stated = { values: { employee_name: "Somebody Else" }, checked: payrollDeductChecked("yes") };
    expect(
      selectStatedFacts({ document, variantKey: null, stated, existing: [], keys: PAYROLL_DEDUCT_STATED_KEYS }),
    ).toEqual({ values: {}, checked: { payroll_deduct: ["yes"] } });

    // Already answered on the form: a statement does not overwrite it.
    expect(
      selectStatedFacts({
        document,
        variantKey: null,
        stated,
        existing: [{ fieldKey: "payroll_deduct", value: null, checked: ["no"] }],
        keys: PAYROLL_DEDUCT_STATED_KEYS,
      }),
    ).toEqual({ values: {}, checked: {} });
  });

  it("stores nothing at all for an unanswered question", () => {
    expect(payrollDeductChecked(null)).toEqual({});
    expect(payrollDeductChecked(undefined)).toEqual({});
  });
});

describe("a stated answer", () => {
  it.each([
    ["no payroll deduction", "no"],
    ["No payroll deduct", "no"],
    ["no deduction", "no"],
    ["no to payroll deduction", "no"],
    ["payroll deduct is not applicable", "no"],
    ["payroll deduction doesn't apply", "no"],
    ["payroll deduct: no", "no"],
    ["payroll deduct n/a", "no"],
    ["Is payroll deduct applicable? No", "no"],
    ["we won't deduct anything from her pay", "no"],
    ["yes payroll deduct applies", "yes"],
    ["Yes, payroll deduction", "yes"],
    ["payroll deduction applies", "yes"],
    ["payroll deduct is applicable", "yes"],
    ["payroll deduct: yes", "yes"],
    ["Is payroll deduct applicable? yes", "yes"],
    ["deduct the $40 shortage from her paycheck", "yes"],
    ["the shortage will be deducted", "yes"],
    ["payroll-deduct applies", "yes"],
  ])("%s -> %s", (text, expected) => {
    expect(statedPayrollDeduct(text)).toBe(expected);
  });

  it.each([
    "yes",
    "no",
    "is payroll deduct applicable?",
    "should we deduct it?",
    "she was late again today",
    "first time, verbal warning",
    "no prior corrective action",
    "Sarah Test",
  ])("%s states nothing", (text) => {
    expect(statedPayrollDeduct(text)).toBeNull();
  });

  it("takes the last thing said when the manager changes their mind", () => {
    expect(statedPayrollDeduct("payroll deduction applies. actually no, no deduction")).toBe("no");
    expect(statedPayrollDeduct("no payroll deduction. Wait — yes payroll deduct applies")).toBe("yes");
  });
});

describe("the answer across the conversation", () => {
  const user = (content: string) => ({ role: "user", content });
  const sunny = (content: string) => ({ role: "assistant", content });

  it("reads a bare reply to the payroll question", () => {
    expect(
      payrollDeductFromConversation([
        user("CA for Dana Moss, she was 30 minutes late today, verbal warning, first time"),
        sunny("I'll draft a Corrective Action Form for Dana Moss.\n\nOne more question: **Is payroll deduct applicable?** Yes or No?"),
        user("no"),
      ]),
    ).toBe("no");
    expect(
      payrollDeductFromConversation([
        user("CA for Dana Moss"),
        sunny("One more question: **Is payroll deduct applicable?** Yes or No?"),
        user("Yes."),
      ]),
    ).toBe("yes");
  });

  it("reads the numbered line that answers the payroll item, wherever it is numbered", () => {
    const intake = [
      "Great, I can help you create a **Corrective Action Form**. To get started, please provide me with these details:",
      "",
      "1. Employee's full name",
      "2. Date for the form",
      "3. What happened",
      "4. Whether this is a verbal or written warning",
      "5. Whether the employee has previously received corrective action for this same issue, and if yes, when",
      "6. Is payroll deduct applicable? (Yes or No)",
      "7. The employee's job title (e.g. TC, ASD, SD) if you have it",
    ].join("\n");
    const reply = ["1. Dana Moss", "2. today", "3. late 30 minutes", "4. verbal", "5. no", "6. yes", "7. TC"].join("\n");
    expect(payrollDeductFromConversation([user("CA"), sunny(intake), user(reply)])).toBe("yes");

    // Item 5 is a "no" too — it is the prior-action answer and must not be read.
    const skipped = ["1. Dana Moss", "2. today", "3. late", "4. verbal", "5. no"].join("\n");
    expect(payrollDeductFromConversation([user("CA"), sunny(intake), user(skipped)])).toBeNull();
  });

  it("does not read a bare \"no\" that could be answering several questions", () => {
    const intake = "1. Employee's full name\n2. Whether they have previous corrective action\n3. Is payroll deduct applicable? (Yes or No)";
    expect(payrollDeductFromConversation([user("CA"), sunny(intake), user("no")])).toBeNull();
  });

  it("does not read a bare reply to some other question", () => {
    expect(
      payrollDeductFromConversation([
        user("CA for Dana"),
        sunny("Who is this Corrective Action Form for?"),
        user("no"),
      ]),
    ).toBeNull();
  });

  it("never lets an assistant turn answer", () => {
    expect(
      payrollDeductFromConversation([user("CA for Dana"), sunny("Is payroll deduct applicable? No payroll deduction.")]),
    ).toBeNull();
  });

  it("takes the latest answer, so a correction before creation wins", () => {
    expect(
      payrollDeductFromConversation([
        user("CA for Dana Moss, no payroll deduction"),
        sunny("Is payroll deduct applicable? **No** — tell me if that should change."),
        user("actually yes payroll deduct applies"),
      ]),
    ).toBe("yes");
  });

  it("does not carry an answer from an earlier form request in the same conversation", () => {
    expect(
      payrollDeductFromConversation([
        user("CA for Sarah Test, she was short at the register, yes payroll deduct applies"),
        sunny("I'll draft a Corrective Action Form for Sarah Test."),
        user("coaching form for Jane Doe, dress code"),
        sunny("Here is what I would put on a Coaching Form."),
        user("CA for Dana Moss, late today"),
      ]),
    ).toBeNull();
  });

  it("is null when the question was never answered — never a default", () => {
    expect(payrollDeductFromConversation([user("CA for Dana Moss, she was late today")])).toBeNull();
    expect(payrollDeductFromConversation([])).toBeNull();
  });
});

describe("a correction after the form exists", () => {
  it.each([
    ["change payroll deduct to yes", "yes"],
    ["set payroll deduction to no", "no"],
    ["mark payroll deduct as yes", "yes"],
    ["actually, no payroll deduction", "no"],
    ["payroll deduct applies", "yes"],
  ])("%s -> %s", (text, expected) => {
    expect(payrollDeductCorrection(text)).toBe(expected);
  });

  it.each(["no", "yes", "is payroll deduct applicable?", "change her new location to salon 24"])(
    "%s is not a payroll correction",
    (text) => {
      expect(payrollDeductCorrection(text)).toBeNull();
    },
  );
});
