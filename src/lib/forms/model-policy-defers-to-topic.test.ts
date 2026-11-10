import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { topicHeadings } from "./specific-policy-topics";

/**
 * MODEL_POLICY_DEFERS_TO_TOPIC_ENABLED (QA, round-7c live test, 9 Nov 2026; the person invented): the headings the incident
 * the manager's words name is cited under, against which the slot model's policy heading is checked (`ai/intent-slots.ts`).
 * The route is covered by the replay pack (`nov9-model-policy-defers-to-topic-cases.ts`).
 */
beforeEach(() => vi.stubEnv("POLICY_SPECIFIC_TOPICS_ENABLED", "true"));
afterEach(() => vi.unstubAllEnvs());

describe("topicHeadings", () => {
  it.each([
    "I need another corrective action for Corwin Ashgrove, his cash drawer was short $20 on 11/3",
    "I need another corrective action for Corwin Ashgrove for his cash drawer being short $20 on 11/3",
    "create a corrective action for Corwin Ashgrove, his cash drawer was short $20 on 11/3",
  ])("%s → the Standards of Conduct only (never Handling Theft)", (said) => {
    expect(topicHeadings(said)).toEqual(["Standards of Conduct"]);
  });

  it("theft → the Standards of Conduct and Handling Theft", () => {
    expect(topicHeadings("he stole $40 from the register")).toEqual(["Standards of Conduct", "Handling Theft"]);
  });

  it.each(["create a corrective action for Corwin Ashgrove, she took $20 from the register on 11/3", "he was late opening the salon on 11/2"])(
    "%s → none: the model's heading stands",
    (said) => {
      expect(topicHeadings(said)).toBeNull();
    },
  );
});
