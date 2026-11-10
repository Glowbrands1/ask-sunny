import { expect, vi } from "vitest";

import { isProposalSuperseded } from "@/lib/forms/proposal-continuation";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayAnswer, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * "CAN YOU DO THE SAME THING FOR <B> BUT MAKE IT A WRITTEN" (QA's Sunny r19 live check, 10 Nov 2026)
 * ============================================================================
 *
 * With SAME_REQUEST_OTHER_PERSON on: "create a corrective action for <A>, she was late on 11/3/26" → "Can you do the
 * same thing for <B> but make it a written". <B> got her own card (policy, date, Written) and <A>'s stayed unchanged.
 * Two follow-ups, QA's wording verbatim, the people invented (Rory Vance, Mara Quell):
 *   (a) <B>'s card had no Observation of Offense: "the same thing" carries <A>'s account with <B>'s name
 *       ("Mara Quell was late on 11/3/26") — SAME_REQUEST_CARRIES_ACCOUNT_ENABLED;
 *   (b) <A>'s card read "Superseded — nothing created", so <A> could not be created from this chat; both cards stay
 *       creatable — SAME_REQUEST_KEEPS_EARLIER_CARD_ENABLED (the browser reads its NEXT_PUBLIC_ twin).
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
const RORY = person("e-sr-rory-vance", "Rory", "Vance");
const MARA = person("e-sr-mara-quell", "Mara", "Quell");

/** The invented people of this file (a function: the registry reads exported arrays as cases). */
export function sameRequestFollowUpPeople(): readonly DirectoryRow[] {
  return [RORY, MARA];
}

const FIRST = "create a corrective action for Rory Vance, she was late on 11/3/26";
const SAME = "Can you do the same thing for Mara Quell but make it a written";
const REPORT = `QA, 10 Nov 2026 (Sunny r19, live): "create a corrective action for <A>, she was late on 11/3/26" → "Can you do the same thing for <B> but make it a written"`;

async function both(t: T): Promise<{ thread: ReturnType<T["thread"]>; second: ReplayAnswer }> {
  vi.setSystemTime(new Date("2026-11-10T09:00:00Z"));
  t.directory([...STAFF, RORY, MARA]);
  t.as("salon_director", KEARNEY);
  const thread = t.thread();
  await thread.say(FIRST);
  expect(thread.proposal, "no CA card for Rory Vance").toMatchObject({ templateKey: "dpoa", employeeName: "Rory Vance" });
  const second = await thread.say(SAME);
  expect(thread.proposal, `no CA card for Mara Quell:\n${second.content}`).toMatchObject({ templateKey: "dpoa", employeeName: "Mara Quell", warningLevel: "written" } as never);
  return { thread, second };
}

const observation = (reply: ReplayAnswer) => /\*\*Observation of Offense:\*\*\s*([^\n]*)/.exec(reply.content)?.[1]?.trim() ?? "";

export const NOV10_SAME_REQUEST_FOLLOW_UP_CASES: ReplayCase[] = [
  {
    id: "nov10-same-request-carries-account",
    title: `(a) "${SAME}": <B>'s card's Observation is <A>'s account with <B>'s name — "Mara Quell was late on 11/3/26"`,
    report: `${REPORT}: (a) <B>'s card had no Observation of Offense`,
    status: { open: "<B>'s card's Observation is not \"Mara Quell was late on 11/3/26\" (live: none; here \"she was late on 11/3/26 Written Warning.\")" },
    fixFlags: ["SAME_REQUEST_CARRIES_ACCOUNT_ENABLED"],
    async run(t) {
      const { second } = await both(t);
      expect(observation(second), `<B>'s card's Observation:\n${second.content}`).toBe("Mara Quell was late on 11/3/26");
    },
  },
  {
    id: "nov10-same-request-keeps-earlier-card",
    title: `(b) "${SAME}": <A>'s card is not superseded, and <A>'s form is still created from it, for <A>`,
    report: `${REPORT}: (b) <A>'s card read "Superseded — nothing created"`,
    status: { open: "<A>'s card is superseded by <B>'s, so <A> can no longer be created from this chat" },
    fixFlags: ["SAME_REQUEST_KEEPS_EARLIER_CARD_ENABLED", "NEXT_PUBLIC_SAME_REQUEST_KEEPS_EARLIER_CARD_ENABLED"],
    async run(t) {
      const { thread } = await both(t);
      const rory = thread.conversation!.find((message) => message.formProposal?.employeeName === "Rory Vance")!.formProposal!;
      expect(isProposalSuperseded(thread.conversation!, rory.proposalId), "<A>'s card is superseded by <B>'s").toBe(false);
      const id = await thread.createCard!("Rory Vance");
      expect(t.values(id).employee_name, "<A>'s form is not <A>'s").toBe("Rory Vance");
      // <B>'s card stays creatable too.
      const mara = await thread.createCard!("Mara Quell");
      expect(t.values(mara).employee_name).toBe("Mara Quell");
    },
  },
];
