import { beforeEach, describe, expect, it, vi } from "vitest";

import { parseFormDocument } from "./document";
import { TEMPLATE_SEEDS } from "./library";

/**
 * "Change her new location to salon 24", typed after the form exists: saved as
 * the manager's own edit, through the template's own edit permission, and only
 * for the employment change forms.
 */

const state = vi.hoisted(() => ({
  templateKey: "position-transfer",
  status: "draft",
  authorized: true,
  saved: [] as { values: Record<string, string>; checked: Record<string, string[]> }[],
  reason: "",
}));

vi.mock("./instance-scope", () => ({
  authorizeInstance: async () => {
    if (!state.authorized) throw new Error("not permitted");
    const seed = TEMPLATE_SEEDS.find((entry) => entry.key === state.templateKey)!;
    return {
      actor: { id: "user-1", role: "salon_director", verified: true, scope: null },
      loaded: {
        instance: {
          id: "form-1",
          templateKey: seed.key,
          templateName: seed.name,
          variantKey: null,
          employeeName: "Jane Doe",
          status: state.status,
        },
        version: { document: parseFormDocument(seed.document), variants: [] },
        values: state.reason ? [{ fieldKey: "reason", value: state.reason, checked: [], filledBy: "ai", provenance: {} }] : [],
      },
    };
  },
}));

vi.mock("./instances", () => ({
  saveInstanceValues: async (
    _id: string,
    submitted: { values: Record<string, string>; checked: Record<string, string[]> },
  ) => {
    state.saved.push(submitted);
    return { rejected: [] };
  },
}));

const { correctActiveForm } = await import("./chat-correction");

const correct = (question: string) =>
  correctActiveForm({
    request: new Request("http://localhost/api/chat"),
    instanceId: "11111111-1111-1111-1111-111111111111",
    question,
    today: "2026-09-28",
  });

beforeEach(() => {
  state.templateKey = "position-transfer";
  state.status = "draft";
  state.authorized = true;
  state.saved = [];
  state.reason = "";
});

describe("correcting the open form from chat", () => {
  it("saves the new location and says so in the form's own words", async () => {
    const response = await correct("change her new location to salon 24");
    expect(state.saved).toEqual([{ values: { new_location: "Salon 24" }, checked: {} }]);
    expect(response!.content).toBe(
      "Updated the **Position Transfer Form** for **Jane Doe**: New Location, if applicable → Salon 24.",
    );
    expect(response!.formUpdate).toEqual({
      instanceId: "11111111-1111-1111-1111-111111111111",
      updated: ["new_location"],
    });
  });

  it("corrects a name or a date without starting again", async () => {
    await correct("change the name to Jane Doe-Smith");
    await correct("change the date to 9/27");
    expect(state.saved).toEqual([
      { values: { employee_name: "Jane Doe-Smith" }, checked: {} },
      { values: { form_date: "2026-09-27" }, checked: {} },
    ]);
  });

  it("points at the reason paragraph when one was already drafted", async () => {
    state.reason = "Jane is transferring to Salon 18.";
    const response = await correct("change her new location to salon 24");
    expect(response!.content).toContain("reason paragraph was written before this change");
  });

  it("does not touch a finalized form", async () => {
    state.status = "finalized";
    const response = await correct("change her new location to salon 24");
    expect(state.saved).toEqual([]);
    expect(response!.content).toContain("finalized");
  });

  it.each([
    ["a question", "what is her new location?"],
    ["a remark", "thanks, looks good"],
  ])("leaves %s to the normal conversation", async (_label, question) => {
    expect(await correct(question)).toBeNull();
    expect(state.saved).toEqual([]);
  });

  it("returns null when the manager may not edit the form", async () => {
    state.authorized = false;
    expect(await correct("change her new location to salon 24")).toBeNull();
    expect(state.saved).toEqual([]);
  });

  it("leaves every other kind of form alone", async () => {
    state.templateKey = "coaching";
    expect(await correct("change her new location to salon 24")).toBeNull();
    expect(state.saved).toEqual([]);
  });

  it("writes only keys the form has", async () => {
    // A demotion form has no transfer_type; the tick lands on demotion_type only.
    state.templateKey = "demotion";
    await correct("make it involuntary");
    expect(state.saved).toEqual([{ values: {}, checked: { demotion_type: ["involuntary"] } }]);
  });
});


describe("found in hands-on QA: the correction summary", () => {
  it("names a ticked box by its group's label, without an empty label", async () => {
    const response = await correct("it's involuntary");
    expect(response!.content).toContain("Type of Transfer → Involuntary");
    expect(response!.content).not.toContain("; →");
  });
});


describe("found in hands-on QA: a new request is not a correction", () => {
  it.each([
    "pull up a transfer form for jane doe, she is a pt tc at $12/hr, transferring from stc 12 to salon 18 effective oct 5, same title, voluntary",
    "create a demotion form for maria lopez, going from SD to TC",
    "maria lopez is transferring from salon 12 to salon 18",
    "create another position transfer form for jane doe, new location salon 30",
  ])("leaves the open form alone: %s", async (question) => {
    state.templateKey = "position-transfer";
    expect(await correct(question)).toBeNull();
    expect(state.saved).toEqual([]);
  });

  it("still corrects when the manager names this form's employee", async () => {
    state.templateKey = "position-transfer";
    const response = await correct("jane's new location is salon 24");
    expect(response).not.toBeNull();
    expect(state.saved).toEqual([{ values: { new_location: "Salon 24" }, checked: {} }]);
  });
});

describe("the Corrective Action Form's payroll-deduct answer", () => {
  beforeEach(() => {
    state.templateKey = "dpoa";
  });

  it("saves a stated change as the manager's own edit, in the form's words", async () => {
    const response = await correct("change payroll deduct to yes");
    expect(state.saved).toEqual([{ values: {}, checked: { payroll_deduct: ["yes"] } }]);
    expect(response!.content).toBe(
      "Updated the **Corrective Action Form** for **Jane Doe**: Is payroll deduct applicable? → Yes.",
    );
    expect(response!.formUpdate).toEqual({
      instanceId: "11111111-1111-1111-1111-111111111111",
      updated: ["payroll_deduct"],
    });
  });

  it("reads a plain statement too", async () => {
    await correct("actually, no payroll deduction");
    expect(state.saved).toEqual([{ values: {}, checked: { payroll_deduct: ["no"] } }]);
  });

  it.each(["no", "yes", "is payroll deduct applicable?", "change the name to Jane Smith", "change the date to 9/27"])(
    "leaves %s alone — only the payroll answer is taken from chat",
    async (question) => {
      expect(await correct(question)).toBeNull();
      expect(state.saved).toEqual([]);
    },
  );

  it("does not touch a finalized form", async () => {
    state.status = "finalized";
    const response = await correct("change payroll deduct to no");
    expect(state.saved).toEqual([]);
    expect(response!.content).toContain("finalized");
  });

  it("never writes a payroll answer onto a form that does not ask the question", async () => {
    state.templateKey = "position-transfer";
    expect(await correct("change payroll deduct to yes")).toBeNull();
    state.templateKey = "coaching";
    expect(await correct("no payroll deduction")).toBeNull();
    expect(state.saved).toEqual([]);
  });
});
