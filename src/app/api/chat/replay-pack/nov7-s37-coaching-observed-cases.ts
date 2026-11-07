import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayAnswer, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * sf-s37: THREE COACHING FORMS LOST THEIR OBSERVATION; ONE MIXED IN ANOTHER EMPLOYEE (Pau's scan, 7 Nov 2026)
 * ============================================================================
 *
 * A Salon Director, live on 6 Nov 2026, word for word (people invented), sent three requests in one chat:
 * "Can you create me a coaching document for <name> for not hitting her numbers for the month of October. Please
 * word it in a professional way. I need the policy attached as well." The second employee was typed by a short
 * first name ("Tilly" for the roster's Ottilie).
 *
 *   (a) Every saved Coaching Form lost its "Observed:" section, and the Underperformance tick, which the manager
 *       had to tick again: the coaching framing guard (`forms/coaching-framing.ts`) did not read "not hitting her
 *       numbers" as a shortfall, so it struck every "did not meet …" sentence and the label left empty.
 *       COACHING_OBSERVED_KEPT_ENABLED.
 *   (b) The second card's Observation of Offense was "<first employee> for not hitting her numbers … <second
 *       employee> for not hitting her numbers …": a request opened with "Can you create me …" was not read as a new
 *       request, so the card read back every earlier turn. POLITE_REQUEST_OWN_TURNS_ENABLED.
 */

type T = ReplayContext;

const person = (id: string, firstName: string, lastName: string, preferredFirstName: string | null = null): DirectoryRow => ({
  id,
  firstName,
  lastName,
  preferredFirstName,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Tanning Consultant",
});

const PEOPLE: readonly DirectoryRow[] = [
  person("e-tamsin-holt", "Tamsin", "Holt"),
  person("e-ottilie-marsh", "Ottilie", "Marsh", "Tilly"),
  person("e-corwin-hale", "Corwin", "Hale"),
];

/** The invented people of this file (a function: the registry reads exported arrays as cases). */
export function s37People(): readonly DirectoryRow[] {
  return PEOPLE;
}

const REPORT = "Pau's morning scan, 7 Nov 2026 (sf-s37; live chat 6 Nov 2026, a Salon Director)";
const say = (name: string) =>
  `Can you create me a coaching document for ${name} for not hitting her numbers for the month of October. Please word it in a professional way. I need the policy attached as well.`;
const TYPED = ["Tamsin Holt", "Tilly Marsh", "Corwin Hale"] as const;

function start(t: T) {
  vi.setSystemTime(new Date("2026-11-06T18:00:00Z"));
  t.directory([...STAFF, ...PEOPLE]);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

const observation = (reply: ReplayAnswer) => reply.content.split("\n").find((line) => /\*\*Observation of Offense:\*\*/.test(line)) ?? "";

export const NOV7_S37_COACHING_OBSERVED_CASES: ReplayCase[] = [
  {
    id: "nov7-s37-observed-kept",
    title: "sf-s37 (a): a Coaching Form for \"not hitting her numbers\" keeps its Observed section and the Underperformance tick",
    report: `${REPORT}: the saved coaching_details had no "Observed:"`,
    // Changed on purpose (7 Nov 2026): QA's flip 7 (21:29 PHT) turned this case's flags on in production (production-flags.json); it now holds with production's flags.
    status: "fixed",
    fixFlags: ["COACHING_OBSERVED_KEPT_ENABLED"],
    async run(t) {
      const thread = start(t);
      await thread.say(say("Tamsin Holt"));
      expect(thread.proposal, "no Coaching card for Tamsin Holt").toMatchObject({ templateKey: "coaching", employeeName: "Tamsin Holt" });
      t.draftWrites(
        { coaching_details: "Observed:\nTamsin did not meet her sales numbers for the month of October.\n\nExpectation:\nTamsin is expected to meet assigned monthly sales targets." },
        { coaching_type: ["underperformance"] },
      );
      const id = await thread.create();
      expect(t.values(id).coaching_details ?? "", "the saved Coaching Form has no Observed section").toMatch(/^Observed:\nTamsin did not meet\b/);
      expect(t.checked(id).coaching_type ?? [], "Underperformance was unticked").toContain("underperformance");
    },
  },
  {
    id: "nov7-s37-own-request-turns",
    title: "sf-s37 (b): three \"Can you create me a coaching document for <name> …\" requests: each card's Observation names only its own request",
    report: `${REPORT}: the second card read back the first employee's request`,
    // Changed on purpose (7 Nov 2026): QA's flip 7 (21:29 PHT) turned this case's flags on in production (production-flags.json); it now holds with production's flags.
    status: "fixed",
    fixFlags: ["POLITE_REQUEST_OWN_TURNS_ENABLED"],
    async run(t) {
      const thread = start(t);
      for (const [index, typed] of TYPED.entries()) {
        const reply = await thread.say(say(typed));
        const line = observation(reply);
        for (const other of TYPED.filter((_, at) => at !== index)) {
          const first = other.split(" ")[0]!;
          expect(line, `card ${index + 1} (${typed}) reads back ${other}'s request:\n${reply.content}`).not.toMatch(new RegExp(`\\b${first}\\b`));
        }
        // The drafting model writes what it wrote live: an Observed section and the Underperformance tick.
        const first = typed.split(" ")[0]!;
        t.draftWrites(
          { coaching_details: `Observed:\n${first} did not meet her sales numbers for the month of October.\n\nExpectation:\n${first} is expected to meet assigned monthly sales targets.` },
          { coaching_type: ["underperformance"] },
        );
        await thread.create();
      }
    },
  },
];
