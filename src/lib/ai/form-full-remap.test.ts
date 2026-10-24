import { afterEach, describe, expect, it, vi } from "vitest";

import type { RosterEmployee } from "@/lib/forms/employee-match";

import { groundFormSlots, remapFormTurn } from "./form-full-remap";

/**
 * FORM_FULL_REMAP: one extraction, then only what the manager said.
 * "write up" is not "Written Warning, as you said". A pasted incident is
 * not the observation. A later salon edit does not restart the form.
 */

const TODAY = "2026-10-24";
const FLAG = "FORM_FULL_REMAP_ENABLED";

const inserts = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({
    from: () => ({
      insert: async (row: Record<string, unknown>) => {
        inserts.rows.push(row);
        return { error: null };
      },
    }),
  }),
}));

const JANE: RosterEmployee = {
  id: "e-jane",
  firstName: "Jane",
  lastName: "Doe",
  salonIds: ["loc-0309"],
};

const KAITLYN: RosterEmployee = {
  id: "e-kaitlyn",
  firstName: "Kaitlyn",
  lastName: "Brook",
  salonIds: ["loc-0309"],
};

afterEach(() => {
  delete process.env[FLAG];
  inserts.rows.length = 0;
});

const OPEN =
  "corrective action for Test Employee, team member, at Kearney. She left the register drawer open on October 20. Verbal warning. Payroll deduct applies and $25 will come out of the check.";

function raw(over: Record<string, unknown> = {}) {
  return {
    templateKey: "dpoa",
    employeeName: "Test Employee",
    observation: "Left the register drawer open.",
    actionPlan: "Review the drawer close with her. Deduct $25 from the check.",
    warningLevel: "written",
    payrollDeduct: "no",
    payrollAmount: "$99",
    jobTitle: "Store Director",
    store: "Omaha",
    policySection: "Moon Landing",
    ...over,
  };
}

describe("form full remap", () => {
  it("keeps Test Employee as typed, the incident date, and the stated $25", () => {
    const { slots, response } = groundFormSlots({
      raw: raw(),
      history: [],
      question: OPEN,
      today: TODAY,
      people: [JANE],
    });
    expect(slots.employeeName).toBe("Test Employee");
    expect(slots.closeMatchNote).toBeNull();
    expect(slots.locationId).toBe("loc-0309");
    expect(slots.store).toBe("NE Kearney");
    expect(slots.incidentDateIso).toBe("2026-10-20");
    expect(slots.jobTitle).toMatch(/Team Member/i);
    expect(slots.warningLevel).toBe("verbal");
    expect(slots.payrollDeduct).toBe("yes");
    expect(slots.payrollAmount).toBe("$25");
    expect(slots.observation).toBe("Left the register drawer open.");
    expect(slots.actionPlan).toBeNull();
    expect(response.content).toContain("**Payroll deduction amount:** $25");
    expect(response.content).not.toMatch(/\*\*Action plan:\*\*/);
    expect(response.content).not.toMatch(/Omaha|Store Director|\$99|Moon Landing/);
    expect(response.content).toMatch(/as you said/);
    expect(response.content).toMatch(/\*\*Type of warning:\*\* Verbal Warning, as you said/);
    expect(response.content).toContain("**Salon:** NE Kearney, as you said");
    expect(response.formProposal?.employeeName).toBe("Test Employee");
    expect(response.formProposal?.status).toBe("ready");
    expect(response.content).not.toMatch(/Who is this for\?|Which salon\?|Which date/);
  });

  it("does not say as you said for a write-up, and does not paste the raw incident", () => {
    const question = "write up for Test Employee at Kearney. She left the register drawer open and I need this done today please.";
    const { slots, response } = groundFormSlots({
      raw: raw({
        employeeName: "Test Employee",
        observation: question,
        warningLevel: "written",
        actionPlan: "She stole cash from the drawer.",
      }),
      history: [],
      question,
      today: TODAY,
      people: [JANE],
    });
    expect(slots.warningLevel).toBeNull();
    expect(slots.observation).toBeNull();
    expect(slots.actionPlan).toBeNull();
    expect(response.content).not.toMatch(/Type of warning:.*as you said/);
    expect(response.content).toMatch(/\*\*Salon:\*\* NE Kearney, as you said/);
    expect(response.content).not.toMatch(/\*\*Date:\*\*/);
    expect(response.content).not.toContain(question);
    expect(response.content).toContain("Verbal or written?");
    expect(response.content).toContain("What happened?");
  });

  it("does not treat $40 short or the manual's $25.00 as a payroll amount", () => {
    const short = groundFormSlots({
      raw: raw({ payrollDeduct: "yes", payrollAmount: "$40", observation: "Drawer was short." }),
      history: [],
      question: "corrective action for Test Employee at Kearney. The drawer was $40 short.",
      today: TODAY,
      people: [JANE],
    });
    expect(short.slots.payrollDeduct).toBeNull();
    expect(short.slots.payrollAmount).toBeNull();

    const quoted = groundFormSlots({
      raw: raw({ payrollAmount: "$25.00", observation: "Opened the store late." }),
      history: [],
      question:
        'corrective action for Test Employee at Kearney. The manual says "$25.00 via payroll deduction". She opened the store late. Payroll deduct yes.',
      today: TODAY,
      people: [JANE],
    });
    expect(quoted.slots.payrollDeduct).toBe("yes");
    expect(quoted.slots.payrollAmount).toBeNull();
    expect(quoted.response.content).toContain("**Payroll deduction amount?**");
  });

  it("overwrites the salon and does not restart", () => {
    const first = "corrective action for Test Employee at Kearney. She left the register drawer open on October 20.";
    const { slots, response } = groundFormSlots({
      raw: raw({ observation: "Left the register drawer open.", store: "Kearney" }),
      history: [{ role: "user", content: first }, { role: "assistant", content: "Here is the form." }],
      question: "change salon to Lawrence",
      today: TODAY,
      people: [JANE],
      continueTemplateKey: "dpoa",
    });
    expect(slots.employeeName).toBe("Test Employee");
    expect(slots.locationId).toBe("loc-0468");
    expect(slots.store).toBe("KS Lawrence");
    expect(slots.templateKey).toBe("dpoa");
    expect(response.content).not.toMatch(/start over|start again|new form/i);
    expect(response.formProposal?.employeeName).toBe("Test Employee");
  });

  it("asks each blank once and does not ask it again", () => {
    const first = groundFormSlots({
      raw: raw({ employeeName: "Test Employee", observation: "Left the register drawer open." }),
      history: [],
      question: "corrective action for Test Employee. She left the register drawer open.",
      today: TODAY,
      people: [JANE],
    });
    expect(first.response.content).toContain("Which salon?");
    expect(first.response.content).toContain("Which date should go on the form?");
    const again = groundFormSlots({
      raw: raw({ employeeName: "Test Employee", observation: "Left the register drawer open." }),
      history: [
        { role: "user", content: "corrective action for Test Employee. She left the register drawer open." },
        { role: "assistant", content: first.response.content },
      ],
      question: "ok",
      today: TODAY,
      people: [JANE],
      continueTemplateKey: "dpoa",
    });
    expect(again.response.content).not.toContain("Which salon?");
    expect(again.response.content).not.toContain("Which date should go on the form?");
    expect(again.slots.employeeName).toBe("Test Employee");
  });

  it("shows Woven has the close name and keeps the typed spelling", () => {
    const { slots, response } = groundFormSlots({
      raw: raw({ employeeName: "Kaitln Brook", observation: "Left the register drawer open." }),
      history: [],
      question: "corrective action for Kaitln Brook, team member, at Kearney. She left the register drawer open on October 20. Verbal warning. No payroll deduction.",
      today: TODAY,
      people: [KAITLYN],
    });
    expect(slots.employeeName).toBe("Kaitln Brook");
    expect(slots.closeMatchNote).toBe("Woven has Kaitlyn Brook");
    expect(response.formProposal?.employeeName).toBe("Kaitln Brook");
    expect(response.formProposal?.wovenCloseMatch).toBe("Woven has Kaitlyn Brook");
    expect(response.content).not.toContain("Woven has");
  });

  it("does not let verbal replace an explicit Coaching Form", () => {
    const { slots } = groundFormSlots({
      raw: raw({ templateKey: "dpoa", employeeName: null, observation: null }),
      history: [],
      question: "Create a Coaching Form\nverbal",
      today: TODAY,
      people: [JANE],
    });
    expect(slots.templateKey).toBe("coaching");
  });

  it("does not call the model when the flag is off", async () => {
    const call = vi.fn();
    const response = await remapFormTurn(
      { history: [], question: OPEN, today: TODAY, people: [JANE] },
      call,
    );
    expect(response).toBeNull();
    expect(call).not.toHaveBeenCalled();
  });

  it("records the extraction model, tokens, and slots on the trace", async () => {
    process.env[FLAG] = "1";
    const { finishChatTrace, openChatTrace } = await import("./chat-trace");
    await finishChatTrace(openChatTrace({ originalQuery: OPEN, formInProgress: true }), () =>
      remapFormTurn(
        { history: [], question: OPEN, today: TODAY, people: [JANE] },
        async () => ({
          raw: raw(),
          model: "claude-haiku-4-5",
          inputTokens: 120,
          outputTokens: 40,
        }),
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
    const row = inserts.rows.at(-1);
    expect(row?.model).toBe("claude-haiku-4-5");
    expect(row?.input_tokens).toBe(120);
    expect(row?.output_tokens).toBe(40);
    const slots = row?.slots as { employeeName?: string; payrollAmount?: string; observation?: string };
    expect(slots.employeeName).toBe("Test Employee");
    expect(slots.payrollAmount).toBe("$25");
    expect(slots.observation).toBe("Left the register drawer open.");
  });
});
