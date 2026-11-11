import { describe, expect, it } from "vitest";

import { datesInText } from "./form-date-answer";
import {
  applyPatch,
  createReducer,
  diffDrafts,
  draftFromRows,
  fold,
  priorLineKey,
  type FormDraft,
  type FormPatch,
  type PatchRules,
} from "./form-reducer";
import type { InstanceValueRow } from "./instances";
import { NO_PRIOR_ACTION, priorActionLine } from "./prior-actions";

/**
 * Step B (FORM_PATCH_REDUCER_ENABLED): the merge rules of STEP_B_PROPOSAL
 * section (a), one by one. People are invented.
 */

const TODAY = "2026-11-03";

const MANAGER = [
  "create ca form for Rowan Tessaly for a register shortage on 10-20-26. payroll deduct applies and $3.25 will be deducted from check.",
  "I need to add that the towel bin was emptied twice",
].join("\n");
const OFFERED = "Rowan was reminded to count the drawer at the start of every shift.";

const BASE: PatchRules = {
  mode: "edit",
  writable: new Set(["observation", "action_plan_notes", "incident_date", "payroll_amount", "prior_actions", "level", "topics", "tone"]),
  managerStated: new Set(["payroll_amount"]),
  dateKeys: new Set(["incident_date"]),
  datesIn: (text) => datesInText(text, TODAY).map((date) => date.iso),
  checkboxGroups: {
    level: { options: ["verbal", "written", "final"], single: true },
    topics: { options: ["cash", "conduct", "attendance"], single: false },
  },
  listKeys: new Set(["prior_actions"]),
  listNone: NO_PRIOR_ACTION,
  sources: { manager: MANAGER, offered: OFFERED, accepted: false },
};

function field(key: string, value: string | string[], owner: "manager" | "assistant" | "empty") {
  return { key, value, owner } as const;
}

const DRAFT: FormDraft = {
  observation: field("observation", "Rowan's drawer was short at close.", "manager"),
  action_plan_notes: field("action_plan_notes", "Review the cash handling steps.", "assistant"),
  incident_date: field("incident_date", "", "empty"),
  payroll_amount: field("payroll_amount", "", "empty"),
  prior_actions: field("prior_actions", NO_PRIOR_ACTION, "assistant"),
  level: field("level", [], "empty"),
  topics: field("topics", ["cash"], "assistant"),
  employee_name: field("employee_name", "Rowan Tessaly", "manager"),
};

function edit(patch: Partial<FormPatch>, rules: Partial<PatchRules> = {}) {
  return applyPatch(DRAFT, { set: {}, clear: [], ...patch }, { ...BASE, ...rules });
}

describe("rule 1: only writable keys", () => {
  it("refuses a key that is not writable", () => {
    const { draft, diff } = edit({ set: { employee_name: "Rowan Tess" }, evidence: { employee_name: "Rowan Tessaly" } });
    expect(diff.refused).toEqual([{ key: "employee_name", reason: "not_writable" }]);
    expect(diff.changed).toEqual([]);
    expect(draft.employee_name!.value).toBe("Rowan Tessaly");
  });

  it("refuses clearing a key that is not writable", () => {
    expect(edit({ clear: ["employee_name"] }).diff.refused).toEqual([{ key: "employee_name", reason: "not_writable" }]);
  });
});

describe("rule 2: typed fields are never blanked", () => {
  it("a set to empty does nothing to a filled field", () => {
    const { draft, diff } = edit({ set: { observation: "  " }, how: { observation: "replace" }, evidence: { observation: "towel bin" } });
    expect(diff.changed).toEqual([]);
    expect(diff.refused).toEqual([{ key: "observation", reason: "would_blank" }]);
    expect(draft.observation!.value).toBe("Rowan's drawer was short at close.");
  });

  it("a set to empty on an empty field is silently nothing", () => {
    const { diff } = edit({ set: { incident_date: "" }, evidence: { incident_date: "10-20-26" } });
    expect(diff).toEqual({ changed: [], refused: [] });
  });

  it("clearing a manager-typed field is refused", () => {
    const { draft, diff } = edit({ clear: ["observation"], evidence: { observation: "I need to add" } });
    expect(diff.refused).toEqual([{ key: "observation", reason: "would_blank" }]);
    expect(draft.observation!.value).toBe("Rowan's drawer was short at close.");
  });

  it("clearing an assistant field with the manager's words empties it", () => {
    const { draft, diff } = edit({ clear: ["action_plan_notes"], evidence: { action_plan_notes: "the towel bin was emptied twice" } });
    expect(diff.changed).toEqual([{ key: "action_plan_notes", before: "Review the cash handling steps.", after: "" }]);
    expect(draft.action_plan_notes!.owner).toBe("empty");
  });

  it("a clear without the manager's words is refused", () => {
    const { diff } = edit({ clear: ["action_plan_notes"], evidence: { action_plan_notes: "please remove the plan" } });
    expect(diff.refused).toEqual([{ key: "action_plan_notes", reason: "not_in_manager_words" }]);
  });
});

describe("rule 3: draft and redraft", () => {
  const drafted = (patch: Partial<FormPatch>, rules: Partial<PatchRules> = {}) =>
    applyPatch(DRAFT, { set: {}, clear: [], ...patch }, { ...BASE, mode: "draft", sources: undefined, ...rules });

  it("never overwrites a manager-typed field", () => {
    const { draft, diff } = drafted({ set: { observation: "The register was short by $3.25." } });
    expect(diff.refused).toEqual([{ key: "observation", reason: "typed_by_manager" }]);
    expect(draft.observation!.value).toBe("Rowan's drawer was short at close.");
  });

  it("replaces a typed field whose key is in typedExempt", () => {
    const { draft, diff } = drafted(
      { set: { observation: "Cash Handling Policy: the drawer is counted at close." } },
      { typedExempt: new Set(["observation"]) },
    );
    expect(diff.refused).toEqual([]);
    expect(draft.observation).toEqual({ key: "observation", value: "Cash Handling Policy: the drawer is counted at close.", owner: "assistant" });
  });

  it("replaces an assistant field", () => {
    const { diff } = drafted({ set: { action_plan_notes: "Count the drawer with a witness." } });
    expect(diff.changed).toEqual([{ key: "action_plan_notes", before: "Review the cash handling steps.", after: "Count the drawer with a witness." }]);
  });

  it("leaves keys missing from the patch alone (a redraft merges, it does not rebuild)", () => {
    const { draft } = drafted({ set: { action_plan_notes: "Count the drawer with a witness." } });
    for (const key of Object.keys(DRAFT)) if (key !== "action_plan_notes") expect(draft[key]).toEqual(DRAFT[key]);
  });

  it("needs no per-field evidence in draft mode, but a date must be one the manager stated", () => {
    expect(drafted({ set: { incident_date: "2026-10-20" } }, { sources: { manager: MANAGER } }).diff.changed).toHaveLength(1);
  });

  it("refuses a date the manager never gave, in draft mode too (nothing is invented)", () => {
    expect(drafted({ set: { incident_date: "2026-10-21" } }, { sources: { manager: MANAGER } }).diff.refused).toEqual([
      { key: "incident_date", reason: "date_not_stated" },
    ]);
    // With no manager words to check against, a draft writes no date at all.
    expect(drafted({ set: { incident_date: "2026-10-20" } }).diff.refused).toEqual([{ key: "incident_date", reason: "date_not_stated" }]);
  });

  it("refuses an amount the manager never gave, in draft mode too", () => {
    expect(drafted({ set: { payroll_amount: "$25.00" } }, { sources: { manager: MANAGER } }).diff.refused).toEqual([
      { key: "payroll_amount", reason: "not_in_manager_words" },
    ]);
    expect(drafted({ set: { payroll_amount: "$3.25" } }, { sources: { manager: MANAGER } }).draft.payroll_amount!.value).toBe("$3.25");
  });
});

describe("rule 4: chat edit", () => {
  it('"add" appends to the field on a new line', () => {
    const { draft, diff } = edit({
      set: { observation: "The towel bin was emptied twice." },
      how: { observation: "add" },
      evidence: { observation: "the towel bin was emptied twice" },
    });
    expect(diff.refused).toEqual([]);
    expect(draft.observation!.value).toBe("Rowan's drawer was short at close.\nThe towel bin was emptied twice.");
    expect(draft.observation!.owner).toBe("manager");
  });

  it('"add" does nothing when the field already says it', () => {
    const { diff } = edit({
      set: { observation: "drawer was  SHORT at close" },
      how: { observation: "add" },
      evidence: { observation: "a register shortage on 10-20-26" },
    });
    expect(diff).toEqual({ changed: [], refused: [] });
  });

  it('"replace" on a typed field with the manager\'s own words replaces it', () => {
    const { draft } = edit({
      set: { observation: "The towel bin was emptied twice." },
      how: { observation: "replace" },
      evidence: { observation: "I need to add that the towel bin was emptied twice" },
    });
    expect(draft.observation!.value).toBe("The towel bin was emptied twice.");
  });

  it('"replace" on a typed field with the accepted offer is refused: offered text never replaces typed text', () => {
    const { draft, diff } = edit(
      { set: { observation: OFFERED }, how: { observation: "replace" }, evidence: { observation: OFFERED } },
      { sources: { manager: MANAGER, offered: OFFERED, accepted: true } },
    );
    expect(diff.refused).toEqual([{ key: "observation", reason: "typed_by_manager" }]);
    expect(draft.observation!.value).toBe("Rowan's drawer was short at close.");
  });

  it("evidence from an accepted offer writes an assistant field", () => {
    const { draft, diff } = edit(
      { set: { action_plan_notes: OFFERED }, how: { action_plan_notes: "replace" }, evidence: { action_plan_notes: OFFERED } },
      { sources: { manager: MANAGER, offered: OFFERED, accepted: true } },
    );
    expect(diff.changed).toHaveLength(1);
    expect(draft.action_plan_notes!.owner).toBe("assistant");
  });

  it("evidence from an offer the manager did not accept is refused", () => {
    const { diff } = edit({ set: { action_plan_notes: OFFERED }, how: { action_plan_notes: "replace" }, evidence: { action_plan_notes: OFFERED } });
    expect(diff.refused).toEqual([{ key: "action_plan_notes", reason: "not_in_manager_words" }]);
  });

  it("evidence nobody said, or none at all, is refused", () => {
    expect(edit({ set: { action_plan_notes: "x" }, evidence: { action_plan_notes: "the manager never said this" } }).diff.refused).toEqual([
      { key: "action_plan_notes", reason: "not_in_manager_words" },
    ]);
    expect(edit({ set: { action_plan_notes: "x" } }).diff.refused).toEqual([{ key: "action_plan_notes", reason: "not_in_manager_words" }]);
  });

  it("the evidence check folds case and whitespace only", () => {
    const { diff } = edit({
      set: { action_plan_notes: "Towel bin emptied twice." },
      how: { action_plan_notes: "replace" },
      evidence: { action_plan_notes: "THE   Towel\nbin was emptied TWICE" },
    });
    expect(diff.refused).toEqual([]);
    expect(fold("  A\t b \n C ")).toBe("a b c");
  });

  it("payroll amount is written verbatim from the manager's words", () => {
    const { draft, diff } = edit({ set: { payroll_amount: "$3.25" }, evidence: { payroll_amount: "$3.25 will be deducted from check" } });
    expect(diff.refused).toEqual([]);
    expect(draft.payroll_amount).toEqual({ key: "payroll_amount", value: "$3.25", owner: "manager" });
  });

  it("an amount the manager did not say verbatim is refused", () => {
    const { diff } = edit({ set: { payroll_amount: "$3.50" }, evidence: { payroll_amount: "$3.25 will be deducted from check" } });
    expect(diff.refused).toEqual([{ key: "payroll_amount", reason: "not_in_manager_words" }]);
  });

  it("an amount already answered is refused, and the same amount is no change", () => {
    const filled = { ...DRAFT, payroll_amount: field("payroll_amount", "$3.25", "manager") };
    const rules = BASE;
    const other = applyPatch(filled, { set: { payroll_amount: "$5" }, clear: [], evidence: { payroll_amount: "$3.25 will be deducted" } }, rules);
    expect(other.diff.refused).toEqual([{ key: "payroll_amount", reason: "already_answered" }]);
    const same = applyPatch(filled, { set: { payroll_amount: "$3.25" }, clear: [], evidence: { payroll_amount: "$3.25 will be deducted" } }, rules);
    expect(same.diff).toEqual({ changed: [], refused: [] });
  });

  it("a date the manager stated is written", () => {
    const { draft, diff } = edit({ set: { incident_date: "2026-10-20" }, evidence: { incident_date: "a register shortage on 10-20-26" } });
    expect(diff.refused).toEqual([]);
    expect(draft.incident_date!.value).toBe("2026-10-20");
  });

  it("an invented date is refused", () => {
    const { draft, diff } = edit({ set: { incident_date: "2026-10-21" }, evidence: { incident_date: "a register shortage on 10-20-26" } });
    expect(diff.refused).toEqual([{ key: "incident_date", reason: "date_not_stated" }]);
    expect(draft.incident_date!.value).toBe("");
  });

  it("a date whose evidence states no date is refused", () => {
    const { diff } = edit({ set: { incident_date: "2026-10-20" }, evidence: { incident_date: "payroll deduct applies" } });
    expect(diff.refused).toEqual([{ key: "incident_date", reason: "date_not_stated" }]);
  });
});

describe("evidence strength (QA, 3 Nov 2026)", () => {
  it('refuses one-word evidence such as "a" or "the", even though it is a substring of what was said', () => {
    for (const evidence of ["a", "the", "towel bin"]) {
      const { diff } = edit({ set: { action_plan_notes: "Count the drawer twice." }, how: { action_plan_notes: "add" }, evidence: { action_plan_notes: evidence } });
      expect(diff.refused, evidence).toEqual([{ key: "action_plan_notes", reason: "not_in_manager_words" }]);
    }
  });

  it("accepts a whole manager turn shorter than three words as evidence", () => {
    const rules = { sources: { manager: `${MANAGER}\nbin emptied`, managerTurns: ["bin emptied"] } };
    const { diff } = edit({ set: { action_plan_notes: "Bin emptied." }, how: { action_plan_notes: "add" }, evidence: { action_plan_notes: "bin emptied" } }, rules);
    expect(diff.refused).toEqual([]);
    expect(diff.changed).toHaveLength(1);
  });

  it("refuses an invented sentence even with real evidence: the value's words must have been said", () => {
    const { diff } = edit({
      set: { observation: "Rowan was rude to a customer and left the salon early without permission." },
      how: { observation: "add" },
      evidence: { observation: "the towel bin was emptied twice" },
    });
    expect(diff.refused).toEqual([{ key: "observation", reason: "not_in_manager_words" }]);
  });

  it("accepts a value built from the accepted offer's words", () => {
    const { diff } = edit(
      { set: { action_plan_notes: "Rowan was reminded to count the drawer at the start of every shift." }, how: { action_plan_notes: "replace" }, evidence: { action_plan_notes: "count the drawer at the start of every shift" } },
      { sources: { manager: MANAGER, offered: OFFERED, accepted: true } },
    );
    expect(diff.refused).toEqual([]);
  });
});

describe("evidence strength for a clear", () => {
  it('refuses a clear whose evidence is one word such as "the"', () => {
    expect(edit({ clear: ["action_plan_notes"], evidence: { action_plan_notes: "the" } }).diff.changed).toEqual([]);
  });
});

describe("rule 5: checkbox groups", () => {
  it("a single-choice group takes exactly one known option", () => {
    const ok = edit({ set: { level: ["written"] }, evidence: { level: "create ca form" } });
    expect(ok.draft.level!.value).toEqual(["written"]);
    expect(edit({ set: { level: ["written", "final"] }, evidence: { level: "create ca form" } }).diff.refused).toEqual([
      { key: "level", reason: "unknown_option" },
    ]);
  });

  it("an option outside the group is refused", () => {
    expect(edit({ set: { level: ["termination"] }, evidence: { level: "create ca form" } }).diff.refused).toEqual([
      { key: "level", reason: "unknown_option" },
    ]);
    expect(edit({ set: { topics: ["cash", "theft"] }, evidence: { topics: "a register shortage on 10-20-26" } }).diff.refused).toEqual([
      { key: "topics", reason: "unknown_option" },
    ]);
  });

  it("a multi-choice group adds or replaces", () => {
    const added = edit({ set: { topics: ["conduct"] }, how: { topics: "add" }, evidence: { topics: "a register shortage on 10-20-26" } });
    expect(added.draft.topics!.value).toEqual(["cash", "conduct"]);
    const replaced = edit({ set: { topics: ["conduct", "attendance"] }, how: { topics: "replace" }, evidence: { topics: "a register shortage on 10-20-26" } });
    expect(replaced.draft.topics!.value).toEqual(["conduct", "attendance"]);
  });

  it("the same options in another order are no change", () => {
    const draft = { ...DRAFT, topics: field("topics", ["cash", "conduct"], "assistant") };
    const { diff } = applyPatch(draft, { set: { topics: ["conduct", "cash"] }, clear: [], evidence: { topics: "a register shortage on 10-20-26" } }, BASE);
    expect(diff).toEqual({ changed: [], refused: [] });
  });
});

describe("rule 6: prior actions are united and de-duplicated", () => {
  const verbal = priorActionLine("Verbal warning", "2025-05-12");
  // This app's priorActionLine takes (step, iso, topic, description); the sibling app's takes the last two the other way round.
  const verbalLonger = priorActionLine("Verbal warning", "2025-05-12", "Cash Handling");
  const coaching = priorActionLine("Coaching", "2026-01-01");

  it("keys on the step and the signed date of priorActionLine's format", () => {
    expect(priorLineKey(verbal)).toBe(priorLineKey(verbalLonger));
    expect(priorLineKey(verbal)).not.toBe(priorLineKey(coaching));
    expect(priorLineKey("VERBAL   warning — signed 05/12/2025")).toBe(priorLineKey(verbal));
  });

  it("drops the no-prior-action line once a real line exists", () => {
    const { draft } = edit({ set: { prior_actions: verbal }, evidence: { prior_actions: "create ca form" } });
    expect(draft.prior_actions!.value).toBe(verbal);
  });

  it("adds a new line and keeps the longer of two lines for the same step", () => {
    const filled = { ...DRAFT, prior_actions: field("prior_actions", [verbal, coaching].join("\n"), "assistant") };
    const { draft } = applyPatch(filled, { set: { prior_actions: verbalLonger }, clear: [], evidence: { prior_actions: "create ca form" } }, BASE);
    expect(draft.prior_actions!.value).toBe([verbalLonger, coaching].join("\n"));
  });

  it("keeps the existing longer line when a shorter duplicate arrives, which is no change", () => {
    const filled = { ...DRAFT, prior_actions: field("prior_actions", verbalLonger, "assistant") };
    const { diff } = applyPatch(filled, { set: { prior_actions: verbal }, clear: [], evidence: { prior_actions: "create ca form" } }, BASE);
    expect(diff).toEqual({ changed: [], refused: [] });
  });

  it("de-duplicates in draft mode too, and keeps the none line when nothing real exists", () => {
    const draftRules = { ...BASE, mode: "draft" as const, sources: undefined };
    const filled = { ...DRAFT, prior_actions: field("prior_actions", verbal, "assistant") };
    expect(applyPatch(filled, { set: { prior_actions: [verbal, NO_PRIOR_ACTION] }, clear: [] }, draftRules).diff.changed).toEqual([]);
    const empty = { ...DRAFT, prior_actions: field("prior_actions", "", "empty") };
    expect(applyPatch(empty, { set: { prior_actions: NO_PRIOR_ACTION }, clear: [] }, draftRules).draft.prior_actions!.value).toBe(NO_PRIOR_ACTION);
  });
});

describe("rule 7: the same value is not a change", () => {
  it("a set to the same text changes nothing", () => {
    const { diff } = edit({
      set: { action_plan_notes: "  Review the cash handling steps. " },
      how: { action_plan_notes: "replace" },
      evidence: { action_plan_notes: "a register shortage on 10-20-26" },
    });
    expect(diff).toEqual({ changed: [], refused: [] });
  });

  it("a draft set to a typed field's own value is no change and no refusal", () => {
    const { diff } = applyPatch(DRAFT, { set: { observation: "Rowan's drawer was short at close." }, clear: [] }, { ...BASE, mode: "draft" });
    expect(diff).toEqual({ changed: [], refused: [] });
  });
});

describe("createReducer, diffDrafts and draftFromRows", () => {
  it("createReducer binds the rules", () => {
    const reduce = createReducer(BASE);
    const patch: FormPatch = { set: { payroll_amount: "$3.25" }, clear: [], evidence: { payroll_amount: "$3.25" } };
    expect(reduce(DRAFT, patch)).toEqual(applyPatch(DRAFT, patch, BASE));
  });

  it("diffDrafts lists only the fields whose value differs", () => {
    const after: FormDraft = {
      ...DRAFT,
      observation: field("observation", "Something else.", "manager"),
      level: field("level", "", "empty"),
      tone: field("tone", "calm", "assistant"),
    };
    expect(diffDrafts(DRAFT, after)).toEqual([
      { key: "observation", before: "Rowan's drawer was short at close.", after: "Something else." },
      { key: "tone", before: "", after: "calm" },
    ]);
    expect(diffDrafts(DRAFT, DRAFT)).toEqual([]);
  });

  it("draftFromRows reads the owner from provenance only", () => {
    const row = (fieldKey: string, value: string | null, filledBy: InstanceValueRow["filledBy"], provenance: Record<string, unknown> = {}, checked: string[] = []): InstanceValueRow => ({
      fieldKey,
      value,
      checked,
      filledBy,
      provenance,
    });
    const draft = draftFromRows([
      row("observation", "Typed by the manager.", "manager"),
      row("payroll_amount", "$3.25", "system", { source: "manager_statement" }),
      row("incident_date", "2026-10-20", "system", { source: "template" }),
      row("action_plan_notes", "Drafted.", "ai"),
      row("tone", "", "manager"),
      row("topics", null, "ai", {}, ["cash"]),
      row("level", null, "manager", {}, []),
    ]);
    expect(draft.observation!.owner).toBe("manager");
    expect(draft.payroll_amount!.owner).toBe("manager");
    expect(draft.incident_date!.owner).toBe("assistant");
    expect(draft.action_plan_notes!.owner).toBe("assistant");
    expect(draft.tone!.owner).toBe("empty");
    expect(draft.topics).toEqual({ key: "topics", value: ["cash"], owner: "assistant" });
    expect(draft.level).toEqual({ key: "level", value: "", owner: "empty" });
  });
});
