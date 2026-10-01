import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { guardCoachingFraming, notesDescribeShortfall } from "./coaching-framing";
import {
  acceptedNameSuggestions,
  matchEmployeeName,
  nameConfirmationQuestion,
  readNameConfirmation,
  settledNameQuestions,
  type RosterEmployee,
} from "./employee-match";
import { scopeRoster, type DirectoryRosterRow } from "./employee-roster";
import { guardManagerFollowUp, notesDescribeFollowUp } from "./follow-up-observation";
import { proposeLocation } from "./location-scope";
import { fieldsNamedIn, isRevisionRequest, planRevision, type CurrentValue } from "./revision";
import { TEAM_SUBJECT_LABEL, allowsTeamSubject, readsAsTeamSubject } from "./team-subject";

/**
 * ============================================================================
 * COACHING FEEDBACK — THE PURE RULES
 * ============================================================================
 *
 * One file per round of feedback is how this suite reads elsewhere, and these
 * are the rules behind the nine points: what a revision may change, who a
 * typed name may be matched to, when a follow-up finding may be written, when
 * coaching may be called a concern, and which salon a form gets. The route-
 * level journeys are in `src/app/api/forms/coaching-feedback-e2e.test.ts`.
 */

const kaitlyn: RosterEmployee = {
  id: "e-1",
  firstName: "Kaitlyn",
  lastName: "Marsh",
  salonIds: ["loc-0310"],
};
const katelyn: RosterEmployee = {
  id: "e-2",
  firstName: "Katelyn",
  lastName: "Marsh",
  salonIds: ["loc-0311"],
};
const avery: RosterEmployee = {
  id: "e-3",
  firstName: "Avery",
  lastName: "Stone",
  preferredFirstName: "Ave",
  salonIds: ["loc-0310", "loc-0311"],
};

describe("matching a typed employee name", () => {
  it("accepts an exact full name, in the directory's spelling", () => {
    expect(matchEmployeeName("kaitlyn marsh", [kaitlyn, avery])).toMatchObject({
      kind: "exact",
      name: "Kaitlyn Marsh",
    });
  });

  it("asks about a slight misspelling — never autocorrects", () => {
    const result = matchEmployeeName("Katlin Marsh", [kaitlyn, avery]);
    expect(result.kind).toBe("confirm");
    expect(result.kind === "confirm" && result.candidates.map((entry) => entry.name)).toEqual([
      "Kaitlyn Marsh",
    ]);
  });

  it("puts every plausible match to the manager and selects none", () => {
    const result = matchEmployeeName("Katlyn Marsh", [kaitlyn, katelyn]);
    expect(result.kind).toBe("confirm");
    expect(result.kind === "confirm" && result.candidates.map((entry) => entry.name).sort()).toEqual([
      "Kaitlyn Marsh",
      "Katelyn Marsh",
    ]);
  });

  it("asks to confirm a lone first name rather than completing it silently", () => {
    const result = matchEmployeeName("Kaitlyn", [kaitlyn, avery]);
    expect(result).toMatchObject({ kind: "confirm" });
  });

  it("reads a preferred first name", () => {
    expect(matchEmployeeName("Ave Stone", [avery])).toMatchObject({ kind: "exact", name: "Avery Stone" });
  });

  it("keeps a name nobody on the roster is close to, as typed", () => {
    expect(matchEmployeeName("Zelda Quinn", [kaitlyn, avery])).toEqual({ kind: "none" });
  });

  it("does not call two different short names a typo", () => {
    const dan: RosterEmployee = { id: "e-9", firstName: "Dan", lastName: "Lee", salonIds: [] };
    expect(matchEmployeeName("Ann Lee", [dan])).toEqual({ kind: "none" });
  });

  it("changes nothing without a roster", () => {
    expect(matchEmployeeName("Katlin Marsh", [])).toEqual({ kind: "unchecked" });
  });
});

describe("the roster is the actor's own scope, and nothing wider", () => {
  const rows: DirectoryRosterRow[] = [
    { id: "e-1", firstName: "Kaitlyn", lastName: "Marsh", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0310"] },
    { id: "e-2", firstName: "Katelyn", lastName: "Marsh", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0499"] },
    { id: "e-4", firstName: "Gone", lastName: "Person", preferredFirstName: null, employmentStatus: "terminated", salonIds: ["loc-0310"] },
    { id: "e-5", firstName: "Unmapped", lastName: "Person", preferredFirstName: null, employmentStatus: "active", salonIds: [] },
  ];

  it("a salon-scoped manager sees only people at their salons", () => {
    const roster = scopeRoster(rows, { level: "salon", primaryAreaId: "loc-0310", alsoCoversAreaIds: [] });
    expect(roster.map((entry) => entry.id)).toEqual(["e-1"]);
    // The out-of-scope Katelyn is never a candidate, however close the spelling.
    const result = matchEmployeeName("Katelyn Marsh", roster);
    expect(result.kind === "confirm" && result.candidates.map((entry) => entry.employee.id)).toEqual(["e-1"]);
  });

  it("an employee's other salons are not disclosed to a manager of one", () => {
    const multi: DirectoryRosterRow[] = [{ ...rows[0]!, salonIds: ["loc-0310", "loc-0499"] }];
    const roster = scopeRoster(multi, { level: "salon", primaryAreaId: "loc-0310", alsoCoversAreaIds: [] });
    expect(roster[0]!.salonIds).toEqual(["loc-0310"]);
  });

  it("a global actor sees every active employee", () => {
    const roster = scopeRoster(rows, { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] });
    expect(roster.map((entry) => entry.id).sort()).toEqual(["e-1", "e-2", "e-5"]);
  });

  it.each(["district", "region"] as const)("a %s scope fails closed to an empty roster", (level) => {
    expect(scopeRoster(rows, { level, primaryAreaId: "dist-x", alsoCoversAreaIds: [] })).toEqual([]);
  });

  it("an unverified (demo) actor gets no roster", () => {
    expect(scopeRoster(rows, null)).toEqual([]);
  });

  it("terminated employees are never suggested", () => {
    const roster = scopeRoster(rows, { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] });
    expect(roster.some((entry) => entry.id === "e-4")).toBe(false);
  });
});

describe("answering 'Did you mean …?'", () => {
  const asked = nameConfirmationQuestion("Katlin", ["Kaitlyn Marsh"]);

  it("a yes accepts the one suggested name", () => {
    const conversation = [
      { role: "user", content: "coaching form for Katlin" },
      { role: "assistant", content: asked },
      { role: "user", content: "yes" },
    ];
    expect(readNameConfirmation(conversation)).toEqual({ kind: "accepted", name: "Kaitlyn Marsh" });
    expect(acceptedNameSuggestions(conversation)).toEqual(["Kaitlyn Marsh"]);
  });

  it("a no keeps the typed name", () => {
    const conversation = [
      { role: "user", content: "coaching form for Katlin" },
      { role: "assistant", content: asked },
      { role: "user", content: "no, keep it as typed" },
    ];
    expect(readNameConfirmation(conversation)).toEqual({ kind: "declined" });
    expect(settledNameQuestions(conversation).kept).toEqual(["Katlin"]);
  });

  it("a yes to a choice of two picks nobody", () => {
    const conversation = [
      { role: "assistant", content: nameConfirmationQuestion("Katlyn", ["Kaitlyn Marsh", "Katelyn Marsh"]) },
      { role: "user", content: "yes" },
    ];
    expect(readNameConfirmation(conversation)).toBeNull();
  });

  it("only answers the question it follows", () => {
    expect(readNameConfirmation([{ role: "assistant", content: "Anything else?" }, { role: "user", content: "yes" }])).toBeNull();
  });
});

describe("which salon a form gets", () => {
  const multi = { level: "salon" as const, primaryAreaId: "loc-0310", alsoCoversAreaIds: ["loc-0311"] };

  it("fills the employee's one salon when the account covers several", () => {
    expect(proposeLocation(multi, "coaching form for Kaitlyn Marsh", ["loc-0310"])).toEqual({
      resolution: "resolved",
      locationId: "loc-0310",
    });
  });

  it("asks when the employee works at several of the manager's salons", () => {
    expect(proposeLocation(multi, "coaching form for Avery", ["loc-0310", "loc-0311"])).toMatchObject({
      resolution: "needs_selection",
      authorizedIds: ["loc-0310", "loc-0311"],
    });
  });

  it("asks when nothing settles it, and never guesses", () => {
    expect(proposeLocation(multi, "coaching form for Zelda", [])).toMatchObject({ resolution: "needs_selection" });
  });

  it("never proposes an employee salon outside the manager's scope", () => {
    expect(proposeLocation(multi, "coaching form for Katelyn", ["loc-0499"])).toMatchObject({
      resolution: "needs_selection",
      authorizedIds: ["loc-0310", "loc-0311"],
    });
  });

  it("a salon the manager names outranks the employee's assignment", () => {
    // Wornall is 0310 in the roster; the employee is assigned to 0311 as well.
    const named = proposeLocation(multi, "coaching form for Avery at salon 0311", ["loc-0310", "loc-0311"]);
    expect(named).toEqual({ resolution: "resolved", locationId: "loc-0311" });
  });

  it("a global actor gets the employee's salon, or none — never a guess", () => {
    const global = { level: "global" as const, primaryAreaId: null, alsoCoversAreaIds: [] };
    expect(proposeLocation(global, "coaching form for Kaitlyn", ["loc-0310"])).toEqual({
      resolution: "resolved",
      locationId: "loc-0310",
    });
    expect(proposeLocation(global, "coaching form for Zelda", []).resolution).toBe("not_applicable");
  });

  it("a district scope still fails closed, whatever the directory says", () => {
    const district = { level: "district" as const, primaryAreaId: "dist-x", alsoCoversAreaIds: [] };
    expect(proposeLocation(district, "coaching form for Kaitlyn", ["loc-0310"]).resolution).toBe("unavailable");
  });
});

describe("a team-wide subject", () => {
  it.each([
    "Create a coaching form for the whole team about bed sanitizing",
    "coaching form for all staff on bed sanitizing expectations",
    "team-wide coaching form about cleaning beds between clients",
    "salon-wide expectations for new client documents — coaching form",
    "I need a coaching form for my team - general training on new client documents",
  ])("reads %j as the team", (text) => {
    expect(readsAsTeamSubject(text)).toBe(true);
  });

  it.each([
    "Tuesday was a difficult shift for the team",
    "coaching form for Dana",
    "she was late again",
  ])("does not read %j as the team", (text) => {
    expect(readsAsTeamSubject(text)).toBe(false);
  });

  it("is offered only on the Coaching Form", () => {
    expect(allowsTeamSubject("coaching")).toBe(true);
    for (const key of ["dpoa", "policy-review", "follow-up-coaching", "sdit-epp", "tsd-epp", "stc-exit", "demotion"]) {
      expect(allowsTeamSubject(key), key).toBe(false);
    }
    expect(TEAM_SUBJECT_LABEL).toBe("All team members");
  });
});

describe("manager follow-up findings stay blank until the follow-up happens", () => {
  const drafted = {
    values: {
      original_topic: "Bed sanitizing",
      follow_up_observation: "She has improved and sanitizes every bed.",
      specific_evidence: "Observed on three shifts.",
      additional_coaching: "Role-played the checklist.",
      next_follow_up: "within 2 weeks",
    },
    checked: { progress_level: ["improved"], next_step: ["continue"] },
  };

  it("empties every finding when the manager has only described the original coaching", () => {
    const notes = "Coached Dana on bed sanitizing today. We agreed to follow up within 2 weeks.";
    expect(notesDescribeFollowUp(notes)).toBe(false);
    const guarded = guardManagerFollowUp(drafted, notes);
    expect(guarded.values).toEqual({ original_topic: "Bed sanitizing", next_follow_up: "within 2 weeks" });
    expect(guarded.checked).toEqual({});
    expect(guarded.emptied.sort()).toEqual(
      ["additional_coaching", "follow_up_observation", "next_step", "progress_level", "specific_evidence"].sort(),
    );
  });

  it("keeps them when the manager reports the follow-up they did", () => {
    const notes = "I followed up today. Since our coaching she has improved — every bed sanitized on three shifts.";
    const guarded = guardManagerFollowUp(drafted, notes);
    expect(guarded.values).toEqual(drafted.values);
    expect(guarded.checked).toEqual(drafted.checked);
  });

  it("is a no-op on a form without these keys", () => {
    const coaching = { values: { coaching_details: "Observed:\nx" }, checked: { coaching_type: ["retraining"] } };
    expect(guardManagerFollowUp(coaching, "nothing about a follow-up")).toEqual({ ...coaching, emptied: [] });
  });
});

describe("coaching is not always a concern", () => {
  const training = "Trained the whole team on the new bed sanitizing steps today. Wipe every bed after each client.";

  it("reads training notes as no shortfall", () => {
    expect(notesDescribeShortfall(training)).toBe(false);
  });

  it("refuses Underperformance and a concern label on a training form", () => {
    const guarded = guardCoachingFraming(
      {
        values: {
          coaching_details:
            "Observed:\nThe team was trained on the new bed sanitizing steps. This is a performance concern.\n\nExpectation:\nEvery bed is wiped after each client.",
        },
        checked: { coaching_type: ["underperformance", "training_plan_of_action"] },
      },
      training,
    );
    expect(guarded.values.coaching_details).toBe(
      "Observed:\nThe team was trained on the new bed sanitizing steps.\n\nExpectation:\nEvery bed is wiped after each client.",
    );
    expect(guarded.checked.coaching_type).toEqual(["training_plan_of_action"]);
    expect(guarded.underperformanceRefused).toBe(true);
  });

  it("leaves a corrective draft alone when the manager described a shortfall", () => {
    const draft = {
      values: { coaching_details: "Observed:\nSarah was 20 minutes late. This is a concern." },
      checked: { coaching_type: ["underperformance"] },
    };
    const guarded = guardCoachingFraming(draft, "Sarah was 20 minutes late today.");
    expect(guarded.values).toEqual(draft.values);
    expect(guarded.checked).toEqual(draft.checked);
  });
});

describe("a revision changes what was asked, and only that", () => {
  const fields = [
    { key: "original_topic", label: "Original Coaching Topic" },
    { key: "original_expectation", label: "Original Expectation" },
    { key: "follow_up_observation", label: "Follow-Up Observation" },
    { key: "progress_level", label: "Progress Level" },
    { key: "specific_evidence", label: "Specific Evidence" },
    { key: "next_follow_up", label: "Next Follow-Up" },
  ];
  const current = new Map<string, CurrentValue>([
    ["original_topic", { value: "Bed sanitizing", checked: [], filledBy: "ai" }],
    ["original_expectation", { value: "Every bed is sanitized after each client.", checked: [], filledBy: "ai" }],
    ["specific_evidence", { value: "Manager's own note.", checked: [], filledBy: "manager" }],
    ["next_follow_up", { value: "within 2 weeks", checked: [], filledBy: "ai" }],
  ]);

  it.each([
    "Can you redraft the form with these changes?",
    "redraft the coaching form and change the timeframe to one week",
    "Please update the next follow-up to 10 days",
    "rewrite the original expectation so it's clearer",
  ])("%j is a revision", (text) => expect(isRevisionRequest(text)).toBe(true));

  it.each([
    "Create a coaching form for Dana",
    "I need another coaching form for the team",
    "What does the progress level mean?",
    "she was late today",
    // A knowledge request while a form is open is still a knowledge request.
    "Can you mention our attendance policy?",
    "Please add more detail about how to handle objections",
  ])("%j is not", (text) => expect(isRevisionRequest(text)).toBe(false));

  it("names fields by label and by alias, and not by the form's own name", () => {
    expect([...fieldsNamedIn("redraft the follow-up coaching form", fields)]).toEqual([]);
    expect([...fieldsNamedIn("change the timeframe to one week", fields)]).toEqual(["next_follow_up"]);
    expect([...fieldsNamedIn("tidy up the specific evidence and the original expectation", fields)].sort()).toEqual([
      "original_expectation",
      "specific_evidence",
    ]);
  });

  it("writes only the named field, however much else the model returned", () => {
    const plan = planRevision({
      question: "change the timeframe to one week",
      fields,
      current,
      proposed: {
        values: { next_follow_up: "within one week", original_topic: "Sanitation (rewritten)" },
        checked: { progress_level: ["improved"] },
      },
    });
    expect(plan.values).toEqual({ next_follow_up: "within one week" });
    expect(plan.checked).toEqual({});
    expect(plan.untouched.sort()).toEqual(["original_topic", "progress_level"]);
  });

  it("never touches the manager's own text on an unnamed rewrite", () => {
    const plan = planRevision({
      question: "redraft the form with cleaner wording",
      fields,
      current,
      proposed: { values: { specific_evidence: "Rewritten.", original_expectation: "Each bed is sanitized after every client." } },
    });
    expect(plan.values).toEqual({ original_expectation: "Each bed is sanitized after every client." });
  });

  it("clears only on an explicit removal of a named field", () => {
    expect(
      planRevision({ question: "redraft it", fields, current, proposed: { values: {}, clear: ["next_follow_up"] } }).cleared,
    ).toEqual([]);
    // Named, but not asked to be removed: a model that empties it anyway is refused.
    expect(
      planRevision({ question: "change the next follow-up wording", fields, current, proposed: { values: {}, clear: ["next_follow_up"] } }).cleared,
    ).toEqual([]);
    expect(
      planRevision({ question: "remove the next follow-up", fields, current, proposed: { values: {}, clear: ["next_follow_up"] } }).cleared,
    ).toEqual(["next_follow_up"]);
  });

  it("drops a value that did not change", () => {
    const plan = planRevision({
      question: "redraft it",
      fields,
      current,
      proposed: { values: { original_topic: "Bed sanitizing" } },
    });
    expect(plan.values).toEqual({});
  });
});

describe("Sunny sounds like Sunny — in the conversation, not on the form", () => {
  it("carries one stated voice in every chat answer's instruction", async () => {
    const { SUNNY_VOICE, buildSystemPrompt } = await import("@/lib/ai/prompts");
    const prompt = buildSystemPrompt({
      assistantName: "Sunny",
      brandName: "Sun Tan City",
      salonNoun: "salon",
      context: { userName: "Dana", locationName: "NE Lincoln O Street", todayIso: "2026-10-01" },
      mode: "standard",
      hasContext: true,
    });
    expect(prompt).toContain(SUNNY_VOICE);
    // Personality never reaches the record, and never changes a fact.
    expect(SUNNY_VOICE).toMatch(/Personality never changes a fact/);
    expect(SUNNY_VOICE).toMatch(/form or an employee's file is neutral and professional/);
    expect(SUNNY_VOICE).toMatch(/only call something a concern when the manager described one/);
  });

  it("the coaching shortcut no longer calls every coaching form a concern", async () => {
    const { QUICK_QUESTIONS } = await import("@/lib/ai/quick-questions");
    const coaching = QUICK_QUESTIONS.find((entry) => entry.needs === "create_coaching_form")!;
    expect(coaching.text).toBe("Create a coaching form.");
    expect(QUICK_QUESTIONS.some((entry) => /performance concern/i.test(entry.text))).toBe(false);
  });
});
