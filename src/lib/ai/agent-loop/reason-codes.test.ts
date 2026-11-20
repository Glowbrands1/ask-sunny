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
  "form_not_visible", "not_a_heading", "one_card", "wrong_tool", "whole_staff", "right_person", "draft_open", "date_not_stated", "follow_up_date_not_stated", "follow_up_date_passed",
  "salon_unknown", "not_stated", "name_correction_only", "date_after_today", "drafts_only", "unknown_field", "empty_account",
  "bad_level", "not_a_saved_form", "not_a_form_id", "write_failed", "finalized_revision_refused", "not_configured", "not_synced",
  "unknown_tool", "tool_threw",
  // PR 6 item 3: an edit_form with no values refused when the turn has no room for the reviser and a reply.
  "step_budget",
  // PR 6 item 1: propose_form's own name lookup got find_staff's Did you mean (which carries no code of its own).
  "name_to_confirm",
  // The rebuild plan's PR 1a (evidence args; QA's review of #1026): the privacy, exit and name-correction refusals.
  "privacy_not_this_person", "exit_not_stated", "name_evidence_missing", "name_correction_other_fields", "name_correction_no_name",
  "name_not_in_evidence", "name_correction_other_person", "name_correction_did_you_mean", "name_correction_needs_evidence",
  // PR 1b: the request and account evidence (requestTurns builds `${kind}_invalid` and the rest), and the open request.
  "request_evidence_invalid", "request_evidence_other_person", "request_evidence_not_this_request",
  "account_evidence_invalid", "account_evidence_other_person", "account_evidence_not_this_request", "account_evidence_missing", "open_requested",
  // Batch J5 (#1028): "late to open" proposed as Attendance; the words are the manual's Late Opening section.
  "wrong_heading",
  // Added on purpose (PR 3, tools return exactly what was saved): propose_form's not_on_card codes, a field left off the card.
  "level_not_stated", "termination_not_stated", "payroll_not_stated", "amount_not_stated", "prior_actions_not_kept",
  "several_dates_not_chosen", "date_from_another_request", "not_on_this_form", "date_is_prior_action",
  // Fix batch item 1 (16 Nov 2026): a resignation told with no ask makes no exit card; the app offers the form.
  "exit_not_asked",
  // The retry guard (QA, 16 Nov 2026): a third call of a tool refused twice this turn for one reason_code is not run.
  "stop_retrying",
  // Item 5 follow-up (the 266 re-run's c219): a near name one edit from the card's person and another active person.
  "near_name_ambiguous",
  // Added on purpose (fix-name, live s10; Pau's ruling 16 Nov 2026): a corrected name on a card not yet created that is on nobody's roster.
  "name_correction_not_on_roster",
  // Added on purpose (QA, the live set on #1064, 16 Nov 2026): an answer to the card's name check keeps its form; a close
  // spelling the manager typed is asked even when the model chose the roster person's id.
  "name_answer_keeps_form", "close_spelling_not_confirmed",
  // Added on purpose (QA, 16 Nov 2026; Runner 2's c014 T6): a heading on a non-CA card that the manager never named for it.
  "policy_not_for_this_card",
  // QA (16 Nov 2026, live group E): an edit asked for a form type with forms on file and another card on screen.
  "edit_asked_forms_on_file",
  // QA item 7 (20 Nov 2026): another form proposed for the open card's person with no words asking for it.
  "form_locked",
  // QA item 8 (20 Nov 2026): a roster person nobody named, picked or confirmed in this chat.
  "person_not_named",
  // QA (16 Nov 2026, the 266 audit on train 4): c261/c263 dress code cited as another heading; c207 Must See Behaviors with no MSB said.
  "dress_code_heading", "msb_not_said",
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
