import { expect } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * THE OFF-ROSTER OFFER IS ONLY FOR A NAME TYPED AS A PERSON (port of the sibling
 * app's gate rerun 2, 6 Nov 2026; OFF_ROSTER_CONFIRM_ENABLED)
 * ============================================================================
 *
 * OFF_ROSTER_CONFIRM offered "reply **use <name>**" for whatever name the card
 * was cleared of, so it said back, and offered as the employee, what the
 * not-found note never says by design: a product ("use **Lotion Starter Kits**"),
 * the placeholder "ima employee", an all-caps run with "BY" ("use **BY CORIN
 * BELLWEATHER**"), "QA Probe XZT One", and a lowercase name. The offer is for
 * a name typed in a person's place ("for <Name>", "employee, <Name>", a line
 * that is only the name), each word Title Case, as the note reads it. The
 * wording is each original case's; the names are invented.
 */
const FLAGS = [
  "FORM_NAME_FROM_ROSTER_ENABLED",
  "ROSTER_NEAR_MISS_ENABLED",
  "ROSTER_NAME_IN_CANDIDATE_ENABLED",
  "ROSTER_COMPOUND_SURNAME_ENABLED",
  "ROSTER_NOT_FOUND_ANY_PHRASING_ENABLED",
  "OFF_ROSTER_CONFIRM_ENABLED",
];

function neverOffered(id: string, title: string, turns: readonly string[], name: string): ReplayCase {
  return {
    id,
    title,
    report: "The sibling app's gate rerun 2 (6 Nov 2026): the off-roster offer said back a name that is not a person typed as one",
    status: "fixed",
    fixFlags: FLAGS,
    async run(t) {
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      for (const turn of turns) {
        const reply = await thread.say(turn);
        expect(reply.content, `"${name}" is offered as the employee:\n${reply.content}`).not.toContain(`reply **use ${name}**`);
      }
    },
  };
}

/** A mixed-case surname (QA, 6 Nov 2026): offered, then the answer makes the card READY with that name. */
function offeredThenReady(id: string, title: string, turn: string, name: string): ReplayCase {
  return {
    id,
    title,
    report: "QA, the review of gate rerun 2's fix (6 Nov 2026): real rosters have mixed-case surnames (McDonald, O'Brien)",
    status: "fixed",
    fixFlags: FLAGS,
    async run(t) {
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      let reply = await thread.say(turn);
      if (thread.proposal?.status !== "ready") {
        expect(reply.content, `the name is not offered:\n${reply.content}`).toContain(`reply **use ${name}**`);
        reply = await thread.say(`use ${name}`);
      }
      expect(thread.proposal, `no card the manager can create:\n${reply.content}`).toMatchObject({ employeeName: name, status: "ready" });
    },
  };
}

/** Two roster people the typed name is close to: the app asks which, and never offers the typed spelling (gate, 6 Nov 2026). */
function neverOfferedBesideTwo(id: string, title: string, turn: string, typed: string, a: [string, string], b: [string, string]): ReplayCase {
  const row = (key: string, [firstName, lastName]: [string, string]) => ({ id: key, firstName, lastName, preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" });
  return {
    id,
    title,
    report: "The Sunny flip-3 gate (6 Nov 2026): a near miss of two roster people was offered as a name not in Woven",
    status: "fixed",
    fixFlags: FLAGS,
    async run(t) {
      t.directory([...STAFF, row("e-near-a", a), row("e-near-b", b)] as never);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      const reply = await thread.say(turn);
      expect(reply.content, `a near miss of a roster person is offered as not in Woven:\n${reply.content}`).not.toContain(`reply **use ${typed}**`);
    },
  };
}

export const NOV6_OFF_ROSTER_OFFER_SHAPE_CASES: ReplayCase[] = [
  neverOffered(
    "nov6-offer-never-a-product",
    "a team coaching \"… on selling Lotion Starter Kits …\": \"Lotion Starter Kits\" is never offered as the employee",
    [
      "I need to make a coaching form for the team at Kearney on selling Lotion Starter Kits, not writing proper rainchecks which results in inventory not being correct.",
      "The employee needs to be left blank for now",
    ],
    "Lotion Starter Kits",
  ),
  // A guard here: this app's readers never put the placeholder on the offer (the sibling app holds it OPEN for QA).
  neverOffered(
    "nov6-offer-never-the-placeholder",
    "\"create a CA form for ima employee, for opening the salon late on 9-28-26\": the placeholder is never offered",
    ["create a CA form for ima employee, for opening the salon late on 9-28-26"],
    "Ima Employee",
  ),
  neverOffered(
    "nov6-offer-never-an-all-caps-run",
    "an all-caps message ending \"… BY CORIN BELLWEATHER\": \"BY CORIN BELLWEATHER\" is never offered",
    ["CORRECTIVE ACTION: A GUEST WAS TREATED RUDELY AT THE FRONT DESK ON MONDAY 10/05/2026 BY CORIN BELLWEATHER"],
    "BY CORIN BELLWEATHER",
  ),
  neverOffered(
    "nov6-offer-never-qa-probe",
    "\"I need a corrective action verbal for QA Probe XZT One. …\": \"QA Probe XZT One\" is never offered",
    ["I need a corrective action verbal for QA Probe XZT One. This is for Under Performance on PPTA, LPSVA, Club Average, Club Close %, and Spa %."],
    "QA Probe XZT One",
  ),
  {
    id: "nov6-offer-lowercase-said-back-title-case",
    title: "\"create a CA for zebulon marchbanks, …\" (typed in lowercase, not in Woven): offered as \"use **Zebulon Marchbanks**\", and \"use Zebulon Marchbanks\" makes the card READY",
    report: "QA, the sibling app's gate rerun 2 (6 Nov 2026): managers type names in lowercase; with the flags on a lowercase off-roster name must still finish",
    status: "fixed",
    fixFlags: FLAGS,
    async run(t) {
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      let reply = await thread.say("create a CA for zebulon marchbanks, he was 40 minutes late opening the salon on 11/2. action plan: zebulon will be on time for every opening shift");
      if (thread.proposal?.status !== "ready") {
        expect(reply.content, `the lowercase name is not offered in Title Case:\n${reply.content}`).toContain("reply **use Zebulon Marchbanks**");
        reply = await thread.say("use Zebulon Marchbanks");
      }
      expect(thread.proposal, `no card the manager can create:\n${reply.content}`).toMatchObject({ status: "ready" });
      expect((thread.proposal?.employeeName ?? "").toLowerCase(), `not his card:\n${reply.content}`).toBe("zebulon marchbanks");
    },
  },
  offeredThenReady(
    "nov6-offer-apostrophe-surname",
    "\"exit form for Siobhan O'Callaghan, …\" (not in Woven): offered, and \"use Siobhan O'Callaghan\" makes the card READY",
    "exit form for Siobhan O'Callaghan, she gave notice 9/25/26 and her last day was 10/9/26, resigning to pursue other career options",
    "Siobhan O'Callaghan",
  ),
  offeredThenReady(
    "nov6-offer-mixed-case-surname",
    "\"ca for Ruairi McAllister, …\" (not in Woven): offered, and \"use Ruairi McAllister\" makes the card READY",
    "ca for Ruairi McAllister, he was late opening the salon on 11/2",
    "Ruairi McAllister",
  ),
  offeredThenReady(
    "nov6-offer-employee-comma-place",
    "\"i have an employee, Zebulon Marchbanks that needs a corrective action form …\" (not in Woven): offered, then READY (the sibling app's gate rerun 3)",
    "i have an employee, Zebulon Marchbanks that needs a corrective action form with a customer complaint",
    "Zebulon Marchbanks",
  ),
  neverOfferedBesideTwo(
    "nov6-offer-never-a-shared-word-near-miss",
    "two roster people share the surname word (Odalys Prewett Vansickle, Odalys Dunmore Vansickle): \"create a ca form for Odalys Vansikcle\" is never offered as a name not in Woven",
    "create a ca form for Odalys Vansikcle",
    "Odalys Vansikcle",
    ["Odalys", "Prewett Vansickle"],
    ["Odalys", "Dunmore Vansickle"],
  ),
  neverOfferedBesideTwo(
    "nov6-offer-never-a-distance-two-near-miss",
    "two roster people two edits apart (Prewett Vansickle, Prewett Vancsikle): \"create a ca form for Odalys Prewett Vanscikle\" is never offered as a name not in Woven",
    "create a ca form for Odalys Prewett Vanscikle",
    "Odalys Prewett Vanscikle",
    ["Odalys", "Prewett Vansickle"],
    ["Odalys", "Prewett Vancsikle"],
  ),
];
