import { expect } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";

/**
 * POLICY_GATE_NONBLOCKING_ENABLED (Gate-Sunny's review, 10 Nov 2026): with the flag on, a blank Direct policy no longer
 * holds the finalize. Before #807 the open-form summary then told the answering model "Its policy lines, where it has
 * any, were quoted from the official manual." for a draft whose Direct policy was blank, which could let it say a blank
 * policy was checked. No replay case had reached that line: every open draft's policy was verified or absent.
 *
 * Holds flag off (the blank field is listed as not yet checked) and on (it is listed as blank and not checked).
 */
export const NOV10_BLANK_DIRECT_POLICY_CASES: readonly ReplayCase[] = [
  {
    id: "nov10-blank-direct-policy-never-called-verified",
    title: "a draft whose Direct policy is blank is never described to the model as quoted from the official manual",
    report:
      "Gate-Sunny, POLICY_GATE_NONBLOCKING flag-only gate (10 Nov 2026): with the flag on, a blank Direct policy dropped out of the summary's not-yet-checked list, so the model read \"Its policy lines, where it has any, were quoted from the official manual.\"",
    // Holds with production's flags (the gate is blocking there); the fix-flag run pins the non-blocking path.
    status: "fixed",
    fixFlags: ["POLICY_GATE_NONBLOCKING_ENABLED", "NEXT_PUBLIC_POLICY_GATE_NONBLOCKING_ENABLED"],
    async run(t) {
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say("I need to create a verbal corrective action form");
      await thread.say("Remy Calder");
      expect(thread.proposal?.employeeName).toBe("Remy Calder");
      t.draftWrites({});
      const id = await thread.create();
      t.typeOnForm(id, { policy_language: "" });
      expect((t.values(id).policy_language ?? "").trim(), "precondition: the Direct policy is blank").toBe("");
      const before = (t.answerSystems?.() ?? []).length;
      await thread.say("did you check the policy on this form?");
      const systems = (t.answerSystems?.() ?? []).slice(before);
      expect(systems.length, "the answering model was not asked").toBeGreaterThan(0);
      const system = systems.at(-1)!;
      expect(system, "the open form was not described to the model").toMatch(/A FORM IS OPEN IN THIS CONVERSATION/);
      expect(system, "a blank Direct policy was described as quoted from the official manual").not.toMatch(
        /were quoted from the official manual/,
      );
      expect(system, "the blank Direct policy was not named as unchecked").toMatch(
        /(Not yet checked against the official manual|Blank, so nothing on it was checked against the official manual)[^\n]*Direct policy/i,
      );
    },
  },
];
