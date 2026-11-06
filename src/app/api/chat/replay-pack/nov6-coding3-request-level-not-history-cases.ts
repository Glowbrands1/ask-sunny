import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayAnswer, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * CODING-3 ITEM 6 (QA, 6 Nov 2026): THE LEVEL ASKED FOR IS NOT AN EARLIER
 * WARNING
 * ============================================================================
 *
 * Found in the sibling app: the manager wrote "I need to write up <name>
 * with a written warning for leaving the front desk unattended for 30
 * minutes on 10/22. There's no prior coaching on file." and the reply said
 * "I've treated the earlier warning you mentioned as previous corrective
 * action history — it doesn't decide this one. Is this new corrective action
 * a Verbal Warning or a Written Warning?" There, the warning-level reader
 * read the level through the date after it, and the incident's date (before
 * today) made the level asked for history.
 *
 * Here, replayed with production's flags on 6 Nov 2026, the same wording
 * holds: this app's `forms/warning-level.ts` reads "written warning" as this
 * form's level unless a history cue (a verb of something received, a
 * history label or heading) comes with the date, and it writes no
 * earlier-warning line. So the two request cases are guards ("fixed"), and
 * the third keeps a dated warning in a clause of its own as history. No flag
 * here (QA, 6 Nov 2026: a flag that changes nothing confuses the gate); see
 * docs/parity-log/2026-11-06-request-level-not-history.md.
 *
 * The manager's turns are verbatim; every person is invented and on this
 * file's own fixture only. The manager is the actor.
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

const MARISOL = person("e-marisol-pendergrast", "Marisol", "Pendergrast");
const TAMSIN = person("e-tamsin-okafor", "Tamsin", "Okafor");
const BRIELLE = person("e-brielle-hartsough", "Brielle", "Hartsough");
const PEOPLE: readonly DirectoryRow[] = [MARISOL, TAMSIN, BRIELLE];

/** The invented people of this file (a function: the registry reads exported arrays as cases). */
export function requestLevelNotHistoryPeople(): readonly DirectoryRow[] {
  return PEOPLE;
}

const REPORT = "QA, 6 Nov 2026 (coding-3 item 6, found in the sibling app)";

/** The line that calls a warning in the turn earlier corrective action history. */
const EARLIER_WARNING = /earlier warning|previous corrective action history/i;
/** The question that asks the level. */
const ASKS_LEVEL = /verbal warning\W*\s+or\s+(?:an?\s+)?\W*written warning/i;

function start(t: T) {
  // 6 Nov 2026: the incident (10/22) is before today, as in the report.
  vi.setSystemTime(new Date("2026-11-06T15:00:00Z"));
  t.directory([...STAFF, ...PEOPLE]);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

function warningLevel(card: ReplayAnswer["formProposal"] | null | undefined): string | null {
  return (card as { warningLevel?: string | null } | null | undefined)?.warningLevel ?? null;
}

/** The reply's "Prior actions" line. */
function priorActions(reply: ReplayAnswer): string {
  return reply.content.split("\n").find((line) => /\*\*Prior actions:?\*\*/i.test(line)) ?? "";
}

export const NOV6_CODING3_REQUEST_LEVEL_NOT_HISTORY_CASES: ReplayCase[] = [
  {
    id: "nov6-coding3-request-level-not-history-write-up-with",
    title: "\"I need to write up <name> with a written warning for … on 10/22\": the card is a Written Warning; no \"earlier warning\" line, no level question",
    report: `${REPORT}: "I need to write up <name> with a written warning for leaving the front desk unattended for 30 minutes on 10/22. There's no prior coaching on file." → "I've treated the earlier warning you mentioned as previous corrective action history — it doesn't decide this one. Is this new corrective action a Verbal Warning or a Written Warning?"`,
    // A guard here: this app's reader never made a dated level history (replayed 6 Nov 2026, production's flags).
    status: "fixed",
    async run(t: T) {
      const thread = start(t);
      const reply = await thread.say(
        "I need to write up Marisol Pendergrast with a written warning for leaving the front desk unattended for 30 minutes on 10/22. There's no prior coaching on file.",
      );
      expect(thread.proposal, `no Corrective Action card for Marisol Pendergrast:\n${reply.content}`).toMatchObject({ templateKey: "dpoa", employeeName: "Marisol Pendergrast" });
      expect(reply.content, `calls the warning asked for an earlier warning:\n${reply.content}`).not.toMatch(EARLIER_WARNING);
      expect(reply.content, `asks the level although a written warning was asked for:\n${reply.content}`).not.toMatch(ASKS_LEVEL);
      expect(warningLevel(thread.proposal), `the card is not the Written Warning asked for:\n${reply.content}`).toBe("written");
    },
  },
  {
    id: "nov6-coding3-request-level-not-history-give-a",
    title: "\"give <name> a written warning for being late on 10/22\": the card is a Written Warning; no \"earlier warning\" line, no level question",
    report: `${REPORT}: a variant of item 6, "give <name> a written warning for being late on 10/22"`,
    status: "fixed",
    async run(t: T) {
      const thread = start(t);
      const reply = await thread.say("give Tamsin Okafor a written warning for being late on 10/22");
      expect(thread.proposal, `no Corrective Action card for Tamsin Okafor:\n${reply.content}`).toMatchObject({ templateKey: "dpoa", employeeName: "Tamsin Okafor" });
      expect(reply.content, `calls the warning asked for an earlier warning:\n${reply.content}`).not.toMatch(EARLIER_WARNING);
      expect(reply.content, `asks the level although a written warning was asked for:\n${reply.content}`).not.toMatch(ASKS_LEVEL);
      expect(warningLevel(thread.proposal), `the card is not the Written Warning asked for:\n${reply.content}`).toBe("written");
    },
  },
  {
    id: "nov6-coding3-request-level-not-history-dated-warning-stays-history",
    title: "\"<name> got a written warning on 9/1 and now she was late again on 10/22, write her up\": the 9/1 warning stays history, with and without the fix",
    report: `${REPORT}: the guard beside item 6 — a warning in its own dated clause is history`,
    status: "fixed",
    async run(t: T) {
      const thread = start(t);
      const reply = await thread.say("Brielle Hartsough got a written warning on 9/1 and now she was late again on 10/22, write her up");
      expect(thread.proposal, `no Corrective Action card for Brielle Hartsough:\n${reply.content}`).toMatchObject({ templateKey: "dpoa", employeeName: "Brielle Hartsough" });
      expect(warningLevel(thread.proposal), `the 9/1 warning was read as this form's level:\n${reply.content}`).toBeNull();
      // This app's reply asks the level only once the draft is made; the card leaves it empty.
      expect(priorActions(reply), `the 9/1 warning is not on the Prior actions line:\n${reply.content}`).toMatch(/09\/01/);
    },
  },
];
