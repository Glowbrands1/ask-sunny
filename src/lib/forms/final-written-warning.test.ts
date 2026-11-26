import { afterEach, describe, expect, it, vi } from "vitest";

import { refuseSensitiveSelections, SENSITIVE_ACTION_OPTION_KEYS } from "./escalation-guard";
import { correctiveActionDocument, TEMPLATE_SEEDS } from "./library";
import { applyRequiredClosings, CA_ACTION_PLAN_CLOSING, closingForDisplay, FINAL_WARNING_PLAN_CLOSING } from "./required-closing";
import { FINAL_WARNING_LABEL, statedWarningLevel, warningLevelLabel, withFinalWritten } from "./warning-level";

/**
 * The owner's scope list from QA's Ask Vicki comparison (26 Nov 2026), kept from the first list: "A Final Written
 * Warning option on the Corrective Action / disciplinary form. Its standard Action Plan ending is "Further violations
 * may result in additional disciplinary action, up to and including termination, following leadership review." It is
 * not a termination, so no termination notice is sent." Remy Calder is invented (the replay pack's STAFF).
 */
const SAID = "Final written warning for Remy Calder, late again today";

afterEach(() => vi.unstubAllEnvs());

function warningOptions(): string[] {
  const document = correctiveActionDocument();
  const group = document.blocks.find((block) => block.kind === "checkbox_group" && block.key === "warning_type") as { options: { key: string; label: string }[] } | undefined;
  return group?.options.map((option) => `${option.key}:${option.label}`) ?? [];
}

describe("Final Written Warning on the Corrective Action Form (revision 10)", () => {
  it("is an option of Type of Warning, after Written Warning, and the revision is 10", () => {
    expect(warningOptions()).toEqual(["verbal:Verbal Warning", "written:Written Warning", "final_warning:Final Written Warning", "termination:Termination", "demotion:Demotion"]);
    expect(TEMPLATE_SEEDS.find((seed) => seed.key === "dpoa")?.revision).toBe(10);
    expect(warningLevelLabel("final_warning")).toBe(FINAL_WARNING_LABEL);
  });

  it("is not a termination: never refused as a final employment action", () => {
    expect(SENSITIVE_ACTION_OPTION_KEYS.has("final_warning")).toBe(false);
    const result = refuseSensitiveSelections({ document: correctiveActionDocument(), variantKey: null, checked: { warning_type: ["final_warning"] } });
    expect(result.checked).toEqual({ warning_type: ["final_warning"] });
  });

  it("ends its Action Plan with the owner's closing, word for word, in place of the future-violations closing", () => {
    const plan = "Management will review the Attendance Policy with Remy Calder.";
    const closed = applyRequiredClosings(correctiveActionDocument(), null, { action_plan: `${plan} ${CA_ACTION_PLAN_CLOSING}` }, { finalWarningTicked: true });
    expect(closed.action_plan).toBe(`${plan} ${FINAL_WARNING_PLAN_CLOSING}`);
    expect(FINAL_WARNING_PLAN_CLOSING).toBe("Further violations may result in additional disciplinary action, up to and including termination, following leadership review.");
    // The page prints it as saved, never with the future-violations closing after it.
    expect(closingForDisplay(closed.action_plan!, CA_ACTION_PLAN_CLOSING)).toBe(closed.action_plan);
    // Unticked again: the plan's own closing returns, once.
    const reverted = applyRequiredClosings(correctiveActionDocument(), null, { action_plan: closed.action_plan! }, { finalWarningTicked: false });
    expect(reverted.action_plan).toBe(`${plan} ${CA_ACTION_PLAN_CLOSING}`);
  });

  it(`"${SAID}": the manager's level is the Final Written Warning with FINAL_WRITTEN_WARNING_ENABLED on, Written with it off`, () => {
    vi.stubEnv("CA_SHORTCUT_WORDS_ENABLED", "true");
    expect(statedWarningLevel(SAID)).toBe("written");
    vi.stubEnv("FINAL_WRITTEN_WARNING_ENABLED", "true");
    expect(statedWarningLevel(SAID)).toBe("final_warning");
    expect(statedWarningLevel("create a final written CA for Remy Calder")).toBe("final_warning");
    // Not history, and not a plain written.
    expect(statedWarningLevel("written warning for Remy Calder, she had a final written before")).not.toBe("final_warning");
    expect(withFinalWritten("written", "written CA for Remy Calder")).toBe("written");
    // A form without the option (an older version) keeps Written.
    expect(withFinalWritten("written", SAID, ["verbal", "written", "termination", "demotion"])).toBe("written");
  });
});
