import { afterEach, describe, expect, it, vi } from "vitest";

import { shownFieldLines, updatedKeysShown } from "./revision-shown-fields";

/*
 * REVISION_REPLY_SHOWS_FIELDS_ENABLED (QA, the Sunny sanitation report, 10 Nov 2026 18:49Z). After Create, "the 10 minute
 * sanitaion in the morning" got "Updated the **Corrective Action Form** for <name>: Observation of Offense. Everything else
 * on the form is as it was." and no card. The person is invented.
 */
const LABELS: Record<string, string> = { observation: "Observation of Offense", action_plan: "Action Plan" };
const label = (key: string) => LABELS[key] ?? key;

describe("REVISION_REPLY_SHOWS_FIELDS_ENABLED", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("on: each changed text field as it now reads", () => {
    vi.stubEnv("REVISION_REPLY_SHOWS_FIELDS_ENABLED", "true");
    const values = { observation: "Observed:\nBrisa did not complete the 10-minute sanitation in the morning." };
    expect(shownFieldLines(["observation"], values, label)).toEqual([
      "",
      "**Observation of Offense:** Observed:\nBrisa did not complete the 10-minute sanitation in the morning.",
    ]);
  });

  it("a cleared field or one with no value shows nothing; a long value is cut", () => {
    vi.stubEnv("REVISION_REPLY_SHOWS_FIELDS_ENABLED", "true");
    expect(updatedKeysShown(["observation", "action_plan"], ["action_plan"])).toEqual(["observation"]);
    expect(shownFieldLines(["observation"], {}, label)).toEqual([]);
    const long = shownFieldLines(["observation"], { observation: "x".repeat(700) }, label)[1]!;
    expect(long.endsWith("…")).toBe(true);
  });

  it("off: no lines", () => {
    vi.stubEnv("REVISION_REPLY_SHOWS_FIELDS_ENABLED", "");
    expect(shownFieldLines(["observation"], { observation: "Observed:\nx" }, label)).toEqual([]);
  });
});
