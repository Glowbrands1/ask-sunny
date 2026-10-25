import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { statedPriorActions } from "@/lib/forms/prior-actions";

import { groundFormSlots } from "./form-full-remap";

/**
 * ============================================================================
 * PRIOR ACTIONS AS MANAGERS WRITE THEM, ON THE REMAP PATH — QA, 25 OCT 2026
 * ============================================================================
 *
 * PRIOR_ACTIONS_PARSE_ENABLED. This app's forms run through the intent read
 * (see `prior-actions-parse-oct25.test.ts`); the full remap
 * (FORM_FULL_REMAP_ENABLED, off here) is the same code as Ask Bubbles', where
 * these turns broke the card: it read prior actions only from "prior = …"
 * and "coached on …", took "Previous coaching" as the action plan
 * (conv_mvmzmhst2si3jfr there), and dated a form 2025-11-01 from "jba manual
 * 11-1-25" (conv_mvmznap42vcw0dl there). The guard is here too. The turns are
 * the managers' (this app's conv_mvmvlnel251xs4k for the list, name swapped),
 * with Ask Bubbles' store replaced by one of this app's salons.
 */

const FLAG = "PRIOR_ACTIONS_PARSE_ENABLED";
const TODAY = "2026-10-24";

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({ from: () => ({ insert: async () => ({ error: null }) }) }),
}));

beforeEach(() => {
  vi.stubEnv("FORM_FULL_REMAP_ENABLED", "1");
  vi.stubEnv(FLAG, "1");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

type Turn = { role: string; content: string };

function remap(turns: string[], raw: Record<string, unknown>) {
  const history: Turn[] = [];
  for (const text of turns.slice(0, -1)) {
    history.push({ role: "user", content: text }, { role: "assistant", content: "Here is the Corrective Action Form." });
  }
  return groundFormSlots({
    raw: { templateKey: "dpoa", employeeName: "Test Employee", observation: null, actionPlan: null, ...raw },
    history,
    question: turns.at(-1)!,
    today: TODAY,
    people: [],
  });
}

const lines = (value: string | null) => (value ?? "").split("\n").filter(Boolean);

/*
 * QA decision, 25 Oct 2026: a prior-action line holds no word the manager did
 * not say. These expectations read "Coaching — signed 09/08/2026" before; the
 * managers below never wrote "signed", so the line is "Coaching — 09/08/2026",
 * and a manual they named reads as its title, "JBA Policy Manual" ("jba
 * manual" was "JBA Manual"). "signed" stays when they write it (last block).
 */

describe("1. a prior list keeps every step the manager named", () => {
  const SAID =
    "Avery Holt today under performance for September 270 tans below in PPTA, UPTA, LPSVA, CC% and Spa% verbal warning received Open Ended Questions Coaching 9/8/2026, Focus Item Coaching 9/15/2026, New Product Coaching 9/25/2026 not payroll deductible Tanning Consultant";

  it("lists 9/8, 9/15 and 9/25 on the card, and dates none of them on the form", () => {
    const { slots, response } = remap([SAID], { employeeName: "Avery Holt" });
    expect(lines(slots.priorActions)).toEqual([
      "Coaching — 09/08/2026",
      "Coaching — 09/15/2026",
      "Coaching — 09/25/2026",
    ]);
    expect(response.formProposal?.priorActions).toBe(slots.priorActions);
    expect(slots.incidentDateIso ?? null).toBeNull();
  });

  it("the intent path's reader lists all three", () => {
    expect(statedPriorActions(SAID, TODAY)).toHaveLength(3);
  });
});

describe("2. \"prior verbal 9-1-26\" is a prior action", () => {
  it.each([
    ["prior verbal 9-1-26", "Verbal warning — 09/01/2026"],
    ["previous verbal 9-1-26", "Verbal warning — 09/01/2026"],
    ["prior written 9-1-26", "Written warning — 09/01/2026"],
    ["had a verbal on 9-1-26", "Verbal warning — 09/01/2026"],
    ["prior verbal ca 9-1-26", "Verbal corrective action — 09/01/2026"],
  ])("%s", (phrase, expected) => {
    const { slots } = remap([`create written ca for Test Employee at KS Lawrence. she was late on 10/20/26. ${phrase}. no payroll deduct`], {});
    expect(lines(slots.priorActions)).toEqual([expected]);
    expect(slots.incidentDateIso).toBe("2026-10-20");
  });
});

describe("3 and 4. a labelled history, with a colon or a dash", () => {
  it("\"previous coaching: jba policy manual 1-1-26, verbal ca 9-1-26\" is both lines", () => {
    const { slots } = remap(
      ["create written ca for Test Employee at KS Lawrence. she was late on 10/20/26. previous coaching: jba policy manual 1-1-26, verbal ca 9-1-26. no payroll deduct"],
      {},
    );
    expect(lines(slots.priorActions)).toEqual([
      "Coaching — JBA Policy Manual — 01/01/2026",
      "Verbal corrective action — 09/01/2026",
    ]);
    expect(slots.incidentDateIso).toBe("2026-10-20");
  });

  it("\"previous coaching - jba policy manual 1-20-26\" is one line, never \"Action plan: Previous coaching\" (conv_mvmzmhst2si3jfr)", () => {
    const { slots, response } = remap(
      [
        "create ca form for Test Employee for a register shortage on 10-20-26. payroll deduct applies and $3.25 will be deducted from check. previous coaching - jba policy manual 1-20-26.",
      ],
      // The model reading Ask Bubbles stored for these words (chat_traces.slots).
      { observation: "Register shortage", actionPlan: "Previous coaching" },
    );
    expect(lines(slots.priorActions)).toEqual(["Coaching — JBA Policy Manual — 01/20/2026"]);
    expect(slots.actionPlan).toBeNull();
    expect(response.content).not.toMatch(/Action plan:\*\*\s*Previous coaching/i);
    expect(slots.incidentDateIso).toBe("2026-10-20");
  });
});

describe("5. \"Previous coaching was a Verbal CA 10-1-26\" (conv_mvmzn0sn2pfk6uk)", () => {
  it("is one verbal corrective action, and 10-1-26 is not the form's date", () => {
    const { slots } = remap(
      [
        "create a written corrective action for Tanning Consultant, Test Employee. Test was assigned to complete policy acknowledgements in woven by 10-15-26 and failed to meet the deadline. Previous coaching was a Verbal CA 10-1-26. Payroll deduct is not applicable.",
      ],
      { observation: "create a for Tanning Consultant" },
    );
    expect(lines(slots.priorActions)).toEqual(["Verbal corrective action — 10/01/2026"]);
    expect(slots.incidentDateIso).not.toBe("2026-10-01");
  });
});

describe("6. \"Her prior coaching is her policy manual ackwnelegement on 9/01\" (conv_mvmzlt9o219eiga)", () => {
  it("is a prior action, and the form stays dated October 11", () => {
    const { slots } = remap(
      [
        "I need a CA form for Test Employee at KS Lawrence for being out of dress code on October 11",
        "This is a verbal warning. Her prior coaching is her policy manual ackwnelegement on 9/01. payroll deduction is not applicable.",
      ],
      { observation: "Employee was out of dress code" },
    );
    expect(lines(slots.priorActions)).toEqual(["Coaching — JBA Policy Manual ackwnelegement — 09/01/2026"]);
    expect(slots.incidentDateIso).toBe("2026-10-11");
  });
});

describe("7. a prior-coaching date never dates the form (conv_mvmznap42vcw0dl)", () => {
  it("dates the form 10-22-26, and the coaching moves to 11-1-25", () => {
    const { slots, response } = remap(
      [
        "do verbal for tanning consultant Test Employee at KS Lawrence. payroll deduct does not apply. previous coaching jba manual 11-1-26. on 10-22-26 Test was not scheduled to work and came into the salon to show her team her new puppy. Test was in the salon 45 min",
        "jba manual 11-1-25",
        "cite pets in workplace",
        "cite animals in the workplace policy",
        "salon location is KS Lawrence. create corrective action",
      ],
      { jobTitle: "Tanning Consultant", observation: "create corrective action" },
    );
    expect(slots.incidentDateIso).toBe("2026-10-22");
    expect(response.formProposal?.formDate).toBe("2026-10-22");
    expect(lines(slots.priorActions)).toEqual(["Coaching — JBA Policy Manual — 11/01/2025"]);
  });
});

describe("8. \"she was coached on 9-15 for being late\" (conv_mvnoiw8n2kfbcvc)", () => {
  const SAID =
    "create a verbal CA for Test Employee at NE Kearney for being late to open on 10-20, she was coached on 9-15 for being late, no payroll";

  it("is one dated coaching line, and 10-20 stays the form's date", () => {
    const { slots } = groundFormSlots({
      raw: { templateKey: "dpoa", employeeName: "Test Employee", observation: null, actionPlan: null },
      history: [],
      question: SAID,
      today: "2026-10-25",
      people: [],
    });
    // QA 25 Oct 2026: no "signed" — the manager never wrote it (see the note above case 1).
    expect(lines(slots.priorActions)).toEqual(["Coaching for being late — 09/15/2026"]);
    expect(slots.incidentDateIso).toBe("2026-10-20");
  });

  it("flag off, the card keeps the raw \"coached on 9-15\"", () => {
    vi.stubEnv(FLAG, "");
    const { slots } = groundFormSlots({
      raw: { templateKey: "dpoa", employeeName: "Test Employee", observation: null, actionPlan: null },
      history: [],
      question: SAID,
      today: "2026-10-25",
      people: [],
    });
    expect(slots.priorActions).toBe("coached on 9-15");
  });
});

/*
 * QA decisions, 25 Oct 2026, with REMAP_INCIDENT_FIX_ENABLED (the "previous
 * coaching: …" list reader) and PRIOR_ACTIONS_PARSE_ENABLED (this reader).
 * The manager's two turns are copied exactly: "jba manual 1-1-26 for previous
 * coaching", then a turn of just "verbal" (the warning level).
 */
describe("a bare \"verbal\" turn is never a prior action, and the line holds only the manager's words", () => {
  const TURNS = ["jba manual 1-1-26 for previous coaching", "verbal"];
  const LINE = "Coaching — JBA Policy Manual — 01/01/2026";

  it.each([
    ["both flags on", { fix: "1", parse: "1" }, [LINE]],
    ["PRIOR_ACTIONS_PARSE_ENABLED alone", { fix: "", parse: "1" }, [LINE]],
    // The list reader reads a label followed by its items; here the label comes last, so there is no list.
    ["REMAP_INCIDENT_FIX_ENABLED alone", { fix: "1", parse: "" }, []],
  ])("%s", (_name, flags, expected) => {
    vi.stubEnv("REMAP_INCIDENT_FIX_ENABLED", flags.fix);
    vi.stubEnv(FLAG, flags.parse);
    const { slots, response } = remap(TURNS, {});
    expect(lines(slots.priorActions)).toEqual(expected);
    expect(lines(slots.priorActions).some((line) => /^verbal$/i.test(line.trim()))).toBe(false);
    expect(response.content).not.toMatch(/Prior actions:\*\*[^\n]*\bverbal\b/i);
  });

  it("\"signed\" is on the line only when the manager wrote it", () => {
    expect(statedPriorActions("prior verbal ca signed 9-1-26", TODAY)).toEqual(["Verbal corrective action — signed 09/01/2026"]);
    expect(statedPriorActions("prior verbal ca 9-1-26", TODAY)).toEqual(["Verbal corrective action — 09/01/2026"]);
    expect(statedPriorActions("jba manual 1-1-26 for previous coaching", TODAY)).toEqual([LINE]);
  });

  it("the list reader adds no \"acknowledgement\" the manager did not type", () => {
    vi.stubEnv("REMAP_INCIDENT_FIX_ENABLED", "1");
    vi.stubEnv(FLAG, "");
    const { slots } = remap(["create a verbal ca for Test Employee for being late on 10-20-26. previous coaching: jba manual 1-1-26"], {});
    expect(lines(slots.priorActions)).toEqual(["JBA Policy Manual 1-1-26"]);
  });

  it("flag off, the line is as before", () => {
    vi.stubEnv(FLAG, "");
    expect(statedPriorActions("prior verbal ca 9-1-26", TODAY)).toEqual(["Verbal corrective action — signed 09/01/2026"]);
  });
});
