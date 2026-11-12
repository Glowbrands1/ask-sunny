import { afterEach, describe, expect, it, vi } from "vitest";

import { withCardPlanAsCreate } from "./card-plan-matches-create";

/* CARD_PLAN_MATCHES_CREATE_ENABLED (ported from the sibling app: QA's Bubbles 17l live test, 12 Nov 2026; ruling B). Invented person. */
const GENERAL = "**Action plan:** Management will review the Attendance policy with Remy. Future policy violations may result in additional corrective action up to and including termination of employment.";
const PAU =
  "**Action plan:** Remy is expected to arrive on time for all scheduled shifts moving forward. Leadership will monitor Remy's attendance closely and provide coaching as needed. A follow-up meeting will be scheduled to review progress. Continued lateness will result in further disciplinary review per company policy. Future policy violations may result in additional corrective action up to and including termination of employment.";
const card = (policy: string, plan = GENERAL, templateKey = "dpoa") => ({
  content: `Here's what I'll fill in …\n\n**Policy:** ${policy}\n\n${plan}\n\nCreate the draft here when you're ready.`,
  formProposal: { templateKey, employeeName: "Remy Calder" },
});
const ACCOUNT = "create a written CA for Remy Calder, she was 20 minutes late on 11/9/26, no action plan";

afterEach(() => vi.unstubAllEnvs());

describe("CARD_PLAN_MATCHES_CREATE_ENABLED", () => {
  it("off: the card as built", () => {
    vi.stubEnv("ATTENDANCE_ACTION_PLAN_ENABLED", "true");
    expect(withCardPlanAsCreate(card("Attendance (JBA Policy Manual p.14), as you said."), ACCOUNT).content).toContain(GENERAL);
  });

  describe("on (with ATTENDANCE_ACTION_PLAN)", () => {
    const on = () => {
      vi.stubEnv("CARD_PLAN_MATCHES_CREATE_ENABLED", "true");
      vi.stubEnv("ATTENDANCE_ACTION_PLAN_ENABLED", "true");
    };

    it.each([
      "Attendance (JBA Policy Manual p.14), as you said.",
      "Attendance, from what you described (\"late\") — the policy manual's section on page 14.",
    ])("an Attendance CA shows Pau's attendance plan: %s", (policy) => {
      on();
      const out = withCardPlanAsCreate(card(policy), ACCOUNT).content;
      expect(out).toContain(PAU);
      expect(out).not.toContain(GENERAL);
    });

    it("a plan line naming no policy is replaced too, when the Policy line cites Attendance", () => {
      on();
      const general = "**Action plan:** Management will review the applicable company policy with Remy. Future policy violations may result in additional corrective action up to and including termination of employment.";
      expect(withCardPlanAsCreate(card("Attendance (JBA Policy Manual p.14), as you said.", general), ACCOUNT).content).toContain(PAU);
    });

    it.each([
      ["Late Opening (JBA Policy Manual p.15), as you said.", ACCOUNT],
      ["Standards of Conduct (JBA Policy Manual p.20), as you said.", ACCOUNT],
      ["Attendance (JBA Policy Manual p.14), as you said.", "make me an CA for Remy Calder missing her saturday and sunday shifts"],
      ["Attendance (JBA Policy Manual p.14), as you said.", "create a written CA for Remy Calder for not attending the monthly meeting on 10-20-26"],
    ])("kept as built: %s / %s", (policy, account) => {
      on();
      // The missed-shift and missed-meeting readers are on in production; the draft route's writer reads the same.
      vi.stubEnv("MISSED_SHIFT_NOT_LATENESS_ENABLED", "true");
      vi.stubEnv("MEETING_NOT_LATENESS_PLAN_ENABLED", "true");
      expect(withCardPlanAsCreate(card(policy), account).content).toContain(GENERAL);
    });

    it("never on another form, and never without ATTENDANCE_ACTION_PLAN", () => {
      on();
      expect(withCardPlanAsCreate(card("Attendance", GENERAL, "coaching"), ACCOUNT).content).toContain(GENERAL);
      vi.stubEnv("ATTENDANCE_ACTION_PLAN_ENABLED", "false");
      expect(withCardPlanAsCreate(card("Attendance"), ACCOUNT).content).toContain(GENERAL);
    });
  });
});
