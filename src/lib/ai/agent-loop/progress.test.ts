import { describe, expect, it } from "vitest";

import { STATUS_NAME_MAX, plainStatusName, progressStatus } from "./progress";

/** PR 6 item 5: a status from the tool's name and input only; the one echoed input (a name) is plain text, at most 40 characters. */
describe("progressStatus", () => {
  it("one short status per tool, from its name", () => {
    expect(progressStatus("find_staff", { name: "remy calder" })).toBe("Looking up remy calder…");
    expect(progressStatus("read_policy", { heading: "Attendance" })).toBe("Reading the policy…");
    expect(progressStatus("propose_form", { template_key: "dpoa", what_happened: "She was late." })).toBe("Building the card…");
    expect(progressStatus("edit_form", { instance_id: "x", values: { observation: "secret text" } })).toBe("Updating the form…");
    expect(progressStatus("find_past_forms", { employee_name: "Remy Calder" })).toBe("Checking forms on file…");
    expect(progressStatus("no_such_tool", {})).toBe("Working on it…");
  });

  it("never echoes another tool's input (account text, values, policy words)", () => {
    for (const tool of ["propose_form", "edit_form", "read_policy", "search_knowledge", "find_past_forms", "read_form"]) {
      expect(progressStatus(tool, { what_happened: "Tamsin was rude", values: { observation: "Tamsin" }, heading: "Tamsin", query: "Tamsin", employee_name: "Tamsin" })).not.toContain("Tamsin");
    }
  });

  it("the name is plain text: no markdown or HTML characters, one line, at most 40 characters", () => {
    expect(plainStatusName("**Remy** <b>Calder</b>")).toBe("Remy b Calder /b");
    expect(plainStatusName("[Remy](https://x.test)\n`Calder`")).toBe("Remy https://x.test Calder");
    const long = plainStatusName("Remy ".repeat(20));
    expect(long.length).toBeLessThanOrEqual(STATUS_NAME_MAX);
    expect(long.endsWith("…")).toBe(true);
    expect(progressStatus("find_staff", { name: "  " })).toBe("Looking up your staff…");
    expect(progressStatus("find_staff", { name: 42 })).toBe("Looking up your staff…");
  });
});
