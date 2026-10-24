import { describe, expect, it } from "vitest";

import { priorCoachingOptionalEnabled } from "@/lib/config/chat-quality-flags";

import { missingIntakeItems, EMPTY_CONFIRMED_FIELDS } from "./form-field-state";
import { buildSystemPrompt } from "./prompts";
import { applyOptionalPriorCoaching, typedPriorCoachingNote } from "./prior-coaching-optional";

const HELD = "You'll set any prior coaching or corrective action on the form — I won't guess at it.\n\nCreate the draft here when you're ready.";

const BOTH =
  "You'll set the verbal/written warning level and any prior coaching or corrective action on the form — I won't guess at them.\n\nCreate the draft here when you're ready.";

describe("optional prior coaching", () => {
  it("leaves the proposal unchanged while the flag is off", () => {
    const same = applyOptionalPriorCoaching(HELD, {
      enabled: false,
      records: [{ status: "finalized", line: "Coaching — signed 07/01/2026" }],
      managerText: "coached verbally in July",
    });
    expect(same).toBe(HELD);
    expect(priorCoachingOptionalEnabled()).toBe(false);
  });

  it("uses a finalized record, ignores a draft, and still creates the form", () => {
    const text = applyOptionalPriorCoaching(HELD, {
      enabled: true,
      records: [
        { status: "draft", line: "Draft coaching — signed 06/01/2026" },
        { status: "finalized", line: "Coaching — signed 07/01/2026" },
      ],
      managerText: "CA for Jordan Lee at Wornall",
    });
    expect(text).toContain("Coaching — signed 07/01/2026");
    expect(text).not.toContain("Draft coaching");
    expect(text).not.toMatch(/won't guess at it/);
    expect(text).toContain("The draft can still be created.");
    expect(text).toContain("Create the draft here");
  });

  it("accepts the typed note 'coached verbally in July' when nothing is finalized", () => {
    expect(typedPriorCoachingNote("She was coached verbally in July about opening.")).toBe(
      "coached verbally in July",
    );
    const text = applyOptionalPriorCoaching(HELD, {
      enabled: true,
      records: [{ status: "draft", line: "Draft coaching — signed 06/01/2026" }],
      managerText: "coached verbally in July",
    });
    expect(text).toContain("Prior coaching note: coached verbally in July");
    expect(text).not.toContain("Draft coaching");
    expect(text).toContain("The draft can still be created.");
  });

  it("leaves prior coaching blank and does not refuse creation", () => {
    const text = applyOptionalPriorCoaching(HELD, {
      enabled: true,
      records: [{ status: "draft", line: "Draft coaching — signed 06/01/2026" }],
      managerText: "CA for cleaning duties not completed",
    });
    expect(text).toContain("the line stays blank");
    expect(text).not.toContain("Draft coaching");
    expect(text).not.toMatch(/I won't guess/);
    expect(text).toContain("The draft can still be created.");
    expect(text).toContain("Create the draft here");
  });

  /**
   * Live conv conv_mvmeuuth27eykk3: "There's no prior coaching on file."
   * The note said prior coaching was on file. A denial is not a note.
   */
  it.each([
    "There's no prior coaching on file.",
    "no prior coaching",
    "none of the prior coaching is on file",
    "not prior coaching",
    "never had prior coaching",
    "without prior coaching",
    "he hasn't had prior coaching",
  ])("does not claim prior coaching exists for %j", (managerText) => {
    expect(typedPriorCoachingNote(managerText)).toBeNull();
    const text = applyOptionalPriorCoaching(HELD, {
      enabled: true,
      records: [],
      managerText,
    });
    expect(text).toContain("the line stays blank");
    expect(text).not.toContain("Prior coaching note:");
    expect(text).not.toContain("prior coaching on file");
    expect(text).not.toContain("No finalized record was required");
    expect(text).toContain("The draft can still be created.");
  });

  it("keeps a positive verbal warning as the note", () => {
    expect(typedPriorCoachingNote("he had a verbal warning last month")).toBe("verbal warning last month");
    const text = applyOptionalPriorCoaching(HELD, {
      enabled: true,
      records: [],
      managerText: "he had a verbal warning last month",
    });
    expect(text).toContain("Prior coaching note: verbal warning last month");
    expect(text).toContain("No finalized record was required.");
    expect(text).not.toContain("the line stays blank");
  });

  it("leaves the line blank when the manager never mentions prior coaching", () => {
    expect(typedPriorCoachingNote("She was late opening the salon today.")).toBeNull();
    const text = applyOptionalPriorCoaching(HELD, {
      enabled: true,
      records: [],
      managerText: "She was late opening the salon today.",
    });
    expect(text).toContain("the line stays blank");
    expect(text).not.toContain("Prior coaching note:");
    expect(text).not.toContain("No finalized record was required");
  });

  it("keeps a later positive note after a denial in an earlier sentence", () => {
    expect(
      typedPriorCoachingNote("There's no prior coaching on file.\nShe was coached verbally in July"),
    ).toBe("coached verbally in July");
  });

  it("does not change the card for a denial while the flag is off", () => {
    const text = applyOptionalPriorCoaching(HELD, {
      enabled: false,
      records: [],
      managerText: "There's no prior coaching on file.",
    });
    expect(text).toBe(HELD);
  });

  it("drops only the prior-coaching hold when the warning level is still open", () => {
    const text = applyOptionalPriorCoaching(BOTH, {
      enabled: true,
      records: [],
      managerText: "CA for Jordan Lee",
    });
    expect(text).toContain("You'll set the verbal/written warning level on the form — I won't guess at it.");
    expect(text).not.toMatch(/prior coaching or corrective action/);
    expect(text).toContain("the line stays blank");
  });

  it("stops listing prior coaching as missing intake when the flag is on", () => {
    const previous = process.env.PRIOR_COACHING_OPTIONAL_ENABLED;
    try {
      delete process.env.PRIOR_COACHING_OPTIONAL_ENABLED;
      const off = missingIntakeItems("CA for Jordan Lee at Wornall today. She was late.", {
        ...EMPTY_CONFIRMED_FIELDS,
        employeeName: "Jordan Lee",
        salon: "MO Kansas City Wornall",
        useToday: true,
      }).map((item) => item.key);
      expect(off).toContain("previous_action");

      process.env.PRIOR_COACHING_OPTIONAL_ENABLED = "on";
      const on = missingIntakeItems("CA for Jordan Lee at Wornall today. She was late.", {
        ...EMPTY_CONFIRMED_FIELDS,
        employeeName: "Jordan Lee",
        salon: "MO Kansas City Wornall",
        useToday: true,
      }).map((item) => item.key);
      expect(on).not.toContain("previous_action");
    } finally {
      if (previous === undefined) delete process.env.PRIOR_COACHING_OPTIONAL_ENABLED;
      else process.env.PRIOR_COACHING_OPTIONAL_ENABLED = previous;
    }
  });

  it("adds the rule to the system prompt only when asked", () => {
    const shared = {
      assistantName: "Sunny",
      brandName: "Sun Tan City",
      salonNoun: "salon",
      context: { userName: "Dana Reyes", locationName: "MO Kansas City Wornall", todayIso: "2026-10-23" },
      mode: "standard" as const,
      hasContext: true,
    };
    const off = buildSystemPrompt(shared);
    expect(off).not.toContain("PRIOR COACHING DOES NOT BLOCK");
    expect(buildSystemPrompt({ ...shared, priorCoachingOptional: false })).toBe(off);
    const on = buildSystemPrompt({ ...shared, priorCoachingOptional: true });
    expect(on).toContain("do not refuse because Form Monitoring has no prior coaching form");
    expect(on).toContain("coached verbally in July");
    expect(on).toContain("Ignore drafts");
  });
});
