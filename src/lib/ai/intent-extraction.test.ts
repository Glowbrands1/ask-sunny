import { describe, expect, it } from "vitest";

import { intentExtractionEnabled } from "@/lib/config/chat-quality-flags";

import { EMPTY_FORM_STATE } from "./form-state";
import { decideIntentTurn, headingFromAccount, normalizeIncidentDate, payrollAmounts, type IntentTurnInput } from "./intent-slots";
import type { GroundedPerson } from "./grounded-entities";

/**
 * Varied phrasings, lowercase names, typos, and date formats.
 *
 * The model is not called. The tool payload is what a faithful copy of the
 * manager's words would be, and the assertions are the grounded result.
 */

const SALONS = [
  { id: "loc-1001", name: "North Salon" },
  { id: "loc-1002", name: "South Salon" },
  { id: "loc-1003", name: "West Salon" },
] as const;

const TEMPLATES = [
  { key: "dpoa", name: "Corrective Action Form" },
  { key: "coaching", name: "Coaching Form" },
] as const;

const HEADINGS = ["Attendance", "Late Opening", "Standards of Conduct"];

function person(input: {
  id: string;
  first: string;
  last: string;
  salonId: string;
  title: string;
  preferred?: string;
}): GroundedPerson {
  return {
    id: input.id,
    firstName: input.first,
    lastName: input.last,
    preferredFirstName: input.preferred ?? null,
    salonIds: [input.salonId],
    title: input.title,
    primaryLocationName: SALONS.find((salon) => salon.id === input.salonId)?.name ?? null,
  };
}

const JORDAN = person({
  id: "emp-jordan",
  first: "Jordan",
  last: "Hale",
  salonId: "loc-1001",
  title: "Salon Director",
});

const ALEX_NORTH = person({
  id: "emp-alex-n",
  first: "Alex",
  last: "Rivera",
  salonId: "loc-1001",
  title: "Salon Director",
});

const ALEX_SOUTH = person({
  id: "emp-alex-s",
  first: "Alex",
  last: "Rivera",
  salonId: "loc-1002",
  title: "Tanning Consultant",
});

function turn(overrides: Partial<IntentTurnInput> = {}): IntentTurnInput {
  return {
    question: "",
    history: [],
    today: "2026-10-23",
    saved: null,
    raw: null,
    people: [JORDAN],
    salons: SALONS,
    headings: HEADINGS,
    templates: TEMPLATES,
    formInProgress: false,
    ...overrides,
  };
}

describe("incident dates normalize from the forms they are typed in", () => {
  const cases: readonly [string, string | null][] = [
    ["2026-10-01", "2026-10-01"],
    ["10/1/2026", "2026-10-01"],
    ["10/01/2026", "2026-10-01"],
    ["10-1-2026", "2026-10-01"],
    ["10-1-26", "2026-10-01"],
    ["October 1, 2026", "2026-10-01"],
    ["october 1, 2026", "2026-10-01"],
    ["Oct. 1st 2026", "2026-10-01"],
    ["1 October 2026", "2026-10-01"],
    ["1st of October 2026", "2026-10-01"],
    ["october 1", "2026-10-01"],
    ["13/40/2026", null],
    ["February 31, 2026", null],
  ];

  it.each(cases)("%s → %s", (raw, iso) => {
    expect(normalizeIncidentDate(raw, "2026-10-23")).toBe(iso);
  });
});

describe("slots are grounded and only the missing ones are asked", () => {
  it("a lowercase name is the roster spelling, and a known date is not asked again", () => {
    const decision = decideIntentTurn(
      turn({
        question: "verbal corrective action for jordan hale at north salon. she showed up late on october 1, 2026. payroll $25.",
        raw: {
          employee: "jordan hale",
          salon: "north salon",
          title: null,
          incidentType: "showed up late",
          incidentDate: "october 1, 2026",
          payrollAmount: "$25",
          warningLevel: "verbal",
          formType: "corrective action",
          formTurn: true,
        },
      }),
    );
    expect(decision.clarification).toBeNull();
    expect(decision.state.employeeName).toBe("Jordan Hale");
    expect(decision.state.employeeId).toBe("emp-jordan");
    expect(decision.state.salonId).toBe("loc-1001");
    expect(decision.state.title).toBe("Salon Director");
    expect(decision.state.incidentType).toBe("Attendance");
    expect(decision.state.formDate).toBe("2026-10-01");
    expect(decision.state.payrollAmount).toBe("25");
    expect(decision.state.warningLevel).toBe("verbal");
    expect(decision.state.templateKey).toBe("dpoa");
    expect(decision.question).toContain("The employee is Jordan Hale.");
    expect(decision.question.toLowerCase()).not.toContain("i still need");
  });

  it("a typo of one person is that person", () => {
    const decision = decideIntentTurn(
      turn({
        question: "corrective action for jorden hale, showed up late on 10/1/2026, verbal",
        raw: {
          employee: "jorden hale",
          salon: null,
          title: null,
          incidentType: "showed up late",
          incidentDate: "10/1/2026",
          payrollAmount: null,
          warningLevel: "verbal",
          formType: "Corrective Action Form",
          formTurn: true,
        },
      }),
    );
    expect(decision.state.employeeName).toBe("Jordan Hale");
    expect(decision.state.incidentType).toBe("Attendance");
    expect(decision.clarification).toBeNull();
  });

  it("two people with one name are a choice that shows salon and title", () => {
    const decision = decideIntentTurn(
      turn({
        question: "corrective action for alex rivera, she showed up late on 10/1/2026, verbal",
        people: [ALEX_NORTH, ALEX_SOUTH],
        raw: {
          employee: "alex rivera",
          salon: null,
          title: null,
          incidentType: "showed up late",
          incidentDate: "10/1/2026",
          payrollAmount: null,
          warningLevel: "verbal",
          formType: "corrective action",
          formTurn: true,
        },
      }),
    );
    expect(decision.clarification).toContain("Which person did you mean");
    expect(decision.clarification).toContain("North Salon");
    expect(decision.clarification).toContain("South Salon");
    expect(decision.clarification).toContain("Salon Director");
    expect(decision.clarification).toContain("Tanning Consultant");
    expect(decision.clarification).not.toContain("I still need");
    expect(decision.state.employeeId).toBeNull();
  });

  it("a numbered reply selects that person and does not ask again", () => {
    const asked = decideIntentTurn(
      turn({
        question: "corrective action for alex rivera, showed up late on 10/1/2026, verbal",
        people: [ALEX_NORTH, ALEX_SOUTH],
        raw: { employee: "alex rivera", formType: "corrective action", formTurn: true, incidentDate: "10/1/2026", warningLevel: "verbal", incidentType: "showed up late" },
      }),
    );
    const decision = decideIntentTurn(
      turn({
        question: "2",
        people: [ALEX_NORTH, ALEX_SOUTH],
        history: [
          { role: "user", content: "corrective action for alex rivera, showed up late on 10/1/2026, verbal" },
          { role: "assistant", content: asked.clarification ?? "" },
        ],
        saved: asked.state,
        raw: { employee: null, formTurn: true },
      }),
    );
    expect(decision.state.employeeId).toBe("emp-alex-s");
    expect(decision.state.employeeName).toBe("Alex Rivera");
    expect(decision.state.title).toBe("Tanning Consultant");
    expect(decision.state.salonId).toBe("loc-1002");
    expect(decision.clarification ?? "").not.toContain("Which person");
  });

  it("a salon reply selects that person", () => {
    const asked = decideIntentTurn(
      turn({
        question: "alex rivera showed up late on 10-1-2026, verbal corrective action",
        people: [ALEX_NORTH, ALEX_SOUTH],
        raw: { employee: "Alex Rivera", formTurn: true, formType: "corrective action", incidentDate: "10-1-2026", warningLevel: "verbal" },
      }),
    );
    const decision = decideIntentTurn(
      turn({
        question: "the south salon one",
        people: [ALEX_NORTH, ALEX_SOUTH],
        history: [{ role: "assistant", content: asked.clarification ?? "" }],
        saved: asked.state,
        raw: { formTurn: true },
      }),
    );
    expect(decision.state.employeeId).toBe("emp-alex-s");
  });

  it("late opening is the heading only when the account is the salon opening late", () => {
    expect(headingFromAccount("she showed up late for her shift", HEADINGS)).toBe("Attendance");
    expect(headingFromAccount("SHE SHOWED UP LATE", HEADINGS)).toBe("Attendance");
    expect(headingFromAccount("she was late opening the salon", HEADINGS)).toBe("Late Opening");
    expect(headingFromAccount("opened the salon late on 10/1", HEADINGS)).toBe("Late Opening");
    expect(headingFromAccount("she showed up late", ["Late Opening"])).toBeNull();
  });

  it("asks only for the slots the conversation has not settled", () => {
    const decision = decideIntentTurn(
      turn({
        question: "corrective action for jordan hale, she showed up late",
        saved: { ...EMPTY_FORM_STATE, employeeName: "Jordan Hale", employeeId: "emp-jordan", salonId: "loc-1001", title: "Salon Director" },
        raw: {
          employee: "jordan hale",
          incidentType: "showed up late",
          formType: "corrective action",
          formTurn: true,
        },
      }),
    );
    // Warning level is ticked on the form. Asking it here replaced the card
    // when the same account was sent again (live, 23 Oct 2026).
    expect(decision.clarification).toBe("I still need the date it happened.");
    expect(decision.clarification).not.toContain("which employee");
    expect(decision.clarification).not.toContain("which salon");
  });

  it("two dates are a choice, and a date the text never stated is dropped", () => {
    const choice = decideIntentTurn(
      turn({
        question: "corrective action for jordan hale on 10/1/2026 and also 10/15/2026, verbal, showed up late",
        raw: { employee: "Jordan Hale", formType: "corrective action", formTurn: true, warningLevel: "verbal", incidentType: "showed up late" },
      }),
    );
    expect(choice.clarification).toContain("Which date");
    expect(choice.clarification).toContain("10/1/2026");
    expect(choice.clarification).toContain("10/15/2026");
    expect(choice.state.formDate).toBeNull();

    const invented = decideIntentTurn(
      turn({
        question: "corrective action for jordan hale, showed up late, verbal",
        raw: { employee: "Jordan Hale", incidentDate: "1999-01-01", formType: "corrective action", formTurn: true, warningLevel: "verbal", incidentType: "late" },
      }),
    );
    expect(invented.state.formDate).toBeNull();
    expect(invented.clarification).toContain("the date it happened");
  });

  it("reads payroll from dollars, a dollar sign, and a decimal", () => {
    expect(payrollAmounts("deduct 25 dollars and also $12.50").sort()).toEqual(["12.50", "25"]);
    const decision = decideIntentTurn(
      turn({
        question: "verbal corrective action for jordan hale at north salon on 1 October 2026, showed up late, payroll of 25.00 dollars",
        raw: {
          employee: "Jordan Hale",
          salon: "North Salon",
          incidentType: "showed up late",
          incidentDate: "1 October 2026",
          payrollAmount: "25.00 dollars",
          warningLevel: "verbal",
          formType: "corrective action",
          formTurn: true,
        },
      }),
    );
    expect(decision.state.payrollAmount).toBe("25.00");
    expect(decision.state.formDate).toBe("2026-10-01");
    expect(decision.clarification).toBeNull();
  });

  it("a name that is not on the roster stays on the form", () => {
    const decision = decideIntentTurn(
      turn({
        question: "verbal corrective action for Casey Quinn at north salon on 10/1/2026, showed up late",
        raw: {
          employee: "Casey Quinn",
          salon: "north salon",
          incidentDate: "10/1/2026",
          incidentType: "showed up late",
          warningLevel: "verbal",
          formType: "corrective action",
          formTurn: true,
        },
      }),
    );
    // The proposal says once that Woven does not have them. This turn must
    // not replace the card with a who-question (live, 23 Oct 2026).
    expect(decision.state.employeeName).toBe("Casey Quinn");
    expect(decision.state.employeeId).toBeNull();
    expect(decision.clarification).toBeNull();
  });

  it("a policy question does not get a form interview", () => {
    const decision = decideIntentTurn(
      turn({
        question: "what does the attendance section say about being on time?",
        raw: { formTurn: false, incidentType: "attendance" },
      }),
    );
    expect(decision.clarification).toBeNull();
    expect(decision.question).toBe("what does the attendance section say about being on time?");
    expect(decision.state.incidentType).toBe("Attendance");
  });

  it("keeps a stored slot when this turn does not restate it", () => {
    const decision = decideIntentTurn(
      turn({
        question: "verbal",
        saved: {
          ...EMPTY_FORM_STATE,
          employeeName: "Jordan Hale",
          employeeId: "emp-jordan",
          salonId: "loc-1001",
          title: "Salon Director",
          formDate: "2026-10-01",
          incidentType: "Attendance",
          templateKey: "dpoa",
        },
        formInProgress: true,
        raw: { warningLevel: "verbal", formTurn: true },
      }),
    );
    expect(decision.clarification).toBeNull();
    expect(decision.state.employeeName).toBe("Jordan Hale");
    expect(decision.state.warningLevel).toBe("verbal");
    expect(decision.state.formDate).toBe("2026-10-01");
  });

  it("a failed tool call still reads a date and a roster name out of the words", () => {
    const decision = decideIntentTurn(
      turn({
        question: "Jordan Hale showed up late on 10/01/2026",
        raw: null,
        formInProgress: true,
      }),
    );
    expect(decision.state.employeeName).toBe("Jordan Hale");
    expect(decision.state.formDate).toBe("2026-10-01");
    expect(decision.state.incidentType).toBe("Attendance");
  });
});

describe("INTENT_EXTRACTION_ENABLED", () => {
  it("is off unless set to 1, true, on, or yes", () => {
    const previous = process.env.INTENT_EXTRACTION_ENABLED;
    try {
      for (const value of [undefined, "", "0", "false", "off", "no", "YES "]) {
        if (value === undefined) delete process.env.INTENT_EXTRACTION_ENABLED;
        else process.env.INTENT_EXTRACTION_ENABLED = value;
        const on = value === "YES ";
        expect(intentExtractionEnabled()).toBe(on);
      }
      for (const value of ["1", "true", "on", "yes", " TRUE "]) {
        process.env.INTENT_EXTRACTION_ENABLED = value;
        expect(intentExtractionEnabled()).toBe(true);
      }
    } finally {
      if (previous === undefined) delete process.env.INTENT_EXTRACTION_ENABLED;
      else process.env.INTENT_EXTRACTION_ENABLED = previous;
    }
  });
});
