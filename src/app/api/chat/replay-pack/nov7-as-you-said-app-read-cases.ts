import { expect } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * AS_YOU_SAID NEVER LEAVES A CARD WITH NO POLICY LINE (QA's gate, 7 Nov 2026)
 * ============================================================================
 *
 * With AS_YOU_SAID_MANAGER_WORDS_ENABLED on, 40 replay records lost the card's **Policy:** line: the only one they
 * had was "<policy>, as you said", read from the app's own heading line. AS_YOU_SAID_APP_READ_ENABLED says the app's
 * reading as one ("— read from this request"), never "as you said" and never nothing. The draft still gets the
 * card's policy (NEXT_PUBLIC_CARD_POLICY_TO_DRAFT_ENABLED reads the heading before " — ").
 */

const POLICY_LINE = /^\*\*Policy:\*\*[^\n]*$/m;
const ASKS = /You haven['’]t told me what happened yet|what happened/i;

export const NOV7_AS_YOU_SAID_APP_READ_CASES: ReplayCase[] = [
  {
    id: "nov7-as-you-said-app-read-late-opening",
    title: "\"make me a CA for <name> for being late to opening this morning\": a Policy line, never \"as you said\"",
    report: "QA's Sunny gate, 7 Nov 2026 (AS_YOU_SAID_MANAGER_WORDS: the card lost its Policy line; nov3-draft-cites-card-policy)",
    status: { open: "the Policy line says \"as you said\" for the app's own reading (AS_YOU_SAID off), or there is none (on)" },
    fixFlags: ["AS_YOU_SAID_MANAGER_WORDS_ENABLED", "AS_YOU_SAID_APP_READ_ENABLED", "NEXT_PUBLIC_CARD_POLICY_TO_DRAFT_ENABLED"],
    async run(t) {
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      const reply = await thread.say("make me a CA for Remy Calder for being late to opening this morning");
      const line = POLICY_LINE.exec(reply.content)?.[0] ?? "";
      expect(line, `the card has no Policy line:\n${reply.content}`).not.toBe("");
      expect(line, "the app's reading is said as the manager's").not.toMatch(/as you said/i);
    },
  },
  {
    id: "nov7-as-you-said-app-read-not-late",
    title: "\"create a corrective action for <name>, not late\": the app's Policy line does not stand in for an account",
    report: "QA's Sunny gate, 7 Nov 2026 (nov6-bare-not-denial-not-late, with AS_YOU_SAID and its fallback on)",
    // Open with the flags file as it stands (AS_YOU_SAID not yet listed there): the card says "Attendance, as you said".
    status: { open: "the Policy line says \"as you said\" for the app's own reading" },
    fixFlags: ["AS_YOU_SAID_MANAGER_WORDS_ENABLED", "AS_YOU_SAID_APP_READ_ENABLED", "REPLY_MATCHES_CARD_ENABLED", "BARE_NOT_DENIAL_ENABLED", "CA_SALES_POLICY_ENABLED"],
    async run(t) {
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      const reply = await thread.say("create a corrective action for Rowan Kestrel, not late");
      expect(thread.proposal).toMatchObject({ templateKey: "dpoa" });
      expect(reply.content, `drafted with no account:\n${reply.content}`).toMatch(ASKS);
      expect(reply.content.split("\n").filter((line) => /^\*\*Policy:\*\*/.test(line) && /as you said/i.test(line))).toEqual([]);
    },
  },
];
