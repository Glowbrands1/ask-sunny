import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * P12, PART 2 (QA, 10 Nov 2026; the live chat of 7 Nov): THE SAME REQUEST FOR A SECOND PERSON NEVER MIXES IN THE FIRST
 * ============================================================================
 *
 * "make me a coaching form for <A> not hitting October numbers" → Create → the same words for <B>: the second reply
 * mixed in the first person ("<A> for not hitting her numbers… <B> for not hitting her numbers…"). The managers' words
 * are verbatim; both people are invented (Brisa Talvenor, Odette Quillane).
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
const BRISA = person("e-brisa-talvenor-2", "Brisa", "Talvenor");
const ODETTE = person("e-odette-quillane", "Odette", "Quillane");

/** The invented people of this file (a function: the registry reads exported arrays as cases). */
export function p12SecondPersonPeople(): readonly DirectoryRow[] {
  return [BRISA, ODETTE];
}

const ASK = (name: string) => `make me a coaching form for ${name} not hitting October numbers`;
const REPORT = "QA, 10 Nov 2026 (P12 part 2; the live chat of 7 Nov 2026): the same request made for a second person mixed in the first";

/** The answering model's reply shape from the report (QA): both people, the first one first. */
const BOTH = "I can start a coaching form for Brisa Talvenor for not hitting her numbers in October, and one for Odette Quillane for not hitting her numbers in October. Odette's is below.";

export const NOV10_P12_SECOND_PERSON_CASES: ReplayCase[] = [
  ...([false, true] as const).map((scripted): ReplayCase => ({
    id: `nov10-p12-second-person-never-mixes-in-the-first${scripted ? "-model-names-both" : ""}`,
    title: `P12 part 2${scripted ? " (the answering model names both, as live)" : ""}: "${ASK("<A>")}" → Create → "${ASK("<B>")}": B's reply and B's saved Details never mention A`,
    report: REPORT,
    status: "fixed",
    async run(t: T) {
      vi.setSystemTime(new Date("2026-11-10T15:30:00Z"));
      t.directory([...STAFF, BRISA, ODETTE]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say(ASK("Brisa Talvenor"));
      expect(thread.proposal, "no Coaching card for Brisa").toMatchObject({ templateKey: "coaching", employeeName: "Brisa Talvenor" });
      const brisa = await thread.create();
      if (scripted) t.modelSays(BOTH);
      const reply = await thread.say(ASK("Odette Quillane"));
      t.modelSays(null);
      expect(reply.formProposal, `no Coaching card for Odette:\n${reply.content}`).toMatchObject({ templateKey: "coaching", employeeName: "Odette Quillane" });
      expect(reply.content, `Brisa is in Odette's reply:\n${reply.content}`).not.toMatch(/brisa|talvenor/i);
      const odette = await thread.create();
      expect(odette, "Odette's card reopened Brisa's form").not.toBe(brisa);
      const saved = JSON.stringify(t.values(odette));
      expect(saved, `Brisa is on Odette's saved form:\n${saved}`).not.toMatch(/brisa|talvenor/i);
      expect(t.draftPrompts().at(-1) ?? "", "Brisa's turn was handed to Odette's drafting model").not.toMatch(/brisa|talvenor/i);
    },
  })),
];
