import { afterEach, describe, expect, it, vi } from "vitest";

import { applyPatch, type FormDraft, type FormPatch, type PatchRules } from "./form-reducer";

/**
 * FORM_EDIT_SAID_REPLACEMENT_ENABLED (QA's Step B gate, 6 Nov 2026; under FORM_EDIT_SINGLE_WRITER). With
 * the single writer on, "fix her last name, it is Laine" was refused (drops_words: "Lane" is not inside
 * "Laine"), and "Change it to a written warning and change the offense to absenteeism" was refused
 * (unknown_option: "absenteeism" is a box the current form replaced with Attendance Policy). With the flag:
 * a word the new text replaces IN PLACE with a word the manager's own message says may go, and an old
 * offense box is written as its successor. A word dropped with nothing in its place ("Marnie") is still
 * refused. The people are invented and not on either directory.
 */
function field(key: string, value: string | string[], owner: "manager" | "assistant" | "empty") {
  return { key, value, owner } as const;
}

function textRules(latest: string, key: string): PatchRules {
  return {
    mode: "edit",
    writable: new Set([key]),
    sources: { manager: latest, managerTurns: [latest], namingTurn: latest },
    keepsUnnamedWords: true,
    droppedWordsReplaced: true,
  };
}

const replace = (key: string, value: string, evidence: string): FormPatch => ({ set: { [key]: value }, clear: [], how: { [key]: "replace" }, evidence: { [key]: evidence } });

function on() {
  vi.stubEnv("FORM_EDIT_SINGLE_WRITER_ENABLED", "true");
  vi.stubEnv("FORM_EDIT_SAID_REPLACEMENT_ENABLED", "true");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("FORM_EDIT_SAID_REPLACEMENT_ENABLED", () => {
  const LAINE = "fix her last name, it is Laine";
  const COACHING: FormDraft = { details: field("details", "Observed:\nTessaly Lane was late to open today.", "assistant") };
  const CORRECTED = "Observed:\nTessaly Laine was late to open today.";

  it("off (main, single writer on): \"Lane\" → \"Laine\" is refused (the bug)", () => {
    vi.stubEnv("FORM_EDIT_SINGLE_WRITER_ENABLED", "true");
    expect(applyPatch(COACHING, replace("details", CORRECTED, LAINE), textRules(LAINE, "details")).diff.refused).toEqual([{ key: "details", reason: "drops_words" }]);
  });

  it("on: \"Lane\" → \"Laine\" in place, said by the manager, is accepted", () => {
    on();
    const { diff } = applyPatch(COACHING, replace("details", CORRECTED, LAINE), textRules(LAINE, "details"));
    expect(diff.refused).toEqual([]);
    expect(diff.changed.map((change) => change.key)).toEqual(["details"]);
  });

  it("on: \"Quill\" → \"Quill-Hart\" keeps the first name and is accepted", () => {
    on();
    const latest = "fix her last name, it is Quill-Hart";
    const draft: FormDraft = { observation: field("observation", "Marnie Quill was late to open on 10-20-26.", "assistant") };
    expect(applyPatch(draft, replace("observation", "Marnie Quill-Hart was late to open on 10-20-26.", latest), textRules(latest, "observation")).diff.refused).toEqual([]);
  });

  it("on, negative: \"Quill-Hart was late …\" drops \"Marnie\" with nothing in its place: still refused", () => {
    on();
    const latest = "fix her last name, it is Quill-Hart";
    const draft: FormDraft = { observation: field("observation", "Marnie Quill was late to open on 10-20-26.", "assistant") };
    expect(applyPatch(draft, replace("observation", "Quill-Hart was late to open on 10-20-26.", latest), textRules(latest, "observation")).diff.refused).toEqual([
      { key: "observation", reason: "drops_words" },
    ]);
  });

  it("on, negative: a replacing word the manager never said is still refused", () => {
    on();
    // Refused before the drop-words check (not_in_manager_words): either way, nothing is written.
    const { diff } = applyPatch(COACHING, replace("details", "Observed:\nTessaly Lyle was late to open today.", LAINE), textRules(LAINE, "details"));
    expect(diff.refused.map((refusal) => refusal.key)).toEqual(["details"]);
    expect(diff.changed).toEqual([]);
  });

  describe("an old offense box is written as the box that replaced it", () => {
    const ASKED = "Change it to a written warning and change the offense to absenteeism";
    const draft: FormDraft = { offense_type: field("offense_type", ["standards_of_conduct"], "assistant") };
    const rules: PatchRules = {
      mode: "edit",
      writable: new Set(["offense_type"]),
      checkboxGroups: { offense_type: { options: ["attendance_policy", "standards_of_conduct", "dress_code", "other"], single: false } },
      sources: { manager: ASKED, managerTurns: [ASKED], namingTurn: ASKED },
    };
    const patch: FormPatch = { set: { offense_type: ["absenteeism"] }, clear: [], how: { offense_type: "replace" }, evidence: { offense_type: ASKED } };

    it("off (single writer on): refused as unknown_option (the bug)", () => {
      vi.stubEnv("FORM_EDIT_SINGLE_WRITER_ENABLED", "true");
      expect(applyPatch(draft, patch, rules).diff.refused).toEqual([{ key: "offense_type", reason: "unknown_option" }]);
    });

    it("on: written as Attendance Policy", () => {
      on();
      const { draft: after, diff } = applyPatch(draft, patch, rules);
      expect(diff.refused).toEqual([]);
      expect(after.offense_type?.value).toEqual(["attendance_policy"]);
    });

    it("on, negative: a box the form never had is still refused", () => {
      on();
      expect(applyPatch(draft, { ...patch, set: { offense_type: ["made_up_box"] } }, rules).diff.refused).toEqual([{ key: "offense_type", reason: "unknown_option" }]);
    });
  });

  it("on: the employee-name guard lets \"Lane\" go when \"Laine\" replaces it in place", () => {
    on();
    const rules: PatchRules = {
      ...textRules(LAINE, "details"),
      protectedValues: { employeeName: "Tessaly Lane", latest: LAINE, datesIn: () => [], amountsIn: () => [] },
    } as PatchRules;
    expect(applyPatch(COACHING, replace("details", CORRECTED, LAINE), rules).diff.refused).toEqual([]);
  });

  it("on, negative: the employee-name guard still refuses \"Tessaly\" dropped with nothing in its place", () => {
    on();
    const rules: PatchRules = {
      ...textRules(LAINE, "details"),
      protectedValues: { employeeName: "Tessaly Lane", latest: LAINE, datesIn: () => [], amountsIn: () => [] },
    } as PatchRules;
    expect(applyPatch(COACHING, replace("details", "Observed:\nLaine was late to open today.", LAINE), rules).diff.refused.map((refusal) => refusal.key)).toEqual(["details"]);
  });

  it("on, negative: \"Marnie was late …\" → \"Quill-Hart was late …\" (another word put in Marnie's place) is still refused", () => {
    on();
    // QA's Step B gate 2 (6 Nov 2026): "Quill-Hart" is said and stands where "Marnie" stood, but it is no correction of her.
    const latest = "fix her last name, it is Quill-Hart";
    const draft: FormDraft = { details: field("details", "Marnie was late to open the salon and the register was not counted.", "assistant") };
    expect(applyPatch(draft, replace("details", "Quill-Hart was late to open the salon and the register was not counted.", latest), textRules(latest, "details")).diff.refused).toEqual([
      { key: "details", reason: "drops_words" },
    ]);
  });
});
