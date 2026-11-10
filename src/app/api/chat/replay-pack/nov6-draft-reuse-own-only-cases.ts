import { expect } from "vitest";

import { modelExactIlike } from "@/test/fake-supabase";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * NEVER REUSE ANOTHER MANAGER'S DRAFT (QA, 25 Oct 2026; rebuilt 6 Nov 2026)
 * ============================================================================
 *
 * QA: manager B's create from chat could reopen manager A's open draft for
 * the same employee, form and incident (`findOpenIncidentDraft` read
 * `form_instances` with no `created_by`, on every chat create, no flag). Two
 * managers at the same salon, each in a chat of their own, ask for the same
 * Corrective Action Form.
 *
 * Production today (QA's Vercel read): DRAFT_REUSE_SAME_CHAT_ONLY_ENABLED on.
 *
 * - `cross-manager`: production's flags. The pack's two chats both start at
 *   message "m1", so B's Create carries the same chat key as A's draft
 *   records, as a forged or colliding key would, and the same-chat filter
 *   lets A's draft through: OPEN until DRAFT_REUSE_OWN_ONLY_ENABLED is on.
 * - `one-flag-away`: the same-chat filter off. B is handed A's draft: OPEN
 *   until DRAFT_REUSE_OWN_ONLY_ENABLED is on.
 *
 * Every combination of the reuse flags, with B's own and A's forged chat key,
 * is pinned in the route test (`forms/draft-reuse-own-only-nov6-route.test.ts`).
 * People are invented.
 */

const FIX = "DRAFT_REUSE_OWN_ONLY_ENABLED";
const REPORT = "QA, 25 Oct 2026: a create from chat could reopen an open draft for the same employee, template and incident that another manager made";

/**
 * Manager B's turn as the old pull request's test had it: as reported, and the
 * real register (lowercase, abbreviated, a typo). The register's date is
 * written "10-20-26" here, not "10 20 26": the card does not read "10 20 26"
 * as a date. The route test keeps "10 20 26" (its card sends the date itself).
 */
const TURNS = [
  ["sentence", "create a CA for Rowan Kestrel, she opened 40 minutes late on 10-20-26"],
  ["lower", "ca for rowan kestrel she opend 40 min late 10-20-26 just do it already"],
] as const;

/**
 * Manager A makes a draft in their chat; manager B, same salon, asks the same in a new chat and presses Create.
 * `findOpenIncidentDraft` reads the name with `.ilike`, which the pack's fake database models only on request
 * (`modelExactIlike`): without it the lookup throws, finds nothing, and the case could not reach the leak.
 */
function twoManagers(t: ReplayContext, said: string): Promise<void> {
  return modelExactIlike(() => twoManagersRun(t, said));
}

async function twoManagersRun(t: ReplayContext, said: string): Promise<void> {
  t.directory(STAFF);
  t.as("salon_director", KEARNEY, "manager-a");
  const chatA = t.thread();
  await chatA.say("create a CA for Rowan Kestrel, she opened 40 minutes late on 10-20-26");
  t.draftWrites({});
  const draftA = await chatA.create();

  t.as("salon_director", KEARNEY, "manager-b");
  const chatB = t.thread();
  await chatB.say(said);
  t.draftWrites({});
  const draftB = await chatB.create();

  expect(draftB, "manager B was handed manager A's draft").not.toBe(draftA);
  const rowB = t.forms().find((row) => row.id === draftB);
  expect(rowB?.created_by, "manager B's draft is B's").toBe("manager-b");
}

export const NOV6_DRAFT_REUSE_OWN_ONLY_CASES: ReplayCase[] = TURNS.flatMap(([register, said]): ReplayCase[] => [
  {
    id: `nov6-own-only-cross-manager-${register}`,
    title: `two managers, same salon, same CA ("${said.slice(0, 40)}…"): B gets a new draft`,
    report: REPORT,
    // Changed on purpose (10 Nov 2026): fixed in production by DRAFT_REUSE_OWN_ONLY_ENABLED, QA round 23.
    status: "fixed",
    fixFlags: [FIX],
    run: (t) => twoManagers(t, said),
  },
  {
    id: `nov6-own-only-one-flag-away-${register}`,
    title: `two managers, same-chat-only off ("${said.slice(0, 40)}…"): B gets a new draft`,
    report: `${REPORT}; production is one flag away (DRAFT_REUSE_SAME_CHAT_ONLY off)`,
    // Changed on purpose (10 Nov 2026): fixed in production by DRAFT_REUSE_OWN_ONLY_ENABLED, QA round 23.
    status: "fixed",
    fixFlags: [FIX],
    run: async (t) => {
      // Restored after the case with every production flag.
      delete process.env.DRAFT_REUSE_SAME_CHAT_ONLY_ENABLED;
      await twoManagers(t, said);
    },
  },
]);
