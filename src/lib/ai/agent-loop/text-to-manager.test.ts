import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { withoutTextToManager } = await import("./tools");

/* QA hotfix (17 Nov 2026): an account never holds text to the manager. Invented names. */
describe("withoutTextToManager", () => {
  const c019 = "create corrective action for for Remy Calder for Late Opening from the policy manual. It is a verbal warning";
  it("takes out the helper line the model wrote into the account (Runner 2's c019, live r2)", () => {
    expect(withoutTextToManager("Late Opening. — that's your words for the offense; add any details before you press Create.", c019))
      .toEqual({ text: "Late Opening.", removed: ["— that's your words for the offense; add any details before you press Create."] });
    expect(withoutTextToManager("Late Opening. (from the offense you named - add more detail before Create if you'd like)", c019).text).toBe("Late Opening.");
    expect(withoutTextToManager("Late Opening (from the offense you named).", c019).text).toBe("Late Opening.");
  });
  it("keeps the manager's own second person: a quoted guest, and an account written to the employee (c200)", () => {
    const quoted = "She told the guest 'you can wait' and walked away.";
    expect(withoutTextToManager(quoted, "ca for remy calder, she told the guest 'you can wait' and walked away")).toEqual({ text: quoted, removed: [] });
    const c200 = "The last two Sunday shifts, you were scheduled to arrive at 9:30 AM but did not arrive until 9:40 AM.";
    expect(withoutTextToManager(c200, "Remy Calder ast two Sunday shifts. Both Sundays, you were scheduled to arrive at 9:30 AM but did not arrive until 9:40 AM")).toEqual({ text: c200, removed: [] });
  });
  it("leaves an account with no second person as it is", () => {
    expect(withoutTextToManager("She was late on 11/14.", "ca for remy, late 11/14")).toEqual({ text: "She was late on 11/14.", removed: [] });
  });
});
