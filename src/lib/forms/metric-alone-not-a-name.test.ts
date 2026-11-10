import { afterEach, describe, expect, it } from "vitest";

import { namesAMetric } from "./request-slot";

/**
 * METRIC_ALONE_NOT_A_NAME_ENABLED (ported from Ask Bubbles: QA's prod-env reading there, 10 Nov 2026, D4). The wording is
 * `ai/corrective-action-conversation.test.ts`'s: "Their Club Close is low. Create a corrective action." drafted the form
 * for an employee named "Club Close".
 */
const FLAG = "METRIC_ALONE_NOT_A_NAME_ENABLED";
const SAID = "Their Club Close is low. Create a corrective action.";

afterEach(() => {
  delete process.env[FLAG];
});

describe("METRIC_ALONE_NOT_A_NAME: a phrase said to be low is a metric", () => {
  it("flag off (as before): \"Club Close\" is not read as a metric", () => {
    expect(namesAMetric("Club Close", SAID)).toBe(false);
  });

  it("flag on: \"Club Close\" is a metric", () => {
    process.env[FLAG] = "true";
    expect(namesAMetric("Club Close", SAID)).toBe(true);
    expect(namesAMetric("Club Close", "the salon's Club Close has been down all month, create a CA")).toBe(true);
  });

  it("flag on, NEVER-BREAK: a person typed bare is never read as a metric", () => {
    process.env[FLAG] = "true";
    expect(namesAMetric("Remy Calder", "Remy Calder is behind on cleaning, create a written")).toBe(false);
    expect(namesAMetric("Remy Calder", "Remy Calder's Club Close is low and she was late again")).toBe(false);
  });
});
