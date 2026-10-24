import { extractText, getDocumentProxy } from "unpdf";

import { afterEach, describe, expect, it } from "vitest";

import type { AccessScope } from "@/types";
import { captureFormState, EMPTY_FORM_STATE, prependFormState } from "@/lib/ai/form-state";
import { fieldsFromManagerText } from "@/lib/ai/form-field-state";
import { proposeFormForTurn } from "@/lib/ai/form-proposal";
import { fieldLines } from "@/lib/ai/intake-augment";
import { HR_TEMPLATE_SEEDS, correctiveActionDocument, coachingDocument } from "@/lib/forms/library";
import { renderFormPdf, type RenderMeta } from "@/lib/forms/pdf-render";

import { correctiveActionPlan, planPayrollAmount } from "./ca-action-plan";
import { parseFormDocument } from "./document";
import { fieldsToRestore, retainFilledFields } from "./draft-merge";
import {
  DPOA_DATABASE_REVISION,
  DPOA_UNPUBLISHED_REVISION,
  PAYROLL_AMOUNT_KEY,
  PAYROLL_AMOUNT_LABEL,
  PAYROLL_AMOUNT_QUESTION,
  payrollAmountPrompt,
  withoutPayrollAmountField,
  withholdUnpublishedDpoa,
} from "./payroll-amount-field";
import { PAYROLL_DEDUCT_KEY, payrollAmountFromConversation, payrollDeductAmount, payrollYesAmount } from "./payroll-deduct";

/**
 * Pau approved the Payroll deduction amount line: after the Yes/No, filled
 * only from the manager, blank unless payroll is Yes, asked once, on the PDF.
 */

const FLAG = "PAYROLL_AMOUNT_FIELD_ENABLED";

const LATE_OPENING =
  "The employee will reimburse The Company $25.00 via payroll deduction.";

const META: RenderMeta = {
  templateName: "Corrective Action Form",
  templateVersion: 6,
  employeeName: "Dana Moss",
  formDate: "2026-10-23",
  locationName: null,
  reference: "form-0001",
  status: "draft",
};

const SCOPE: AccessScope = {
  level: "salon",
  primaryAreaId: "loc-0101",
  alsoCoversAreaIds: [],
};

afterEach(() => {
  delete process.env[FLAG];
});

async function readBack(bytes: Uint8Array) {
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

function blockKey(block: ReturnType<typeof parseFormDocument>["blocks"][number]): string {
  if (block.kind === "field") return block.field.key;
  if (block.kind === "checkbox_group") return block.key;
  return block.kind;
}

describe("Payroll deduction amount", () => {
  it("is on the seed and its PDF, and a revision 6 document stays without it when the flag is off", async () => {
    const raw = correctiveActionDocument();
    expect(raw.blocks.map(blockKey)).toContain(PAYROLL_AMOUNT_KEY);
    const document = parseFormDocument(raw);
    expect(document.blocks.map(blockKey)).toContain(PAYROLL_AMOUNT_KEY);
    const text = await readBack(
      renderFormPdf(document, null, { values: { employee_name: "Dana Moss", [PAYROLL_AMOUNT_KEY]: "$40" }, checked: {} }, META),
    );
    expect(text).toContain(PAYROLL_AMOUNT_LABEL);
    expect(text).toContain("$40");

    const revision6 = parseFormDocument(withoutPayrollAmountField(raw));
    expect(revision6.blocks.map(blockKey)).not.toContain(PAYROLL_AMOUNT_KEY);
    const older = await readBack(
      renderFormPdf(revision6, null, { values: { employee_name: "Dana Moss" }, checked: {} }, META),
    );
    expect(older).toContain("Is payroll deduct applicable?");
    expect(older).not.toContain(PAYROLL_AMOUNT_LABEL);
  });

  it("places Payroll deduction amount immediately after Is payroll deduct applicable?", () => {
    process.env[FLAG] = "1";
    expect(PAYROLL_DEDUCT_KEY).toBe("payroll_deduct");
    const document = parseFormDocument(correctiveActionDocument());
    const keys = document.blocks.map(blockKey);
    const yesNo = keys.indexOf(PAYROLL_DEDUCT_KEY);
    expect(keys[yesNo + 1]).toBe(PAYROLL_AMOUNT_KEY);
    const line = document.blocks[yesNo + 1];
    expect(line).toMatchObject({
      kind: "field",
      field: {
        key: PAYROLL_AMOUNT_KEY,
        label: PAYROLL_AMOUNT_LABEL,
        responsibility: "manager",
        input: "text",
      },
    });
    expect(line?.kind === "field" ? line.field.policyGrounded : true).toBeUndefined();
    const again = parseFormDocument(document);
    expect(again.blocks.filter((block) => block.kind === "field" && block.field.key === PAYROLL_AMOUNT_KEY)).toHaveLength(1);
    const coaching = parseFormDocument(coachingDocument());
    expect(coaching.blocks.map(blockKey)).not.toContain(PAYROLL_AMOUNT_KEY);
  });

  it('fills only from the manager: "payroll deduct yes $25", never the Late Opening $25.00', () => {
    expect(payrollYesAmount("payroll deduct yes $25")).toBe("$25");
    expect(payrollYesAmount(LATE_OPENING)).toBeNull();
    const policyAndYes = `payroll deduct yes. ${LATE_OPENING}`;
    expect(
      payrollAmountFromConversation([{ role: "user", content: policyAndYes }], { payrollAnswer: "yes" }),
    ).toBeNull();
    expect(
      payrollAmountFromConversation([{ role: "user", content: "payroll deduct yes $25" }], { payrollAnswer: "yes" }),
    ).toBe("$25");
    expect(
      payrollAmountFromConversation(
        [{ role: "user", content: "she owes $25, payroll deduction applies" }],
        { payrollAnswer: "yes" },
      ),
    ).toBeNull();
    expect(
      payrollAmountFromConversation(
        [{ role: "user", content: "register short $25. payroll deduct applies" }],
        { payrollAnswer: "yes" },
      ),
    ).toBeNull();
    expect(
      payrollAmountFromConversation([{ role: "user", content: "payroll deduct yes $25" }], { payrollAnswer: "no" }),
    ).toBeNull();
    expect(
      payrollAmountFromConversation([{ role: "user", content: "payroll deduct yes $25" }], { payrollAnswer: null }),
    ).toBeNull();
    expect(
      payrollAmountFromConversation(
        [
          { role: "assistant", content: PAYROLL_AMOUNT_QUESTION },
          { role: "user", content: "$25" },
        ],
        { payrollAnswer: "yes" },
      ),
    ).toBe("$25");
    expect(
      payrollAmountFromConversation([{ role: "user", content: "$25" }], { payrollAnswer: "yes" }),
    ).toBeNull();
  });

  it("prints Payroll deduction amount on the PDF, with the figure the manager gave", async () => {
    process.env[FLAG] = "1";
    const document = parseFormDocument(correctiveActionDocument());
    const text = await readBack(
      renderFormPdf(
        document,
        null,
        {
          values: { employee_name: "Dana Moss", [PAYROLL_AMOUNT_KEY]: "$25" },
          checked: { payroll_deduct: ["yes"] },
        },
        META,
      ),
    );
    const question = text.indexOf("Is payroll deduct applicable?");
    const amount = text.indexOf(PAYROLL_AMOUNT_LABEL);
    expect(question).toBeGreaterThanOrEqual(0);
    expect(amount).toBeGreaterThan(question);
    expect(text).toContain("$25");
  });
});

describe("the chat asks for Payroll deduction amount once, and does not hold the card", () => {
  const library = HR_TEMPLATE_SEEDS.filter((seed) => seed.key === "coaching" || seed.key === "dpoa").map((seed) => ({
    id: `tpl-${seed.key}`,
    key: seed.key,
    name: seed.name,
    shortName: seed.shortName,
    description: seed.description,
    category: seed.category,
    layoutFamily: seed.layoutFamily,
    requiredPermission: seed.requiredPermission,
    active: true,
    displayOrder: seed.displayOrder,
    currentVersion: {
      id: `v-${seed.key}`,
      status: "published" as const,
      document: seed.document,
      variants: seed.variants,
    },
    draftVersion: null,
    versionCount: 1,
    activeAsset: null,
    assetCount: 0,
  }));

  function ask(question: string, history: { id: string; role: "user" | "assistant"; content: string }[] = []) {
    return proposeFormForTurn({
      history,
      question,
      questionMessageId: "msg-current",
      actor: { role: "salon_director", scope: SCOPE },
      summaries: library as never,
      today: "2026-10-23",
    });
  }

  it("asks once when payroll is Yes and the manager has not given a figure", async () => {
    process.env[FLAG] = "1";
    const first = await ask(
      "Create a corrective action for Sarah Test. She was late today. payroll deduct yes",
    );
    expect(first?.formProposal).toBeTruthy();
    expect(first?.formProposal?.payrollDeduct).toBe("yes");
    expect(first?.formProposal?.payrollDeductAmount ?? null).toBeNull();
    expect(first?.content).toContain(PAYROLL_AMOUNT_QUESTION);
    expect(first?.content).not.toMatch(/I cannot create this form|I still need/i);

    const second = await ask(
      "Create a corrective action for Sarah Test. She was late today. payroll deduct yes",
      [{ id: "a1", role: "assistant", content: first!.content }],
    );
    expect(second?.formProposal).toBeTruthy();
    expect(second?.content).not.toContain(PAYROLL_AMOUNT_QUESTION);
  });

  it('reads back $25 from "payroll deduct yes $25" and does not take $25.00 from the policy', async () => {
    process.env[FLAG] = "1";
    const stated = await ask(
      "Create a corrective action for Sarah Test. She was late today. payroll deduct yes $25",
    );
    expect(stated?.formProposal?.payrollDeductAmount).toBe("$25");
    expect(stated?.content).toContain(`**${PAYROLL_AMOUNT_LABEL}** **$25**`);
    expect(stated?.content).not.toContain(PAYROLL_AMOUNT_QUESTION);

    const quoted = await ask(
      `Create a corrective action for Sarah Test. She opened late today. payroll deduct yes. ${LATE_OPENING}`,
    );
    expect(quoted?.formProposal).toBeTruthy();
    expect(quoted?.formProposal?.payrollDeductAmount ?? null).toBeNull();
    expect(quoted?.content).toContain(PAYROLL_AMOUNT_QUESTION);
  });

  it("does not ask when payroll is No, or when the flag is off", async () => {
    process.env[FLAG] = "1";
    const no = await ask(
      "Create a corrective action for Sarah Test. She was late today. payroll deduct no",
    );
    expect(no?.formProposal).toBeTruthy();
    expect(no?.content).not.toContain(PAYROLL_AMOUNT_QUESTION);
    expect(no?.formProposal?.payrollDeductAmount ?? null).toBeNull();

    delete process.env[FLAG];
    const off = await ask(
      "Create a corrective action for Sarah Test. She was late today. payroll deduct yes",
    );
    expect(off?.formProposal).toBeTruthy();
    expect(off?.content).not.toContain(PAYROLL_AMOUNT_LABEL);
    expect(off?.content).not.toContain(PAYROLL_AMOUNT_QUESTION);
    expect(off?.formProposal?.payrollDeductAmount).toBeUndefined();
  });
});

describe("the amount field is wired, and revision 7 is not published", () => {
  const POLICY = "The employee will reimburse The Company $25.00 via payroll deduction.";

  it("the seed is revision 7 and the database write stays revision 6 without the line", () => {
    const seed = HR_TEMPLATE_SEEDS.find((entry) => entry.key === "dpoa")!;
    expect(seed.revision).toBe(DPOA_UNPUBLISHED_REVISION);
    const keys = seed.document.blocks.map(blockKey);
    expect(keys[keys.indexOf(PAYROLL_DEDUCT_KEY) + 1]).toBe(PAYROLL_AMOUNT_KEY);
    const written = withholdUnpublishedDpoa(seed);
    expect(written.revision).toBe(DPOA_DATABASE_REVISION);
    expect(written.document.blocks.map(blockKey)).not.toContain(PAYROLL_AMOUNT_KEY);
  });

  it("fills a stated amount and does not take $25 from the policy", () => {
    process.env[FLAG] = "1";
    expect(fieldsFromManagerText("payroll deduct yes $40", "2026-10-24").payrollAmount).toBe("$40");
    expect(fieldsFromManagerText(`${POLICY} payroll deduct yes`, "2026-10-24").payrollAmount).toBeNull();
    expect(payrollDeductAmount(POLICY)).toBeNull();
    expect(
      fieldLines("create the form", "2026-10-24", "payroll deduct yes $40"),
    ).toContain("Payroll deduction amount: $40.");
    expect(fieldLines("create the form", "2026-10-24", POLICY).join("\n")).not.toContain("$25");
  });

  it("asks once when the amount is missing", () => {
    process.env[FLAG] = "1";
    expect(
      payrollAmountPrompt({ payroll: "yes", amount: null, alreadyAsked: false, onForm: true }),
    ).toBe(PAYROLL_AMOUNT_QUESTION);
    expect(
      payrollAmountPrompt({ payroll: "yes", amount: null, alreadyAsked: true, onForm: true }),
    ).toBeNull();
    expect(
      payrollAmountPrompt({ payroll: "yes", amount: "$40", alreadyAsked: false, onForm: true }),
    ).toBeNull();
  });

  it("is never written into the action plan, including Late Opening's $25", () => {
    process.env[FLAG] = "1";
    const payroll = planPayrollAmount({
      answer: "yes",
      stated: "$40",
      quotedPolicy: POLICY,
    });
    expect(payroll).toEqual({ amount: null });
    const plan = correctiveActionPlan({
      citedPolicies: ["Late Opening"],
      employeeName: "Dana Moss",
      payroll: { answer: "yes", ...payroll },
    });
    expect(plan).not.toContain("$40");
    expect(plan).not.toContain("$25");
    expect(plan).not.toContain("will be deducted");
  });

  it("survives a redraft in chat_form_state and in the draft merge", () => {
    process.env[FLAG] = "1";
    const proposal = {
      proposalId: "p",
      templateKey: "dpoa",
      templateName: "Corrective Action Form",
      supportsInlineDraft: false,
      variantKey: null,
      employeeName: "Dana Moss",
      employeeRole: null,
      formDate: null,
      locationId: null,
      locationName: null,
      locationResolution: "needs_selection" as const,
      authorizedLocationIds: [],
      status: "ready" as const,
      sourceMessageIds: [],
      payrollDeduct: "yes" as const,
      payrollDeductAmount: "$40",
    };
    const kept = captureFormState(EMPTY_FORM_STATE, {
      proposal,
      employeeId: null,
      keptTypedName: null,
      userText: "redraft it",
      policyHeading: null,
      policyPage: null,
    });
    const again = captureFormState(kept, {
      proposal: { ...proposal, payrollDeductAmount: undefined },
      employeeId: null,
      keptTypedName: null,
      userText: "redraft it cleaner",
      policyHeading: null,
      policyPage: null,
    });
    expect(again.payrollDeductAmount).toBe("$40");
    expect(prependFormState("redraft it", again)).toContain("Payroll deduction amount: $40.");
    expect(payrollDeductAmount("Payroll deduction amount: $40.")).toBeNull();

    const existing = [{ fieldKey: PAYROLL_AMOUNT_KEY, value: "$40", checked: [] }];
    expect(
      retainFilledFields({
        question: "redraft it",
        existing,
        values: { [PAYROLL_AMOUNT_KEY]: "" },
        checked: {},
      }).values,
    ).not.toHaveProperty(PAYROLL_AMOUNT_KEY);
    expect(
      fieldsToRestore({
        question: "redraft it",
        before: existing,
        after: [{ fieldKey: PAYROLL_AMOUNT_KEY, value: "", checked: [] }],
      }).values[PAYROLL_AMOUNT_KEY],
    ).toBe("$40");
  });
});
