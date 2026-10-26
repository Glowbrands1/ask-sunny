import { afterEach, describe, expect, it, vi } from "vitest";

import { readCaPolicy } from "@/lib/forms/ca-policy";

import { EMPTY_FORM_STATE, prependFormState, stateSentences } from "./form-state";
import { decideIntentTurn, type IntentTurnInput } from "./intent-slots";
import type { GroundedPerson } from "./grounded-entities";
import { managerPolicyHeadings } from "./policy-heading-stated";

/**
 * ============================================================================
 * THE SAME WORDS, THE SAME POLICY (POLICY_HEADING_STATED_ONLY_ENABLED)
 * ============================================================================
 *
 * QA, 25-26 Oct 2026, Sunny production (names invented): "Create a verbal
 * corrective action for <name> for missing the 10-15-26 woven deadline" /
 * "Prior coaching jba policy manual 7-29-26" / "No payroll deduct" cited
 * "**Policy:** Attendance, as you said" on some runs and Standards of Conduct
 * p.12 on others, in every casing (conv_mvoiqhqf2zhcmij, conv_mvok4e392bdwu5t
 * vs conv_mvok53pb2v5ds3p). The slot model's policyHeading was accepted as a
 * real heading and written back as "Policy reference: Attendance, …".
 *
 * The model's reading is mocked here to return "Attendance", as on the bad
 * runs; ten times per casing the form state carries no Attendance and the
 * code's reading of the account is the Standards of Conduct (the card's
 * p.12 comes from that reading). A manager who names Attendance keeps Attendance; "late opening"
 * keeps Late Opening p.15.
 */

const SALONS = [{ id: "loc-1001", name: "North Salon" }] as const;
const TEMPLATES = [
  { key: "dpoa", name: "Corrective Action Form" },
  { key: "coaching", name: "Coaching Form" },
] as const;
const HEADINGS = ["Attendance", "Late Opening", "Standards of Conduct", "Dress Code for The Company"];
const PAGES = { Attendance: 14, "Late Opening": 15, "Standards of Conduct": 12, "Dress Code for The Company": 15 };

const ODA: GroundedPerson = {
  id: "emp-oda",
  firstName: "Oda",
  lastName: "Lindqvist",
  preferredFirstName: null,
  salonIds: ["loc-1001"],
  title: "Tanning Consultant",
  primaryLocationName: "North Salon",
};

function turn(question: string, raw: Record<string, unknown>, history: IntentTurnInput["history"] = []): IntentTurnInput {
  return {
    question,
    history,
    today: "2026-10-26",
    saved: null,
    raw,
    people: [ODA],
    salons: SALONS,
    headings: HEADINGS,
    headingPages: PAGES,
    templates: TEMPLATES,
    formInProgress: false,
  };
}

const MODEL_SAYS_ATTENDANCE = {
  employee: "oda lindqvist",
  salon: null,
  title: null,
  incidentType: "missed woven deadline",
  incidentDate: "10-15-26",
  payrollAmount: null,
  warningLevel: "verbal",
  formType: "corrective action",
  formTurn: true,
  policyHeading: "Attendance",
};

const WOVEN = "Create a verbal corrective action for oda lindqvist for missing the 10-15-26 woven deadline";
const CASINGS = [WOVEN, WOVEN.toLowerCase(), WOVEN.charAt(0).toUpperCase() + WOVEN.slice(1).toLowerCase(), WOVEN.toUpperCase()];

afterEach(() => vi.unstubAllEnvs());
const on = () => vi.stubEnv("POLICY_HEADING_STATED_ONLY_ENABLED", "true");

describe("flag off: the model's Attendance is taken (the bug)", () => {
  it("the form state says Policy reference: Attendance", () => {
    const decision = decideIntentTurn(turn(WOVEN, MODEL_SAYS_ATTENDANCE));
    expect(decision.state.policyHeading).toBe("Attendance");
    expect(stateSentences(decision.state).join(" ")).toContain("Policy reference: Attendance");
  });
});

describe("flag on: Standards of Conduct p.12 every time, in every casing", () => {
  it.each(CASINGS)("%s (x10)", (question) => {
    on();
    for (let run = 0; run < 10; run += 1) {
      const decision = decideIntentTurn(turn(question, MODEL_SAYS_ATTENDANCE));
      // No invented "Policy reference: Attendance"; the code's reading of the account decides.
      expect(decision.state.policyHeading).toBeNull();
      expect(stateSentences(decision.state).join(" ")).not.toMatch(/Attendance/);
      const reading = readCaPolicy(prependFormState(question, decision.state));
      expect(reading.stated).toBeNull();
      expect(reading.suggestion).toBe("standards_of_conduct");
    }
  });

  it("the later turns keep it, even with Attendance saved from a bad run", () => {
    on();
    const saved = { ...EMPTY_FORM_STATE, policyHeading: "Attendance", policyPage: 14 };
    const history = [
      { role: "user", content: WOVEN },
      { role: "assistant", content: "**Policy:** Attendance, as you said." },
    ];
    for (const question of ["Prior coaching jba policy manual 7-29-26", "No payroll deduct", "no payroll deduct"]) {
      const decision = decideIntentTurn({ ...turn(question, MODEL_SAYS_ATTENDANCE, history), saved });
      expect(decision.state.policyHeading, question).toBeNull();
      expect(stateSentences(decision.state).join(" "), question).not.toMatch(/Policy reference: Attendance/);
    }
  });
});

describe("flag on: what the manager named still wins", () => {
  it.each(["not standards of conduct, its attendance", "the policy violated is attendance", "The policy violated is attendance"])(
    "%s keeps Attendance",
    (named) => {
      on();
      const decision = decideIntentTurn(
        turn(named, MODEL_SAYS_ATTENDANCE, [{ role: "user", content: WOVEN }]),
      );
      expect(decision.state.policyHeading).toBe("Attendance");
    },
  );

  it.each(["oda lindqvist opened the salon late on 10-20-26", "Oda lindqvist opened the salon late on 10-20-26", "ca for oda, late opening 10-20"])(
    "%s keeps Late Opening p.15",
    (account) => {
      on();
      const decision = decideIntentTurn(turn(account, { ...MODEL_SAYS_ATTENDANCE, policyHeading: "Late Opening" }));
      expect(decision.state.policyHeading).toBe("Late Opening");
      expect(decision.state.policyPage).toBe(15);
    },
  );

  it("a model heading the manager's words support is kept", () => {
    on();
    const decision = decideIntentTurn(turn("oda lindqvist was 20 minutes late to her shift", MODEL_SAYS_ATTENDANCE));
    expect(decision.state.policyHeading).toBe("Attendance");
  });

  it("the code reads no policy: the model's catch-all Standards of Conduct stands, as before", () => {
    on();
    const decision = decideIntentTurn(
      turn("oda lindqvist was rude to a client", { ...MODEL_SAYS_ATTENDANCE, policyHeading: "Standards of Conduct" }),
    );
    expect(decision.state.policyHeading).toBe("Standards of Conduct");
  });

  it("with nothing to support any heading, none is set", () => {
    on();
    const decision = decideIntentTurn(turn("create a coaching form for oda lindqvist", MODEL_SAYS_ATTENDANCE));
    expect(decision.state.policyHeading).toBeNull();
  });
});

/* QA-6, 26 Oct 2026: a negated mention supports no heading; a negated incident verb still does what it did. */
describe("flag on: negated mentions support nothing", () => {
  const HEADINGS = ["Attendance", "Dress Code for The Company", "Standards of Conduct", "Late Opening"];
  const registers = (text: string) => [text, text.charAt(0).toUpperCase() + text.slice(1), text.toUpperCase()];
  it.each(
    [
      ["never attendance", []],
      ["she was not late, she was rude to a client", []],
      ["attendance is not the issue, dress code is", ["Dress Code for The Company"]],
      ["attendance isn't the problem", []],
    ].flatMap(([text, expected]) => registers(text as string).map((typed) => [typed, expected] as const)),
  )("%s", (text, expected) => {
    vi.stubEnv("POLICY_HEADING_STATED_ONLY_ENABLED", "true");
    expect(managerPolicyHeadings(text, HEADINGS)).toEqual(expected);
  });

  it.each(["ca for marlo no call no show", "she was 20 minutes late to her shift", "not standards of conduct, its attendance"])(
    "%s still supports Attendance",
    (text) => {
      vi.stubEnv("POLICY_HEADING_STATED_ONLY_ENABLED", "true");
      expect(managerPolicyHeadings(text, HEADINGS)).toContain("Attendance");
    },
  );
});
