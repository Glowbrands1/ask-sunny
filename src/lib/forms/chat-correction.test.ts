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
  failSave: false,
  reasonFilledBy: "ai",
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
          ...(state.reason
            ? [{ fieldKey: "reason", value: state.reason, checked: [], filledBy: state.reasonFilledBy, provenance: {} }]
            : []),
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
    if (state.failSave) throw new Error("Could not save the form: connection reset");
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
  state.failSave = false;
  state.reasonFilledBy = "ai";
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

  it("updates New Location and the reason together, in one save: 'Actually her new location is salon 24.'", async () => {
    productionTransfer();
    const response = await correct("Actually her new location is salon 24.");
    // One write carrying both, so neither can land without the other.
    expect(state.saved).toEqual([
      {
        values: {
          new_location: "Salon 24",
          reason:
            "Transfer Beta Test is transferring from Salon Manager at salon 18 to Salon Manager at Salon 24, effective October 12, 2026. The transfer is due to a mock staffing coverage change for QA.",
        },
        checked: {},
      },
    ]);
    expect(state.saved[0]!.values.reason).not.toMatch(/salon 23/i);
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
    expect(response!.content).toContain('still mentions "Salon Manager", which I didn\'t change automatically');
  });
});

describe("found in review: the correction and the paragraph are one save", () => {
  it("writes nothing when the save fails, and reports no success", async () => {
    state.reason = "Jane is moving from salon 18 to salon 23 as a Salon Manager.";
    state.values = [
      { fieldKey: "location", value: "Salon 18" },
      { fieldKey: "new_location", value: "Salon 23" },
    ];
    state.failSave = true;
    await expect(correct("Actually her new location is salon 24.")).rejects.toThrow("Could not save the form");
    // A single attempt carried the field and the paragraph together; there was no second write.
    expect(state.saved).toEqual([
      { values: { new_location: "Salon 24", reason: "Jane is moving from salon 18 to Salon 24 as a Salon Manager." }, checked: {} },
    ]);
  });

  it("never rewrites 'manager' in ordinary prose when a title named Manager is corrected", async () => {
    state.templateKey = "demotion";
    state.reason = "Jane was a Manager at Salon 12. She discussed it with her manager and asked to step down.";
    state.values = [{ fieldKey: "job_title", value: "Manager" }];
    const response = await correct("change her current title to SD");
    expect(state.saved).toEqual([{ values: { job_title: "Salon Director" }, checked: {} }]);
    expect(response!.content).toContain('still mentions "Manager", which I didn\'t change automatically');
    expect(response!.formUpdate!.updated).toEqual(["job_title"]);
  });
});

describe("found in QA: corrections to several lines, and a reason the manager wrote", () => {
  it("swaps both locations and the paragraph together, without cross-rewriting", async () => {
    state.reason = "Jane is moving from salon 18 to salon 23 as a Salon Manager.";
    state.values = [
      { fieldKey: "location", value: "Salon 18" },
      { fieldKey: "new_location", value: "Salon 23" },
    ];
    await correct("current location is salon 23. new location is salon 18");
    expect(state.saved).toEqual([
      {
        values: {
          location: "Salon 23",
          new_location: "Salon 18",
          reason: "Jane is moving from Salon 23 to Salon 18 as a Salon Manager.",
        },
        checked: {},
      },
    ]);
  });

  it("never rewrites a reason the manager wrote, and names what to check", async () => {
    state.reasonFilledBy = "manager";
    state.reason = "Jane asked to move to salon 23 because salon 23 is closer to home.";
    state.values = [
      { fieldKey: "location", value: "Salon 18" },
      { fieldKey: "new_location", value: "Salon 23" },
    ];
    const response = await correct("Actually her new location is salon 24.");
    expect(state.saved).toEqual([{ values: { new_location: "Salon 24" }, checked: {} }]);
    expect(response!.content).toContain('still mentions "Salon 23", which I didn\'t change automatically');
    expect(response!.content).not.toContain("I changed");
    expect(response!.formUpdate!.updated).toEqual(["new_location"]);
  });
});

describe("found in live QA: a correction never makes the paragraph contradict itself", () => {
  it("leaves the reason alone when the new value is already there for another purpose", async () => {
    state.reason = "QA draft from the notes: she is a PT TC at $12/hr at salon 18, moving to salon 23 effective 10/12.";
    state.values = [
      { fieldKey: "location", value: "KS Lawrence" },
      { fieldKey: "new_location", value: "Salon 23" },
    ];
    const response = await correct("current location is salon 23. new location is salon 18");
    expect(state.saved).toEqual([{ values: { location: "Salon 23", new_location: "Salon 18" }, checked: {} }]);
    expect(response!.content).toContain('still mentions "Salon 23", which I didn\'t change automatically');
    expect(response!.content).not.toContain("I changed");
  });
});

describe("found in review: PR #48's payroll correction never touches the reason", () => {
  it("saves only the payroll answer on a Corrective Action Form that has a reason paragraph", async () => {
    state.templateKey = "dpoa";
    state.reason = "Jane was late three times in September, at salon 23.";
    state.values = [{ fieldKey: "location", value: "Salon 23" }];
    const response = await correct("change payroll deduct to yes");
    expect(state.saved).toEqual([{ values: {}, checked: { payroll_deduct: ["yes"] } }]);
    expect(response!.content).toBe(
      "Updated the **Corrective Action Form** for **Jane Doe**: Is payroll deduct applicable? → Yes.",
    );
    expect(response!.formUpdate!.updated).toEqual(["payroll_deduct"]);
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
