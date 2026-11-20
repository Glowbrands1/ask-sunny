import { describe, expect, it } from "vitest";

import { agentLoopTools } from "./run";

/*
 * Pau's live chat (20 Nov 2026, 14:23Z): find_past_forms calls with no forms_on_file_evidence were refused, two in one step,
 * and the call with evidence was then stopped by the retry guard. The schema requires the evidence (replay case:
 * nov20-agent-loop-forms-on-file-parallel-refusals-cases.ts).
 */
describe("find_past_forms' schema", () => {
  it("requires forms_on_file_evidence", () => {
    const tool = agentLoopTools().find((entry) => entry.name === "find_past_forms");
    expect((tool?.input_schema as { required?: unknown } | undefined)?.required).toEqual(["forms_on_file_evidence"]);
  });
});
