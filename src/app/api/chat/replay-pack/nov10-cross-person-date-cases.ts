import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * A NEW EMPLOYEE'S CARD NEVER KEEPS THE PREVIOUS PERSON'S DATE (#236, rebuilt 10 Nov 2026)
 * ============================================================================
 *
 * conv_mvoetxo92fraflz (25 Oct 2026; ask-sunny#236, never merged): turn 1 "create a coaching document for <A>
 * regarding On 10-16-26 …", turn 3 "create a coaching document for <B>". The October triage
 * (docs/parity-log/oct-pr-triage.md, 10 Nov 2026) found, with production's flags: <B>'s card has no Observation
 * (fixed), but its formDate is 2026-10-16 and "**Date:** 10/16/2026" is carried over from <A>.
 *
 * The chat word for word; every person is invented (Marla Quince is <A>, Tobin Ashgrove the new hire in her
 * incident, Petra Linwood is <B>), as in #236's own test.
 */
const person = (id: string, firstName: string, lastName: string): DirectoryRow => ({
  id,
  firstName,
  lastName,
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Salon Manager",
});
const MARLA = person("e-xperson-marla-quince", "Marla", "Quince");
const PETRA = person("e-xperson-petra-linwood", "Petra", "Linwood");
const TOBIN = person("e-xperson-tobin-ashgrove", "Tobin", "Ashgrove");

const TURN_1 =
  "create a coaching document for Marla Quince regarding On 10-16-26 the Woven policy acknowledgement report reflected that Tobin Ashgrove did not complete required policy acknowledgements during her onboarding on 9-28-26. Marla is responsible for making sure all new hires complete required policy acknowledgements during onboarding.";
const TURN_2 = "coaching form for Marla Quince";
const TURN_3 = "create a coaching document for Petra Linwood";

const REPORT = 'conv_mvoetxo92fraflz (25 Oct 2026, #236; the October triage, 10 Nov 2026, still failing with production\'s flags): "create a coaching document for <B>" after <A>\'s coaching card dated 10-16-26';
const OPEN = "<B>'s card is dated 10/16/2026, <A>'s incident date";

const cardDate = (thread: { proposal: unknown }) => (thread.proposal as { formDate?: string | null } | null)?.formDate ?? null;

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-10-21T15:00:00Z"));
  t.directory([...STAFF, MARLA, PETRA, TOBIN]);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

const casings = (s: string) =>
  [
    ["lower", s.toLowerCase()],
    ["sentence", s],
    ["caps", s.toUpperCase()],
  ] as const;

export const NOV10_CROSS_PERSON_DATE_CASES: ReplayCase[] = casings(TURN_3).map(([casing, turn3]) => ({
  id: `nov10-cross-person-date-${casing}`,
  title: `after Marla Quince's coaching card (10-16-26), "${turn3}" — Petra Linwood's card carries no date of Marla's`,
  report: `${REPORT}; ${casing}`,
  status: { open: OPEN },
  fixFlags: ["CROSS_PERSON_OWN_TURNS_ENABLED"],
  async run(t) {
    const thread = start(t);
    await thread.say(TURN_1);
    expect(thread.proposal, "turn 1 made no coaching card for Marla").toMatchObject({ templateKey: "coaching", employeeName: "Marla Quince" });
    await thread.say(TURN_2);
    const reply = await thread.say(turn3);
    expect(thread.proposal, `no card for Petra:\n${reply.content}`).toMatchObject({ employeeName: "Petra Linwood" });
    expect(cardDate(thread), `Petra's card is dated with Marla's incident:\n${reply.content}`).not.toBe("2026-10-16");
    expect(reply.content, "Marla's date is on Petra's card").not.toMatch(/10\/16\/2026|october 16/i);
    expect(reply.content, "Petra is asked which of Marla's dates goes on her form").not.toMatch(/which date goes on the form|\b10\/16\b|\b9\/28\b/i);
    expect(reply.content, "Marla's incident is on Petra's card").not.toMatch(/tobin ashgrove|policy acknowledgement/i);
  },
}));
