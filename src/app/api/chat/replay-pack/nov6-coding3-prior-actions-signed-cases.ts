import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * PRIOR ACTIONS NEVER SAY "SIGNED" UNLESS SOMEBODY SAID SO (QA, a location
 * manager's chat in the sibling app, 5 Nov 2026; the same code is here)
 * ============================================================================
 *
 * The manager wrote "this is a verbal warning. previous coaching policy manual
 * 10-15-26". The new Corrective Action draft's Prior actions said the earlier
 * steps were SIGNED; none was ever signed or given. Rule (Pau / QA): list only
 * FINALIZED forms, and never say "signed" unless the record or the manager
 * says so.
 *
 * Root cause: the drafting prompt told the model to write every line as
 * "<what it was> — signed <MM/DD/YYYY>", and `groundPriorActions` kept the
 * model's line over the manager's own (same date). The code's own line
 * (`priorActionLine`) also always wrote "— signed <date>".
 *
 * The drafting model is scripted as production's writes it:
 * "Coaching — JBA Policy Manual — signed 10/15/2026". On file for the
 * employee: one FINALIZED Coaching Form (09/02/2026) and one still a DRAFT
 * (10/01/2026). The saved list holds no "signed" the manager did not write and
 * lists only the finalized form.
 *
 * PRIOR_ACTIONS_PARSE_ENABLED is in this app's production-flags.json under
 * "on" (the sibling app lists it under "assumedOn"), so the pack runs with it
 * on. The fix holds with it off too: see the "parse off" case below. Every
 * person is invented.
 */

type T = ReplayContext;

const SALON = "loc-0309";
const ODALYS: DirectoryRow = {
  id: "e-odalys-penwarden",
  firstName: "Odalys",
  lastName: "Penwarden",
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: [SALON],
  positionName: "Tanning Consultant",
};
const NAME = "Odalys Penwarden";

/** The invented people of this file (a function: the registry reads exported arrays as cases). */
export function nov6PriorActionsSignedPeople(): readonly DirectoryRow[] {
  return [ODALYS];
}

const REPORT = "QA, a location manager's chat in the sibling app, 5 Nov 2026";
const SAID = "this is a verbal warning. previous coaching policy manual 10-15-26";
const FIX = "PRIOR_ACTIONS_NO_SIGNED_ENABLED";
/** As production's drafting model writes the line: "signed", which nobody said. */
const MODEL_LINE = "Coaching — JBA Policy Manual — signed 10/15/2026";

function start(t: T) {
  vi.setSystemTime(new Date("2026-11-05T15:00:00Z"));
  t.directory([...STAFF, ODALYS]);
  t.as("salon_director", KEARNEY);
}

/**
 * Her Coaching Form on file: made through the chat, then finalized (as the
 * Form Monitoring would hold it), and a copy of it still a draft. A draft is
 * not history.
 */
async function coachingOnFile(t: T): Promise<void> {
  const thread = t.thread();
  await thread.say(`create a coaching form for ${NAME}, she left the front desk unattended on 9/2/26`);
  expect(thread.proposal, "no Coaching card to put on file").toMatchObject({ templateKey: "coaching", employeeName: NAME });
  t.draftWrites({});
  const id = await thread.create();
  const rows = t.forms();
  const row = rows.find((entry) => entry.id === id)!;
  Object.assign(row, { status: "finalized", form_date: "2026-09-02" });
  rows.push({ ...row, id: `${id}-draft`, status: "draft", form_date: "2026-10-01", created_at: new Date().toISOString() });
}

/** The Corrective Action from the manager's words; the model writes `priorLine`. Its saved Prior actions. */
async function correctiveAction(t: T, said: string | readonly string[], priorLine: string): Promise<string> {
  const thread = t.thread();
  await thread.say(`I need a corrective action for ${NAME}, she left the front desk unattended again on 11/3/26`);
  for (const turn of typeof said === "string" ? [said] : said) await thread.say(turn);
  expect(thread.proposal, `no Corrective Action card for ${NAME}`).toMatchObject({ templateKey: "dpoa", employeeName: NAME });
  t.draftWrites({ prior_actions: priorLine });
  const id = await thread.create();
  return t.values(id).prior_actions ?? "";
}

/** Every line of the list that says "signed". */
function signedLines(prior: string): string[] {
  return prior.split("\n").filter((line) => /\bsigned\b/i.test(line));
}

export const NOV6_CODING3_PRIOR_ACTIONS_SIGNED_CASES: ReplayCase[] = [
  {
    id: "nov6-coding3-prior-actions-never-signed-unsaid",
    title: "\"this is a verbal warning. previous coaching policy manual 10-15-26\": Prior actions never say \"signed\", and list only the finalized form on file",
    report: `${REPORT}: "${SAID}" → the new Corrective Action's Prior actions said the steps were signed; they were never signed or given`,
    status: { open: "the drafting prompt asks for \"— signed <date>\" and grounding keeps it; a form on file reads \"— signed <date>\" too" },
    fixFlags: [FIX],
    async run(t: T) {
      start(t);
      await coachingOnFile(t);
      const prior = await correctiveAction(t, SAID, MODEL_LINE);
      expect(signedLines(prior), `Prior actions say "signed", which nobody said:\n${prior}`).toEqual([]);
      expect(prior, `the manager's coaching of 10/15/2026 is not listed:\n${prior}`).toMatch(/coaching[^\n]*10\/15\/2026/i);
      expect(prior, `the finalized Coaching Form of 09/02/2026 is not listed:\n${prior}`).toMatch(/coaching[^\n]*09\/02\/2026/i);
      expect(prior, `the DRAFT Coaching Form of 10/01/2026 is listed:\n${prior}`).not.toMatch(/10\/01\/2026/);
    },
  },
  {
    id: "nov6-coding3-prior-actions-never-signed-unsaid-parse-off",
    title: "the same, with PRIOR_ACTIONS_PARSE_ENABLED off: no \"signed\" nobody said",
    report: `${REPORT}: "${SAID}" (PRIOR_ACTIONS_PARSE_ENABLED, on in production, turned off)`,
    status: { open: "the drafting prompt asks for \"— signed <date>\"; with PRIOR_ACTIONS_PARSE_ENABLED off the manager's own line says \"signed\" too" },
    fixFlags: [FIX],
    async run(t: T) {
      // PRIOR_ACTIONS_PARSE_ENABLED is on in production: the case checks the other side.
      vi.stubEnv("PRIOR_ACTIONS_PARSE_ENABLED", "");
      try {
        start(t);
        await coachingOnFile(t);
        const prior = await correctiveAction(t, SAID, MODEL_LINE);
        expect(signedLines(prior), `Prior actions say "signed", which nobody said:\n${prior}`).toEqual([]);
        expect(prior, `the finalized Coaching Form of 09/02/2026 is not listed:\n${prior}`).toMatch(/coaching[^\n]*09\/02\/2026/i);
        expect(prior, `the DRAFT Coaching Form of 10/01/2026 is listed:\n${prior}`).not.toMatch(/10\/01\/2026/);
      } finally {
        vi.unstubAllEnvs();
      }
    },
  },
  {
    id: "nov6-coding3-prior-actions-signed-when-said",
    title: "negative: \"verbal warning signed 9/1/26\" — the manager said signed, so \"signed\" stays",
    report: `${REPORT}: negative control`,
    status: "fixed",
    fixFlags: [FIX],
    async run(t: T) {
      start(t);
      const prior = await correctiveAction(t, "this is a written warning. verbal warning signed 9/1/26", "Verbal warning — signed 09/01/2026");
      expect(prior, `the verbal warning the manager said was signed lost "signed":\n${prior}`).toMatch(/verbal warning[^\n]*signed 09\/01\/2026/i);
    },
  },
  {
    id: "nov6-coding3-prior-actions-signed-policy-manual-kept",
    title: "\"<name> signed the jba policy manual on 10-15-26\": the manager said signed, so the 10/15/2026 line keeps \"signed\"; the form on file still reads \"finalized\"",
    report: `${REPORT} (QA follow-up, 6 Nov 2026): the manager's chat also said "<name> signed the jba policy manual on 10-15-26"`,
    status: "fixed",
    fixFlags: [FIX],
    async run(t: T) {
      start(t);
      await coachingOnFile(t);
      const prior = await correctiveAction(t, [SAID, `${NAME} signed the jba policy manual on 10-15-26`], MODEL_LINE);
      const lines = prior.split("\n");
      expect(lines.filter((line) => /10\/15\/2026/.test(line)), `the coaching the manager said was signed lost "signed":\n${prior}`).toEqual([MODEL_LINE]);
      const onFile = lines.filter((line) => /09\/02\/2026/.test(line));
      expect(onFile, `the finalized Coaching Form of 09/02/2026 is not listed once:\n${prior}`).toHaveLength(1);
      // With the fix the form on file reads "finalized"; production today writes "signed" there (the OPEN case above).
      if (process.env[FIX] === "true") expect(onFile[0], `the form on file says "signed", which nobody said:\n${prior}`).toBe("Coaching — finalized 09/02/2026");
      expect(prior, `the DRAFT Coaching Form of 10/01/2026 is listed:\n${prior}`).not.toMatch(/10\/01\/2026/);
    },
  },
];
