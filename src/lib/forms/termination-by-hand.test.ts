import { describe, expect, it } from "vitest";

import { checkboxGroupsForVariant } from "./document";
import { refuseSensitiveSelections } from "./escalation-guard";
import { correctiveActionDocument } from "./library";
import { canPersonEdit, enforcePersonEdit } from "./responsibility";

/**
 * QA, 15 Nov 2026, from a salon manager on a revision of a finalized Corrective Action Form: "under the type of
 * warning drop down box I can't select Termination." `escalation-guard.ts`: the assistant never ticks a final
 * employment action, and "a manager acting on a leadership decision ticks them by hand". Every save of a person's own
 * ticks — the form page on a new draft, a revision draft, and the finalized form's "Change something" — goes through
 * `enforcePersonEdit`, so this is the rule for all three.
 */
describe("a manager ticks Termination by hand on a Corrective Action Form", () => {
  const document = correctiveActionDocument();
  const warning = checkboxGroupsForVariant(document, null).find((group) => group.key === "warning_type")!;

  it("the template offers Termination and a person may tick the Type of Warning", () => {
    expect(warning.options.map((option) => option.key)).toContain("termination");
    expect(canPersonEdit(warning.responsibility)).toBe(true);
  });

  it("the manager's own Termination is saved, not refused", () => {
    const result = enforcePersonEdit(document, null, { checked: { warning_type: ["termination"] } });
    expect(result.rejected).toEqual([]);
    expect(result.checked.warning_type).toEqual(["termination"]);
  });

  it("only the assistant's draft has it taken off", () => {
    const drafted = refuseSensitiveSelections({ document, variantKey: null, checked: { warning_type: ["termination"] } });
    expect(drafted.checked.warning_type ?? []).not.toContain("termination");
  });
});
