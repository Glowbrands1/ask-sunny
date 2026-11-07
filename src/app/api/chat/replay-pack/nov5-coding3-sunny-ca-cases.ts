import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayAnswer, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * CODING-3 OPEN CASES (Ask Sunny production, relayed by QA, 5 Nov 2026):
 * TWO CORRECTIVE ACTION CARD NOTES
 * ============================================================================
 *
 * Cases only: OPEN with today's production flags, no fixFlags until a fix
 * exists. The manager's turns are verbatim; every person is invented and on
 * this file's own fixture only. The manager is the actor.
 *
 *   prior coaching  "I need to write up <name> with a written warning for
 *                   leaving the front desk unattended for 30 minutes on
 *                   10/22. There's no prior coaching on file." → the card
 *                   said "Prior coaching note: prior coaching on file. No
 *                   finalized record was required." The reason QA keeps
 *                   PRIOR_COACHING_OPTIONAL_ENABLED off. Expected: the note
 *                   never says prior coaching is on file when she said there
 *                   is none. (`typedPriorCoachingNote`,
 *                   ai/prior-coaching-optional.ts, takes the words after
 *                   "prior coaching" and drops the "no" in front of them.)
 *   performance     "can you write me a Ca for <name> for performance for
 *                   october" → "You haven't told me what happened yet".
 *                   Expected, with CA_SALES_POLICY_ENABLED on: a CA for
 *                   performance is the sales-performance account; the card
 *                   cites the Standards of Conduct and does not ask what
 *                   happened. (Neither `statesMetricShortfall` — a metric
 *                   named AND judged — nor the Under Performance name reads
 *                   the bare "performance", and one leftover word is not
 *                   `describesMoreThanTheRequest`'s three.)
 *
 * "Change <name> CA" in a new chat (a new form, not the CA on file) is
 * already nov5-sf-s26-change-ca-new-chat (nov5-pau-sf-s26-s28-cases.ts); not
 * repeated here.
 */

type T = ReplayContext;

const SALON = "loc-0309";
const person = (id: string, firstName: string, lastName: string): DirectoryRow => ({
  id,
  firstName,
  lastName,
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: [SALON],
  positionName: "Tanning Consultant",
});

const ODESSA = person("e-odessa-quarrington", "Odessa", "Quarrington");
const LINNEA = person("e-linnea-thistlewood", "Linnea", "Thistlewood");
const PEOPLE: readonly DirectoryRow[] = [ODESSA, LINNEA];

/** The invented people of this file (a function: the registry reads exported arrays as cases). */
export function coding3SunnyCaPeople(): readonly DirectoryRow[] {
  return PEOPLE;
}

const REPORT = "QA, 5 Nov 2026 (Ask Sunny production, coding-3 open items)";
const NO_ACCOUNT = /haven'?t told me what happened/i;

function start(t: T) {
  vi.setSystemTime(new Date("2026-11-05T15:00:00Z"));
  t.directory([...STAFF, ...PEOPLE]);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

function policyLine(reply: ReplayAnswer): string {
  return reply.content.split("\n").find((line) => /\*\*Policy:?\*\*/i.test(line)) ?? "";
}

/** A line of the reply that says prior coaching is on file. */
function saysPriorCoachingOnFile(reply: ReplayAnswer): string[] {
  return reply.content
    .split("\n")
    .filter((line) => /prior coaching/i.test(line) && /\bon file\b/i.test(line) && !/\bno prior coaching\b|\bnot on file\b|\bnone\b/i.test(line));
}

export const NOV5_CODING3_SUNNY_CA_CASES: ReplayCase[] = [
  {
    id: "nov5-coding3-prior-coaching-none-on-file",
    title: "\"… There's no prior coaching on file.\": the card's prior-coaching note never says prior coaching is on file",
    report: `${REPORT}: "I need to write up <name> with a written warning … There's no prior coaching on file." → "Prior coaching note: prior coaching on file. No finalized record was required."`,
    status: { open: "the note quotes \"prior coaching on file\" without the manager's \"no\": \"Prior coaching note: prior coaching on file.\"" },
    async run(t: T) {
      /*
       * PRIOR_COACHING_OPTIONAL_ENABLED writes the note this case reports. QA
       * keeps it off in production because of this bug; production-flags.json
       * lists it under assumedOn (the earlier decrypted reading). On here
       * whatever that file says, so the case reads the path the report took.
       */
      vi.stubEnv("PRIOR_COACHING_OPTIONAL_ENABLED", "true");
      try {
        const thread = start(t);
        const reply = await thread.say(
          "I need to write up Odessa Quarrington with a written warning for leaving the front desk unattended for 30 minutes on 10/22. There's no prior coaching on file.",
        );
        expect(thread.proposal, `no Corrective Action card for Odessa Quarrington:\n${reply.content}`).toMatchObject({ templateKey: "dpoa", employeeName: "Odessa Quarrington" });
        expect(saysPriorCoachingOnFile(reply), `says prior coaching is on file although the manager said there is none:\n${reply.content}`).toEqual([]);
      } finally {
        vi.unstubAllEnvs();
      }
    },
  },
  {
    id: "nov5-coding3-ca-for-performance-is-an-account",
    title: "\"can you write me a Ca for <name> for performance for october\": with CA_SALES_POLICY_ENABLED the card cites the Standards of Conduct; never \"You haven't told me what happened yet\"",
    report: `${REPORT}: "can you write me a Ca for <name> for performance for october" → "You haven't told me what happened yet"`,
    status: { open: "\"for performance\" is no account and no sales reading: \"You haven't told me what happened yet\", no policy cited" },
    // CA_PERFORMANCE_REASON_ENABLED (default off, not in production): "for performance" in the sentence that asks for the form is the sales reading (`withSalesPolicy`, ca-policy.ts).
    fixFlags: ["CA_SALES_POLICY_ENABLED", "CA_PERFORMANCE_REASON_ENABLED"],
    async run(t: T) {
      /*
       * CA_ASKS_WHAT_HAPPENED_ENABLED is on in production (QA, 5 Nov 2026; as
       * nov5-sf-s28 records). The note this case reports is written by the
       * card itself (`awaitingIncident`, the same `describesIncident` reading)
       * with or without it; recorded 5 Nov 2026. CA_SALES_POLICY_ENABLED is not in production-flags.json (off); the
       * report is what it must do once on, so both are on inside the case, as
       * nov5-r3's cases turn on the flip they test.
       */
      vi.stubEnv("CA_ASKS_WHAT_HAPPENED_ENABLED", "true");
      vi.stubEnv("CA_SALES_POLICY_ENABLED", "true");
      try {
        const thread = start(t);
        const reply = await thread.say("can you write me a Ca for Linnea Thistlewood for performance for october");
        expect(thread.proposal, `no Corrective Action card for Linnea Thistlewood:\n${reply.content}`).toMatchObject({ templateKey: "dpoa", employeeName: "Linnea Thistlewood" });
        expect(reply.content, `asks what happened although the reason (performance) was given:\n${reply.content}`).not.toMatch(NO_ACCOUNT);
        expect(policyLine(reply), `the card does not cite Standards of Conduct:\n${reply.content}`).toMatch(/standards of conduct/i);
      } finally {
        vi.unstubAllEnvs();
      }
    },
  },
];
