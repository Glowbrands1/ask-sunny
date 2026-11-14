import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayAnswer, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * AN OFFER THE APP MAKES CAN BE TAKEN (QA, top priority, 12 Nov 2026; OFFERED_NAME_ACCEPTED_ENABLED)
 * ============================================================================
 *
 * Found on the Sunny 37b live bug's replay: an all-salon admin typed "CA for <C>, do not terminate yet, she was late";
 * the reply offered "reply use <C>"; "use <C>" was refused — "\"<C>\" isn't a person on your team" — and the card had
 * no employee. The request's slot reader takes "<C>," before the account as a capitalised list item, so the person
 * guard ruled the name out on the turn that takes the offer too. QA: "an offer the bot makes must be acceptable". <C>
 * is invented (Brisa Talmadge, not on the directory).
 */
const C = "Brisa Talmadge";
const REQUEST = `CA for ${C}, do not terminate yet, she was late`;
const ADMIN = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };
const observation = (reply: ReplayAnswer) => /\*\*Observation of Offense:\*\*\s*([^\n]*)/.exec(reply.content)?.[1]?.trim() ?? "";

const SCOPES = [
  { key: "admin", role: "admin", scope: ADMIN },
  { key: "salon-director", role: "salon_director", scope: KEARNEY },
] as const;

export const NOV12_OFFERED_NAME_ACCEPTED_CASES: ReplayCase[] = SCOPES.map(({ key, role, scope }) => ({
  id: `nov12-offered-name-accepted-${key}`,
  title: `${key}: "${REQUEST}" → "reply use ${C}" → "use ${C}": the card is for ${C}, with the account`,
  report: `QA, 12 Nov 2026 (top priority; found on the Sunny 37b replay); ${key}`,
  // Changed on purpose (13 Nov 2026): fixed in production by OFFERED_NAME_ACCEPTED_ENABLED, QA round 38a. Was OPEN.
  status: "fixed",
  fixFlags: ["OFFERED_NAME_ACCEPTED_ENABLED"],
  async run(t: ReplayContext) {
    vi.setSystemTime(new Date("2026-11-12T15:00:00Z"));
    t.directory([...STAFF]);
    t.as(role, scope as never);
    const thread = t.thread();
    const first = await thread.say(REQUEST);
    if (t.loopActive?.()) {
      // Changed on purpose (Pau 14 Nov: fewer questions / off-roster card + not-on-Woven line): with the loop on, the card comes at once with the line; every outcome check is kept.
      expect((thread.proposal as { employeeName?: string | null } | null)?.employeeName, `no card for ${C}:\n${first.content}`).toBe(C);
      expect(first.content).toMatch(new RegExp(`\\*\\*${C}\\*\\* isn't on (?:your salon's|the) Woven staff list`));
      expect(observation(first), `the account was lost:\n${first.content}`).toMatch(/she was late/i);
      return;
    }
    expect(first.content, `no offer for ${C}:\n${first.content}`).toContain(`reply **use ${C}**`);
    const used = await thread.say(`use ${C}`);
    expect(used.content, `the offer was refused:\n${used.content}`).not.toMatch(/isn't a person on your team/);
    expect((thread.proposal as { employeeName?: string | null } | null)?.employeeName, `"use ${C}" did not take the name:\n${used.content}`).toBe(C);
    expect(observation(used), `the account was lost:\n${used.content}`).toMatch(/she was late/);
  },
}));
