import { describe, expect, it } from "vitest";

import {
  NO_PRIOR_ACTION,
  groundPriorActions,
  legacyPriorActions,
  priorActionLine,
  signedDate,
  statedPriorActions,
} from "./prior-actions";

/**
 * "List previously received coaching and/or corrective action with date
 * signed" — the Corrective Action Form's history line from revision 5.
 */

const TODAY = "2026-10-03";

describe("the list holds several entries, each with its date", () => {
  it("keeps every entry the draft wrote from the manager's words", () => {
    const drafted = "Coaching — signed 09/02/2026\nVerbal warning — signed 09/21/2026\nWritten warning — signed 09/28/2026";
    const result = groundPriorActions({
      drafted,
      notes: "Jessica was coached on 9/2, got a verbal warning on 9/21 and was given a written warning on 9/28. She was late again today.",
      today: TODAY,
    });
    expect(result.value).toBe(drafted);
    expect(result.value.split("\n")).toHaveLength(3);
    expect(result.removed).toEqual([]);
  });

  it("adds a step the manager dated that the draft left out", () => {
    const result = groundPriorActions({
      drafted: "Coaching — signed 09/02/2026",
      notes: "she was coached on 9/2 and got a verbal warning on september 21",
      today: TODAY,
    });
    expect(result.value).toBe("Coaching — signed 09/02/2026\nVerbal warning — signed 09/21/2026");
    expect(result.added).toEqual(["Verbal warning — signed 09/21/2026"]);
  });

  it("lists the manager's dated steps when the draft wrote nothing", () => {
    const result = groundPriorActions({
      drafted: "",
      notes: "create ca for Paulyne Test she was late today, got verbal warning on september 21",
      today: TODAY,
    });
    expect(result.value).toBe("Verbal warning — signed 09/21/2026");
  });

  it("removes a line whose date the manager never gave", () => {
    const result = groundPriorActions({
      drafted: "Verbal warning — signed 08/15/2026\nCoaching on attendance (date not given)",
      notes: "she was coached on attendance before and is late again",
      today: TODAY,
    });
    expect(result.value).toBe("Coaching on attendance (date not given)");
    expect(result.removed).toEqual(["Verbal warning — signed 08/15/2026"]);
  });

  it("says None — first occurrence when the manager said so", () => {
    const result = groundPriorActions({ drafted: "", notes: "late today, verbal warning, first time", today: TODAY });
    expect(result.value).toBe(NO_PRIOR_ACTION);
  });

  it("never reads a repeated behaviour as a history", () => {
    const result = groundPriorActions({ drafted: "", notes: "she was late again today", today: TODAY });
    expect(result.value).toBe("");
  });

  it("lets a dated step win over a None the draft also wrote", () => {
    const result = groundPriorActions({
      drafted: "None — first occurrence",
      notes: "got a verbal warning on 9/21",
      today: TODAY,
    });
    expect(result.value).toBe("Verbal warning — signed 09/21/2026");
  });
});

describe("the two revision-4 lines, read as one entry", () => {
  it("combines what was recorded with the date", () => {
    expect(legacyPriorActions("Verbal warning for tardiness", "2026-09-21")).toBe(
      "Verbal warning for tardiness — signed 09/21/2026",
    );
  });

  it("keeps either half alone", () => {
    expect(legacyPriorActions("None — first occurrence", "")).toBe("None — first occurrence");
    expect(legacyPriorActions("", "2026-09-21")).toBe("Previous corrective action — signed 09/21/2026");
  });

  it("is nothing when the original recorded nothing", () => {
    expect(legacyPriorActions(null, null)).toBeNull();
    expect(legacyPriorActions("  ", "")).toBeNull();
  });

  it("writes dates the way the business writes them", () => {
    expect(signedDate("2026-09-02")).toBe("09/02/2026");
    expect(priorActionLine("Coaching", "2026-09-02")).toBe("Coaching — signed 09/02/2026");
  });
});

/*
 * District Manager feedback, 21 Oct 2026: the history as the manager labelled
 * it — what it was about, then its date — is listed with its topic, the
 * manual's name spelled as the manual spells it.
 */
describe("a labelled earlier step is listed with what it was about", () => {
  const DAY = "2026-10-21";

  it.each([
    [
      "create verbal CA for remy calder for violating visitors at work policy on 10-10-26. previous coaching was jba policy manual 1-1-26",
      "Coaching — JBA Policy Manual — signed 01/01/2026",
    ],
    [
      "create ca form for tess varga for violating attendance policy on 10-20-26. verbal. no payroll deduct. jba manual 1-1-26 for previous coaching",
      "Coaching — JBA Manual — signed 01/01/2026",
    ],
    ["register shortage on 10-20-26. previous coaching - jba policy manual 1-20-26.", "Coaching — JBA Policy Manual — signed 01/20/2026"],
    ["late again on 10/20. prior CA 9/1", "Corrective action — signed 09/01/2026"],
    // HR, 21 Oct 2026 (ported from Ask Bubbles): what it was for, said after the date, is kept.
    [
      "on her phone again on 10-20-26. previous coaching was 9/15 for cell phone use and she was on her phone again",
      "Coaching for cell phone use — signed 09/15/2026",
    ],
    ["late again on 10/20. prior CA 9/1 about tardiness.", "Corrective action about tardiness — signed 09/01/2026"],
  ])("%s", (notes, line) => {
    expect(statedPriorActions(notes, DAY)).toEqual([line]);
    expect(groundPriorActions({ drafted: "", notes, today: DAY }).value).toBe(line);
  });

  it("keeps the model's own line for that step", () => {
    const grounded = groundPriorActions({
      drafted: "Coaching — JBA Manual 1-1-26",
      notes: "jba manual 1-1-26 for previous coaching",
      today: DAY,
    });
    expect(grounded.value).toBe("Coaching — JBA Manual 1-1-26");
    expect(grounded.added).toEqual([]);
  });
});

/*
 * HR, 21 Oct 2026: "previous coaching: jba policy manual 1-1-26, verbal ca
 * 9-1-26" listed the coaching and dropped the verbal CA. Every item of the
 * list is a line, in the order written, naming its own step.
 */
describe("a labelled history list is listed item by item", () => {
  const DAY = "2026-10-21";
  const PRODUCTION =
    "create a written CA for tess varga for not attending the monthly meeting on 10-20-26. previous coaching: jba policy manual 1-1-26, verbal ca 9-1-26. payroll deduct not applicable";

  it("the production request lists both steps", () => {
    const lines = ["Coaching — JBA Policy Manual — signed 01/01/2026", "Verbal corrective action — signed 09/01/2026"];
    expect(statedPriorActions(PRODUCTION, DAY)).toEqual(lines);
    expect(groundPriorActions({ drafted: "", notes: PRODUCTION, today: DAY }).value).toBe(lines.join("\n"));
  });

  it.each([
    ["previous coaching: verbal ca 9-1-26", "Verbal corrective action — signed 09/01/2026"],
    ["prior actions: written warning 8/2/26", "Written warning — signed 08/02/2026"],
    ["previous coaching: policy acknowledgement 1-1-26", "Policy acknowledgement — signed 01/01/2026"],
    ["previous CA: written ca 8/2/26", "Written corrective action — signed 08/02/2026"],
    ["previous CA: final written ca 9/9/26", "Final written corrective action — signed 09/09/2026"],
    ["previous coaching: written warning tardiness 8/2/26", "Written warning — tardiness — signed 08/02/2026"],
  ])("%s", (notes, line) => {
    expect(statedPriorActions(notes, DAY)).toEqual([line]);
    expect(groundPriorActions({ drafted: "", notes, today: DAY }).value).toBe(line);
  });

  it("lists every item, in the order the manager wrote them", () => {
    const notes = "prior actions: policy acknowledgement 1-1-26, verbal ca 9-1-26 and written warning 10/1/26";
    expect(groundPriorActions({ drafted: "", notes, today: DAY }).value).toBe(
      [
        "Policy acknowledgement — signed 01/01/2026",
        "Verbal corrective action — signed 09/01/2026",
        "Written warning — signed 10/01/2026",
      ].join("\n"),
    );
  });

  it("keeps the draft's verbal warning on the day the manager said a verbal CA was given", () => {
    const grounded = groundPriorActions({
      drafted: "Verbal warning for missing the meeting — signed 09/01/2026",
      notes: "previous coaching: jba policy manual 1-1-26, verbal ca 9-1-26",
      today: DAY,
    });
    expect(grounded.removed).toEqual([]);
    expect(grounded.value).toBe(
      ["Verbal warning for missing the meeting — signed 09/01/2026", "Coaching — JBA Policy Manual — signed 01/01/2026"].join("\n"),
    );
  });
});

/*
 * District Manager feedback, 21 Oct 2026: the employee's earlier Coaching Form
 * and Verbal CA were in Form Monitoring and the manager had to type them again.
 */
describe("the forms already on file are listed too", () => {
  const onFile = [
    { formDate: "2026-09-02", line: "Coaching — signed 09/02/2026" },
    { formDate: "2026-09-21", line: "Verbal corrective action — signed 09/21/2026" },
  ];

  it("lists each finalized form on file when the manager named none", () => {
    const result = groundPriorActions({
      drafted: "",
      notes: "Paisley missed the Woven deadline.",
      today: TODAY,
      onFile,
    });
    expect(result.value).toBe(
      "Coaching — signed 09/02/2026\nVerbal corrective action — signed 09/21/2026",
    );
  });

  it("keeps the manager's own words for a step they dated, and adds the rest", () => {
    const result = groundPriorActions({
      drafted: "Coaching — JBA Policy Manual — signed 09/02/2026",
      notes: "previous coaching was jba policy manual 9-2-26",
      today: TODAY,
      onFile,
    });
    expect(result.value).toBe(
      "Coaching — JBA Policy Manual — signed 09/02/2026\nVerbal corrective action — signed 09/21/2026",
    );
  });

  it("keeps a drafted line dated from the record, not just from the notes", () => {
    const result = groundPriorActions({
      drafted: "Verbal corrective action — signed 09/21/2026",
      notes: "Paisley missed the Woven deadline.",
      today: TODAY,
      onFile,
    });
    expect(result.removed).toEqual([]);
  });

  it("lets the record outweigh \"first time\"", () => {
    const result = groundPriorActions({
      drafted: "",
      notes: "This is her first time.",
      today: TODAY,
      onFile: onFile.slice(0, 1),
    });
    expect(result.value).toBe("Coaching — signed 09/02/2026");
  });
});
