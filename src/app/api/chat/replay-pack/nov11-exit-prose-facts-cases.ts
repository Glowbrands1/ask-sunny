import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * AN EXIT FORM ASKED FOR WITH ONLY A NAME: ADDITIONAL DETAILS IS LEFT BLANK, NEVER PROMISED AS "A SHORT ACCOUNT
 * DRAFTED…" (QA's October triage of #263, 10 Nov 2026; EXIT_PROSE_FACTS_ENABLED)
 * ============================================================================
 *
 * The managers' wording (a bare name after "exit form"), the person from the pack's STAFF: with production's flags
 * the reply promises "a short account drafted from what you've described" when nothing was described.
 */
export const NOV11_EXIT_PROSE_FACTS_CASES: readonly ReplayCase[] = [
  {
    id: "nov11-exit-prose-bare-name",
    title: '"exit form" then a bare name: Additional Details is listed as left blank, never "a short account drafted from what you\'ve described"',
    report: "#263 (QA's October triage, 10 Nov 2026): after a bare name the reply still promised a drafted account",
    status: { open: "the reply says Additional Details is \"a short account drafted from what you've described\"" },
    fixFlags: ["EXIT_PROSE_FACTS_ENABLED"],
    async run(t) {
      vi.setSystemTime(new Date("2026-10-25T15:00:00Z"));
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say("exit form");
      const reply = await thread.say("remy calder");
      expect(reply.formProposal, `no exit card:\n${reply.content}`).toMatchObject({ employeeName: "Remy Calder" });
      expect(reply.content, `a drafted account promised:\n${reply.content}`).not.toMatch(/a short account drafted/i);
      expect(reply.content, `Additional Details not left blank:\n${reply.content}`).toMatch(/\*\*Left blank for you to review:\*\*[^\n]*Additional Details/);
    },
  },
];
