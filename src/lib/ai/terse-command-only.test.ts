import { afterEach, describe, expect, it } from "vitest";

import { detectTemplateIntent } from "@/lib/forms/template-intent";

import { expandTerseRequest } from "./terse-slots";

/**
 * QA, 26 Oct 2026: with TERSE_SLOT_READ on, three existing suites changed —
 * the sentences below were rewritten (a middle name lost, a held coaching
 * dated by the first date, "out of dress code" losing "out of").
 * TERSE_COMMAND_ONLY_ENABLED leaves them as typed and keeps every live short
 * command. Names invented.
 */
const FLAGS = ["TERSE_SLOT_READ_ENABLED", "TERSE_COMMAND_ONLY_ENABLED"] as const;
const saved = Object.fromEntries(FLAGS.map((name) => [name, process.env[name]]));
afterEach(() => {
  for (const name of FLAGS) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
});

const TODAY = "2026-10-25";
const SENTENCES = [
  "Exit for john michael doe effective october 2",
  "coaching form for Test Employee at NE Kearney, she was late on 10-5 and 10-15, I coached her on 10-16 about being late",
  "CA for Test Employee at Kearney, out of dress code 10/11",
  "ca for quenby arlott not opening salon on time and no call no show",
  "exit devon hale, she gave her notice and her last day was 9/20",
];
const COMMANDS: readonly [string, string][] = [
  ["ca quenby arlott opened late 15 min 9-20 verbal 25 deduct", "Create a corrective action form for quenby arlott."],
  ["coach quenby arlott woven acks 10-16", "Create a coaching form for quenby arlott."],
  ["exit quenby arlott tc ks manhattan nc/ns last day 9/20 called 9/27 no answer", "Create an exit form for quenby arlott"],
  ["verbal ca quenby arlott ks manhattan dress code 10/11", "Create a corrective action form for quenby arlott at ks manhattan."],
  ["coach tamsin vedder", "Create a coaching form for tamsin vedder."],
];

function cases(text: string): string[] {
  const lower = text.toLowerCase();
  return [lower, lower[0]!.toUpperCase() + lower.slice(1), text.toUpperCase()];
}

describe("TERSE_COMMAND_ONLY_ENABLED off: TERSE_SLOT_READ rewrites the sentences, as on main", () => {
  it("rewrites the 'for' sentences", () => {
    delete process.env.TERSE_COMMAND_ONLY_ENABLED;
    expect(expandTerseRequest(SENTENCES[0]!, TODAY)).not.toBe(SENTENCES[0]);
    expect(expandTerseRequest(SENTENCES[2]!, TODAY)).not.toBe(SENTENCES[2]);
  });
});

describe("TERSE_COMMAND_ONLY_ENABLED on", () => {
  it.each(SENTENCES)("leaves the sentence '%s' as typed, in any case", (sentence) => {
    process.env.TERSE_COMMAND_ONLY_ENABLED = "on";
    for (const variant of cases(sentence)) expect(expandTerseRequest(variant, TODAY)).toBe(variant);
  });

  it("a 'ca for <name>' sentence is still the Corrective Action request", () => {
    process.env.TERSE_COMMAND_ONLY_ENABLED = "on";
    expect(detectTemplateIntent(SENTENCES[3]!)).toEqual({ kind: "explicit", templateKey: "dpoa" });
  });

  it.each(COMMANDS)("still writes out the command '%s', in any case", (command, start) => {
    process.env.TERSE_COMMAND_ONLY_ENABLED = "on";
    for (const variant of cases(command)) expect(expandTerseRequest(variant, TODAY).toLowerCase().startsWith(start.toLowerCase())).toBe(true);
  });
});

/**
 * QA live runs, 26 Oct 2026 (Sunny tester 1, TERSE off and on; names invented,
 * "rory ann vance" stands in for the tester's three-part name).
 */
describe("TERSE_COMMAND_ONLY_ENABLED on: the live command lines", () => {
  const THREE: readonly [string, string][] = [
    ["ca rory ann vance ks manhattan late today verbal", "Create a corrective action form for rory ann vance at ks manhattan."],
    // QA-4, 26 Oct 2026: a lowercase third word right before the account is unsure ("dana smith
    // barely late" has the same shape), so those two live lines are now left as typed — see
    // "a third name word is read from the shape of the line" below. Capitalised, they keep it.
    ["ca John Michael Doe late today", "Create a corrective action form for John Michael Doe."],
    ["ca Rory Ann Vance opened late 10-12", "Create a corrective action form for Rory Ann Vance."],
  ];
  it.each(THREE)("keeps a three-part name whole: '%s'", (command, start) => {
    process.env.TERSE_COMMAND_ONLY_ENABLED = "on";
    const variants = /[A-Z]/.test(command) ? [command] : cases(command);
    for (const variant of variants) expect(expandTerseRequest(variant, TODAY).toLowerCase().startsWith(start.toLowerCase())).toBe(true);
  });

  it.each([
    ["ca devon harlan opened late 15 min 9-20 verbal 25 deduct", "Create a corrective action form for devon harlan."],
    ["coach devon harlan woven acks 10-16", "Create a coaching form for devon harlan."],
    ["exit devon harlan tc ks manhattan nc/ns last day 9/20 called 9/27 no answer", "Create an exit form for devon harlan at ks manhattan"],
  ])("writes out the tester's line '%s' with the form word never in the name", (command, start) => {
    process.env.TERSE_COMMAND_ONLY_ENABLED = "on";
    for (const variant of cases(command)) {
      const out = expandTerseRequest(variant, TODAY);
      expect(out.toLowerCase().startsWith(start.toLowerCase())).toBe(true);
      expect(out.toLowerCase()).not.toContain("for ca ");
    }
  });

  it("stays two words when the third is the account ('woven acks', 'tanned on clock')", () => {
    process.env.TERSE_COMMAND_ONLY_ENABLED = "on";
    expect(expandTerseRequest("coach devon harlan woven acks 10-16", TODAY)).toMatch(/^Create a coaching form for devon harlan\. /);
    expect(expandTerseRequest("coaching quenby arlott tanned on clock 9-28-26 tc ks manhattan", TODAY)).toMatch(/^Create a coaching form for quenby arlott at ks manhattan, /);
  });

  it.each([
    "coaching form for rory ann vance, she was late today",
    "Create a coaching form for Test Employee at KS Manhattan, she was late on 10-5 and 10-15, I coached her on 10-16.",
    "coaching form for rory vance and a ca for devon harlan",
    "Exit for rory ann vance effective october 2",
    "Sacramento, CA",
    // A bare "ca" / "coach" / "exit" is now read as the request for that form, on purpose
    // (QA via Code 7, 26 Oct 2026): see "a bare form word" below.
  ])("leaves '%s' as typed, in any case", (turn) => {
    process.env.TERSE_COMMAND_ONLY_ENABLED = "on";
    for (const variant of cases(turn)) expect(expandTerseRequest(variant, TODAY)).toBe(variant);
  });
});

/**
 * QA-4, 26 Oct 2026 (both terse flags on): a level, topic or form word after
 * the name, or the name repeated, was glued into it ("ca avery stone final
 * 10-14" → "avery stone final"). Live tester G19 (conv_mvon4qqu27bu4in,
 * invented name): "written ca mara quill 10/5 didnt do 10 min sanitize at
 * <place>" read "Ca Mara Quill" with the terse reader off.
 */
describe("TERSE_COMMAND_ONLY_ENABLED on: a third name word is never a level, topic or form word", () => {
  const TWO_WORDS = [
    "ca avery stone final 10-14",
    "ca avery stone warning",
    "ca avery stone uniform",
    "ca avery stone personal",
    "ca avery stone second",
    "ca avery stone closing",
    "ca avery stone sales",
    "ca avery stone training",
    "ca avery stone schedule",
    "ca avery stone break",
    "ca avery stone refund",
    "ca avery stone deposit",
    "ca avery stone theft",
    "ca avery stone safety",
    "coach avery stone woven",
    "coach avery stone acks",
    "coach avery stone coaching 10-14",
    "exit avery stone final",
    "ca avery stone stone",
  ];
  it.each(TWO_WORDS)("'%s' keeps the name 'avery stone', in any case", (command) => {
    process.env.TERSE_COMMAND_ONLY_ENABLED = "on";
    for (const variant of cases(command)) {
      expect(expandTerseRequest(variant, TODAY).toLowerCase()).toMatch(/ form for avery stone(?:[.,]| at )/);
    }
  });

  // QA-4, 26 Oct 2026: changed on purpose — lowercase or capitals, the third word is unsure and
  // the line is left as typed; capitalised by the manager, the three-part name is kept.
  it.each(["ca john michael doe late 10-14", "ca john michael doe late today"])("'%s' is left as typed in lowercase and capitals", (command) => {
    process.env.TERSE_COMMAND_ONLY_ENABLED = "on";
    for (const variant of [command, command.toUpperCase()]) expect(expandTerseRequest(variant, TODAY)).toBe(variant);
    const named = command.replace("john michael doe", "John Michael Doe");
    expect(expandTerseRequest(named, TODAY)).toContain("form for John Michael Doe.");
  });

  it.each(["written ca mara quill 10/5 didnt do 10 min sanitize at lawrence", "verbal ca mara quill 10/5 didnt do 10 min sanitize at lawrence"])(
    "G19 '%s' is a form for mara quill, never 'ca mara quill', in any case",
    (command) => {
      process.env.TERSE_COMMAND_ONLY_ENABLED = "on";
      for (const variant of cases(command)) {
        const out = expandTerseRequest(variant, TODAY).toLowerCase();
        expect(out).toMatch(/^create a corrective action form for mara quill[ .,]/);
        expect(out).not.toContain("for ca ");
      }
    },
  );
});

/** QA-4, 26 Oct 2026 (re-probe): a negation or degree word is never a name; a three-part name before a topic or a code stays whole. */
describe("TERSE_COMMAND_ONLY_ENABLED on: 'never' is not a name, and long-tail three-part names stay whole", () => {
  it.each([
    "ca avery stone never late",
    "ca avery stone always late",
    "ca avery stone also late",
    "ca avery stone just late",
    "ca avery stone still late",
    "ca avery stone again late",
    "ca avery stone really late",
    "ca avery stone not opening",
    "ca avery stone never opened the store",
    "ca avery stone sleeping 10-14",
  ])("'%s' keeps the name 'avery stone', in any case", (command) => {
    process.env.TERSE_COMMAND_ONLY_ENABLED = "on";
    for (const variant of cases(command)) expect(expandTerseRequest(variant, TODAY).toLowerCase()).toMatch(/ form for avery stone(?:[.,]| at )/);
  });

  it.each([
    // QA-4, 26 Oct 2026: "rory ann vance woven acks" is now unsure in lowercase (see below); a code still ends the name.
    ["exit rory ann vance nc/ns last day 9/20", "Create an exit form for rory ann vance."],
  ])("'%s' keeps the three-part name, in any case", (command, start) => {
    process.env.TERSE_COMMAND_ONLY_ENABLED = "on";
    for (const variant of cases(command)) expect(expandTerseRequest(variant, TODAY).toLowerCase().startsWith(start.toLowerCase())).toBe(true);
  });
});

/** QA-7, 26 Oct 2026: an -ly adverb, a word with an apostrophe or a conjunction is never a name word. */
describe("TERSE_COMMAND_ONLY_ENABLED on: adverbs, contractions and conjunctions are not names", () => {
  it.each(["ca dana smith repeatedly late", "ca dana smith constantly opened late", "ca dana smith doesn't clock in", "coach dana smith and ca tom lee"])(
    "'%s' never takes a third word into the name, in any case",
    (command) => {
      process.env.TERSE_COMMAND_ONLY_ENABLED = "on";
      // Either written out for "dana smith" or, when the third word is unsure, left as typed.
      for (const variant of cases(command)) {
        const out = expandTerseRequest(variant, TODAY);
        if (out !== variant) expect(out.toLowerCase()).toMatch(/ form for dana smith(?:[.,]| at )/);
      }
    },
  );
});

describe("TERSE_COMMAND_ONLY_ENABLED on: a surname that ends in 'ly' is a name", () => {
  // QA-4, 26 Oct 2026: changed on purpose — in lowercase the third word is unsure, so the line is
  // left as typed (the name is never cut short); capitalised by the manager, it is kept.
  it.each(["ca rory ann kelly late today", "ca rory ann kimberly late today"])("'%s' keeps the three-part name when capitalised", (command) => {
    process.env.TERSE_COMMAND_ONLY_ENABLED = "on";
    expect(expandTerseRequest(command, TODAY)).toBe(command);
    const named = command.replace(/rory ann (\w+)/, (_m, last: string) => `Rory Ann ${last[0]!.toUpperCase()}${last.slice(1)}`);
    expect(expandTerseRequest(named, TODAY)).toMatch(/ form for Rory Ann (?:Kelly|Kimberly)\./);
  });
});

/** QA, 26 Oct 2026 (via Code 7): a form word on its own is the request for that form, never a name or a blank card. */
describe("TERSE_COMMAND_ONLY_ENABLED: a bare form word", () => {
  const saved = { slot: process.env.TERSE_SLOT_READ_ENABLED, only: process.env.TERSE_COMMAND_ONLY_ENABLED };
  afterEach(() => {
    for (const [name, value] of [["TERSE_SLOT_READ_ENABLED", saved.slot], ["TERSE_COMMAND_ONLY_ENABLED", saved.only]] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it.each([
    ["ca", "Create a corrective action form."],
    ["Ca", "Create a corrective action form."],
    ["CA", "Create a corrective action form."],
    ["c/a", "Create a corrective action form."],
    ["coach", "Create a coaching form."],
    ["Coach", "Create a coaching form."],
    ["COACH", "Create a coaching form."],
    ["coaching form", "Create a coaching form."],
    ["exit", "Create an exit form."],
    ["Exit", "Create an exit form."],
    ["EXIT", "Create an exit form."],
  ])("flag on: '%s' → '%s'", (turn, read) => {
    process.env.TERSE_SLOT_READ_ENABLED = "1";
    process.env.TERSE_COMMAND_ONLY_ENABLED = "1";
    expect(expandTerseRequest(turn, "2026-10-26")).toBe(read);
  });

  it.each(["ca", "coach", "exit"])("flag off (terse read on): '%s' stays as typed, as on main", (turn) => {
    process.env.TERSE_SLOT_READ_ENABLED = "1";
    delete process.env.TERSE_COMMAND_ONLY_ENABLED;
    expect(expandTerseRequest(turn, "2026-10-26")).toBe(turn);
  });

  it.each(["coach?", "exit process", "coaching tips", "ca."])("flag on: '%s' is not a bare form word", (turn) => {
    process.env.TERSE_SLOT_READ_ENABLED = "1";
    process.env.TERSE_COMMAND_ONLY_ENABLED = "1";
    expect(expandTerseRequest(turn, "2026-10-26")).toBe(turn);
  });
});

/**
 * QA-4 sweep, 26 Oct 2026 (names invented): with the flag off the name is "dana smith"; with it
 * on, the word after it was taken into the name ("ca dana smith doesnt clock in" → "for dana
 * smith doesnt."). A third name word now comes from the shape of the line, never a word list.
 */
describe("TERSE_COMMAND_ONLY_ENABLED on: a third name word is read from the shape of the line", () => {
  const WORDS = [
    "doesnt", "dont", "wasnt", "cant", "wont", "isnt", "hasnt", "barely", "mostly", "hardly", "rarely", "badly", "nearly",
    "slowly", "early", "daily", "weekly", "kinda", "sorta", "seldom", "sometimes", "twice", "once", "too", "very", "so",
    "even", "already", "always", "often", "just", "still", "again", "only", "finally", "apparently", "allegedly", "supposedly",
  ];
  const LINES = ["ca", "coach", "exit"].flatMap((form) => WORDS.map((word) => `${form} dana smith ${word} late`));
  it.each([...LINES, "ca dana smith doesnt clock in", "ca avery stone barely opened late"])("'%s' never puts the third word in the name, in any case", (command) => {
    process.env.TERSE_COMMAND_ONLY_ENABLED = "on";
    const person = command.includes("avery") ? "avery stone" : "dana smith";
    for (const variant of cases(command)) {
      const out = expandTerseRequest(variant, TODAY);
      if (out !== variant) expect(out.toLowerCase()).toMatch(new RegExp(` form for ${person}(?:[.,]| at )`));
    }
  });

  it.each([
    ["ca rory ann vance ks manhattan late today verbal", "Create a corrective action form for rory ann vance at ks manhattan."],
    ["exit rory ann vance nc/ns last day 9/20", "Create an exit form for rory ann vance."],
    ["ca Rory Ann Vance late today", "Create a corrective action form for Rory Ann Vance."],
  ])("'%s' keeps the three-part name", (command, start) => {
    process.env.TERSE_COMMAND_ONLY_ENABLED = "on";
    expect(expandTerseRequest(command, TODAY).startsWith(start)).toBe(true);
  });

  it.each(["ca rory ann vance late today", "CA RORY ANN VANCE LATE TODAY", "coach rory ann vance woven acks 10-16"])("'%s' is unsure and left as typed", (command) => {
    process.env.TERSE_COMMAND_ONLY_ENABLED = "on";
    expect(expandTerseRequest(command, TODAY)).toBe(command);
  });
});
