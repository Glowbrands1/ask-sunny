import { afterEach, describe, expect, it } from "vitest";

import { formFullRemapEnabled } from "@/lib/config/chat-quality-flags";
import { CLAUDE_HAIKU_MODEL } from "@/lib/config/models";
import { HR_TEMPLATE_SEEDS } from "@/lib/forms/library";
import { extractFormRemap } from "@/lib/forms/form-full-remap";
import type { AccessScope, ChatFormProposal, ChatMessage } from "@/types";

import { __setAnthropicClient } from "./anthropic";
import { chatTraceDraft, runChatTrace, type ChatTraceDraft } from "./chat-trace-store";
import { remapFormResponse } from "./form-full-remap";
import { deliverFormProposal } from "./grounded-turn";
import type { AskRequest, AskResponse } from "./types";

/**
 * Tonight's form failures, read as one map of what the manager said.
 *
 * conv_mvmhcy3r2iyyoci pasted a write-up as a Written Warning.
 * conv_mvmgbx8i28ku3en cut a job title off at "It happened", asked which
 * of 9/1 and 9/28 to use, and left coaching and payroll unset.
 * conv_mvmft3ux2rs9hqv offered Lawrence and a cash drawer as people.
 */

const TODAY = "2026-10-24";
const WRITE_UP = "write up Test Employee for cell phone use";
const CASH_DRAWER = "Create a corrective action for Test Employee at Lawrence. Cash drawer was $40 short.";
const TITLE_SENTENCE = "Job title: tan consultant. It happened at KS Manhattan.";
const POLICY = [
  "When an employee assigned to open a location is unable to open the location at the proper",
  "time, the employee must notify the manager as soon as possible. The manager of the salon will",
  "be required to open the salon and work until the person originally assigned arrives, or a",
  "replacement is found. The employee who failed to open will then be required to reimburse The",
  "Company $25.00 via payroll deduction (when applicable and following all state and local",
  "guidelines), for all expenses incurred. Managers or District Managers will be responsible for",
  "offering restitution to affected clients, as well as giving the payroll deduct total to Payroll. *",
].join("\n");
const S9 = [
  "create a CA form for ima employee, tan consultant at manhattan, for opening salon late on 9-28-26",
  "this should be a written and note a verbal ca was given on 9-1-26",
  POLICY,
  "Create a form from this conversation.",
  "ima is a tanning consultant not a district manager. the policy violated is late opening, not attendance",
];

const ONE: AccessScope = { level: "salon", primaryAreaId: "loc-0310", alsoCoversAreaIds: [] };
const LIBRARY = HR_TEMPLATE_SEEDS.filter((seed) => seed.key === "dpoa").map((seed) => ({
  id: "tpl-dpoa",
  key: seed.key,
  name: seed.name,
  shortName: seed.shortName,
  description: seed.description,
  category: seed.category,
  layoutFamily: seed.layoutFamily,
  requiredPermission: seed.requiredPermission,
  active: true,
  displayOrder: seed.displayOrder,
  currentVersion: { id: "v-dpoa", status: "published", document: seed.document, variants: seed.variants },
  draftVersion: null,
  versionCount: 1,
  activeAsset: null,
  assetCount: 0,
}));

function proposal(partial: Partial<ChatFormProposal> = {}): ChatFormProposal {
  return {
    proposalId: "prop-1",
    templateKey: "dpoa",
    templateName: "Corrective Action Form",
    supportsInlineDraft: true,
    variantKey: null,
    employeeName: "Test",
    employeeRole: "tan consultant. It happened",
    formDate: "2026-10-24",
    payrollDeduct: null,
    warningLevel: "written",
    locationId: "loc-0462",
    locationName: "KS Manhattan",
    locationResolution: "resolved",
    authorizedLocationIds: ["loc-0462"],
    status: "needs_employee",
    wovenCloseMatch: "Woven has Test Employee",
    sourceMessageIds: ["m1"],
    ...partial,
  };
}

function answer(content: string, formProposal?: ChatFormProposal): AskResponse {
  return {
    content,
    citations: [],
    coverage: "not_applicable",
    recommendedVideoIds: [],
    ...(formProposal ? { formProposal } : {}),
  };
}

function message(role: "user" | "assistant", content: string, id: string): ChatMessage {
  return { id, role, content, createdAt: "2026-10-24T15:00:00Z" };
}

function trace(): ChatTraceDraft {
  return {
    startedAt: Date.now(),
    conversationId: "conv_mvmhcy3r2iyyoci",
    messageId: null,
    userId: null,
    originalQuery: WRITE_UP,
    rewrittenQuery: null,
    intent: null,
    retrievalCount: null,
    retrieved: [],
    prompt: null,
    formInProgress: true,
    modelCall: null,
    errorSubtype: null,
    errorClass: null,
    errorStatus: null,
    succeeded: null,
  };
}

afterEach(() => {
  delete process.env.FORM_FULL_REMAP;
  __setAnthropicClient(null);
});

describe("the conversation is read into the form's own fields", () => {
  it("keeps a typed name, drops a store and a cash drawer, and stops a title at the sentence", () => {
    const writeUp = extractFormRemap([WRITE_UP], TODAY);
    expect(writeUp.employeeName?.value).toBe("Test Employee");
    expect(writeUp.employeeName?.quote.toLowerCase()).toContain("test employee");
    expect(writeUp.warningLevel).toBeNull();
    expect(writeUp.observation?.value).toBe("Cell phone use.");
    expect(writeUp.observation?.quote.toLowerCase()).toContain("cell phone use");

    const drawer = extractFormRemap([CASH_DRAWER], TODAY);
    expect(drawer.employeeName?.value).toBe("Test Employee");
    expect(drawer.observation?.value).toBe("Cash drawer was $40 short.");
    expect(extractFormRemap(["create a corrective action for Lawrence"], TODAY).employeeName).toBeNull();
    expect(extractFormRemap(["coaching form for lawrence smith"], TODAY).employeeName?.value.toLowerCase()).toBe(
      "lawrence smith",
    );
    expect(extractFormRemap(["the employee is Pat Kearney"], TODAY).employeeName?.value).toBe("Pat Kearney");

    const title = extractFormRemap([TITLE_SENTENCE], TODAY);
    expect(title.jobTitle?.value).toBe("tan consultant");
    expect(title.jobTitle?.value).not.toContain("It happened");
  });

  it("keeps 9/28, records the verbal on 9/1, and does not treat the policy paste as payroll", () => {
    const mapped = extractFormRemap(S9, TODAY);
    expect(mapped.employeeName?.value.toLowerCase()).toBe("ima");
    expect(mapped.formDate?.value).toBe("2026-09-28");
    expect(mapped.warningLevel?.value).toBe("written");
    expect(mapped.priorCoaching?.value).toContain("Verbal corrective action");
    expect(mapped.priorCoaching?.value).toContain("09/01/2026");
    expect(mapped.payrollDeduct).toBeNull();
    expect(mapped.payrollAmount).toBeNull();
    expect(mapped.observation?.value).toBe("Opening the salon late.");
    expect(mapped.jobTitle?.value).toBe("Tanning Consultant");
    expect(mapped.jobTitle?.value).not.toContain("It happened");

    const paid = extractFormRemap(["payroll deduct yes $40"], TODAY);
    expect(paid.payrollDeduct?.value).toBe("yes");
    expect(paid.payrollAmount?.value).toBe("$40");
    const twentyFive = extractFormRemap(["payroll deduct yes $25"], TODAY);
    expect(twentyFive.payrollDeduct?.value).toBe("yes");
    expect(twentyFive.payrollAmount?.value).toBe("$25");
  });

  it("applies a later date and a later warning without clearing the person", () => {
    const mapped = extractFormRemap(
      [
        "create a corrective action for Pat Rivera, she was late on 9/28/26",
        "change the date to 10/1",
        "actually make it a verbal warning",
      ],
      TODAY,
    );
    expect(mapped.employeeName?.value).toBe("Pat Rivera");
    expect(mapped.formDate?.value).toBe("2026-10-01");
    expect(mapped.warningLevel?.value).toBe("verbal");
    expect(mapped.observation?.value).toBe("Late.");
  });
});

describe("the card asks once for what is still blank", () => {
  it("leaves the existing card alone while the flag is off", async () => {
    expect(formFullRemapEnabled()).toBe(false);
    const response = answer(`Written Warning, as you said\n${WRITE_UP}`, proposal());
    const same = await remapFormResponse({
      response,
      history: [],
      question: WRITE_UP,
      today: TODAY,
    });
    expect(same).toBe(response);
  });

  it("replaces a fake Written Warning and the pasted write-up", async () => {
    process.env.FORM_FULL_REMAP = "on";
    const response = await remapFormResponse({
      response: answer(
        `**Type of Warning:** Written Warning, as you said\n\n**Observation of Offense:** ${WRITE_UP}`,
        proposal(),
      ),
      history: [],
      question: WRITE_UP,
      today: TODAY,
      skipModel: true,
    });
    const card = response.formProposal!;
    expect(card.employeeName).toBe("Test Employee");
    expect(card.warningLevel ?? null).toBeNull();
    expect(card.employeeRole ?? null).toBeNull();
    expect(card.status).not.toBe("needs_employee");
    expect(card.wovenCloseMatch).toBe("Woven has Test Employee");
    expect(card.locationId).toBe("loc-0462");
    expect(response.content).toContain("**Observation of Offense:** Cell phone use.");
    expect(response.content).not.toContain("Written Warning");
    expect(response.content).not.toContain(WRITE_UP);
    expect(response.content).not.toContain("as you said");
    expect(response.content).not.toContain("To draft a form, I'll need a few details");
  });

  it("does not ask which date, and asks payroll once", async () => {
    process.env.FORM_FULL_REMAP = "on";
    const response = await remapFormResponse({
      response: answer("Which date goes on the form?", proposal()),
      history: S9.slice(0, 4).map((content, index) => message("user", content, `u${index}`)),
      question: S9[4]!,
      today: TODAY,
      skipModel: true,
    });
    expect(response.formProposal?.formDate).toBe("2026-09-28");
    expect(response.formProposal?.employeeRole).toBe("Tanning Consultant");
    expect(response.formProposal?.employeeRole).not.toContain("It happened");
    expect(response.formProposal?.payrollDeduct ?? null).toBeNull();
    expect(response.content).toContain("Verbal corrective action");
    expect(response.content).toContain("09/01/2026");
    expect(response.content).toContain("Opening the salon late.");
    expect(response.content).toContain("Is payroll deduct applicable? Yes or no?");
    expect(response.content).not.toMatch(/Which date goes on the form/i);
    expect(response.content).not.toContain("You mentioned more than one date");

    const asked = await remapFormResponse({
      response: answer("old", proposal({ employeeName: "Pat Rivera", warningLevel: null, employeeRole: null })),
      history: [
        message("user", "create a corrective action for Pat Rivera, she was late on 9/28/26", "u1"),
        message("assistant", "Is payroll deduct applicable? Yes or no?", "a1"),
        message("user", "this should be a verbal warning", "u2"),
        message("user", "a verbal ca was given on 9-1-26", "u3"),
      ],
      question: "Create a form from this conversation.",
      today: TODAY,
      skipModel: true,
    });
    expect(asked.content).not.toContain("Is payroll deduct applicable? Yes or no?");
    expect(asked.formProposal?.formDate).toBe("2026-09-28");
    expect(asked.formProposal?.warningLevel).toBe("verbal");
  });

  it("does not offer Lawrence or a cash drawer as the employee", async () => {
    process.env.FORM_FULL_REMAP = "on";
    const response = await remapFormResponse({
      response: answer("Is this for Test Employee or cash drawer? Or Lawrence?", proposal({ locationId: "loc-0468" })),
      history: [],
      question: CASH_DRAWER,
      today: TODAY,
      skipModel: true,
    });
    expect(response.formProposal?.employeeName).toBe("Test Employee");
    expect(response.content).not.toMatch(/or lawrence/i);
    expect(response.content).not.toMatch(/or cash drawer/i);
    expect(response.content).not.toContain("Test Employee or cash drawer");
  });

  it("keeps going after a date change and a warning change", async () => {
    process.env.FORM_FULL_REMAP = "on";
    const response = await remapFormResponse({
      response: answer("To draft a form, I'll need a few details first:", proposal({ formDate: "2026-09-28" })),
      history: [
        message("user", "create a corrective action for Pat Rivera, she was late on 9/28/26", "u1"),
        message("user", "change the date to 10/1", "u2"),
      ],
      question: "actually make it a verbal warning",
      today: TODAY,
      skipModel: true,
    });
    expect(response.formProposal?.formDate).toBe("2026-10-01");
    expect(response.formProposal?.warningLevel).toBe("verbal");
    expect(response.formProposal?.employeeName).toBe("Pat Rivera");
    expect(response.content).not.toContain("I'll need a few details");
    expect(response.content).toContain("Verbal Warning");
    expect(response.content).not.toContain("Written Warning");
  });
});

describe("the extraction call is the form turn's trace", () => {
  it("records the model and tokens, and rejects a Written Warning quoted from write up", async () => {
    process.env.FORM_FULL_REMAP = "on";
    __setAnthropicClient({
      messages: {
        create: async () => ({
          stop_reason: "tool_use",
          usage: { input_tokens: 21, output_tokens: 9 },
          content: [
            {
              type: "tool_use",
              name: "record_form_fields",
              input: {
                warningLevel: { value: "written", quote: "write up" },
                observation: { value: "Cell phone use.", quote: "cell phone use" },
              },
            },
          ],
        }),
      },
    } as never);
    const draft = trace();
    let response: AskResponse | null = null;
    await runChatTrace(draft, async () => {
      response = await remapFormResponse({
        response: answer(`Written Warning, as you said\n${WRITE_UP}`, proposal()),
        history: [],
        question: WRITE_UP,
        today: TODAY,
      });
      expect(chatTraceDraft()?.modelCall?.inputTokens).toBe(21);
    });
    expect(draft.modelCall?.model).toBe(CLAUDE_HAIKU_MODEL);
    expect(draft.modelCall?.inputTokens).toBe(21);
    expect(draft.modelCall?.outputTokens).toBe(9);
    const slots = draft.slots as { warningLevel: unknown; observation: { value: string; quote: string } };
    expect(slots.warningLevel).toBeNull();
    expect(slots.observation.value).toBe("Cell phone use.");
    expect(slots.observation.quote.toLowerCase()).toContain("cell phone use");
    expect(response!.content).not.toContain("Written Warning");
    expect(response!.formProposal?.warningLevel ?? null).toBeNull();
  });

  it("falls back to the quote-backed read when the model call fails", async () => {
    process.env.FORM_FULL_REMAP = "on";
    const draft = trace();
    await runChatTrace(draft, async () => {
      const response = await remapFormResponse({
        response: answer(WRITE_UP, proposal()),
        history: [],
        question: WRITE_UP,
        today: TODAY,
        callModel: async () => {
          throw new Error("no model");
        },
      });
      expect(response.formProposal?.employeeName).toBe("Test Employee");
      expect(response.content).toContain("Cell phone use.");
    });
  });
});

describe("form turns use the remap as the last write", () => {
  it("cleans a write-up proposal", async () => {
    process.env.FORM_FULL_REMAP = "on";
    const { proposeFormForTurn } = await import("./form-proposal");
    const response = await proposeFormForTurn({
      history: [],
      question: WRITE_UP,
      questionMessageId: "u1",
      actor: { role: "salon_director", scope: ONE },
      summaries: LIBRARY as never,
      today: TODAY,
    });
    expect(response?.formProposal?.templateKey).toBe("dpoa");
    expect(response?.formProposal?.employeeName).toBe("Test Employee");
    expect(response?.formProposal?.warningLevel ?? null).toBeNull();
    expect(response?.content).toContain("Cell phone use.");
    expect(response?.content).not.toContain("Written Warning");
    expect(response?.content).not.toContain(WRITE_UP);
  });

  it("rewrites the card after the filled-slot pass", async () => {
    process.env.FORM_FULL_REMAP = "on";
    const request: AskRequest = {
      question: WRITE_UP,
      mode: "standard",
      history: [],
      scopeId: "sunny",
      context: { userName: "Alex", locationName: "KS Manhattan", todayIso: TODAY },
    };
    const response = await deliverFormProposal({
      request,
      actor: { role: "salon_director", scope: ONE },
      question: WRITE_UP,
      propose: async () =>
        answer(
          `**Type of Warning:** Written Warning, as you said\n\n**Observation of Offense:** ${WRITE_UP}`,
          proposal({ locationResolution: "resolved" }),
        ),
      decorate: async (proposed) => proposed,
    });
    expect(response?.formProposal?.employeeName).toBe("Test Employee");
    expect(response?.formProposal?.warningLevel ?? null).toBeNull();
    expect(response?.formProposal?.employeeRole ?? null).toBeNull();
    expect(response?.content).toContain("Cell phone use.");
    expect(response?.content).not.toContain(WRITE_UP);
    expect(response?.content).not.toContain("Written Warning");
  });
});
