import { describe, expect, it } from "vitest";

import { payrollAmounts } from "@/lib/ai/intent-slots";

import { datesInText } from "./form-date-answer";
import { applyPatch, type FormDraft, type FormPatch, type PatchRules } from "./form-reducer";

/**
 * ============================================================================
 * STEP 2a (FORM_EDIT_SINGLE_WRITER_ENABLED): THE REDUCER'S NEW OPTIONAL RULES
 * ============================================================================
 *
 * Each rule on its own, with the live wording that broke it (STEP_B_ROOT_CAUSE,
 * 4 Nov 2026) or QA's condition. Ported from Ask Bubbles (117e33b1), in this
 * app's setting. Every rule is optional: without it the
 * reducer behaves as before, which each block also pins ("absent: unchanged").
 * People are invented (the replay pack's Jane Doe).
 */

const TODAY = "2026-11-03";

function field(key: string, value: string | string[], owner: "manager" | "assistant" | "empty") {
  return { key, value, owner } as const;
}

/* ------------------------------------------------ drops_words (Doe-Smith) --- */

describe("keepsUnnamedWords: a replace drops no word the latest message does not name", () => {
  const LATEST = "fix her last name, it is Doe-Smith";
  const EARLIER = "create ca form for jane doe, she was late to open the salon";
  const DETAILS = "Jane was late to open the salon and the register was not counted.";
  const DRAFT: FormDraft = { details: field("details", DETAILS, "assistant") };
  const rules = (on: boolean): PatchRules => ({
    mode: "edit",
    writable: new Set(["details"]),
    sources: {
      manager: [EARLIER, LATEST].join("\n"),
      managerTurns: [EARLIER, LATEST],
      ...(on ? { namingTurn: LATEST } : {}),
    },
    ...(on ? { keepsUnnamedWords: true } : {}),
  });
  const replace = (value: string): FormPatch => ({ set: { details: value }, clear: [], how: { details: "replace" }, evidence: { details: LATEST } });

  it('refuses the live write: "Doe-Smith was late …" drops "Jane"', () => {
    const { diff } = applyPatch(DRAFT, replace(DETAILS.replace("Jane", "Doe-Smith")), rules(true));
    expect(diff.refused).toEqual([{ key: "details", reason: "drops_words" }]);
    expect(diff.changed).toEqual([]);
  });

  it('accepts "Jane Doe-Smith was late …": nothing dropped, the added word named', () => {
    const { diff } = applyPatch(DRAFT, replace(DETAILS.replace("Jane", "Jane Doe-Smith")), rules(true));
    expect(diff.refused).toEqual([]);
    expect(diff.changed.map((change) => change.key)).toEqual(["details"]);
  });

  it('refuses a bare "Doe-Smith" (it would wipe the field)', () => {
    expect(applyPatch(DRAFT, replace("Doe-Smith"), rules(true)).diff.refused).toEqual([{ key: "details", reason: "drops_words" }]);
  });

  it("a word dropped and named inside a word of the latest message is fine (doe in Doe-Smith)", () => {
    const name: FormDraft = { details: field("details", "Jane Doe", "assistant") };
    const { diff } = applyPatch(name, replace("Jane Doe-Smith"), rules(true));
    expect(diff.refused).toEqual([]);
  });

  it("absent: unchanged — the live write is accepted, as on main", () => {
    expect(applyPatch(DRAFT, replace(DETAILS.replace("Jane", "Doe-Smith")), rules(false)).diff.refused).toEqual([]);
  });
});

/* ------------------------------------------------- namingTurn (strict Q2) --- */

describe("namingTurn: every word an op adds is in the naming turn (owner's Q2: no 50% floor)", () => {
  const EARLIER = "she was rude to a guest, it is a conduct issue";
  const LATEST = "make it sound more professional";
  const DRAFT: FormDraft = { other_topic: field("other_topic", "", "empty"), details: field("details", "Pat was rude to a guest.", "assistant") };
  const rules = (on: boolean): PatchRules => ({
    mode: "edit",
    writable: new Set(["other_topic", "details"]),
    sources: { manager: [EARLIER, LATEST].join("\n"), managerTurns: [EARLIER, LATEST], ...(on ? { namingTurn: LATEST } : {}) },
  });
  const set = (key: string, value: string, evidence = LATEST): FormPatch => ({ set: { [key]: value }, clear: [], how: { [key]: "replace" }, evidence: { [key]: evidence } });

  it('refuses "Professional conduct": "conduct" is not in the latest message', () => {
    expect(applyPatch(DRAFT, set("other_topic", "Professional conduct"), rules(true)).diff.refused).toEqual([
      { key: "other_topic", reason: "not_in_manager_words" },
    ]);
  });

  it("accepts a value whose added words are all in the naming turn", () => {
    expect(applyPatch(DRAFT, set("other_topic", "More professional"), rules(true)).diff.refused).toEqual([]);
  });

  it("refuses a value with one extra word not in the naming turn", () => {
    expect(applyPatch(DRAFT, set("other_topic", "More professional tone"), rules(true)).diff.refused).toEqual([
      { key: "other_topic", reason: "not_in_manager_words" },
    ]);
  });

  it("measures only the words the op ADDS: kept words of the old value need not be said again", () => {
    expect(applyPatch(DRAFT, set("details", "Pat was rude to a guest, more professional."), rules(true)).diff.refused).toEqual([]);
  });

  it("a turn the evidence quotes is a naming turn too", () => {
    expect(applyPatch(DRAFT, set("other_topic", "Conduct issue", "it is a conduct issue"), rules(true)).diff.refused).toEqual([]);
  });

  it("the correction readers' own values still count as said (#410)", () => {
    const withReader = { ...rules(true), sources: { ...rules(true).sources!, readerValues: ["Professional conduct"] } };
    expect(applyPatch(DRAFT, set("other_topic", "Professional conduct"), withReader).diff.refused).toEqual([]);
  });

  it("the invented-sentence refusal still holds", () => {
    expect(applyPatch(DRAFT, set("details", "Pat threw a chair at the guest.", LATEST), rules(true)).diff.refused).toEqual([
      { key: "details", reason: "not_in_manager_words" },
    ]);
    expect(applyPatch(DRAFT, set("details", "Pat threw a chair at the guest.", LATEST), rules(false)).diff.refused).toEqual([
      { key: "details", reason: "not_in_manager_words" },
    ]);
  });

  it('absent: unchanged — "Professional conduct" scores 1/2 over all turns and is accepted, as on main', () => {
    expect(applyPatch(DRAFT, set("other_topic", "Professional conduct"), rules(false)).diff.refused).toEqual([]);
  });
});

/* ------------------------------------------------------ writein_without_box --- */

describe("writeIns: a write-in only beside its ticked box", () => {
  const LATEST = "the topic is uniform";
  const DRAFT: FormDraft = { topics: field("topics", ["cash"], "assistant"), other_topic: field("other_topic", "", "empty") };
  const rules = (on: boolean): PatchRules => ({
    mode: "edit",
    writable: new Set(["topics", "other_topic"]),
    checkboxGroups: { topics: { options: ["cash", "conduct", "other"], single: false } },
    sources: { manager: LATEST, managerTurns: [LATEST] },
    ...(on ? { writeIns: new Map([["other_topic", { group: "topics", option: "other" }]]) } : {}),
  });

  it('refuses "Uniform" in Other with the Other box not ticked', () => {
    const { diff, draft } = applyPatch(
      DRAFT,
      { set: { other_topic: "Uniform" }, clear: [], how: { other_topic: "replace" }, evidence: { other_topic: LATEST } },
      rules(true),
    );
    expect(diff.refused).toEqual([{ key: "other_topic", reason: "writein_without_box" }]);
    expect(draft.other_topic!.value).toBe("");
  });

  it("accepts it when the same patch ticks Other", () => {
    const { diff } = applyPatch(
      DRAFT,
      { set: { topics: ["other"], other_topic: "Uniform" }, clear: [], how: { topics: "add", other_topic: "replace" }, evidence: { topics: LATEST, other_topic: LATEST } },
      rules(true),
    );
    expect(diff.refused).toEqual([]);
    expect(diff.changed.map((change) => change.key).sort()).toEqual(["other_topic", "topics"]);
  });

  it("absent: unchanged", () => {
    const { diff } = applyPatch(
      DRAFT,
      { set: { other_topic: "Uniform" }, clear: [], how: { other_topic: "replace" }, evidence: { other_topic: LATEST } },
      rules(false),
    );
    expect(diff.refused).toEqual([]);
  });
});

/* -------------------------------------------- drops_protected_value (QA 2) --- */

describe("protectedValues: a whole-text rewrite keeps the header's name, every date and every amount", () => {
  const OLD = "Jane was short at the register by $25 at close on 10-20-26.";
  const DRAFT: FormDraft = { details: field("details", OLD, "assistant"), blank: field("blank", "", "empty") };
  const rules = (latest: string, on = true): PatchRules => ({
    mode: "draft",
    writable: new Set(["details", "blank"]),
    sources: { manager: latest },
    ...(on
      ? {
          protectedValues: {
            employeeName: "Jane Doe",
            datesIn: (text: string) => datesInText(text, TODAY).map((date) => date.iso),
            amountsIn: (text: string) => payrollAmounts(text).map(Number),
            latest,
          },
        }
      : {}),
  });
  const rewrite = (value: string, latest = "make it sound more professional", on = true) =>
    applyPatch(DRAFT, { set: { details: value }, clear: [] }, rules(latest, on)).diff;

  it('refuses a rewrite that drops "Jane"', () => {
    expect(rewrite("The employee was short at the register by $25 at close on 10-20-26.").refused).toEqual([
      { key: "details", reason: "drops_protected_value" },
    ]);
  });

  it("refuses a rewrite that drops the date", () => {
    expect(rewrite("Jane was short at the register by $25 at close.").refused).toEqual([{ key: "details", reason: "drops_protected_value" }]);
  });

  it("refuses a rewrite that drops the amount", () => {
    expect(rewrite("Jane was short at the register at close on 10-20-26.").refused).toEqual([{ key: "details", reason: "drops_protected_value" }]);
  });

  it("accepts a rewrite that keeps them (case folded, another date spelling)", () => {
    expect(rewrite("At close on October 20, 2026, JANE's register was short by $25.00.").refused).toEqual([]);
  });

  it("accepts a rewrite where the latest message names the changed value", () => {
    expect(rewrite("Jane was short at the register by $20 at close on 10-20-26.", "it was 20 dollars, not $25").refused).toEqual([]);
    expect(rewrite("Jane was short at the register by $25 at close on 10-21-26.", "the date was 10-21-26 not 10-20-26").refused).toEqual([]);
    expect(rewrite("Ms. Doe was short at the register by $25 at close on 10-20-26.", "call jane by her last name").refused).toEqual([]);
  });

  it("a field that held no text is not a rewrite", () => {
    expect(applyPatch(DRAFT, { set: { blank: "Short at close." }, clear: [] }, rules("x")).diff.refused).toEqual([]);
  });

  it("applies to an edit-mode replace too", () => {
    const latest = "rewrite the details: short at close";
    const edit: PatchRules = { ...rules(latest), mode: "edit", sources: { manager: latest, managerTurns: [latest] } };
    const { diff } = applyPatch(
      DRAFT,
      { set: { details: "Short at close." }, clear: [], how: { details: "replace" }, evidence: { details: latest } },
      edit,
    );
    expect(diff.refused).toEqual([{ key: "details", reason: "drops_protected_value" }]);
  });

  it("absent: unchanged", () => {
    expect(rewrite("The employee was short.", "make it sound more professional", false).refused).toEqual([]);
  });

  it("a text rewritten to the form's current Date line may drop the old day (classification, qa-oct21: the manager moved the Date on the card)", () => {
    const moved: PatchRules = { ...rules("jane opened the salon late"), protectedValues: { ...rules("jane opened the salon late").protectedValues!, formDate: "2026-10-03" } };
    const to = (value: string) => applyPatch(DRAFT, { set: { details: value }, clear: [] }, moved).diff.refused;
    expect(to("Jane was short at the register by $25 at close on October 3, 2026.")).toEqual([]);
    // Dropped for no reason, the date is still protected.
    expect(to("Jane was short at the register by $25 at close.")).toEqual([{ key: "details", reason: "drops_protected_value" }]);
  });
});
