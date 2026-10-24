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

const elin = {
  id: "elin",
  firstName: "Elin",
  lastName: "Haskett",
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
    people: [elin],
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
    const first = decideIntentTurn(turn("create a corrective action form for Dasiley Veklo"));
    expect(first.state.employeeName).toBe("Dasiley Veklo");
    expect(first.clarification).toBeNull();
    const yes = decideIntentTurn(turn("Yes", { ...first.state, templateKey: "dpoa" }));
    expect(yes.state.employeeName).toBe("Dasiley Veklo");
    expect(yes.state.salonId).toBe(first.state.salonId);
  });

  it("accepts a pending confirmation in code", () => {
    process.env.CODE_SLOTS_ENABLED = "1";
    const saved = {
      ...EMPTY_FORM_STATE,
      templateKey: "dpoa",
      employeeName: "Dasiley Veklo",
      pendingConfirmation: { typed: "Dasiley Veklo", candidate: "Daisley Veklo" },
    };
    const yes = decideIntentTurn(turn("Yes", saved));
    expect(yes.state.employeeName).toBe("Daisley Veklo");
    expect(yes.state.pendingConfirmation).toBeNull();
    const no = decideIntentTurn(turn("No", saved));
    expect(no.state.employeeName).toBe("Dasiley Veklo");
  });

  it("s8 verbatim never stores Job title as the employee", () => {
    process.env.CODE_SLOTS_ENABLED = "1";
    const turns = [
      "what does policy say about pets in salon",
      "assist with creating an exit form",
      "evangeline pembury, tanning consultant at shawnee",
      "last day worked was 9-20-26. management called her with no response on 9-27-26",
      "its a no call no show",
      "create exit form",
      "Create a form from this conversation.",
      "create exit: Evangeline Pembury, Tanning Consultant, KS Shawnee Mission Pkwy\nLast day worked 9/20/26\nNo call/no show; management attempted phone contact 9/27/26, no response",
      "Create a form from this conversation.",
      "Create a form from this conversation.",
    ];
    const evangeline = {
      id: "evangeline",
      firstName: "Evangeline",
      lastName: "Pembury",
      preferredFirstName: null,
      salonIds: ["loc-0463"],
      title: "Tanning Consultant",
      primaryLocationName: "KS Shawnee Mission Pkwy",
      primarySalonId: "loc-0463",
    };
    let saved = EMPTY_FORM_STATE;
    for (const question of turns) {
      const decision = decideIntentTurn({
        ...turn(question, saved),
        people: [evangeline],
        raw: {
          employee: "Job title",
          salon: null,
          title: null,
          incidentType: null,
          incidentDate: null,
          payrollAmount: null,
          warningLevel: null,
          formType: "exit",
          formTurn: true,
          policyHeading: null,
        },
      });
      expect(decision.state.employeeName?.toLowerCase() ?? "").not.toBe("job title");
      expect(decision.state.employeeName ?? "").not.toMatch(/\bjob\b/i);
      saved = decision.state;
    }
    expect(saved.employeeName).toBe("Evangeline Pembury");
    expect(saved.title).toBe("Tanning Consultant");
  });

  it("s17 verbatim keeps Betty Sue and does not keep Job on the name", () => {
    process.env.CODE_SLOTS_ENABLED = "1";
    const turns = [
      "Can you create me a performance CA?",
      "Betty Sue today under performance for September 270 tans below in PPTA, UPTA, LPSVA, CC% and Spa% verbal warning received Open Ended Questions Coaching 9/8/2026, Focus Item Coaching 9/15/2026, New Product Coaching 9/25/2026 not payroll deductible Tanning Consultant",
      "Betty Sue",
    ];
    let saved = EMPTY_FORM_STATE;
    for (const question of turns) {
      const decision = decideIntentTurn({
        ...turn(question, saved),
        people: [],
        raw: {
          employee: "Larissa Venko Job",
          salon: null,
          title: "Job title",
          incidentType: null,
          incidentDate: null,
          payrollAmount: null,
          warningLevel: null,
          formType: "corrective action",
          formTurn: true,
          policyHeading: null,
        },
      });
      expect(decision.state.employeeName ?? "").not.toBe("Job title");
      expect(decision.state.employeeName ?? "").not.toBe("Larissa Venko Job");
      expect(decision.state.employeeName ?? "").not.toMatch(/\bjob\b/i);
      saved = decision.state;
    }
    expect(saved.employeeName).toBe("Betty Sue");
    expect(saved.title).toBe("Tanning Consultant");
  });

  it("replay: Jane Store keeps the surname, and a label alone does not replace it", () => {
    process.env.CODE_SLOTS_ENABLED = "1";
    const turns = [
      "create a corrective action for Jane Store, tanning consultant at shawnee",
      "Store",
      "Salon",
      "Job title",
      "Create a form from this conversation.",
    ];
    let saved = EMPTY_FORM_STATE;
    for (const question of turns) {
      const decision = decideIntentTurn({
        ...turn(question, saved),
        people: [],
        raw: {
          employee: question === "Store" || question === "Salon" ? question : "Job title",
          salon: null,
          title: null,
          incidentType: null,
          incidentDate: null,
          payrollAmount: null,
          warningLevel: null,
          formType: "corrective action",
          formTurn: true,
          policyHeading: null,
        },
      });
      expect(decision.state.employeeName).toBe("Jane Store");
      expect(decision.state.employeeName).not.toBe("Store");
      expect(decision.state.employeeName).not.toBe("Salon");
      expect(decision.state.employeeName).not.toBe("Job title");
      saved = decision.state;
    }
    expect(saved.title).toBe("Tanning Consultant");
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
