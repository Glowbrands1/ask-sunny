import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";
import { evidenceFrom, headingWith, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * THE CARD KEEPS WHOSE IT IS: "HER PERSONAL LIFE" IS NEVER "THE PERSONAL LIFE" (port of Ask Bubbles #1075, 9ce649e)
 * ============================================================================
 *
 * Bubbles' tester (Pau's round 3 there, U23), the manager's sentences word for word with Sunny's salon and an invented
 * person: T5's card read "<P> has talked about the boyfriend or ex boyfriend with customers", and T6's "… constantly
 * bothering them not just about products but about the personal life." The card/reply pronoun pass turned the named
 * person's possessive into "the" (Sunny's `reply-pronouns.ts` is the same code). QA's ruling (option B, card/reply pass
 * only): the first possessive keeps its owner; "the" after a place/time preposition, or for a second possessive in the
 * sentence; the saved write-up keeps HR's design (3 Oct 2026).
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "Ask Bubbles #1075 (Pau's round 3 there, U23): \"about her personal life\" read \"about the personal life\" on the card and in the reply (and \"her boyfriend\" \"the boyfriend\")";
const T1 = "i need to create a corrective action for Remy Calder";
const T2 = "She has unprofessional conversations with guests and staff. I have already had a conversation with her about this.";
const T5 = "Multiple times she has talked about her boyfriend or ex boyfriend with customers, she has stated that she takes medication for different things to customers, even stating that she was sick.";
const T6 = "She will also follow customers around the salon, constantly bothering them not just about products but about her personal life.";
/** The model's account, as live: the manager's sentences with the name for the first "she". */
const ACCOUNT: Record<string, string> = {
  [T2]: "Remy has unprofessional conversations with guests and staff.",
  [T5]: "Remy has unprofessional conversations with guests and staff. Multiple times Remy has talked about her boyfriend or ex boyfriend with customers.",
  [T6]: "Remy has unprofessional conversations with guests and staff. Multiple times Remy has talked about her boyfriend or ex boyfriend with customers. Remy will also follow customers around the salon, constantly bothering them not just about products but about her personal life.",
};

const said = (view: LoopView) => view.turns.filter((turn) => turn.role === "user" && (turn.messageIds?.length ?? 0) > 0).at(-1)?.text ?? "";

export const NOV23_AGENT_LOOP_POSSESSIVE_KEEPS_OWNER_CASES: ReplayCase[] = [
  {
    id: "nov23-1075-possessive-keeps-owner-on-card",
    title: "Port of Bubbles #1075 (U23): T5 \"… talked about her boyfriend …\" and T6 \"… about her personal life\": the card and the reply read \"Remy's boyfriend\" and \"Remy's personal life\", never \"the\"",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
      vi.setSystemTime(new Date("2026-11-22T18:00:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      t.loopModel!(loopStandIn((view): LoopDecision => {
        const result = lastResult(view, "propose_form") as { card?: { observation?: string | null } } | null;
        if (result) return { text: `Here's the Corrective Action Form for **Remy**.\n\n**Observation of Offense:** ${result.card?.observation ?? ""}` };
        const message = said(view);
        return {
          tool: "propose_form",
          input: {
            template_key: "dpoa", employee_id: "e-2", policy: headingWith(view, /standards of conduct/i),
            person_evidence: evidenceFrom(view, "Remy Calder", view.turns.filter((turn) => turn.role === "user" && (turn.messageIds?.length ?? 0) > 0).length - 1),
            ...(ACCOUNT[message] ? { what_happened: ACCOUNT[message] } : {}),
          },
        };
      }));
      const thread = t.thread();
      for (const turn of [T1, T2]) await thread.say(turn);
      const fifth = await thread.say(T5);
      const issue = () => String((thread.proposal as { issue?: string | null } | null)?.issue ?? "");
      expect(issue(), `T5's card lost whose boyfriend:\n${fifth.content}`).toMatch(/Remy's boyfriend/);
      expect(fifth.content).not.toMatch(/the boyfriend/);
      const sixth = await thread.say(T6);
      expect(issue(), `T6's card lost whose personal life:\n${sixth.content}`).toMatch(/Remy's personal life/);
      expect(issue()).not.toMatch(/the personal life/);
      expect(sixth.content, "the reply lost whose personal life").not.toMatch(/the personal life/);
    },
  },
];
