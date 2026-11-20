import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";
import { loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * A DRAFTED MESSAGE KEEPS THE MANAGER'S MEANING, NEGATIONS INCLUDED (QA item 23; conv_mwm892j82eh29qo, verbatim, no names)
 * ============================================================================
 *
 * T2 the manager: "… 2 closers on slow nights isnt realostic but all closing duties need to be done …". T3 Sunny offered
 * the message or a team Coaching Form, paraphrasing it as "short-staffed slow nights". T4 "draft the message". T5 Sunny's
 * draft: "… only have 2 closers scheduled on slower nights — that's realistic given current traffic, and I'm not
 * expecting more coverage than that." REVERSED: it was drafted from Sunny's own T3 paraphrase, not the manager's T2.
 * General rule (the rules book's Replies): a message drafted for the manager says what THEY said, from their own
 * messages, every negation and limit kept; never from Sunny's earlier summary. Code never reads or writes the reply (the
 * loop's rule), so the rule is the model's; this case's stand-in drafts from the manager's own words only when the rules
 * book teaches it, as the live model would follow it.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA item 23 (production audit, conv_mwm892j82eh29qo): a drafted team message reversed \"2 closers on slow nights isnt realostic\"";
const offline = process.env.AGENT_LOOP_LIVE !== "1";

const T0 = "how do i address the team for closing duties not getting done correctly or fully.";
const T2 = "i need to send a message to everyone i want them to undestand that it is slow season right now and 2 closers on slow nights isnt realostic but all closing duties need to be done. i need them to send their goal sheet, cleaning closing checklist and cleaning binder sinage before they leave";
const T3 = "This sounds like a team-wide message. Draft the message itself, or set it up as a Coaching Form for the whole team (this would cover the expectation that closing duties be fully done despite short-staffed slow nights). Which do you want — just the message, the team Coaching Form, or both?";
const REVERSED = "Hi team, With it being slow season right now, I know we sometimes only have 2 closers scheduled on slower nights — that's realistic given current traffic, and I'm not expecting more coverage than that. What I do need: all closing duties completed fully, and turn in your goal sheet, cleaning/closing checklist and cleaning binder signage before you leave.";
const KEPT = "Hi team, It's slow season right now, and 2 closers on slow nights isn't realistic, but all closing duties still need to be done. Before you leave, send your goal sheet, cleaning closing checklist and cleaning binder signage.";

const managerTurns = (view: LoopView) => view.turns.filter((turn) => turn.role === "user").length;

export const NOV20_AGENT_LOOP_DRAFTED_MESSAGE_KEEPS_MEANING_CASES: ReplayCase[] = [
  {
    id: "nov20-drafted-message-keeps-negation-closers",
    title: "Item 23 (conv_mwm892j82eh29qo): \"… 2 closers on slow nights isnt realostic but all closing duties need to be done …\", Sunny offers the message or a team Coaching Form, \"draft the message\": the draft keeps \"isn't realistic\", never \"that's realistic\"",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      vi.setSystemTime(new Date("2026-11-19T20:00:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      const model = loopStandIn((view): LoopDecision => {
        const turn = managerTurns(view);
        if (turn === 1) return { text: "Here's a way to coach the team on closing duties: set the expectation, walk the checklist together, and follow up each night." };
        if (turn === 2) return { text: T3 };
        // T5: the live model follows the rules book; without the drafting rule it drafted from its own T3 paraphrase.
        return { text: /never from your earlier summary/.test(view.system) ? KEPT : REVERSED };
      });
      t.loopModel!(model);
      const thread = t.thread();
      await thread.say(T0);
      await thread.say(T2);
      const draft = await thread.say("draft the message");
      expect(model.views.at(-1)!.system, "the rules book does not teach drafting from the manager's own words").toMatch(/draft it from their own messages, never from your earlier summary/);
      expect(draft.content, `the draft reversed the manager's meaning:\n${draft.content}`).not.toMatch(/that's realistic|not expecting more coverage/i);
      expect(draft.content).toMatch(/isn't realistic/);
    },
  },
];
