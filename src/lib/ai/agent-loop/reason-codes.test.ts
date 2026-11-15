import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * PR 4 of the loop rebuild (Pau's audit, 15 Nov 2026): every refusal a tool returns carries a fixed `reason_code`, and the
 * trace's error_kind is that code (run.ts), never a reading of the error's wording. A source guard: a refusal added
 * without a code, or with a code outside this list, fails here. (The behaviour of each code that needs no evidence is a
 * replay case: nov15-agent-loop-pr4-reason-codes-cases.ts.)
 */
const DIR = __dirname;
const FILES = ["tools.ts", "data-tools.ts", "run.ts"];

/** Every code a refusal or a roster outcome may carry. */
const KNOWN = new Set([
  "missing_input", "roster_failed", "not_on_roster", "ambiguous_person", "scope", "privacy_not_asked", "read_failed",
  "form_not_visible", "not_a_heading", "one_card", "wrong_tool", "whole_staff", "right_person", "draft_open", "date_not_stated",
  "salon_unknown", "not_stated", "name_correction_only", "date_after_today", "drafts_only", "unknown_field", "empty_account",
  "bad_level", "not_a_saved_form", "not_a_form_id", "write_failed", "finalized_revision_refused", "not_configured", "not_synced",
  "unknown_tool", "tool_threw",
  // Batch J5 (#1028): "late to open" proposed as Attendance; the words are the manual's Late Opening section.
  "wrong_heading",
  // Added on purpose (PR 3, tools return exactly what was saved): propose_form's not_on_card codes, a field left off the card.
  "level_not_stated", "termination_not_stated", "payroll_not_stated", "amount_not_stated", "prior_actions_not_kept",
  "several_dates_not_chosen", "date_from_another_request", "not_on_this_form",
]);

/** A line that returns a refusal: `error:` followed by a string, a template or a named message (not `error: Boolean(...)`). */
const REFUSAL = /\berror:\s*(?:["`]|[A-Z][A-Z_]+\b)/;

describe("every refusal has a reason code", () => {
  for (const file of FILES) {
    const lines = readFileSync(join(DIR, file), "utf8").split("\n");
    it(`${file}: no refusal without a reason_code`, () => {
      const missing = lines.flatMap((line, index) => (REFUSAL.test(line) && !/reason_code/.test(line) ? [`${file}:${index + 1}: ${line.trim().slice(0, 90)}`] : []));
      expect(missing).toEqual([]);
    });
    it(`${file}: every reason_code is a known code`, () => {
      const used = new Set(lines.flatMap((line) => [...line.matchAll(/reason_code:\s*"([a-z_]+)"/g)].map((match) => match[1]!)));
      expect([...used].filter((code) => !KNOWN.has(code))).toEqual([]);
    });
  }

  it("run.ts reads error_kind from reason_code and has no wording table", () => {
    const run = readFileSync(join(DIR, "run.ts"), "utf8");
    expect(run).not.toMatch(/ERROR_KINDS/);
    expect(run).toMatch(/record\.reason_code/);
  });
});
