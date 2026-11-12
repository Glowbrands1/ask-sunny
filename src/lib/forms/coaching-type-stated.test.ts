import { afterEach, describe, expect, it, vi } from "vitest";

import { statedCoachingType } from "./coaching-type-stated";

/* COACHING_TYPE_STATED_TICKS_ENABLED (QA's Bubbles 17p live check, 12 Nov 2026); invented wording. */
const OFFERED = ["underperformance", "training_plan_of_action", "retraining"];

describe("COACHING_TYPE_STATED_TICKS", () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    ["coaching on under performance", "underperformance"],
    ["this is for underperformance on sales", "underperformance"],
    ["she is under-performing on add-ons", "underperformance"],
    ["coaching for retraining on the register", "retraining"],
    ["put her on a training plan of action", "training_plan_of_action"],
  ])("on: %j ticks %j", (said, type) => {
    vi.stubEnv("COACHING_TYPE_STATED_TICKS_ENABLED", "true");
    expect(statedCoachingType(`create a coaching for Ilsa Varnholt, ${said}`, OFFERED)).toBe(type);
  });

  it("on: two types, a negated type, a type the form does not offer, or none state nothing", () => {
    vi.stubEnv("COACHING_TYPE_STATED_TICKS_ENABLED", "true");
    expect(statedCoachingType("underperformance and retraining", OFFERED)).toBeNull();
    expect(statedCoachingType("this is not underperformance, she missed a meeting", OFFERED)).toBeNull();
    expect(statedCoachingType("coaching on under performance", ["retraining"])).toBeNull();
    expect(statedCoachingType("create a coaching for Ilsa Varnholt, she missed a meeting", OFFERED)).toBeNull();
  });

  it("off: nothing is read", () => {
    vi.stubEnv("COACHING_TYPE_STATED_TICKS_ENABLED", "");
    expect(statedCoachingType("coaching on under performance", OFFERED)).toBeNull();
  });
});
