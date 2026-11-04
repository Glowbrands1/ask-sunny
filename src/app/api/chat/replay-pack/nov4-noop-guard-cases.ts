import { expect } from "vitest";

import { KEARNEY, noClaimWithoutUpdate, replyMatchesDiff, savedForm, type ReplayCase, type ReplayContext } from "./cases";
import { CA_CHAIN, LIVE_ROSTER, OBSERVATION_AFTER } from "./nov4-live-regressions-scenarios";

/**
 * ============================================================================
 * STEP 4 — NO FALSE "UPDATED" (FORM_EDIT_NOOP_GUARD_ENABLED)
 * ============================================================================
 *
 * Ported from Ask Bubbles (bdabffbe), in this app's setting (Jane Doe at the
 * Kearney salon, invented). Production has the flag off, so each case turns
 * it on for its own run, with the single writer and the edit tool it is
 * built on (as the Step 3 cases do, `nov4-edit-tool-cases.ts`).
 * `fixFlags: []`. Jane Doe's Corrective Action (QA's CA chat). The
 * overnight scan's sf-s11 ("the request sentence goes into Observation",
 * `nov4-overnight-scan-cases.ts`) is pinned by
 * `form-edit-noop-guard-e2e.test.ts`; its replay case stays OPEN (it needs a
 * new card for the second employee, which this step does not make).
 *
 *   - An edit that sets the Observation to what it already says: refused as
 *     `same_value`, and the reply is exactly "I didn't change anything on the
 *     form. Tell me which part to change and what it should say."
 */

type T = ReplayContext;

const GUARD_FLAGS = ["FORM_EDIT_SINGLE_WRITER_ENABLED", "FORM_EDIT_TOOL_IN_STREAM_ENABLED", "FORM_EDIT_NOOP_GUARD_ENABLED"] as const;

async function withGuard(run: () => Promise<void>): Promise<void> {
  const saved = GUARD_FLAGS.map((name) => [name, process.env[name]] as const);
  for (const name of GUARD_FLAGS) process.env[name] = "true";
  try {
    await run();
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

async function janeDraft(t: T) {
  t.directory(LIVE_ROSTER);
  t.as("salon_director", KEARNEY);
  const thread = t.thread();
  await thread.say(CA_CHAIN[0]);
  expect(thread.proposal, "T1 made no card for Jane Doe").toMatchObject({ templateKey: "dpoa", employeeName: "Jane Doe" });
  t.draftWrites({ observation: OBSERVATION_AFTER[0]! });
  const id = await thread.create();
  return { thread, id };
}

const UNCHANGED = "I didn't change anything on the form. Tell me which part to change and what it should say.";

export const NOV4_NOOP_GUARD_CASES: readonly ReplayCase[] = [
  {
    id: "nov4-noop-guard-same-value-edit",
    title: `"set the observation to what it says now" with the edit tool ON — the model sets the Observation to its own value; no false "Updated", the reply says nothing changed`,
    report: "Step 4 design, 4 Nov 2026: an edit to the value a field already has is never claimed as an update",
    status: "fixed",
    fixFlags: [],
    async run(t) {
      await withGuard(async () => {
        const { thread, id } = await janeDraft(t);
        const before = savedForm(t, id);
        t.modelSays("Updated the Observation.");
        t.modelCallsEditTool!({ ops: [{ op: "set", field: "observation", value: t.values(id).observation! }] });
        t.revisionWrites({});
        const reply = await thread.say("set the observation to what it says now");
        replyMatchesDiff(t, id, before, reply, "set the observation to what it says now");
        noClaimWithoutUpdate(reply);
        expect(savedForm(t, id)).toBe(before);
        expect(reply.content).toBe(UNCHANGED);
        expect(reply.formUpdate).toBeUndefined();
      });
    },
  },
];
