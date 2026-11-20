import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";
import { loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * THE STARTER'S EXAMPLE ON THE AGENT LOOP, WHATEVER THE WHO-QUESTION'S WORDS (QA's live re-test of #1127, 20 Nov 2026)
 * ============================================================================
 *
 * With STARTER_FOLLOW_UP_EXAMPLE_ENABLED on in production (dpl_EgcMZm, main 2c8ec520), the agent loop answered:
 * - "Create a coaching form." (main chat, conv_mwozm6yp2kkhien) → "I can set that up. Who is this Coaching Form for, and
 *   what's it about?" with no example: the who-question was matched only as "Who is this **<form>** for?", and the loop
 *   never ran the step at all;
 * - "Help me prepare for a coaching conversation." (the home chip, conv_mwozktvx2mbz6nk) → "A couple of things first:
 *   1. Who is this coaching conversation for? 2. What's the topic…?" with no example: that starter was not keyed.
 * General rule: every home starter answered with a who or which question gets one example answer, on the agent loop and
 * the regular chat alike; the who-question is any "Who is this / it … for …?" sentence. The replies are the live ones.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA's live re-test of #1127 (20 Nov 2026): the starters' who-questions on the agent loop got no example";
const offline = process.env.AGENT_LOOP_LIVE !== "1";

const replyWith = (text: string) => loopStandIn((): LoopDecision => ({ text }));

export const NOV20_AGENT_LOOP_STARTER_FOLLOW_UP_CASES: ReplayCase[] = [
  {
    id: "nov20-starter-loop-coaching-form-loose-who",
    title: "Live re-test: \"Create a coaching form.\" answered \"I can set that up. Who is this Coaching Form for, and what's it about?\" ends with the example answer",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      vi.setSystemTime(new Date("2026-11-20T15:00:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      t.loopModel!(replyWith("I can set that up. Who is this Coaching Form for, and what's it about?"));
      const reply = await t.thread().say("Create a coaching form.");
      expect(reply.content, `no example answer:\n${reply.content}`).toContain('For example: "coaching for <name> on greeting guests".');
    },
  },
  {
    id: "nov20-starter-loop-coaching-conversation-chip",
    title: "Live re-test: the home chip \"Help me prepare for a coaching conversation.\" answered \"A couple of things first: 1. Who is this coaching conversation for? 2. What's the topic…?\" ends with the example answer",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      vi.setSystemTime(new Date("2026-11-20T15:00:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      t.loopModel!(replyWith("A couple of things first:\n1. Who is this coaching conversation for?\n2. What's the topic you want to cover?"));
      const reply = await t.thread().say("Help me prepare for a coaching conversation.");
      expect(reply.content, `no example answer:\n${reply.content}`).toContain('For example: "a coaching conversation with <name> about greeting guests".');
    },
  },
  {
    id: "nov20-starter-loop-control-later-message",
    title: "Control: the same who-question to a later message (not the chat's first) gets no example",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      vi.setSystemTime(new Date("2026-11-20T15:00:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      t.loopModel!(replyWith("Who is this Coaching Form for?"));
      const thread = t.thread();
      await thread.say("hi");
      const reply = await thread.say("Create a coaching form.");
      expect(reply.content).not.toContain("For example:");
    },
  },
];
