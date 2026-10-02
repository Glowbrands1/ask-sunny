import { describe, expect, it } from "vitest";

import { notesDescribeShortfall } from "./coaching-framing";
import { isServiceAccountName } from "./employee-match";
import { scopeRoster } from "./employee-roster";
import {
  findingsSupportedBy,
  notesDescribeFollowUp,
  reportsFollowUpResult,
} from "./follow-up-observation";
import { extractEmployeeNames } from "./proposal";
import {
  asksAboutFollowUpDate,
  instructedFieldsIn,
  isRevisionRequest,
  keepsSubstance,
  planRevision,
  scopeRevision,
  statesFollowUpTimeframe,
  type CurrentValue,
} from "./revision";
import { asksForTeamCoaching, maskTeamSubjectPhrases, readsAsTeamSubject } from "./team-subject";
import { detectTemplateIntent } from "./template-intent";

/**
 * ============================================================================
 * REGRESSIONS FROM THE PRODUCTION QA OF PR #81 (2 OCTOBER 2026)
 * ============================================================================
 *
 * Every exact phrase the QA report listed as failing, at the layer that decides
 * it. The end-to-end half — the same phrases through the proposal, the create
 * route and the chat revision — is `app/api/forms/coaching-qa-fixes-e2e.test.ts`.
 */

/* ===================================================== P1: the team subject == */

describe("P1 — team descriptors are never an employee's name", () => {
  it.each([
    ["Create a coaching form for general training for staff on bed sanitizing.", "general"],
    ["Create a coaching form for group training on bed sanitizing.", "group"],
    ["Create a coaching form for team-wide coaching on bed sanitizing.", "team-wide"],
  ])("%j names nobody (was %j)", (text) => {
    expect(extractEmployeeNames(text)).toEqual([]);
    expect(readsAsTeamSubject(text)).toBe(true);
  });

  it.each([
    "team-wide", "whole team", "entire team", "all staff", "all employees", "everyone", "everybody",
    "staff training", "team training", "group training", "general training", "salon-wide", "store-wide",
  ])("masks %j before any name is read", (phrase) => {
    expect(extractEmployeeNames(`Create a coaching form for ${phrase} on bed sanitizing.`)).toEqual([]);
    expect(maskTeamSubjectPhrases(`coaching form for ${phrase}`)).not.toContain(phrase);
  });

  it("keeps a real named employee — the form is hers, not the team's", () => {
    expect(extractEmployeeNames("Create a coaching form for Kaitlyn about how the whole team should sanitize beds.")).toEqual([
      "Kaitlyn",
    ]);
    expect(extractEmployeeNames("Create a coaching form for Kaitlyn Mazzei about group training on beds.")).toEqual([
      "Kaitlyn Mazzei",
    ]);
  });
});

describe("P1 — natural team requests ask for the Coaching Form", () => {
  it.each([
    "I need team-wide coaching about bed sanitizing.",
    "Coaching for everyone at the salon about bed sanitizing.",
    "General training for staff about bed sanitizing — can you write up a coaching form?",
    "Create a coaching form for general training for staff on bed sanitizing.",
    "Create a coaching form for group training on bed sanitizing.",
    "Create a coaching form for team-wide coaching on bed sanitizing.",
  ])("%j", (text) => {
    expect(detectTemplateIntent(text)).toEqual({ kind: "explicit", templateKey: "coaching" });
  });

  it.each([
    "What should team-wide coaching on bed sanitizing cover?",
    "Any tips for group training on bed sanitizing?",
    "How should we run general training for staff?",
    "I don't need team-wide coaching on this yet.",
    "Tuesday was a difficult shift for the team.",
  ])("leaves advice and narrative alone: %j", (text) => {
    expect(asksForTeamCoaching(text)).toBe(false);
  });
});

/* ======================================= P2: a follow-up result, in plain words == */

describe("P2 — a manager reporting a follow-up is giving the form its findings", () => {
  it.each([
    "Kaitlyn improved and followed the sanitizing procedure correctly during today’s observation.",
    "Kaitlyn improved and followed the procedure correctly during today’s observation.",
    "She has improved since our last conversation.",
    "During today’s follow-up she followed all the sanitizing steps.",
    "No improvement yet. She skipped two steps again.",
    "She is making progress but still needs reminders.",
  ])("%j is a follow-up result", (text) => {
    expect(reportsFollowUpResult(text)).toBe(true);
    expect(notesDescribeFollowUp(text)).toBe(true);
  });

  it.each([
    "Did she improve?",
    "I hope she improved by next week.",
    "We'll follow up in two weeks.",
    "She should have improved by then.",
    "What does the progress level mean?",
  ])("%j is not", (text) => expect(reportsFollowUpResult(text)).toBe(false));

  it("each finding needs its own words", () => {
    expect([...findingsSupportedBy("Kaitlyn improved and followed the sanitizing procedure correctly during today’s observation.")].sort()).toEqual([
      "follow_up_observation",
      "progress_level",
      "specific_evidence",
    ]);
    // A progress reading is not a next-step decision, and reports no further coaching.
    expect(findingsSupportedBy("She is making progress but still needs reminders.").has("next_step")).toBe(false);
    expect(findingsSupportedBy("She has improved; we reviewed the checklist again and will continue to monitor.").has("additional_coaching")).toBe(true);
    expect(findingsSupportedBy("She has improved; we reviewed the checklist again and will continue to monitor.").has("next_step")).toBe(true);
  });
});

/* =========================================== P2/P3: which fields a turn names == */

const FOLLOW_UP_FIELDS = [
  { key: "original_topic", label: "Original Coaching Topic" },
  { key: "original_expectation", label: "Original Expectation" },
  { key: "follow_up_observation", label: "Follow-Up Observation" },
  { key: "specific_evidence", label: "Specific Evidence" },
  { key: "additional_coaching", label: "Additional Coaching Completed" },
  { key: "next_follow_up", label: "Next Follow-Up" },
  {
    key: "progress_level",
    label: "Progress Level",
    options: [
      { key: "improved", label: "Improved" },
      { key: "partially_improved", label: "Partially Improved" },
      { key: "not_improved", label: "Not Improved" },
    ],
  },
  { key: "next_step", label: "Next Step", options: [{ key: "continue", label: "Continue" }, { key: "role_play", label: "Role-Play" }] },
];

describe("P2/P3 — a field restricts a revision only when it is instructed", () => {
  it.each([
    ["Kaitlyn improved and followed the sanitizing procedure correctly during today’s observation.", []],
    ["Add this to the form: Kaitlyn improved and followed the sanitizing procedure correctly during today’s observation.", []],
    ["Change only Progress Level to Improving.", ["progress_level"]],
    ["Make the follow up 10 days instead.", ["next_follow_up"]],
    ["Can you re-draft a cleaner version with the next follow-up as within 10 days?", ["next_follow_up"]],
    ["Please open the form and change the timeframe to within 10 days.", ["next_follow_up"]],
    ["Redraft the follow-up coaching form with one change: the timeframe should be within 10 days.", ["next_follow_up"]],
    ["Remove the additional coaching section.", ["additional_coaching"]],
    ["Change the specific evidence to: observed on four shifts.", ["specific_evidence"]],
    ["Mark her as partially improved.", ["progress_level"]],
    ["Redraft this cleaner but keep everything else.", []],
  ])("%j instructs %j", (text, keys) => {
    expect([...instructedFieldsIn(text, FOLLOW_UP_FIELDS)].sort()).toEqual([...keys].sort());
  });

  it("protects a field the manager says to keep", () => {
    const scope = scopeRevision("Redraft it cleaner but keep the specific evidence as it is.", FOLLOW_UP_FIELDS);
    expect(scope.protectedKeys.has("specific_evidence")).toBe(true);
    expect(scope.mode).toBe("wording");
  });
});

describe("P3 — natural edit phrasings are edits", () => {
  it.each([
    "Make the follow up 10 days instead.",
    "Redraft it with these changes.",
    "Can you re-draft a cleaner version with the next follow-up as within 10 days?",
    "Please open the form and change the timeframe to within 10 days.",
    "Redraft this cleaner but keep everything else.",
    "Clean this up.",
    "Can you rewrite it?",
    "Reword the follow-up observation.",
    "Adjust the next step.",
    "follow up again in 10 days",
    "check back within two weeks",
    "next follow-up should be in one month",
  ])("%j", (text) => expect(isRevisionRequest(text)).toBe(true));

  it.each([
    "Create a new coaching form for Avery Stone",
    "Open a new follow-up coaching form for Kaitlyn",
    "Draft a coaching form for Dana",
    "Can you mention our attendance policy?",
    "What does the progress level mean?",
  ])("%j is not", (text) => expect(isRevisionRequest(text)).toBe(false));
});

/* ======================================== P3: the merge, not the prompt, decides == */

describe("P3 — a badly behaved model cannot rewrite what the request did not ask about", () => {
  const current = new Map<string, CurrentValue>([
    ["original_topic", { value: "Bed sanitizing", checked: [], filledBy: "ai" }],
    ["original_expectation", { value: "Every bed is sanitized after each client.", checked: [], filledBy: "ai" }],
    ["follow_up_observation", { value: "Kaitlyn has sanitized every bed after each client since the coaching.", checked: [], filledBy: "ai" }],
    ["specific_evidence", { value: "Manager's own words: watched 3 shifts.", checked: [], filledBy: "manager" }],
    ["additional_coaching", { value: "Reviewed the sanitizing checklist together.", checked: [], filledBy: "ai" }],
    ["next_follow_up", { value: "within 2 weeks", checked: [], filledBy: "ai" }],
    ["progress_level", { value: null, checked: ["improved"], filledBy: "ai" }],
    ["next_step", { value: null, checked: ["continue"], filledBy: "ai" }],
  ]);
  const adversarial = {
    values: {
      next_follow_up: "within 10 days",
      follow_up_observation: "REWRITTEN",
      specific_evidence: "REWRITTEN",
      original_topic: "REWRITTEN",
      additional_coaching: "",
    },
    checked: { progress_level: ["partially_improved"], next_step: ["role_play"] },
    clear: ["additional_coaching", "specific_evidence"],
  };

  it.each(["Make the follow up 10 days instead.", "Can you re-draft a cleaner version with the next follow-up as within 10 days?", "Please open the form and change the timeframe to within 10 days."])(
    "%j changes only the timeframe",
    (question) => {
      const plan = planRevision({ question, fields: FOLLOW_UP_FIELDS, current, proposed: adversarial });
      expect(plan.values).toEqual({ next_follow_up: "within 10 days" });
      expect(plan.checked).toEqual({});
      expect(plan.cleared).toEqual([]);
    },
  );

  it.each(["Redraft it with these changes.", "Redraft this cleaner but keep everything else.", "Can you redraft it so it reads better?"])(
    "%j may reword, but never replaces, drops or re-ticks anything",
    (question) => {
      const plan = planRevision({ question, fields: FOLLOW_UP_FIELDS, current, proposed: adversarial });
      expect(plan.values).toEqual({});
      expect(plan.checked).toEqual({});
      expect(plan.cleared).toEqual([]);
    },
  );

  it("a genuine rewording of Sunny's own text is accepted", () => {
    const plan = planRevision({
      question: "Redraft this cleaner but keep everything else.",
      fields: FOLLOW_UP_FIELDS,
      current,
      proposed: { values: { follow_up_observation: "Since the coaching, Kaitlyn has sanitized every bed after each client." } },
    });
    expect(plan.values).toEqual({ follow_up_observation: "Since the coaching, Kaitlyn has sanitized every bed after each client." });
  });

  it("a follow-up report writes only the findings the report supports", () => {
    const question = "Kaitlyn improved and followed the sanitizing procedure correctly during today’s observation.";
    const plan = planRevision({
      question,
      fields: FOLLOW_UP_FIELDS,
      current,
      proposed: adversarial,
      scope: scopeRevision(question, FOLLOW_UP_FIELDS, findingsSupportedBy(question)),
    });
    // Observation, and Progress Level — the manager's own text and everything else untouched.
    expect(plan.values).toEqual({ follow_up_observation: "REWRITTEN" });
    expect(plan.checked).toEqual({ progress_level: ["partially_improved"] });
    expect(plan.values.specific_evidence).toBeUndefined();
    expect(plan.values.original_topic).toBeUndefined();
    expect(plan.checked.next_step).toBeUndefined();
  });

  it("keepsSubstance accepts a rewording and refuses a replacement", () => {
    expect(keepsSubstance("kaitlyn didnt wipe 2 beds after clients today", "Kaitlyn did not wipe two beds after clients today.")).toBe(true);
    expect(keepsSubstance("Observed on three shifts.", "REWRITTEN")).toBe(false);
    expect(keepsSubstance("She was 15 minutes late.", "She was late.")).toBe(false);
  });
});

/* ===================================================== P4: date vs timeframe == */

describe("P4 — the follow-up date and the agreed timeframe never cross", () => {
  it.each([
    "Change the follow-up date to 10/15",
    "schedule the follow-up for October 15",
    "set the follow-up date to 10/15",
    "Follow up on 10/15",
  ])("%j is about the DATE", (text) => {
    expect(asksAboutFollowUpDate(text)).toBe(true);
    expect(statesFollowUpTimeframe(text)).toBe(false);
    expect(instructedFieldsIn(text, FOLLOW_UP_FIELDS).has("next_follow_up")).toBe(false);
  });

  it.each([
    "follow up again in 10 days",
    "check back within two weeks",
    "next follow-up should be in one month",
    "Make the follow up 10 days instead.",
  ])("%j is about the TIMEFRAME", (text) => {
    expect(asksAboutFollowUpDate(text)).toBe(false);
    expect(statesFollowUpTimeframe(text)).toBe(true);
    expect(instructedFieldsIn(text, FOLLOW_UP_FIELDS).has("next_follow_up")).toBe(true);
  });
});

/* ======================================================== P5: proactive coaching == */

describe("P5 — 'again', 'still' and 'missing' are not a shortfall on their own", () => {
  it.each([
    "Quick reminder going over the bed sanitizing steps again before the new checklist starts.",
    "Let’s review the steps again before launch.",
    "We’re still preparing everyone for the new process.",
    "Going over the expectations again as a refresher.",
    "The new checklist is still being rolled out.",
    "Create a coaching form for Kaitlyn Mazzei to make sure she's not missing any steps on the new bed sanitizing checklist before we roll it out.",
    "Create a coaching form for Kaitlyn to align on our new bed sanitizing expectations before we roll them out.",
    "No concerns — this is a refresher on the new spray.",
    "She hasn't missed a shift; this is development coaching for a shift lead role.",
  ])("%j is proactive", (text) => expect(notesDescribeShortfall(text)).toBe(false));

  it.each([
    "She skipped the sanitizing step again after being coached.",
    "The required initials are still missing from yesterday’s checklist.",
    "Kaitlyn was 20 minutes late today.",
    "coaching form for Kaitlyn Marsh she didnt wipe 2 beds after clients today",
    "Kaitlyn left two beds unsanitized after clients today.",
    "She keeps forgetting to wipe the beds.",
    "She is still late most mornings.",
  ])("%j describes a shortfall", (text) => expect(notesDescribeShortfall(text)).toBe(true));
});

/* ================================================== P7: directory service rows == */

describe("P7 — shared and service accounts are never a name suggestion", () => {
  it.each([
    ["Risk", "Management"],
    ["No", "Manager"],
    ["GlowBrands", "IT Support"],
  ])("%s %s", (first, last) => expect(isServiceAccountName(first, last)).toBe(true));

  it.each([
    ["Kaitlyn", "Mazzei"],
    ["Kim", "Keller"],
    ["Hope", "Office"],
    ["Paige", "Horne"],
    ["Tia", "Aldred"],
  ])("%s %s is a person", (first, last) => expect(isServiceAccountName(first, last)).toBe(false));

  it("leaves them out of the scoped roster without touching anybody else", () => {
    const rows = [
      { id: "1", firstName: "Risk", lastName: "Management", preferredFirstName: "Risk", employmentStatus: "active", salonIds: ["loc-0306"] },
      { id: "2", firstName: "No", lastName: "Manager", preferredFirstName: "No", employmentStatus: "active", salonIds: ["loc-0306"] },
      { id: "3", firstName: "Hayley", lastName: "Cooper", preferredFirstName: "Hayley", employmentStatus: "active", salonIds: ["loc-0306"] },
    ];
    const roster = scopeRoster(rows, { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] });
    expect(roster.map((row) => `${row.firstName} ${row.lastName}`)).toEqual(["Hayley Cooper"]);
  });
});
