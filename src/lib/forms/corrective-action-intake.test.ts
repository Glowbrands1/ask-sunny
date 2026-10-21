import { describe, expect, it } from "vitest";

import {
  CORRECTIVE_ACTION_INTAKE,
  answeredWhatHappened,
  correctiveActionBasis,
  correctiveActionIntakeRequest,
  describesIncident,
  describesMoreThanTheRequest,
  NO_INCIDENT_NOTE,
  readCorrectiveActionIntake,
  statedWarningLevel,
  statesFirstOccurrence,
  statesRepeatedBehaviour,
  warningLevelChecked,
  warningLevelFromTurns,
} from "./corrective-action-intake";

/**
 * ============================================================================
 * THE INTAKE, AND THE TWO WAYS IT CAN BE WRONG
 * ============================================================================
 *
 * READING AN ANSWER AS MISSING is the defect this module was written to
 * remove: a manager answers six numbered questions and is asked all six again.
 * Most of what is below is that case, in the shapes people actually type.
 *
 * READING SOMETHING AS AN ANSWER WHEN IT IS NOT costs a question that should
 * have been asked, and the manager sees the empty field on the draft in front
 * of them. That is the cheaper failure and the detectors are tuned for it —
 * but not to the point of accepting anything, so the negatives matter too.
 *
 * NOTHING HERE WRITES TO A FORM. What a field ends up containing is decided by
 * the drafting route, under the policy and narrative guards. This module only
 * decides what to ask.
 */

/** The manager has an account with a salon, which is the common case. */
function read(text: string, employeeKnown = false) {
  return readCorrectiveActionIntake({ text, employeeKnown, salonSettled: true });
}

function missingKeys(text: string, employeeKnown = false) {
  return read(text, employeeKnown).missingRequired.map((item) => item.key);
}

describe("1. the seven, and their order", () => {
  it("is the intake managers already know, so a numbered reply lines up", () => {
    expect(CORRECTIVE_ACTION_INTAKE.map((item) => item.key)).toEqual([
      "employee_name",
      "salon",
      "form_date",
      "what_happened",
      "warning_level",
      "previous_action",
      "payroll_deduct",
      "job_title",
    ]);
  });

  it("makes only the job title optional, because the form has no field for it", () => {
    const optional = CORRECTIVE_ACTION_INTAKE.filter((item) => item.optional);
    expect(optional.map((item) => item.key)).toEqual(["job_title"]);
  });

  it("asks for previous COACHING AND/OR CORRECTIVE ACTION with the date signed, not for previous discipline", () => {
    const previous = CORRECTIVE_ACTION_INTAKE.find((item) => item.key === "previous_action")!;
    expect(previous.prompt).toMatch(/previously received coaching and\/or corrective action/i);
    expect(previous.prompt).toMatch(/date each was signed/i);
    expect(previous.prompt).not.toMatch(/disciplin/i);
  });
});

/* ==================================================================== */
/*  THE QA REPLY                                                        */
/* ==================================================================== */

describe("2. QA's own numbered reply", () => {
  /** Typed exactly as QA typed it, missing spaces included. */
  const REPLY = [
    "1. Sarah Test",
    "2. Kearny",
    "3.today",
    "4.she was wearing mini skirt today",
    "5. verbal warning",
    "6.this is the first time",
  ].join("\n");

  it("leaves only the payroll-deduct question outstanding, which was added after QA's reply", () => {
    const intake = read(REPLY, true);

    expect(intake.missingRequired.map((item) => item.key)).toEqual(["payroll_deduct"]);
    expect(intake.complete).toBe(false);
  });

  it("leaves nothing required outstanding once payroll deduct is answered", () => {
    const intake = read(`${REPLY}\n7. no payroll deduct`, true);

    expect(intake.missingRequired).toEqual([]);
    expect(intake.complete).toBe(true);
  });

  it("reports the job title as missing but does not hold the form up", () => {
    const intake = read(`${REPLY}\n7. no payroll deduct`, true);

    expect(intake.missing.map((item) => item.key)).toEqual(["job_title"]);
    expect(intake.complete).toBe(true);
  });

  it("takes a payroll answer the caller read from the conversation — a bare \"no\" to its question", () => {
    const intake = readCorrectiveActionIntake({
      text: REPLY,
      employeeKnown: true,
      salonSettled: true,
      payrollDeduct: "no",
    });

    expect(intake.complete).toBe(true);
    expect(intake.supplied).toContain("payroll_deduct");
  });

  it("reads it as a first occurrence, which is an answer rather than a blank", () => {
    expect(statesFirstOccurrence(REPLY)).toBe(true);
  });
});

/* ==================================================================== */
/*  ITEM BY ITEM                                                        */
/* ==================================================================== */

describe("3. what counts as an answer", () => {
  it.each([
    ["today", "3. today"],
    ["a weekday", "it was on Tuesday"],
    ["a slash date", "9/10 during the closing shift"],
    ["an ISO date", "2026-09-10, mid-shift"],
    ["a month and day", "September 10, on her closing shift"],
  ])("a date — %s", (_label, text) => {
    expect(missingKeys(text)).not.toContain("form_date");
  });

  it.each([
    ["verbal warning", "5. verbal warning"],
    ["written warning", "this should be a written warning"],
    ["final written", "final written warning"],
    ["a bare answer on its own line", "1. Sarah Test\n5. verbal\n"],
  ])("a warning level — %s", (_label, text) => {
    expect(missingKeys(text)).not.toContain("warning_level");
  });

  it("does not read a verbal conversation as a warning LEVEL", () => {
    // "He gave her a verbal heads-up" is an account of what happened, not a
    // decision about the Type of Warning box.
    expect(missingKeys("I gave her a verbal heads-up on the floor")).toContain(
      "warning_level",
    );
  });

  it.each([
    ["first time", "6. this is the first time"],
    ["first offence", "her first offense"],
    ["nothing prior", "no prior write-ups"],
    ["never coached", "she has never been coached on this"],
    ["a stated history", "we coached her about this last month"],
    ["a second occurrence", "this is the second time"],
  ])("previous corrective action — %s", (_label, text) => {
    expect(missingKeys(text)).not.toContain("previous_action");
  });

  it.each([
    ["an offense topic", "she was wearing a mini skirt"],
    ["tardiness", "she clocked in twenty minutes late"],
    ["a refusal", "she refused to follow my direction on the closing duties"],
    ["cash handling", "her drawer was short at close"],
    ["an observational clause", "she left before the end of her shift"],
  ])("what happened — %s", (_label, text) => {
    expect(missingKeys(text)).not.toContain("what_happened");
  });

  it.each([
    ["an acronym", "she is a TC at Kearny"],
    ["a spelled-out title", "she is an assistant salon director"],
  ])("a job title — %s", (_label, text) => {
    expect(read(text).supplied).toContain("job_title");
  });

  it("asks for everything when the manager has only named the form", () => {
    const intake = read("corrective action form");

    expect(intake.nothingSupplied).toBe(true);
    expect(intake.missingRequired.map((item) => item.key)).toEqual([
      "employee_name",
      "form_date",
      "what_happened",
      "warning_level",
      "previous_action",
      "payroll_deduct",
    ]);
  });

  /*
   * THE SALON COMES FROM THE ACCOUNT, NOT FROM THE CHAT. On a salon-assigned
   * login it is settled before the manager has typed a word, and counting that
   * as something they SAID would mean the opening intake never appeared for the
   * people who actually use this product.
   */
  it("does not count an account-supplied salon as something the manager said", () => {
    expect(read("corrective action form").nothingSupplied).toBe(true);
    expect(
      readCorrectiveActionIntake({
        text: "corrective action form",
        employeeKnown: false,
        salonSettled: false,
      }).nothingSupplied,
    ).toBe(true);
  });

  it("asks for the salon only when the account has not settled it", () => {
    expect(missingKeys("corrective action form")).not.toContain("salon");
    expect(
      readCorrectiveActionIntake({
        text: "corrective action form",
        employeeKnown: false,
        salonSettled: false,
      }).missingRequired.map((item) => item.key),
    ).toContain("salon");
  });
});

/* ==================================================================== */
/*  "AGAIN" IS NOT A WRITE-UP                                           */
/* ==================================================================== */

/**
 * ============================================================================
 * THE DISTINCTION THIS BLOCK EXISTS FOR
 * ============================================================================
 *
 * "Sarah was 20 minutes late AGAIN today" was being read as an answer to the
 * intake's sixth question — as though the manager had said she had already
 * been through a corrective step.
 *
 * It says nothing of the kind. It says the LATENESS repeated. Whether anybody
 * ever coached her, warned her, wrote her up or put her on a plan is a
 * different fact, and a manager who has been letting it slide for a month says
 * exactly that sentence. Recording a formal history that never happened is the
 * most consequential thing this field can get wrong, because the approved
 * progression escalates on it.
 *
 * SO THE TWO ARE READ SEPARATELY, and this block asserts both halves: the
 * repeated behaviour IS picked up, as context, and the prior-action question
 * stays open.
 */
describe("3b. a repeated incident and a prior corrective action are different facts", () => {
  const LATE_AGAIN = "Sarah was 20 minutes late again today. Create a corrective action.";
  const LATE_AND_WARNED =
    "Sarah was 20 minutes late again today. She already received a verbal warning for this last week.";

  it("1. \"late again\" leaves prior corrective action UNKNOWN", () => {
    const intake = read(LATE_AGAIN, true);

    expect(intake.supplied).not.toContain("previous_action");
    expect(intake.missingRequired.map((item) => item.key)).toContain("previous_action");
    // And it is not read as a first occurrence either — the manager said
    // neither, and absence of history is not evidence of its absence.
    expect(statesFirstOccurrence(LATE_AGAIN)).toBe(false);
  });

  it("1. still reads it as a repeated behaviour, which is what it does say", () => {
    expect(statesRepeatedBehaviour(LATE_AGAIN)).toBe(true);
    // The incident itself is understood, so nothing about the draft stalls.
    expect(read(LATE_AGAIN, true).supplied).toEqual(
      expect.arrayContaining(["what_happened", "form_date", "employee_name"]),
    );
  });

  it("2. a STATED prior warning does answer it", () => {
    const intake = read(LATE_AND_WARNED, true);

    expect(intake.supplied).toContain("previous_action");
    expect(intake.missingRequired.map((item) => item.key)).not.toContain("previous_action");
    // Repeated behaviour is still true of the same sentence; the two readings
    // are independent rather than exclusive.
    expect(statesRepeatedBehaviour(LATE_AND_WARNED)).toBe(true);
  });

  it.each([
    ["keeps doing it", "she keeps showing up late"],
    ["still", "she is still coming in late"],
    ["repeatedly", "she has been late repeatedly this month"],
    ["yet again", "late yet again"],
  ])("reads repetition without inventing a history — %s", (_label, text) => {
    expect(statesRepeatedBehaviour(text)).toBe(true);
    expect(missingKeys(text, true)).toContain("previous_action");
    expect(statesFirstOccurrence(text)).toBe(false);
  });

  it.each([
    ["a verbal warning", "I gave her a verbal warning about this last week"],
    ["a write-up", "she was written up for this before"],
    ["documented coaching", "we already coached her on this in August"],
    ["a prior corrective action", "she had a corrective action for this previously"],
  ])("a stated formal step DOES answer it — %s", (_label, text) => {
    expect(missingKeys(text, true)).not.toContain("previous_action");
  });

  /*
   * THE METRIC GUARD IS UNAFFECTED. "again" was kept out of the conduct
   * signals for this exact sentence, and it stays out.
   */
  it("does not let repetition turn a metric complaint into conduct", () => {
    expect(correctiveActionBasis("Her upgrade rate is down again this month.")).toBe(
      "metric_only",
    );
  });
});

/* ==================================================================== */
/*  THE BASIS                                                           */
/* ==================================================================== */

/**
 * §7 of the approved framework: underperformance enters the ladder at
 * coaching. A metric offered as the grounds for formal accountability is a
 * request the progression answers, not one the form answers.
 */
describe("4. a metric on its own is not grounds for a corrective action", () => {
  it.each([
    "Their Club Close is low.",
    "Sarah's conversion is the lowest in the district.",
    "Her upgrade rate is down again this month.",
    "His numbers are behind everyone else's.",
    "She is not hitting her EFTs.",
  ])("metric only — %s", (text) => {
    expect(correctiveActionBasis(text)).toBe("metric_only");
  });

  it.each([
    "She was late again on Tuesday.",
    "Dress code violation — she was in a mini skirt.",
    "She refused to follow my direction on the closing duties.",
    "We coached her about this last month and nothing has changed.",
    "Her Club Close is low and she has been leaving early all week.",
  ])("conduct — %s", (text) => {
    expect(correctiveActionBasis(text)).toBe("conduct");
  });

  it("treats a bare request as unstated rather than as either", () => {
    // Which is why the intake exists: the basis is what the questions find out.
    expect(correctiveActionBasis("corrective action form")).toBe("unstated");
    expect(correctiveActionBasis("Create a corrective action for Sarah.")).toBe("unstated");
  });

  it("needs BOTH a metric and a judgement about it", () => {
    // A metric mentioned without a verdict is not grounds for anything, and it
    // is not a reason to divert a manager who is mid-request either.
    expect(correctiveActionBasis("what is her Club Close?")).toBe("unstated");
    expect(correctiveActionBasis("she is behind")).toBe("unstated");
  });
});

/* ==================================================================== */
/*  THE WORDING                                                         */
/* ==================================================================== */

describe("5. what Ask Sunny actually says", () => {
  it("opens with the form's own name, taken from the library", () => {
    const message = correctiveActionIntakeRequest({
      formName: "Corrective Action Form",
      items: CORRECTIVE_ACTION_INTAKE,
      opening: true,
    });

    expect(message).toMatch(/I can help you create a \*\*Corrective Action Form\*\*/);
    expect(message).toMatch(/^1\. Employee's full name$/m);
    expect(message).toMatch(/^7\. Is payroll deduct applicable\? \(Yes or No\)$/m);
    expect(message).toMatch(/^8\. The employee's job title/m);
    expect(message).toMatch(/check the applicable company policy/i);
    // Never the old name, in either spelling.
    expect(message).not.toMatch(/disciplinary/i);
    expect(message).not.toContain("DPOA");
  });

  /*
   * ==========================================================================
   * THE BUSINESS'S OWN WORDING, PINNED
   * ==========================================================================
   *
   * They sent the seven questions back to us and said they wanted them. This
   * asserts the lines rather than the gist, because "roughly these questions"
   * is how an intake drifts back into something nobody recognises.
   *
   * ONE LINE IS NOT THEIRS VERBATIM, AND DELIBERATELY. Their sixth question
   * said "previously disciplined"; the product no longer says disciplinary
   * anywhere a manager can read it, so it asks the same question in the same
   * shape — "and if yes, when" included — in the terminology that replaced it.
   */
  it("asks the seven questions in the business's own words", () => {
    const message = correctiveActionIntakeRequest({
      formName: "Corrective Action Form",
      items: CORRECTIVE_ACTION_INTAKE,
      opening: true,
      today: "September 11, 2026",
    });

    expect(message.split("\n").slice(0, 11).join("\n")).toBe(
      [
        "Great, I can help you create a **Corrective Action Form**. To get started, please provide me with these details:",
        "",
        "1. Employee's full name",
        "2. Salon location",
        "3. Date for the form (if you say \u201Ctoday,\u201D I'll use September 11, 2026)",
        "4. What happened — a clear description of the incident(s) with dates and specifics",
        "5. Whether this is a verbal or written warning",
        "6. Whether the employee has previously received coaching and/or corrective action, and if yes, what and the date each was signed",
        // Added at Operations' request, in their wording.
        "7. Is payroll deduct applicable? (Yes or No)",
        "8. The employee's job title (e.g. TC, ASD, SD) if you have it",
        "",
      ].join("\n"),
    );
  });

  /*
   * THE DATE LINE IS THE ONE THAT VARIES, and it varies because it is meant to
   * be CHECKED: the form's date is what the observation gets written against,
   * so a manager who answers "today" should already have seen which day that
   * is. A caller with no date gets the generic line rather than a wrong one.
   */
  it("names the date it would use, and says nothing specific without one", () => {
    const withDate = correctiveActionIntakeRequest({
      formName: "Corrective Action Form",
      items: CORRECTIVE_ACTION_INTAKE,
      opening: true,
      today: "September 11, 2026",
    });
    const without = correctiveActionIntakeRequest({
      formName: "Corrective Action Form",
      items: CORRECTIVE_ACTION_INTAKE,
      opening: true,
    });

    expect(withDate).toContain("I'll use September 11, 2026");
    expect(without).toContain("I'll use today's date");
    expect(without).not.toMatch(/I'll use \w+ \d{1,2}, \d{4}/);
  });

  it("renumbers the gaps rather than showing their original positions", () => {
    const message = correctiveActionIntakeRequest({
      formName: "Corrective Action Form",
      items: CORRECTIVE_ACTION_INTAKE.filter((item) =>
        ["warning_level", "previous_action"].includes(item.key),
      ),
      opening: false,
    });

    expect(message).toMatch(/^1\. Whether this is a verbal or written warning$/m);
    expect(message).toMatch(/^2\. Whether the employee has previously received coaching and\/or corrective action/m);
    // No opening pleasantries on a follow-up — the manager is mid-task.
    expect(message).not.toMatch(/I can help you create/);
  });

  it("says 'one more thing' when exactly one is outstanding", () => {
    const message = correctiveActionIntakeRequest({
      formName: "Corrective Action Form",
      items: [CORRECTIVE_ACTION_INTAKE[4]!],
      opening: false,
    });

    expect(message).toMatch(/one more thing/i);
  });
});

/*
 * ============================================================================
 * NOTHING TO DRAFT FROM
 * ============================================================================
 *
 * Production, 20 Oct 2026: "create ca for Ellie Sendgraff" was offered a draft
 * with nothing described. The draft came back empty and the form, its policy
 * line included, was completed by hand with no section or page cited.
 */
describe("6. whether the manager has said what happened", () => {
  it.each([
    "create ca for Ellie Sendgraff",
    "Create a corrective action form for Jane Smith",
    "I need a CA for Dana Moss at NE Omaha 132nd and Maple please",
    "write up a corrective action for Sarah, verbal warning, no payroll deduction, today",
  ])("reads %s as only the request", (text) => {
    const ignore = ["Ellie Sendgraff", "Jane Smith", "Dana Moss", "Sarah", "NE Omaha 132nd and Maple"];
    expect(describesIncident(text)).toBe(false);
    expect(describesMoreThanTheRequest(text, { ignore })).toBe(false);
  });

  it.each([
    "Create a corrective action for Colene for missing the Woven deadline.",
    "corrective action for Ellie, scheduled 9:30 but got here 11:23",
    "CA for Jane, rang up her own tan package against policy",
  ])("reads %s as an account", (text) => {
    expect(describesMoreThanTheRequest(text, { ignore: ["Colene", "Ellie", "Jane"] })).toBe(true);
  });

  it("reads an arrival with its time as an incident", () => {
    expect(describesIncident("Ellie arrived at 11:23 for a 9:30 shift")).toBe(true);
    expect(describesIncident("came in after ten")).toBe(true);
  });

  it("takes a reply to its own What happened ask as the account, in any words", () => {
    const ask = `I can create a **Corrective Action Form** for **Ellie Sendgraff**.\n\n${NO_INCIDENT_NOTE}`;

    expect(
      answeredWhatHappened([
        { role: "user", content: "create ca for Ellie Sendgraff" },
        { role: "assistant", content: ask },
        { role: "user", content: "Ellie got to the salon at 11:23 for a 9:30 shift" },
        { role: "assistant", content: "Is payroll deduct applicable?" },
        { role: "user", content: "yes" },
      ]),
    ).toBe(true);
  });

  it("does not take a question, a bare ok, or an unprompted turn as the account", () => {
    const ask = `I can create a **Corrective Action Form** for **Ellie Sendgraff**.\n\n${NO_INCIDENT_NOTE}`;

    expect(answeredWhatHappened([{ role: "assistant", content: ask }, { role: "user", content: "ok" }])).toBe(false);
    expect(
      answeredWhatHappened([
        { role: "assistant", content: ask },
        { role: "user", content: "what does the attendance policy say?" },
      ]),
    ).toBe(false);
    expect(answeredWhatHappened([{ role: "user", content: "create ca for Ellie Sendgraff" }])).toBe(false);
  });

  it("says the policy cannot be cited yet, and how to get it cited", () => {
    expect(NO_INCIDENT_NOTE).toMatch(/haven't told me what happened/);
    expect(NO_INCIDENT_NOTE).toMatch(/can't cite the policy manual/);
    expect(NO_INCIDENT_NOTE).toMatch(/redraft the form you created/);
  });

  it("still recognises the numbered intake's What happened ask", () => {
    const ask = correctiveActionIntakeRequest({
      formName: "Corrective Action Form",
      items: CORRECTIVE_ACTION_INTAKE.filter((item) => item.key === "what_happened"),
      opening: false,
    });

    expect(
      answeredWhatHappened([
        { role: "assistant", content: ask },
        { role: "user", content: "she rang up her own tan package" },
      ]),
    ).toBe(true);
  });
});

/*
 * District Manager feedback, 21 Oct 2026: the level in the form's own
 * shorthand ("create verbal CA for …") and as a sentence of its own ("… on
 * 10-20-26. verbal. no payroll deduct.") was left for the manager to set.
 * Synthetic names.
 */
describe("statedWarningLevel — the level stated for this form", () => {
  it.each([
    [
      "create verbal CA for remy calder for violating visitors at work policy on 10-10-26. remy spent 40 minutes talking with a friend and ignoring clients. previous coaching was jba policy manual 1-1-26",
      "verbal",
    ],
    [
      "create ca form for tess varga for violating attendance policy on 10-20-26. verbal. no payroll deduct. jba manual 1-1-26 for previous coaching",
      "verbal",
    ],
    ["create a written corrective action for tess varga for a register shortage", "written"],
    ["written CA for tess varga, register short $3.25 today", "written"],
    ["give her a verbal C/A for the dress code", "verbal"],
    ["tess was late on 10/20. written. payroll deduct no", "written"],
    ["late today. Verbal.", "verbal"],
    ["5. verbal", "verbal"],
    ["warning level: written", "written"],
    ["Sarah Test, Kearny, today, mini skirt, verbal warning, first time", "verbal"],
  ])("%s → %s", (text, level) => {
    expect(statedWarningLevel(text)).toBe(level);
  });

  it.each([
    "she had a written CA in august and was late again today",
    "she has had verbal CAs before",
    "previous written corrective action 9/1, late again today",
    "got verbal warning on september 21",
    "I gave her a verbal warning last week",
    "she got a written warning before for this",
    "final written warning",
    "late again. verbal. written.",
    "verbal or written?",
    "is it verbal?",
    "he gave her a verbal heads-up about the schedule",
    "she was written up",
  ])("%s states no level for this form", (text) => {
    expect(statedWarningLevel(text)).toBeNull();
  });

  it("the latest turn that states one wins", () => {
    expect(
      warningLevelFromTurns(["create ca form for tess varga for violating attendance policy on 10-20-26", "verbal"]),
    ).toBe("verbal");
    expect(warningLevelFromTurns(["verbal CA for tess varga, late today", "actually make it written"])).toBe("written");
    expect(warningLevelFromTurns(["create ca form for tess varga", "no payroll deduct"])).toBeNull();
  });

  it("is ticked only where the form offers it", () => {
    expect(warningLevelChecked("verbal", ["verbal", "written", "termination", "demotion"])).toEqual({
      warning_type: ["verbal"],
    });
    expect(warningLevelChecked("written", ["verbal"])).toEqual({});
    expect(warningLevelChecked(null, ["verbal", "written"])).toEqual({});
  });

  it("answers the intake's warning-level item", () => {
    const reading = readCorrectiveActionIntake({
      text: "create verbal CA for remy calder for violating visitors at work policy on 10-10-26",
      employeeKnown: true,
      salonSettled: true,
    });
    expect(reading.supplied).toContain("warning_level");
  });
});

/*
 * HR, 21 Oct 2026: "create a written CA for … previous coaching: jba policy
 * manual 1-1-26, verbal ca 9-1-26 …". The verbal CA is an item of the history
 * list under the label; the form being written is the written one requested.
 * Synthetic names.
 */
describe("a verbal CA in a labelled history list is history", () => {
  const PRODUCTION =
    "create a written CA for tess varga for not attending the monthly meeting on 10-20-26. previous coaching: jba policy manual 1-1-26, verbal ca 9-1-26. payroll deduct not applicable";

  it("the production request is Written", () => {
    expect(statedWarningLevel(PRODUCTION)).toBe("written");
  });

  it.each([
    "missed the monthly meeting on 10-20-26. previous coaching: jba policy manual 1-1-26, verbal ca",
    "missed the monthly meeting on 10-20-26. previous CA: verbal ca",
    "missed the monthly meeting on 10-20-26. prior actions - written warning",
    "missed the monthly meeting on 10-20-26. previous coaching: jba policy manual attendance and punctuality review, verbal ca",
  ])("undated, under the label: %s", (text) => {
    expect(statedWarningLevel(text)).toBeNull();
  });
});
