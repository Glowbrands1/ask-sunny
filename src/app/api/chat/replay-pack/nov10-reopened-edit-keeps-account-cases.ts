import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * AN EDIT ON A REOPENED COACHING FORM KEEPS ITS DETAILS (ported from the sibling app: QA, a manager's 1★ rating there,
 * 5–6 Nov 2026;
 * ACCOUNT_WIPE_GUARD_ENABLED)
 * ============================================================================
 *
 * The manager reopened a previous Coaching Form and typed "this is a verbal warning. previous coaching policy manual
 * 10-15-26"; the edit wiped Details of Coaching. Here: a Coaching Form draft on file whose Details are filled, "open my last
 * coaching form for <name>" (it reopens), then the manager's turn verbatim. The live reader's output is not
 * known; each way it wipes the field is scripted — a clear, and a full replace with the turn's words. The person is
 * invented.
 */
type T = ReplayContext;

const ODALYS: DirectoryRow = {
  id: "e-odalys-penwarden-reopen",
  firstName: "Odalys",
  lastName: "Penwarden",
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Tanning Consultant",
};
const SAID = "this is a verbal warning. previous coaching policy manual 10-15-26";
const DETAILS = "Odalys Penwarden left the register drawer open on 10/15/26. We reviewed the cash handling policy.";
const REPORT = `QA, a manager's 1★ rating in the sibling app (5–6 Nov 2026): on a reopened Coaching Form, "${SAID}" wiped Details of Coaching`;

async function reopened(t: T) {
  vi.setSystemTime(new Date("2026-11-05T15:00:00Z"));
  t.directory([...STAFF, ODALYS]);
  t.as("salon_director", KEARNEY);
  const earlier = t.thread();
  await earlier.say("I need a coaching form for Odalys Penwarden, she left the register drawer open on 10/15/26");
  t.draftWrites({ coaching_details: DETAILS });
  // A draft on file, reopened as itself. (A finalized one opens a new draft of it, which this app's replay store leaves
  // empty — see the pull request.)
  await earlier.create();
  const thread = t.thread();
  const opened = (await thread.say("open my last coaching form for Odalys Penwarden")).formOpened as { instanceId: string } | undefined;
  expect(opened, "the Coaching Form on file did not reopen").toBeDefined();
  expect(t.values(opened!.instanceId).coaching_details ?? "", "the reopened draft does not carry the Details").toBe(DETAILS);
  return { thread, draft: opened!.instanceId };
}

const READINGS = [
  ["clear", { turn: "this_form", set: [], clear: [{ field: "coaching_details", evidence: SAID }] }, "Details of Coaching: empty (\"Cleared Details of Coaching.\")"],
  [
    "replace",
    { turn: "this_form", set: [{ field: "coaching_details", value: "This is a verbal warning.", how: "replace", evidence: SAID }], clear: [] },
    "Details of Coaching: \"This is a verbal warning.\"",
  ],
] as const;

export const NOV10_REOPENED_EDIT_KEEPS_ACCOUNT_CASES: ReplayCase[] = READINGS.map(
  ([key, reading, open]): ReplayCase => ({
    id: `nov10-reopened-edit-keeps-details-${key}`,
    title: `a reopened Coaching Form, "${SAID}" (the reader ${key === "clear" ? "clears" : "replaces"} Details): the saved Details are kept`,
    report: REPORT,
    status: { open },
    fixFlags: ["ACCOUNT_WIPE_GUARD_ENABLED"],
    async run(t: T) {
      const { thread, draft } = await reopened(t);
      t.patchWrites([reading]);
      const reply = await thread.say(SAID);
      const saved = t.values(draft).coaching_details ?? "";
      expect(saved, `the saved Details were wiped:\n${saved}\n— reply:\n${reply.content}`).toBe(DETAILS);
      expect(reply.content, `the reply says Details changed:\n${reply.content}`).not.toMatch(/\b(?:Cleared|Changed)\s+Details of Coaching\b/);
    },
  }),
);
