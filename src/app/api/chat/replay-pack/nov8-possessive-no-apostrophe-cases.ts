import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayAnswer, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * "BRING UP <FIRST NAME>S CORRECTIVE ACTION" OPENS THE FORM ON FILE (QA, 8 Nov 2026, from the sibling app's live tester
 * with round 5 on; checked here the same; POSSESSIVE_NO_APOSTROPHE_ENABLED)
 * ============================================================================
 *
 * With REOPEN_BY_ANY_OPEN_VERB and REOPEN_NOT_OPEN_FORM on, "bring up <first name>'s corrective action" opens the
 * form on file, and so does "an old coaching form for <first name>". The manager's own wording, a possessive without
 * the apostrophe ("bring up <first name>s corrective action"; one roster person by that first name), still asked "Who
 * is this form for?" and showed a blank Corrective Action card. The same in round 4. The person is invented.
 */
type T = ReplayContext;

const QUILLA: DirectoryRow = {
  id: "e-quilla-brandt",
  firstName: "Quilla",
  lastName: "Brandt",
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Tanning Consultant",
};

/** The invented person of this file (a function: the registry reads exported arrays as cases). */
export function possessiveNoApostrophePeople(): readonly DirectoryRow[] {
  return [QUILLA];
}

// Round 5's reopen flags (live with QA's round 5, #684; not yet in production-flags.json here), then this fix.
const ROUND_5 = ["PAST_FORMS_BEFORE_LIBRARY_ENABLED", "REOPEN_BY_ANY_OPEN_VERB_ENABLED", "REOPEN_NOT_OPEN_FORM_ENABLED"];
const FIX = [...ROUND_5, "POSSESSIVE_NO_APOSTROPHE_ENABLED"];
const REPORT = "QA, 8 Nov 2026 (the sibling app's live tester with round 5 on; the same here): \"bring up <first name>s corrective action\" asks who";
const ASKS_WHO = /Who is this (?:\*\*[^*]+\*\* |form )?for\?|Is this for \*{0,2}[A-Z]/i;

async function caOnFile(t: T): Promise<string> {
  vi.setSystemTime(new Date("2026-11-07T15:00:00Z"));
  t.directory([...STAFF, QUILLA]);
  t.as("salon_director", KEARNEY);
  const earlier = t.thread();
  await earlier.say("I need a corrective action for Quilla Brandt, she was late opening the salon on Monday");
  t.draftWrites({ observation: "Observed:\nQuilla Brandt opened the salon late on Monday." });
  return earlier.create();
}

function opens(reply: ReplayAnswer, id: string, said: string) {
  expect(reply.content, `"${said}" asks who the form is for:\n${reply.content}`).not.toMatch(ASKS_WHO);
  const opened = reply.formOpened as { instanceId: string; revisesInstanceId?: string | null } | undefined;
  expect(opened, `"${said}" opens no form on file:\n${reply.content}`).toBeDefined();
  expect([opened!.instanceId, opened!.revisesInstanceId], `"${said}" opens another form:\n${reply.content}`).toContain(id);
  expect(reply.formProposal, `"${said}" proposes a new form:\n${reply.content}`).toBeUndefined();
}

const WORDINGS: readonly (readonly [string, string])[] = [
  ["lower-case", "bring up quillas corrective action"],
  ["capital", "bring up Quillas corrective action"],
  ["ca", "pull up quillas CA"],
];

export const NOV8_POSSESSIVE_NO_APOSTROPHE_CASES: ReplayCase[] = [
  ...WORDINGS.map(([key, said]): ReplayCase => ({
    id: `nov8-possessive-no-apostrophe-${key}`,
    title: `"${said}" with her Corrective Action on file opens it`,
    report: REPORT,
    status: { open: "\"Who is this form for?\" and a blank Corrective Action card" },
    fixFlags: FIX,
    async run(t) {
      const id = await caOnFile(t);
      opens(await t.thread().say(said), id, said);
    },
  })),
  {
    id: "nov8-possessive-apostrophe-guard",
    title: "must not change: \"bring up Quilla's corrective action\" (with the apostrophe) opens it, with round 5's flags",
    report: REPORT,
    status: { open: "production's flags here are before round 5's reopen flags" },
    fixFlags: ROUND_5,
    async run(t) {
      const id = await caOnFile(t);
      opens(await t.thread().say("bring up Quilla's corrective action"), id, "bring up Quilla's corrective action");
    },
  },
];
