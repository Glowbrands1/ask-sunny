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
  employeeName: "Jane Doe",
  values: [] as { fieldKey: string; value: string }[],
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
          employeeName: state.employeeName,
          status: state.status,
        },
        version: { document: parseFormDocument(seed.document), variants: [] },
        values: [
          ...(state.reason ? [{ fieldKey: "reason", value: state.reason, checked: [], filledBy: "ai", provenance: {} }] : []),
          ...state.values.map((row) => ({ ...row, checked: [], filledBy: "system", provenance: {} })),
        ],
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
  state.employeeName = "Jane Doe";
  state.values = [];
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


describe("found in production QA: a correction never leaves the reason stale", () => {
  /* The live production form, as it stood when the correction was typed. */
  function productionTransfer() {
    state.employeeName = "Transfer Beta Test";
    state.reason =
      "Transfer Beta Test is transferring from Salon Manager at salon 18 to Salon Manager at salon 23, effective October 12, 2026. The transfer is due to a mock staffing coverage change for QA.";
    state.values = [
      { fieldKey: "employee_name", value: "Transfer Beta Test" },
      { fieldKey: "job_title", value: "Salon Manager" },
      { fieldKey: "location", value: "Salon 18" },
      { fieldKey: "new_job_title", value: "Salon Manager" },
      { fieldKey: "new_location", value: "Salon 23" },
    ];
  }

  it("updates New Location and the reason together: 'Actually her new location is salon 24.'", async () => {
    productionTransfer();
    const response = await correct("Actually her new location is salon 24.");
    expect(state.saved[0]).toEqual({ values: { new_location: "Salon 24" }, checked: {} });
    expect(state.saved[1]!.values.reason).toBe(
      "Transfer Beta Test is transferring from Salon Manager at salon 18 to Salon Manager at Salon 24, effective October 12, 2026. The transfer is due to a mock staffing coverage change for QA.",
    );
    expect(state.saved[1]!.values.reason).not.toMatch(/salon 23/i);
    expect(response!.content).toContain('I changed "Salon 23" → "Salon 24" in the reason paragraph too');
    expect(response!.content).not.toContain("give it a quick read");
    expect(response!.formUpdate).toEqual({
      instanceId: "11111111-1111-1111-1111-111111111111",
      updated: ["new_location", "reason"],
    });
  });

  it("says which value it could not safely change, rather than guessing", async () => {
    productionTransfer();
    const response = await correct("new title is shift lead");
    expect(state.saved).toEqual([{ values: { new_job_title: "Shift Lead" }, checked: {} }]);
    expect(response!.content).toContain('still mentions "Salon Manager", which is also another line on this form');
  });
});
