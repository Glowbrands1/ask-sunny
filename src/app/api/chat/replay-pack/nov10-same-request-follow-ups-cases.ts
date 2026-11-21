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
const ODALYS = person("e-sr-odalys-frewen", "Odalys", "Frewen");
const PERRIN = person("e-sr-perrin-haldane", "Perrin", "Haldane");

/** The invented people of this file (a function: the registry reads exported arrays as cases). */
export function sameRequestFollowUpPeople(): readonly DirectoryRow[] {
  return [RORY, MARA, ODALYS, PERRIN];
}

const FIRST = "create a corrective action for Rory Vance, she was late on 11/3/26";
const SAME = "Can you do the same thing for Mara Quell but make it a written";
const REPORT = `QA, 10 Nov 2026 (Sunny r19, live): "create a corrective action for <A>, she was late on 11/3/26" → "Can you do the same thing for <B> but make it a written"`;

async function both(t: T, offRoster = false): Promise<{ thread: ReturnType<T["thread"]>; second: ReplayAnswer }> {
  vi.setSystemTime(new Date("2026-11-10T09:00:00Z"));
  // QA's round-23 live test (conv_mwb1xng82tz2tyr): both names invented, so neither is on the directory; an all-salon admin.
  t.directory(offRoster ? [...STAFF] : [...STAFF, RORY, MARA]);
  if (offRoster) t.as("admin", { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] });
  else t.as("salon_director", KEARNEY);
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
    // Changed on purpose (10 Nov 2026): fixed in production by SAME_REQUEST_CARRIES_ACCOUNT_ENABLED, QA round 23.
    status: "fixed",
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
    // Changed on purpose (10 Nov 2026): fixed in production by SAME_REQUEST_KEEPS_EARLIER_CARD_ENABLED, QA round 23.
    status: "fixed",
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
  /*
   * The same two checks as QA's round-23 live test ran them (10 Nov 2026, Sunny production main 227340dd): Rory Vance and
   * Mara Quell are on no directory and the tester is an all-salon admin. Live: Mara's card had no Observation and Rory's
   * read "Superseded — nothing created". SAME_REQUEST_OFF_ROSTER_ENABLED reads <A> from the card and <B> as typed.
   */
  {
    id: "nov10-same-request-carries-account-off-roster",
    title: `(a), off roster: "${SAME}" — <B>'s card's Observation is <A>'s account with <B>'s name`,
    report: `QA's Sunny round-23 live test, conv_mwb1xng82tz2tyr (names off the directory): (a) <B>'s card had no Observation of Offense`,
    // Changed on purpose (11 Nov 2026): fixed in production by SAME_REQUEST_OFF_ROSTER_ENABLED, QA round 25. Was OPEN ("with <A> and <B> off the directory the same request is never read: <B>'s turn goes to <A>'s card").
    status: "fixed",
    fixFlags: ["SAME_REQUEST_OFF_ROSTER_ENABLED"],
    async run(t) {
      const { second } = await both(t, true);
      expect(observation(second), `<B>'s card's Observation:\n${second.content}`).toBe("Mara Quell was late on 11/3/26");
    },
  },
  {
    id: "nov10-same-request-keeps-earlier-card-off-roster",
    title: `(b), off roster: "${SAME}" — <A>'s card is not superseded, and both cards stay creatable`,
    report: `QA's Sunny round-23 live test, conv_mwb1xng82tz2tyr (names off the directory): (b) <A>'s card read "Superseded — nothing created"`,
    // Changed on purpose (11 Nov 2026): fixed in production by SAME_REQUEST_OFF_ROSTER_ENABLED, QA round 25. Was OPEN ("with <A> and <B> off the directory <A>'s card is superseded by <B>'s").
    status: "fixed",
    fixFlags: ["SAME_REQUEST_OFF_ROSTER_ENABLED"],
    async run(t) {
      const { thread } = await both(t, true);
      const rory = thread.conversation!.find((message) => message.formProposal?.employeeName === "Rory Vance")!.formProposal!;
      expect(isProposalSuperseded(thread.conversation!, rory.proposalId), "<A>'s card is superseded by <B>'s").toBe(false);
      const id = await thread.createCard!("Rory Vance");
      expect(t.values(id).employee_name, "<A>'s form is not <A>'s").toBe("Rory Vance");
      const mara = await thread.createCard!("Mara Quell");
      expect(t.values(mara).employee_name).toBe("Mara Quell");
    },
  },
  {
    // Port from Ask Bubbles' #696 gate (QA, group 4, Gate-Bubbles 961ab16c): a negative. The overnight scan's sf-s11 gives
    // no account, only a name, a level and a topic, so "the same thing" carries none: with SAME_REQUEST_CARRIES_ACCOUNT on
    // (production) the Observation was "Perrin Haldane Written Warning. Under Performance".
    id: "nov12-same-request-carries-no-level-or-topic",
    title: `sf-s11, "Odalys Frewen. Verbal Warning. Under Performance." → "Can you do the same thing for Perrin Haldane but switch it to a written": no level or bare topic as <B>'s Observation`,
    report: `QA, group 4 (12 Nov 2026), Ask Bubbles #696 NO-GO: sf-s11 carried "Perrin Haldane Written Warning. Under Performance"`,
    status: { open: "<B>'s card's Observation is the level and the topic (\"Perrin Haldane Written Warning. Under Performance\")" },
    fixFlags: ["SAME_REQUEST_REAL_ACCOUNT_ONLY_ENABLED"],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-04T09:00:00Z"));
      t.directory([...STAFF, ODALYS, PERRIN]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say("what information do you need for a corrective action for an employee");
      await thread.say("Odalys Frewen. Verbal Warning. Under Performance.");
      const reply = await thread.say("Can you do the same thing for Perrin Haldane but switch it to a written");
      const line = observation(reply);
      expect(line, `<B>'s card's Observation is a level:\n${reply.content}`).not.toMatch(/\bwarning\b/i);
      expect(line, `<B>'s card's Observation is a bare topic:\n${reply.content}`).not.toMatch(/^Perrin Haldane\b[^a-z]*(?:under performance)?\.?$/i);
    },
  },
];
