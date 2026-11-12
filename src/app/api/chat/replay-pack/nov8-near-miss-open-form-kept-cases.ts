import { expect } from "vitest";

import { KEARNEY, type ReplayCase } from "./cases";
import { STEP_B_REFUSAL_SCENARIOS } from "./nov7-step-b-refusals-scenarios";

/**
 * NEAR_MISS_QUESTION_RULES_ENABLED (QA's Sunny round-4 gate, 8 Nov 2026: nov7-refusal-sun-msb-format turn 3, with
 * FORM_NAME + ROSTER_NEAR_MISS on): the draft was created, and "I need the CA for the Must see behaviors and not the
 * standard of conduct …" was answered with only "Is this for **<the form's employee>**?" — the open form replaced by
 * the bare question. The form on screen is never replaced by it. The scenario's own steps (sun-msb-format, people
 * invented); here the model's scripted reads are left out, so only the card and the question are checked.
 */
const NAME_SET = ["FORM_NAME_FROM_ROSTER_ENABLED", "ROSTER_NEAR_MISS_ENABLED"];
const RULES = "NEAR_MISS_QUESTION_RULES_ENABLED";
const scenario = STEP_B_REFUSAL_SCENARIOS.find((item) => item.id === "sun-msb-format")!;

export const NOV8_NEAR_MISS_OPEN_FORM_KEPT_CASES: ReplayCase[] = [
  {
    id: "nov8-near-miss-open-form-kept-sun-msb-format",
    title: "sun-msb-format with FORM_NAME + ROSTER_NEAR_MISS on: turn 3 keeps the form on screen's card, never the bare \"Is this for <them>?\"",
    report: "QA's Sunny round-4 gate (8 Nov 2026): nov7-refusal-sun-msb-format turn 3 replaced the open form with a bare question",
    status: "fixed",
    fixFlags: [...NAME_SET, RULES],
    async run(t) {
      t.directory(scenario.roster);
      t.as("salon_director", KEARNEY);
      if (scenario.script.draft || scenario.script.checked) t.draftWrites({ ...(scenario.script.draft ?? {}) }, scenario.script.checked ? { ...scenario.script.checked } : undefined);
      const thread = t.thread();
      let last = "";
      for (const step of scenario.steps) {
        if ("create" in step) {
          await thread.create();
          continue;
        }
        last = (await thread.say(step.say)).content;
      }
      expect(last, `the form on screen was replaced by the bare question:\n${last}`).not.toMatch(/^Is this for \*\*[^*]+\*\*\? Tell me if that should change\.\s*$/);
    },
  },
];
