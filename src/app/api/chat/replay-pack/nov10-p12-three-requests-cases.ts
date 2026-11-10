import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayAnswer, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * P12, PART 2 — THE LIVE SHAPE (QA, 10 Nov 2026; Sunny production, 6 Nov 18:01Z)
 * ============================================================================
 *
 * Three requests back to back in one chat, no Create between, each for another person:
 *   "Can you create me a coaching document for <A> for not hitting her numbers for the month of October. Please word it
 *    in a professional way. I need the policy attached as well." — then the same text for <B>, then for <C>.
 * Two bugs, both on the CARD's Observation and so on the draft:
 *   (a) <B>'s Observation carried <A>'s request ("<A> for not hitting her numbers … <B> for not hitting …");
 *   (b) every Observation kept the manager's instructions to the app ("Please word it in a professional way. I need the
 *       policy attached as well.").
 * The manager's words are verbatim; the people are invented (Brisa Talvenor, Odette Quillane, Liesl Varnham).
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
const PEOPLE = [person("e-p12-brisa", "Brisa", "Talvenor"), person("e-p12-odette", "Odette", "Quillane"), person("e-p12-liesl", "Liesl", "Varnham")];
const NAMES = PEOPLE.map((p) => `${p.firstName} ${p.lastName}`);

/** The invented people of this file (a function: the registry reads exported arrays as cases). */
export function p12ThreeRequestsPeople(): readonly DirectoryRow[] {
  return PEOPLE;
}

const ASK = (name: string) =>
  `Can you create me a coaching document for ${name} for not hitting her numbers for the month of October. Please word it in a professional way. I need the policy attached as well.`;
const INSTRUCTIONS = /word it in a professional way|policy attached/i;
const REPORT = "QA, 10 Nov 2026 (P12 part 2; Sunny production, 6 Nov 18:01Z): three requests back to back; (a) B's Observation carried A's request, (b) every Observation kept the manager's instructions";
export const P12_THREE_FIX = "APP_INSTRUCTIONS_NOT_ACCOUNT_ENABLED";

const observationLine = (reply: ReplayAnswer) => reply.content.split("\n").find((line) => /\*\*Observation of Offense:\*\*/.test(line)) ?? "";

function others(index: number): RegExp {
  const words = NAMES.filter((_n, i) => i !== index).flatMap((name) => name.split(" "));
  return new RegExp(`\\b(?:${words.join("|")})\\b`, "i");
}

export const NOV10_P12_THREE_REQUESTS_CASES: ReplayCase[] = [0, 1, 2].map(
  (index): ReplayCase => ({
    id: `nov10-p12-three-requests-t${index + 1}`,
    title: `P12 part 2, T${index + 1} of three back-to-back requests: ${NAMES[index]}'s card and saved Details are her own account only, without the instructions to the app`,
    report: REPORT,
    status: { open: index === 1 ? "T2's Observation carries T1's request and the instructions" : "the Observation keeps \"Please word it in a professional way. I need the policy attached as well.\"" },
    fixFlags: [P12_THREE_FIX],
    async run(t: T) {
      vi.setSystemTime(new Date("2026-11-06T18:01:00Z"));
      t.directory([...STAFF, ...PEOPLE]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      let reply: ReplayAnswer | null = null;
      for (let turn = 0; turn <= index; turn += 1) reply = await thread.say(ASK(NAMES[turn]!));
      expect(thread.proposal, `no Coaching card for ${NAMES[index]}:\n${reply!.content}`).toMatchObject({ templateKey: "coaching", employeeName: NAMES[index] });
      const observed = observationLine(reply!);
      expect(observed, `the card's Observation names somebody else:\n${observed}`).not.toMatch(others(index));
      expect(observed, `the card's Observation keeps the instructions to the app:\n${observed}`).not.toMatch(INSTRUCTIONS);
      expect(observed, `the card's Observation lost the account:\n${observed}`).toMatch(/not hitting her numbers/i);
      const id = await thread.create();
      const saved = t.values(id).coaching_details ?? "";
      expect(saved, `the saved Details name somebody else:\n${saved}`).not.toMatch(others(index));
      expect(saved, `the saved Details keep the instructions to the app:\n${saved}`).not.toMatch(INSTRUCTIONS);
      const described = (t.draftPrompts().at(-1) ?? "").split("WHAT THE MANAGER DESCRIBED:")[1] ?? "";
      expect(described, "another person's request was handed to the drafting model").not.toMatch(others(index));
      expect(described, "the instructions to the app were handed to the drafting model as the account").not.toMatch(INSTRUCTIONS);
    },
  }),
);
