import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  chatMemoryEnabled,
  draftDedupeEnabled,
  fieldAccuracyEnabled,
  policyCitationEnabled,
  reportBreakdownEnabled,
  secondFormEnabled,
  slotRetentionEnabled,
} from "@/lib/config/chat-quality-flags";

import { augmentIntakeQuestion } from "./intake-augment";
import { flaggedCitationWrite } from "./policy-citation-fields";

/**
 * Flags off must match the path main already ships.
 *
 * New flags default off. The wrappers return the input they were given.
 * Pau's modules are untouched. The existing chat and form suites are run
 * in a child process with every new flag forced off; their expectations
 * are main's, and a failure here is a behavior change that leaked through.
 */

const NEW_FLAGS = [
  "SLOT_RETENTION_ENABLED",
  "FIELD_ACCURACY_ENABLED",
  "DRAFT_DEDUPE_ENABLED",
  "SECOND_FORM_ENABLED",
  "POLICY_CITATION_ENABLED",
  "CHAT_MEMORY_ENABLED",
  "REPORT_BREAKDOWN_ENABLED",
] as const;

const PROTECTED = [
  "src/lib/ai/form-proposal.ts",
  "src/lib/ai/violation-policy.ts",
  "src/lib/ai/prior-coaching-optional.ts",
  "src/lib/ai/glossary.ts",
  "src/lib/ai/form-field-state.ts",
  "src/lib/ai/chat-data-plan.ts",
  "src/lib/forms/salon-mention.ts",
  "src/lib/forms/salon-text.ts",
  "src/lib/forms/location-scope.ts",
  "src/lib/forms/proposal.ts",
  "src/lib/forms/form-date-answer.ts",
  "src/lib/forms/payroll-deduct.ts",
  "src/lib/forms/ca-action-plan.ts",
  "src/lib/forms/required-closing.ts",
  "src/lib/forms/chat-revision.ts",
  "src/lib/forms/revision.ts",
  "src/lib/forms/policy-citation.ts",
  "src/lib/forms/instances.ts",
];

const UI_PATHS = ["src/app/**/*.tsx", "src/components/**", "src/features/**/*.tsx", "**/*.css"];

function diff(ref: string, args: string[]): string {
  return execFileSync("git", ["diff", ref, "--", ...args], { encoding: "utf8" });
}

describe("new flags default off and wrappers are inert", () => {
  it("treats unset flags as off and returns the caller's own values", () => {
    const previous = Object.fromEntries(NEW_FLAGS.map((name) => [name, process.env[name]]));
    for (const name of NEW_FLAGS) delete process.env[name];
    expect(slotRetentionEnabled()).toBe(false);
    expect(fieldAccuracyEnabled()).toBe(false);
    expect(draftDedupeEnabled()).toBe(false);
    expect(secondFormEnabled()).toBe(false);
    expect(policyCitationEnabled()).toBe(false);
    expect(chatMemoryEnabled()).toBe(false);
    expect(reportBreakdownEnabled()).toBe(false);

    const question = "create a verbal corrective action for Avery Holt at Lawrence on 10-1";
    expect(
      augmentIntakeQuestion({
        slots: false,
        fields: false,
        question,
        history: [{ role: "user", content: "The employee is Avery Holt. Salon Director at Lawrence." }],
        today: "2026-10-23",
      }),
    ).toBe(question);

    const values = { policy_language: "", coaching_details: "Opened late." };
    expect(
      flaggedCitationWrite({
        enabled: false,
        templateKey: "coaching",
        values,
        notes: "late opening",
        chunks: [],
      }).values,
    ).toBe(values);

    for (const name of NEW_FLAGS) {
      const saved = previous[name];
      if (saved === undefined) delete process.env[name];
      else process.env[name] = saved;
    }
  });

  it("does not edit Pau's modules or any UI file", () => {
    expect(diff("HEAD", PROTECTED)).toBe("");
    expect(diff("origin/main", UI_PATHS)).toBe("");
    const ask = readFileSync("src/lib/ai/server-ask.ts", "utf8");
    const code = ask.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toContain("process.env");
    expect(code).not.toContain(".catch(");
    expect(ask).toContain("question: request.question");
    expect(ask).toContain("slotRetentionEnabled()");
    expect(ask).toContain("fieldAccuracyEnabled()");
  });
});

const CHILD = process.env.FLAGS_OFF_PARITY_CHILD === "1";

describe("existing chat and form suites with every new flag off", () => {
  it.skipIf(CHILD)(
    "passes the suites whose expectations are already on main",
    () => {
      const env: NodeJS.ProcessEnv = { ...process.env, FLAGS_OFF_PARITY_CHILD: "1" };
      delete env.VITEST;
      delete env.VITEST_WORKER_ID;
      delete env.VITEST_POOL_ID;
      for (const name of NEW_FLAGS) env[name] = "off";
      const output = execFileSync(
        process.execPath,
        [
          "node_modules/vitest/vitest.mjs",
          "run",
          "--exclude",
          "src/lib/ai/flags-off-parity.test.ts",
          "src/lib/ai",
          "src/lib/forms",
          "src/app/api/chat",
          "src/app/api/forms",
        ],
        { env, encoding: "utf8", timeout: 540_000, stdio: "pipe" },
      );
      expect(output).toMatch(/Test Files[\s\S]*passed/);
    },
    560_000,
  );
});
