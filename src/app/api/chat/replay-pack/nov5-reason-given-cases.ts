import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * A REASON GIVEN IS NEVER ASKED FOR AGAIN (QA, this app's production with
 * CA_SALES_POLICY_ENABLED and FORM_NAME_FROM_ROSTER_ENABLED on, 4 Nov 2026)
 * ============================================================================
 *
 * Eight managers' requests made the Corrective Action card and then said "You
 * haven't told me what happened yet", although each gives the reason: Woven
 * courses past the deadline, metrics, sales, MSB. Pau's pass criterion: never
 * "what happened" when a reason is given. QA's exact wording (typos, casing,
 * line breaks); every person is invented and on this file's own fixture.
 */

type T = ReplayContext;

const person = (id: string, firstName: string, lastName: string): DirectoryRow => ({
  id,
  firstName,
  lastName,
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Tanning Consultant",
});

const PEOPLE: readonly DirectoryRow[] = [
  person("e-wrenna-halvik", "Wrenna", "Halvik"),
  person("e-brielle-oakhurst", "Brielle", "Oakhurst"),
  person("e-ondine-marsk", "Ondine", "Marsk"),
  person("e-talise-vorn", "Talise", "Vorn"),
];

/** The invented people of this file (a function: the registry reads exported arrays as cases). */
export function reasonGivenPeople(): readonly DirectoryRow[] {
  return PEOPLE;
}

const FLAGS = ["CA_SALES_POLICY_ENABLED", "FORM_NAME_FROM_ROSTER_ENABLED", "CA_ASKS_WHAT_HAPPENED_ENABLED"];
const REPORT = "QA, this app's production (CA_SALES + FORM_NAME on), 4 Nov 2026: a reason given, then \"You haven't told me what happened yet\"";
const ASKS_WHAT_HAPPENED = /haven'?t told me what happened|what happened\?|tell me what happened/i;

const MESSAGES: readonly { readonly n: number; readonly say: string; readonly name: string }[] = [
  { n: 1, say: "put together a written CA for Wrenna Halvik for not compelting her woven courses by the deadline of october 31st", name: "Wrenna Halvik" },
  { n: 2, say: "create a corrective action for Wrenna Halvik for not completing her woven courses by the deadline of october 31st", name: "Wrenna Halvik" },
  { n: 3, say: "Write a corrective action form for tanning consultant Brielle Oakhurst for not meeting company performance standards in PPTA LPSVA club average spa and club close", name: "Brielle Oakhurst" },
  { n: 4, say: "create a verbal ca for tanning consultant ondine marsk at liberty. ondine did not follow must see behaviors for october 2026 which violates standards of conduct policy", name: "Ondine Marsk" },
  { n: 5, say: "I need a Corrective Action for Brielle Oakhurst. Not meeting sales requirements.", name: "Brielle Oakhurst" },
  { n: 6, say: "I need a verbal corrective action made for Brielle Oakhurst. Not meeting sales requirements for the month of October", name: "Brielle Oakhurst" },
  { n: 7, say: "I need a verbal corrective action for brielle oakhurst not meeting msb for the month of october.", name: "Brielle Oakhurst" },
  { n: 8, say: "Can you write me a performace ca for an employee who did not meet their numbers for the month of october Talise Vorn  - verbal\n146 tans \nBelow in PPTA, LPSVA, Average Club, CC%, Spa%", name: "Talise Vorn" },
  // QA's 2-week audit (5 Nov 2026; Pau: "yes, include #542/#543"): one of the 7 Sunny managers' requests that was asked "You haven't told me what happened" after the reason. The name is invented.
  { n: 9, say: "can you write me a Ca for Talise Vorn for performance for october", name: "Talise Vorn" },
];

/*
 * QA's 2-week audit wording #9, "can you write me a Ca for <name> for performance for october": with
 * production's flags AND with this branch's fix flags, the card says "You haven't told me what happened
 * yet". "for performance" alone is not read as an account (no negation, two words). Not fixed by this
 * branch; recorded OPEN for QA's call (5 Nov 2026). Its fix is CA_PERFORMANCE_REASON_ENABLED (coding-3
 * item 5): with it on as well, the fix-flag run holds; production lacks the flag, so it stays OPEN.
 */
const NOT_FIXED_9 = "\"for performance for october\" is not read as an account: the card says \"You haven't told me what happened yet\", with production's flags and with CA_SALES + FORM_NAME + CA_ASKS on";

/** Why #1, #2, #4–#7 and the live-models guard are OPEN in production (#555's flags correction). */
const CA_SALES_OFF = "production (#555, = Vercel): CA_SALES_POLICY_ENABLED and FORM_NAME_FROM_ROSTER_ENABLED off — no card, or \"You haven't told me what happened yet\" after the reason";

function start(t: T) {
  vi.setSystemTime(new Date("2026-11-04T23:30:00Z"));
  t.directory([...STAFF, ...PEOPLE]);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

export const NOV5_REASON_GIVEN_CASES: ReplayCase[] = [
  ...MESSAGES.map(({ n, say, name }) => ({
    id: `nov5-reason-given-${n}`,
    title: `${n}. "${say.split("\n")[0]!.slice(0, 70)}…": the card, and never "what happened"`,
    report: `${REPORT}, #${n}`,
    /*
     * src/config/production-flags.json (#555, = Vercel) lists CA_SALES_POLICY_ENABLED
     * and FORM_NAME_FROM_ROSTER_ENABLED as off; the fixFlags are production as QA
     * ran it on 4 Nov 2026. Without the fix, #1–#7 fail with them.
     */
    /*
     * Changed on purpose (5 Nov 2026, QA): #555 corrected production-flags.json to Vercel, where
     * CA_SALES_POLICY_ENABLED and FORM_NAME_FROM_ROSTER_ENABLED are OFF. With production's flags the
     * reason-given requests therefore get no card or the "what happened" question (#1, #2, #4–#7 had held
     * only while the file read them as on); they are OPEN in production and hold with the fix flags.
     */
    status:
      n === 3 || n === 8
        ? ({ open: "with production's flags as this file reads them (CA_SALES off) a metric-only request gets the progression's refusal, no card" } as const)
        : n === 9
          ? ({ open: NOT_FIXED_9 } as const)
          : ({ open: CA_SALES_OFF } as const),
    // #9 is fixed by CA_PERFORMANCE_REASON_ENABLED (default off, not in production): "for performance" in the request is the sales reading (`withSalesPolicy`, forms/ca-policy.ts).
    fixFlags: n === 9 ? [...FLAGS, "CA_PERFORMANCE_REASON_ENABLED"] : FLAGS,
    async run(t: T) {
      const thread = start(t);
      const reply = await thread.say(say);
      expect(thread.proposal, `no Corrective Action card for ${name}:\n${reply.content}`).toMatchObject({ templateKey: "dpoa" });
      expect(reply.content, `asks what happened although the reason was given:\n${reply.content}`).not.toMatch(ASKS_WHAT_HAPPENED);
    },
  })),
  {
    id: "nov5-reason-given-live-models",
    title: "the live path (the reading models quote the name): \"I need a verbal corrective action made for <name>. Not meeting sales requirements for the month of October\": the card, and never \"what happened\"",
    report: `${REPORT}; QA's 2-week audit (5 Nov 2026), Maddie's complaint in production's wording, through the models-reading path as nov4-name-*-models`,
    /*
     * A GUARD, not the proof (5 Nov 2026): through this path the note does not appear on main
     * without this branch either, so it holds both ways; the code-only path (#6, the same wording
     * shape) is the one that fails on main and holds with the fix. QA's live run (the real model)
     * is the proof for the live path. Changed on purpose (5 Nov 2026): OPEN in production since #555
     * corrected production-flags.json (CA_SALES off); it holds with the fix flags.
     */
    status: { open: CA_SALES_OFF },
    fixFlags: FLAGS,
    async run(t) {
      const thread = start(t);
      const reply = await thread.say("I need a verbal corrective action made for Talise Vorn. Not meeting sales requirements for the month of October", { employeeName: "Talise Vorn" });
      expect(thread.proposal, `no Corrective Action card for Talise Vorn:\n${reply.content}`).toMatchObject({ templateKey: "dpoa" });
      expect(reply.content, `asks what happened although the reason was given:\n${reply.content}`).not.toMatch(ASKS_WHAT_HAPPENED);
    },
  },
  {
    id: "nov5-reason-given-negative-name-only",
    title: "negative control: \"create a corrective action for <name>\" with no reason still asks what happened",
    report: `${REPORT}, negative control`,
    status: "fixed",
    fixFlags: FLAGS,
    async run(t) {
      const thread = start(t);
      const reply = await thread.say("create a corrective action for Wrenna Halvik");
      expect(reply.content, `no question for what happened:\n${reply.content}`).toMatch(/what happened|\?/i);
    },
  },
];
