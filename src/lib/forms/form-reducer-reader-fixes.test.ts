import { describe, expect, it } from "vitest";

import { addsNothingNew, applyPatch, factWords, repeatsField, repeatsInstruction, type FormDraft, type FormPatch, type PatchRules } from "./form-reducer";
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

describe("FORM_PATCH_READER_FIXES_ENABLED: content she gave is kept (QA's live run, 7 Nov 2026)", () => {
  const STEPS = "wipe down the bed with the approved cleaner, use a fresh towel, empty the trash, reset the timer and check the room before the next guest is taken back.";
  const LATEST = `this is what i am wanting to coach on: getting rooms ready between guests, here are the details of the process: ${STEPS}`;
  const draft: FormDraft = { coaching_details: field("coaching_details", "Observed:\nNeeds coaching on room turnover.", "assistant") };
  const fixes = { employeeName: "Leopold Ashdown", formText: "Observed:\nNeeds coaching on room turnover." };

  it("on: a shorter summary that drops the towel is refused (drops_words)", () => {
    const summary = op("coaching_details", "Observed:\nReviewed the process for getting rooms ready between guests, including wiping down the bed.", "replace", STEPS);
    // Changed on purpose (7 Nov 2026): the stricter unsaid-words floor now refuses it first (not_in_manager_words); refused either way.
    const { diff } = applyPatch(draft, summary, rules(LATEST, ["coaching_details"], fixes));
    expect(diff.changed).toEqual([]);
    expect(diff.refused.map((refusal) => refusal.key)).toEqual(["coaching_details"]);
  });

  it("on: the process as she gave it is written", () => {
    expect(applyPatch(draft, op("coaching_details", STEPS, "replace", STEPS), rules(LATEST, ["coaching_details"], fixes)).diff.refused).toEqual([]);
  });
});

describe("FORM_PATCH_READER_FIXES_ENABLED: after the reader found nothing to write (QA's re-run, 7 Nov 2026)", () => {
  it("the instruction written as content adds nothing new (a heading is layout)", () => {
    expect(addsNothingNew("Observed:\nAdd details about the towel.", "", "add details about the towel")).toBe(true);
  });

  it("a sentence the field already holds, written again, adds nothing new", () => {
    const once = "Reminded her to call a manager for any cash drawer shortage.";
    expect(addsNothingNew(`${once}\n${once}`, once, "yes, do that")).toBe(true);
  });

  it("content from the conversation is new", () => {
    expect(addsNothingNew("Use a fresh towel for every guest.", "", "add details about the towel")).toBe(false);
  });

  it("the revision's write is refused as copies_message with `nothingNewFrom`", () => {
    const draft: FormDraft = { coaching_details: field("coaching_details", "", "empty") };
    const rules: PatchRules = { mode: "draft", writable: new Set(["coaching_details"]), typedExempt: new Set(["coaching_details"]), sources: { manager: "add details about the towel" }, nothingNewFrom: "add details about the towel" };
    const write: FormPatch = { set: { coaching_details: "Observed:\nAdd details about the towel." }, clear: [] };
    expect(applyPatch(draft, write, rules).diff.refused).toEqual([{ key: "coaching_details", reason: "copies_message" }]);
    const { nothingNewFrom: _off, ...without } = rules;
    void _off;
    expect(applyPatch(draft, write, without).diff.refused).toEqual([]);
  });
});

describe("FORM_PATCH_READER_FIXES_ENABLED: \"make it for/about X\" keeps her X (QA's run 4, 7 Nov 2026)", () => {
  const LATEST = "can you make it for missing out monthly meeting";
  const draft: FormDraft = { coaching_details: field("coaching_details", "", "empty") };
  const fixes = { employeeName: "Perrin Fennimore", formText: "" };

  it("text about the form, none of her words in it, is refused (even with every word said earlier)", () => {
    const sameWords = op("coaching_details", "This coaching form for Perrin is about the attendance policy.", "replace", "missing out monthly meeting");
    // Changed on purpose (7 Nov 2026): the stricter unsaid-words floor may refuse it first (not_in_manager_words); refused either way.
    const { diff } = applyPatch(draft, sameWords, rules(LATEST, ["coaching_details"], fixes, [LATEST, "can you create a coaching form for attendance policy"]));
    expect(diff.changed).toEqual([]);
    expect(diff.refused.map((refusal) => refusal.key)).toEqual(["coaching_details"]);
  });

  it("text about the form, with words nobody said, is refused", () => {
    const drift = op("coaching_details", "Observed:\nThis coaching session with Perrin addressed the attendance policy.", "replace", "missing out monthly meeting");
    const { diff } = applyPatch(draft, drift, rules(LATEST, ["coaching_details"], fixes, [LATEST, "can you create a coaching form for attendance policy"]));
    expect(diff.changed).toEqual([]);
    expect(diff.refused.map((refusal) => refusal.key)).toEqual(["coaching_details"]);
  });

  it("her X, in the account, is written", () => {
    expect(applyPatch(draft, op("coaching_details", "Perrin missed the monthly meeting.", "replace", "missing out monthly meeting"), rules(LATEST, ["coaching_details"], fixes)).diff.refused).toEqual([]);
  });
});

describe("FORM_PATCH_READER_FIXES_ENABLED: an in-place correction is not held to its instruction's words", () => {
  it("\"fix her last name, it is Pembrooke\" rewrites the text with the word corrected", () => {
    const latest = "fix her last name, it is Pembrooke";
    const old = "Observed:\nIsolde Pembrook was late to open the salon today.";
    const draft: FormDraft = { coaching_details: field("coaching_details", old, "assistant") };
    const fixed = op("coaching_details", old.replace("Pembrook", "Pembrooke"), "replace", latest);
    expect(applyPatch(draft, fixed, rules(latest, ["coaching_details"], { employeeName: "Isolde Pembrook", formText: old })).diff.refused).toEqual([]);
  });
});

describe("FORM_PATCH_READER_FIXES_ENABLED: the instruction is never written back as content (QA's stability run 2)", () => {
  const coaching = { coaching_details: "Details of Coaching", prior_actions: "Prior Coaching / Corrective Action" };
  const echo = (latest: string) => ({ latest, name: "Maelis Kittredge", formWords: coaching });

  it("\"Details about the towel.\" for \"add details about the towel\" repeats the instruction", () => {
    expect(repeatsInstruction("Details about the towel.", echo("add details about the towel"), "coaching_details")).toBe(true);
    expect(repeatsInstruction("Observed:\nAdd details about the towel.", echo("add details about the towel"), "coaching_details")).toBe(true);
  });

  it("content in her own words does not name its field", () => {
    expect(repeatsInstruction("She was also on her phone.", echo("add that she was also on her phone"), "coaching_details")).toBe(false);
    expect(repeatsInstruction("He told the whole team he was quitting.", echo("update the draft: he told the whole team he was quitting"), "coaching_details")).toBe(false);
    expect(repeatsInstruction("Reminded her to call a manager for any cash drawer shortage.", echo("add to the details: reminded her to call a manager for any cash drawer shortage"), "coaching_details")).toBe(false);
  });

  it("a label word that is content is not an echo (\"Coaching when she signed …\" in Prior Coaching)", () => {
    expect(repeatsInstruction("Coaching when she signed the policy manual — signed May 2025", echo("Previous coaching was when she signed the policy manual, signed May 2025"), "prior_actions")).toBe(false);
    expect(repeatsInstruction("She skipped her coaching session.", echo("add that she skipped her coaching session"), "coaching_details")).toBe(false);
  });

  it("a word nobody said makes it not an echo (the other checks judge it)", () => {
    expect(repeatsInstruction("Details: use a fresh towel for every guest.", echo("add details about the towel"), "coaching_details")).toBe(false);
  });
});

describe("FORM_PATCH_READER_FIXES_ENABLED: a new account she asks for replaces the old one whole (QA's trace, 7 Nov 2026)", () => {
  const LATE = "I need you to make it about showing up late and please list the policy make the date for 10/14/26.";
  const OLD = "Observed:\nThaddeus Lowestoft already has a coaching document from October 14, 2026, but the policy was not listed.";
  const draft: FormDraft = { coaching_details: field("coaching_details", OLD, "assistant") };
  const guard = { employeeName: "Thaddeus Lowestoft", datesIn: (text: string) => (/October 14, 2026/.test(text) ? ["2026-10-14"] : []), amountsIn: () => [], latest: LATE };

  it("\"Observed: showing up late.\" (her words, new content) is written; the old account's name and date may go", () => {
    const base = rules(LATE, ["coaching_details"], { employeeName: "Thaddeus Lowestoft", formText: OLD });
    const withDates: PatchRules = { ...base, protectedValues: guard };
    const { diff } = applyPatch(draft, op("coaching_details", "Observed:\nshowing up late.", "replace", "make it about showing up late"), withDates);
    expect(diff.refused).toEqual([]);
    // Off (no reader fixes): the protected values hold, as before.
    const off: PatchRules = { ...rules(LATE, ["coaching_details"], null), protectedValues: guard };
    expect(applyPatch(draft, op("coaching_details", "Observed:\nshowing up late.", "replace", "make it about showing up late"), off).diff.changed).toEqual([]);
  });

  it("an in-place edit still keeps her name (not new content)", () => {
    const base: PatchRules = { ...rules(LATE, ["coaching_details"], { employeeName: "Thaddeus Lowestoft", formText: OLD }), protectedValues: guard };
    const edit = op("coaching_details", OLD.replace("Thaddeus Lowestoft already", "Already").replace(", but", " but"), "replace", "make it about showing up late");
    expect(applyPatch(draft, edit, base).diff.refused.map((refusal) => refusal.reason)).toContain("drops_protected_value");
  });

  it("evidence that is not in her latest message keeps the protected values", () => {
    const base: PatchRules = { ...rules(LATE, ["coaching_details"], { employeeName: "Thaddeus Lowestoft", formText: OLD }, [LATE, "she was late again"]), protectedValues: guard };
    const { diff } = applyPatch(draft, op("coaching_details", "Observed:\nshe was late again.", "replace", "she was late again"), base);
    expect(diff.refused.map((refusal) => refusal.reason)).toContain("drops_protected_value");
  });

  it("the old path's new content must keep the reader's evidence (`readerEvidence`)", () => {
    const revision: PatchRules = { mode: "draft", writable: new Set(["coaching_details"]), typedExempt: new Set(["coaching_details"]), sources: { manager: LATE }, readerEvidence: { coaching_details: "make it about showing up late" } };
    const drift = { set: { coaching_details: "This coaching document was created on 10/14/26 to add the policy reference that was missing." }, clear: [] };
    expect(applyPatch(draft, drift, revision).diff.refused).toEqual([{ key: "coaching_details", reason: "drops_words" }]);
    expect(applyPatch(draft, { set: { coaching_details: "Observed:\nThaddeus showed up late." }, clear: [] }, revision).diff.refused).toEqual([]);
  });
});

describe("FORM_PATCH_READER_FIXES_ENABLED: what the field says is never written again (QA's 2x run, 7 Nov 2026)", () => {
  const ONCE = "Reminded her to call a manager for any cash drawer shortage.";
  it("the same sentence twice, or nearly the same, repeats the field", () => {
    expect(repeatsField(`${ONCE}\n${ONCE}`, ONCE)).toBe(true);
    expect(repeatsField(`${ONCE}\nReminded her to call a manager about any cash drawer shortage.`, ONCE)).toBe(true);
  });
  it("a new sentence, an in-place fix or a rewording does not", () => {
    expect(repeatsField(`${ONCE}\nShe also left the safe open.`, ONCE)).toBe(false);
    expect(repeatsField("Observed:\nIsolde Pembrooke was late to open.", "Observed:\nIsolde Pembrook was late to open.")).toBe(false);
    expect(repeatsField("Observed:\nIsolde arrived after opening time.", "Observed:\nIsolde was late to open.")).toBe(false);
  });
  it("a patch add that nearly repeats a sentence is refused with `noRepeat`", () => {
    const draft: FormDraft = { coaching_details: field("coaching_details", ONCE, "assistant") };
    const latest = "yes, do that";
    const again = op("coaching_details", "Reminded her to call a manager about any cash drawer shortage.", "add", "reminded her to call a manager for any cash drawer shortage");
    const base: PatchRules = { ...rules(latest, ["coaching_details"], { employeeName: "Ottoline Ormsworth", formText: ONCE }, [latest, `add to the details: ${ONCE}`]), noRepeat: true };
    expect(applyPatch(draft, again, base).diff.changed).toEqual([]);
  });
});

describe("FORM_PATCH_READER_FIXES_ENABLED: an invented clause is refused (the sibling app's replay, 7 Nov 2026)", () => {
  it("her sentence plus \"lied to the customer, refused to apologise, and was rude\" is refused", () => {
    const what = "rowan marked an order as shipped but the customer hadn't picked up yet";
    const draft: FormDraft = { coaching_details: field("coaching_details", "", "empty") };
    const invented = op("coaching_details", "Rowan marked an order as shipped and then lied to the customer about it, refused to apologise, and was rude to the team all week.", "add", what);
    expect(applyPatch(draft, invented, rules(what, ["coaching_details"], { employeeName: "Rowan Kestrel", formText: "" })).diff.refused).toEqual([{ key: "coaching_details", reason: "not_in_manager_words" }]);
  });
});
