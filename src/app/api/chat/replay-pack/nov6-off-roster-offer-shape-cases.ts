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
];
