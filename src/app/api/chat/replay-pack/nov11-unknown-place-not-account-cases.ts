import { expect, vi } from "vitest";

import { STAFF, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * A PLACE THAT IS NOT A SALON IS NOT THE ACCOUNT (QA's D5 follow-up, 11 Nov 2026; UNKNOWN_PLACE_NOT_ACCOUNT_ENABLED)
 * ============================================================================
 *
 * Signed in as an all-salon admin, "Create an SDIT EPP for <name> at IA Altoona" (IA Altoona is not one of the salons)
 * put the whole request on the card as "**Observation of Offense:**", and "Create a coaching form for <name> at IA
 * Altoona" put "<name> at IA Altoona" there. "… at Kearney" (a salon) gives no such line. The person is invented and not
 * on the replay roster.
 */
const EVERY_SALON = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };
const NAME = "Wren Tallis";
const FIX = ["UNKNOWN_PLACE_NOT_ACCOUNT_ENABLED"];
const REPORT = "QA's D5 follow-up (11 Nov 2026): a place that is not a salon put the request's words on the card as the account";

async function card(t: ReplayContext, words: string) {
  vi.setSystemTime(new Date("2026-11-11T15:00:00Z"));
  t.directory(STAFF);
  t.as("admin", EVERY_SALON);
  const thread = t.thread();
  const reply = await thread.say(words);
  const account = reply.content.split("\n").find((line) => /^\*\*(?:Observation of Offense|Details of Coaching|What happened):?\*\*/i.test(line.trim()));
  return { reply, account };
}

const NO_ACCOUNT: readonly (readonly [string, string, ReplayCase["status"]])[] = [
  ["sdit-epp-kearney", `Create an SDIT EPP for ${NAME} at Kearney`, "fixed"],
  ["sdit-epp-unknown-place", `Create an SDIT EPP for ${NAME} at IA Altoona`, { open: "the request is the card's Observation of Offense" }],
  ["coaching-unknown-place", `Create a coaching form for ${NAME} at IA Altoona`, { open: "\"<name> at IA Altoona\" is the card's account" }],
];

export const NOV11_UNKNOWN_PLACE_NOT_ACCOUNT_CASES: ReplayCase[] = [
  ...NO_ACCOUNT.map(([key, words, status]) => ({
    id: `nov11-unknown-place-not-account-${key}`,
    title: `"${words}": no account line on the card`,
    report: REPORT,
    status,
    fixFlags: FIX,
    async run(t: ReplayContext) {
      const { reply, account } = await card(t, words);
      expect(account, `the request's words became the account:\n${reply.content}`).toBeUndefined();
    },
  })),
  {
    id: "nov11-unknown-place-not-account-account-kept",
    title: `NEVER-BREAK: "Create a coaching form for ${NAME} at IA Altoona, she was rude to a guest at the front desk": the account stays`,
    report: REPORT,
    status: "fixed",
    fixFlags: FIX,
    async run(t: ReplayContext) {
      const { reply, account } = await card(t, `Create a coaching form for ${NAME} at IA Altoona, she was rude to a guest at the front desk`);
      expect(account ?? "", reply.content).toMatch(/rude to a guest at the front desk/i);
    },
  },
];

/**
 * UNKNOWN_PLACE_SAID_ENABLED (QA's D5 follow-up, 11 Nov 2026): the same admin's card said "Your account covers every
 * salon, so this form won't name one" for "… at IA Altoona", as though no place was named. With the flag, it says IA
 * Altoona is not one of the salons. A salon the reader knows ("at Kearney") is filled in as before.
 */
const SAID_FIX = ["UNKNOWN_PLACE_SAID_ENABLED"];
const SAID_REPORT = "QA's D5 follow-up (11 Nov 2026): a named place that is not a salon was passed over in silence";

NOV11_UNKNOWN_PLACE_NOT_ACCOUNT_CASES.push(
  ...([
    ["sdit-epp", `Create an SDIT EPP for ${NAME} at IA Altoona`],
    ["coaching", `Create a coaching form for ${NAME} at IA Altoona`],
  ] as const).map(([key, words]) => ({
    id: `nov11-unknown-place-said-${key}`,
    title: `"${words}": the card says IA Altoona is not one of the salons`,
    report: SAID_REPORT,
    status: { open: "the card says only that the account covers every salon" } as const,
    fixFlags: SAID_FIX,
    async run(t: ReplayContext) {
      const { reply } = await card(t, words);
      expect(reply.content).toContain("IA Altoona isn't one of our salons, so this form won't name one.");
      expect(reply.content).not.toMatch(/covers every salon/);
    },
  })),
  {
    id: "nov11-unknown-place-said-salon-kept",
    title: `NEVER-BREAK: "Create an SDIT EPP for ${NAME} at Kearney": no "isn't one of our salons" line`,
    report: SAID_REPORT,
    status: "fixed",
    fixFlags: SAID_FIX,
    async run(t: ReplayContext) {
      const { reply } = await card(t, `Create an SDIT EPP for ${NAME} at Kearney`);
      expect(reply.content).not.toMatch(/isn't one of our salons/);
    },
  },
);
