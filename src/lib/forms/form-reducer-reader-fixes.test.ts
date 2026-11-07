import { describe, expect, it } from "vitest";

import { applyPatch, factWords, type FormDraft, type FormPatch, type PatchRules } from "./form-reducer";
import { patchOutputSchema, toPatch } from "./form-patch-schema";

/**
 * FORM_PATCH_READER_FIXES_ENABLED (coding 5, 7 Nov 2026): the reducer's side. The rules the patch turn
 * builds with the flag on carry `faithful` and `verbatimKeys`; without them every check is as before.
 * The manager's words are the real-AI trace's (6 Nov) and the production refusals' (QA, 7 Nov); the
 * people are invented and on neither directory.
 */

function field(key: string, value: string, owner: "manager" | "assistant" | "empty") {
  return { key, value, owner } as const;
}

/** The single writer's patch preset (namingTurn, keepsUnnamedWords), with or without the reader fixes. */
function rules(latest: string, keys: string[], fixes: { employeeName: string; formText: string } | null, turns: string[] = [latest]): PatchRules {
  return {
    mode: "edit",
    writable: new Set(keys),
    keepsUnnamedWords: true,
    sources: { manager: turns.join("\n"), managerTurns: turns, namingTurn: latest },
    protectedValues: { employeeName: fixes?.employeeName ?? "", datesIn: () => [], amountsIn: () => [], latest },
    ...(fixes ? { faithful: { ...fixes, latest }, verbatimKeys: new Set(["job_title"]) } : {}),
  };
}

const op = (key: string, value: string, how: "add" | "replace" | "reword", evidence: string): FormPatch => ({
  set: { [key]: value },
  clear: [],
  how: { [key]: how },
  evidence: { [key]: evidence },
});

describe("factWords", () => {
  it("a number, or a capital inside a sentence; never a sentence's first word", () => {
    expect([...factWords("During September 2026, Sabeline completed 146 transactions.\nThe Leadership Team will coach.")].sort()).toEqual(
      ["146", "2026", "leadership", "sabeline", "september", "team"].sort(),
    );
    expect([...factWords("Perrin missed the monthly meeting.")]).toEqual([]);
  });
});

describe("FORM_PATCH_READER_FIXES_ENABLED: the evidence and word checks", () => {
  const PRACTICE = "Add that she Must Practice the sanitizing checklist every shift.";
  const CA: FormDraft = { observation: field("observation", "Observed:\nWrenna Thistlecombe was late to open on October 20, 2026.", "assistant") };
  const NAMED = op("observation", "Wrenna Thistlecombe must practice the sanitizing checklist every shift.", "add", "Wrenna Thistlecombe must practice the sanitizing checklist every shift");

  it("off: the name put in front of her words is refused (the trace's not_in_manager_words)", () => {
    expect(applyPatch(CA, NAMED, rules(PRACTICE, ["observation"], null)).diff.refused).toEqual([{ key: "observation", reason: "not_in_manager_words" }]);
  });

  it("on: the form's own name counts as said, in the value and in the evidence", () => {
    const { diff } = applyPatch(CA, NAMED, rules(PRACTICE, ["observation"], { employeeName: "Wrenna Thistlecombe", formText: CA.observation!.value as string }));
    expect(diff.refused).toEqual([]);
    expect(diff.changed[0]!.after).toMatch(/late to open on October 20, 2026\.\nWrenna Thistlecombe must practice/);
  });

  it("on: a name that is neither said nor the form's is still refused", () => {
    const invented = op("observation", "She must practice the checklist with Bartholomew every shift.", "add", "must practice the sanitizing checklist every shift");
    expect(applyPatch(CA, invented, rules(PRACTICE, ["observation"], { employeeName: "Wrenna Thistlecombe", formText: "" })).diff.refused).toEqual([
      { key: "observation", reason: "not_in_manager_words" },
    ]);
  });

  it("on: a number nobody said is refused", () => {
    const latest = "add that she was also on her phone";
    const invented = op("observation", "She was also on her phone for 45 minutes.", "add", latest);
    expect(applyPatch(CA, invented, rules(latest, ["observation"], { employeeName: "Wrenna Thistlecombe", formText: "" })).diff.refused).toEqual([
      { key: "observation", reason: "not_in_manager_words" },
    ]);
  });

  it("on: \"can you make it for missing out monthly meeting\" → \"Perrin missed the monthly meeting.\" (a stem, half the other words said)", () => {
    const latest = "can you make it for missing out monthly meeting";
    const draft: FormDraft = { coaching_details: field("coaching_details", "", "empty") };
    const meeting = op("coaching_details", "Perrin missed the monthly meeting.", "replace", "missing out monthly meeting");
    expect(applyPatch(draft, meeting, rules(latest, ["coaching_details"], null)).diff.refused).toEqual([{ key: "coaching_details", reason: "not_in_manager_words" }]);
    expect(applyPatch(draft, meeting, rules(latest, ["coaching_details"], { employeeName: "Perrin Fennimore", formText: "" })).diff.refused).toEqual([]);
  });

  it("on: text mostly not said is still refused (the half floor)", () => {
    const latest = "can you make it for missing out monthly meeting";
    const draft: FormDraft = { coaching_details: field("coaching_details", "", "empty") };
    const padded = op("coaching_details", "Perrin repeatedly ignored several mandatory leadership gatherings without notice.", "replace", "missing out monthly meeting");
    expect(applyPatch(draft, padded, rules(latest, ["coaching_details"], { employeeName: "Perrin Fennimore", formText: "" })).diff.refused).toEqual([
      { key: "coaching_details", reason: "not_in_manager_words" },
    ]);
  });
});

describe("FORM_PATCH_READER_FIXES_ENABLED: \"reword\" (Pau, 7 Nov 2026: yes rewrite)", () => {
  const PRO = "can you make it more professional";
  const OLD = "Observed:\nIsolde Pembrook was late to open the salon today.\nExpectation:\nIsolde is expected to arrive on time and be ready to open.";
  const NEW = "Observed:\nIsolde Pembrook arrived after the scheduled opening time today.\nExpectation:\nIsolde is expected to arrive punctually, prepared to open the salon.";
  const draft: FormDraft = { coaching_details: field("coaching_details", OLD, "assistant") };
  const fixes = { employeeName: "Isolde Pembrook", formText: OLD };

  it("off: a reword is a replace and is refused (the trace's not_in_manager_words ×2)", () => {
    expect(applyPatch(draft, op("coaching_details", NEW, "reword", PRO), rules(PRO, ["coaching_details"], null)).diff.refused).toEqual([
      { key: "coaching_details", reason: "not_in_manager_words" },
    ]);
  });

  it("on: new words are written", () => {
    const { diff } = applyPatch(draft, op("coaching_details", NEW, "reword", PRO), rules(PRO, ["coaching_details"], fixes));
    expect(diff.refused).toEqual([]);
    expect(diff.changed[0]!.after).toBe(NEW);
  });

  it("on: a reword that adds a fact (a name, a number) is refused", () => {
    const added = NEW.replace("today.", "today, 25 minutes late, as Dorian saw.");
    expect(applyPatch(draft, op("coaching_details", added, "reword", PRO), rules(PRO, ["coaching_details"], fixes)).diff.refused).toEqual([
      { key: "coaching_details", reason: "not_in_manager_words" },
    ]);
  });

  it("on: a reword that drops her name is refused (protected value)", () => {
    const dropped = NEW.replace("Isolde Pembrook arrived", "The employee arrived").replace("Isolde is", "The employee is");
    expect(applyPatch(draft, op("coaching_details", dropped, "reword", PRO), rules(PRO, ["coaching_details"], fixes)).diff.refused).toEqual([
      { key: "coaching_details", reason: "drops_protected_value" },
    ]);
  });

  it("on: a reword of an empty field is refused", () => {
    const empty: FormDraft = { coaching_details: field("coaching_details", "", "empty") };
    expect(applyPatch(empty, op("coaching_details", NEW, "reword", PRO), rules(PRO, ["coaching_details"], fixes)).diff.refused).toEqual([
      { key: "coaching_details", reason: "not_in_manager_words" },
    ]);
  });
});

describe("FORM_PATCH_READER_FIXES_ENABLED: replacing what the assistant wrote", () => {
  const LATE = "I need you to make it about showing up late and please list the policy make the date for 10/14/26.";
  const value = op("coaching_details", "Thaddeus showed up late.", "replace", "make it about showing up late");

  it("on: assistant text may be replaced when she asks (no drops_words); off it is refused", () => {
    const draft: FormDraft = { coaching_details: field("coaching_details", "Observed:\nThaddeus already has one but the policy was not listed.", "assistant") };
    expect(applyPatch(draft, value, rules(LATE, ["coaching_details"], null)).diff.refused).toEqual([{ key: "coaching_details", reason: "not_in_manager_words" }]);
    expect(applyPatch(draft, value, rules(LATE, ["coaching_details"], { employeeName: "Thaddeus Lowestoft", formText: "" })).diff.refused).toEqual([]);
  });

  it("on: what she typed herself still keeps every word she did not name", () => {
    const typed: FormDraft = { coaching_details: field("coaching_details", "Thaddeus was rude to a guest at the register.", "manager") };
    expect(applyPatch(typed, value, rules(LATE, ["coaching_details"], { employeeName: "Thaddeus Lowestoft", formText: "" })).diff.refused).toEqual([
      { key: "coaching_details", reason: "drops_words" },
    ]);
  });
});

describe("FORM_PATCH_READER_FIXES_ENABLED: the Job Title (verbatimKeys)", () => {
  const POSITION = "change her position to Tanning Consultant";
  const draft: FormDraft = { job_title: field("job_title", "", "empty") };

  it("on: the latest message's words are written as the manager's", () => {
    const { diff, draft: next } = applyPatch(draft, op("job_title", "Tanning Consultant", "replace", POSITION), rules(POSITION, ["job_title"], { employeeName: "Briony Tallisker", formText: "" }));
    expect(diff.refused).toEqual([]);
    expect(next.job_title).toEqual({ key: "job_title", value: "Tanning Consultant", owner: "manager" });
  });

  it("on: a title the latest message does not say is refused", () => {
    expect(applyPatch(draft, op("job_title", "Tanning Consultant Lead", "replace", POSITION), rules(POSITION, ["job_title"], { employeeName: "Briony Tallisker", formText: "" })).diff.refused).toEqual([
      { key: "job_title", reason: "not_in_manager_words" },
    ]);
  });

  it("on: a Woven title is replaced by the one she gives", () => {
    const woven: FormDraft = { job_title: field("job_title", "Tanning Consultant", "assistant") };
    const latest = "change her position to Assistant Salon Director";
    expect(applyPatch(woven, op("job_title", "Assistant Salon Director", "replace", latest), rules(latest, ["job_title"], { employeeName: "Galen Winterbourne", formText: "" })).diff.changed).toEqual([
      { key: "job_title", before: "Tanning Consultant", after: "Assistant Salon Director" },
    ]);
  });
});

describe("the schema", () => {
  it("off: \"reword\" is not a `how` (the model's object is refused, the turn falls back)", () => {
    const output = { turn: "this_form", set: [{ field: "a", value: "x", how: "reword", evidence: "x" }], clear: [] };
    expect(patchOutputSchema(["a"]).safeParse(output).success).toBe(false);
    const parsed = patchOutputSchema(["a"], { reword: true }).safeParse(output);
    expect(parsed.success).toBe(true);
    expect(toPatch(parsed.data!).how).toEqual({ a: "reword" });
  });
});
