import { describe, expect, it } from "vitest";

import { employeeState, extractEmployeeNames, managerContext, tidyTypedName } from "./proposal";

/**
 * QA, 22 Oct 2026 — who the form is for, read from the manager's own turns.
 *
 *   F-02  a reply that is only a salon ("kearney", "sorry, it's grand island")
 *         replaced the employee already named
 *   F-09  a role between "for" and the name ("for the manager Jane Doe", "for
 *         her coworker Amy Lee") hid the person; "Her coworker Amy Lee" at the
 *         start of a sentence was read as a second subject
 *   F-06  "for pat rivera and sam jones" named only Pat, so a form went to one
 *         of two people without a word
 *   spelling  the manager's spelling is kept (exact directory matches are
 *         applied in `form-proposal.ts`, not here)
 *
 * Every person is synthetic.
 */

/** The employee after the manager's turns, read the way the proposal reads them. */
function after(...turns: string[]) {
  const history = turns.slice(0, -1).map((content, index) => ({ id: `u${index}`, role: "user" as const, content }));
  return employeeState(managerContext(history, { id: "now", content: turns[turns.length - 1]! })).resolution;
}

const OPENED = "create a coaching form for pat rivera, late 3 times this week";

describe("spelling: the manager's own", () => {
  it.each([
    ["coaching form for jane doe", "jane doe"],
    ["COACHING FORM FOR JANE DOE", "JANE DOE"],
    ["coaching form for Jane McDonald", "Jane McDonald"],
    ["coaching form for jd smith", "jd smith"],
  ])("%s", (text, employee) => {
    expect(after(text)).toEqual({ kind: "resolved", employeeName: employee });
  });

  it("only the spacing is tidied", () => {
    expect(tidyTypedName("  jane   doe ")).toBe("jane doe");
    expect(tidyTypedName("JOHN SMITH III")).toBe("JOHN SMITH III");
    expect(tidyTypedName("de la cruz")).toBe("de la cruz");
  });
});
