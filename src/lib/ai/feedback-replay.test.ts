import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { fewShotExamplesEnabled } from "@/lib/config/chat-quality-flags";

import {
  buildReplayCases,
  containsPersonalData,
  fewShotPrompt,
  redactPersonal,
  scopeForExchange,
  selectFewShot,
  type RatedExchange,
} from "./feedback-replay";
import { buildSystemPrompt } from "./prompts";

const PROMPT = {
  assistantName: "Sunny",
  brandName: "Example Co",
  salonNoun: "salon",
  context: { userName: "Avery Holt", locationName: "North", todayIso: "2026-10-23" },
  mode: "quick" as const,
  hasContext: false,
};

describe("feedback replay cases", () => {
  it("redacts emails, phones, addresses, ids, and roster names", () => {
    const text = redactPersonal(
      "Email jordan.hale@example.com or call (402) 555-0100. Lives at 18 Pine Street. SSN 123-45-6789. id 11111111-1111-4111-8111-111111111111. Jordan Hale was late.",
      ["Jordan Hale"],
    );
    expect(text).not.toContain("jordan.hale@example.com");
    expect(text).not.toContain("555-0100");
    expect(text).not.toContain("Pine Street");
    expect(text).not.toContain("123-45-6789");
    expect(text).not.toContain("11111111");
    expect(text).not.toContain("Jordan Hale");
    expect(text).toContain("[email]");
    expect(text).toContain("[phone]");
    expect(text).toContain("[address]");
    expect(text).toContain("[employee 1]");
    expect(containsPersonalData(text)).toBe(false);
  });

  it("keeps 1–4 star pairs and drops a 5, with the question that came before the answer", () => {
    const cases = buildReplayCases({
      ratings: [
        { activityEventId: "turn-low", rating: 2, comment: "Call me at 402-555-0199" },
        { activityEventId: "turn-high", rating: 5, comment: "great" },
        { activityEventId: "turn-missing", rating: 1, comment: "" },
      ],
      messages: [
        { conversationId: "c1", position: 0, role: "user", content: "Jordan Hale showed up late", turnId: null },
        { conversationId: "c1", position: 1, role: "assistant", content: "See Attendance.", turnId: "turn-low" },
        { conversationId: "c1", position: 2, role: "user", content: "thanks", turnId: null },
        { conversationId: "c2", position: 0, role: "user", content: "what is overtime", turnId: null },
        { conversationId: "c2", position: 1, role: "assistant", content: "The manual covers it.", turnId: "turn-high" },
      ],
      rosterNames: ["Jordan Hale"],
    });
    expect(cases).toHaveLength(1);
    expect(cases[0]?.rating).toBe(2);
    expect(cases[0]?.prompts[0]).toContain("[employee 1]");
    expect(cases[0]?.prompts[0]).not.toContain("Jordan Hale");
    expect(cases[0]?.answer).toContain("Attendance");
    expect(cases[0]?.note).toContain("[phone]");
    expect(cases[0]?.id.startsWith("fb-")).toBe(true);
    expect(cases[0]?.id).not.toContain("turn-low");
  });

  it("the export script only selects", () => {
    const source = readFileSync("scripts/export-feedback-replay.mts", "utf8");
    expect(source).not.toMatch(/\.(insert|update|upsert|delete)\s*\(/);
    expect(source).toContain(".select(");
    expect(source).toContain("buildReplayCases");
    const loader = readFileSync("src/lib/ai/few-shot-examples.ts", "utf8");
    expect(loader).not.toMatch(/\.(insert|update|upsert|delete)\s*\(/);
    expect(loader).toContain('.gte("rating", 5)');
  });
});

describe("few-shot examples stay in this company", () => {
  const exchanges: RatedExchange[] = [
    {
      id: "a",
      rating: 5,
      scopeId: "stc-core",
      question: "she showed up late for the shift",
      answer: "Attendance covers arriving late.",
    },
    {
      id: "b",
      rating: 5,
      scopeId: "bcs-core",
      question: "she showed up late for the shift",
      answer: "A different company's answer.",
    },
    {
      id: "c",
      rating: 4,
      scopeId: "stc-core",
      question: "she showed up late for the shift",
      answer: "This was not highly rated.",
    },
    {
      id: "d",
      rating: 5,
      scopeId: "stc-core",
      question: "how do I reset a password",
      answer: "Use the account page.",
    },
  ];

  it("uses a similar 5-star exchange from this scope only", () => {
    const picked = selectFewShot({
      question: "someone showed up late yesterday",
      scopeId: "stc-core",
      exchanges,
    });
    expect(picked.map((item) => item.id)).toEqual(["a"]);
    const prompt = fewShotPrompt(picked, ["Jordan Hale"]);
    expect(prompt).toContain("THIS COMPANY");
    expect(prompt).toContain("not this conversation");
    expect(prompt).toContain("earlier today");
    expect(prompt).not.toContain("different company");
  });

  it("does not carry another chat's employee into the example", () => {
    const prompt = fewShotPrompt(
      [
        {
          id: "nadia",
          rating: 5,
          scopeId: "stc-core",
          question: "coaching for Nadia Brook at Lawrence today",
          answer: "You mentioned Nadia Brook earlier today.",
        },
      ],
      ["Nadia Brook"],
    );
    expect(prompt).not.toContain("Nadia Brook");
    expect(prompt).toContain("[employee 1]");
    expect(prompt).toContain("Do not tell the manager they mentioned");
  });

  it("drops a row stored for another company", () => {
    expect(scopeForExchange({ scopeId: "bcs-core" }, "stc-core")).toBeNull();
    expect(scopeForExchange({}, "stc-core")).toBe("stc-core");
    expect(scopeForExchange({ scopeId: "stc-core" }, "stc-core")).toBe("stc-core");
  });

  it("leaves the system prompt unchanged when no examples are attached", () => {
    expect(buildSystemPrompt(PROMPT)).toBe(buildSystemPrompt({ ...PROMPT, fewShot: "" }));
    expect(buildSystemPrompt(PROMPT)).not.toContain("SIMILAR PAST ANSWERS");
    expect(buildSystemPrompt({ ...PROMPT, fewShot: fewShotPrompt(exchanges.slice(0, 1)) })).toContain(
      "SIMILAR PAST ANSWERS",
    );
  });
});

describe("FEWSHOT_EXAMPLES_ENABLED", () => {
  it("is off unless set to 1, true, on, or yes", () => {
    const previous = process.env.FEWSHOT_EXAMPLES_ENABLED;
    try {
      delete process.env.FEWSHOT_EXAMPLES_ENABLED;
      expect(fewShotExamplesEnabled()).toBe(false);
      for (const value of ["0", "false", "off", ""]) {
        process.env.FEWSHOT_EXAMPLES_ENABLED = value;
        expect(fewShotExamplesEnabled()).toBe(false);
      }
      for (const value of ["1", "true", "on", "yes"]) {
        process.env.FEWSHOT_EXAMPLES_ENABLED = value;
        expect(fewShotExamplesEnabled()).toBe(true);
      }
    } finally {
      if (previous === undefined) delete process.env.FEWSHOT_EXAMPLES_ENABLED;
      else process.env.FEWSHOT_EXAMPLES_ENABLED = previous;
    }
  });
});
