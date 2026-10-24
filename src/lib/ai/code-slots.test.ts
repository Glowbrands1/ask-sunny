import { afterEach, describe, expect, it } from "vitest";

import type { ManualChunk } from "@/lib/forms/official-policy-manual";

import { decideIntentTurn } from "./intent-slots";
import { EMPTY_FORM_STATE } from "./form-state";
import { runSelfCheck, type OutgoingDraft } from "./self-check";

const ATTENDANCE: ManualChunk = {
  chunkIndex: 1,
  page: 15,
  printedPage: 14,
  section: "Attendance",
  content: "Attendance\nBe on time.",
  sections: [{ heading: "Attendance", page: 14 }],
};

const erin = {
  id: "erin",
  firstName: "Erin",
  lastName: "Nelson",
  preferredFirstName: null,
  salonIds: ["loc-0313"],
  title: "Salon Director",
  primaryLocationName: "NE Omaha 132nd and Maple",
  primarySalonId: "loc-0313",
};

function turn(question: string, saved = EMPTY_FORM_STATE) {
  return {
    question,
    history: [] as { role: string; content: string }[],
    today: "2026-10-23",
    saved,
    raw: { employee: "Job title", salon: null, title: null, incidentType: null, incidentDate: null, payrollAmount: null, warningLevel: null, formType: "corrective action", formTurn: true, policyHeading: null },
    people: [erin],
    salons: [{ id: "loc-0313", name: "NE Omaha 132nd and Maple" }],
    headings: ["Standards of Conduct", "Late Opening"],
    headingPages: { "Late Opening": 15 },
    templates: [{ key: "dpoa", name: "Corrective Action Form" }],
    formInProgress: true,
  };
}

describe("code slots", () => {
  afterEach(() => {
    delete process.env.CODE_SLOTS_ENABLED;
  });

  it("does not let the model write Employee, and a bare Yes keeps the typed name", () => {
    process.env.CODE_SLOTS_ENABLED = "1";
    const first = decideIntentTurn(turn("create a corrective action form for Pasiley Peklo"));
    expect(first.state.employeeName).toBe("Pasiley Peklo");
    expect(first.clarification).toBeNull();
    const yes = decideIntentTurn(turn("Yes", { ...first.state, templateKey: "dpoa" }));
    expect(yes.state.employeeName).toBe("Pasiley Peklo");
    expect(yes.state.salonId).toBe(first.state.salonId);
  });

  it("accepts a pending confirmation in code", () => {
    process.env.CODE_SLOTS_ENABLED = "1";
    const saved = {
      ...EMPTY_FORM_STATE,
      templateKey: "dpoa",
      employeeName: "Pasiley Peklo",
      pendingConfirmation: { typed: "Pasiley Peklo", candidate: "Paisley Peklo" },
    };
    const yes = decideIntentTurn(turn("Yes", saved));
    expect(yes.state.employeeName).toBe("Paisley Peklo");
    expect(yes.state.pendingConfirmation).toBeNull();
    const no = decideIntentTurn(turn("No", saved));
    expect(no.state.employeeName).toBe("Pasiley Peklo");
  });

  it("does not show repair output", async () => {
    process.env.CODE_SLOTS_ENABLED = "1";
    const draft: OutgoingDraft = {
      content: "Here is the card for Test Testy. Attendance Policy, JBA Policy Manual p.99.",
      employeeName: "Test Testy",
      actionPlan: null,
      chunks: [ATTENDANCE],
      roster: [],
      question: "Create a form from this conversation.",
    };
    const settled = await runSelfCheck(draft, async () => ({
      content: "I cannot repair this reply. 'Test Testy' does not appear on the employee roster.",
      employeeName: null,
      actionPlan: null,
    }));
    expect(settled.content).toContain("Here is the card for Test Testy.");
    expect(settled.content).not.toMatch(/I cannot repair|does not appear on the employee roster/);
    expect(settled.employeeName).toBe("Test Testy");
  });
});
