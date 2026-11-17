import { expect, vi } from "vitest";

import type { ChatFormProposal } from "@/types";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * THE COACHING TOPIC IS STILL THE ACCOUNT; THE POLICY IS IN ADDITION (Runner 2's c243, c244, c075 on main 33863575; QA, 17 Nov 2026)
 * ============================================================================
 *
 * After #1092 (coaching cards always cite a policy), "make this form for salon cleanliness", "a coaching form for salon
 * cleanliness" and "coaching form for <P> at kearney about bed cleaning" came as policy "Other — <topic>" with an EMPTY
 * account, so the card was not ready; on train 4 the topic was the account and the card was ready. The rule: the
 * "Other — <topic>" policy never takes the account's place. A coaching topic the manager gave is still the account, and
 * the policy line is in addition. Invented names only (Remy Calder).
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "Runner 2's c243, c244 and c075 on main 33863575 (QA, 17 Nov 2026): a coaching topic went into the policy line (\"Other — Salon cleanliness\") and the account was left empty, so the card was not ready";

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-17T08:30:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
}

const managerTurns = (view: LoopView) => view.turns.filter((turn) => turn.role === "user" && (turn.messageIds?.length ?? 0) > 0);
const quoted = (view: LoopView, quote: string) => ({ message_id: [...managerTurns(view)].reverse().find((turn) => turn.text.toLowerCase().includes(quote.toLowerCase()))?.messageIds?.at(-1) ?? "current", quote });
const card = (reply: { formProposal?: unknown }) => (reply.formProposal as (ChatFormProposal & { policyLine?: string | null }) | undefined) ?? null;

/** The live model: a coaching card with the topic as "Other — <topic>" and no account; asks who first when nobody is named. */
function topicAsPolicy(policy: string, account?: string, topic?: string) {
  return loopStandIn((view): LoopDecision => {
    const result = [...view.results].reverse().find((entry) => entry.tool === "propose_form")?.output;
    if (result) return { text: typeof result.ask_exactly === "string" ? result.ask_exactly : "Here's the Coaching Form for **Remy Calder**." };
    if (!managerTurns(view).some((turn) => /remy calder/i.test(turn.text))) return { text: "Who is this Coaching Form for?" };
    return { tool: "propose_form", input: { template_key: "coaching", employee_name: "Remy Calder", person_evidence: quoted(view, "Remy Calder"), policy, ...(account ? { what_happened: account } : {}), ...(topic ? { topic, topic_evidence: quoted(view, topic) } : {}) } };
  });
}

function ready(reply: { formProposal?: unknown; content: string }, topic: RegExp) {
  expect(card(reply)?.templateKey, reply.content).toBe("coaching");
  expect(card(reply)?.issue ?? "", "the coaching topic the manager gave is not the account").toMatch(topic);
  expect(card(reply)?.awaitingIncident ?? false, "the card is not ready (it waits for an account the manager already gave)").toBe(false);
  expect(card(reply)?.policyLine ?? "", "the policy line was dropped").toMatch(/^Other — /);
}

const fixed = (id: string, title: string, run: (t: ReplayContext) => Promise<void>): ReplayCase => ({
  id,
  title,
  report: REPORT,
  status: "fixed",
  fixFlags: [FLAG],
  async run(t) {
    if (!t.loopOn?.()) return;
    start(t);
    await run(t);
  },
});

export const NOV17_AGENT_LOOP_COACHING_TOPIC_IS_THE_ACCOUNT_CASES: ReplayCase[] = [
  fixed("nov17-coaching-topic-is-the-account-c075", "c075: \"coaching form for Remy Calder at kearney about bed cleaning\", the model gives policy \"Other — Bed cleaning\" and no account: the account is \"Bed cleaning.\", the card is ready, and the policy line stays", async (t) => {
    t.loopModel!(topicAsPolicy("Other — Bed cleaning"));
    const reply = await t.thread().say("coaching form for Remy Calder at kearney about bed cleaning");
    ready(reply, /^Bed cleaning\.$/);
    expect(card(reply)?.policyLine).toBe("Other — Bed cleaning");
  }),
  fixed("nov17-coaching-topic-is-the-account-c244", "c244: \"a coaching form for salon cleanliness\", then \"Remy Calder\"; the model gives policy \"Other — Salon cleanliness\" and no account: the account is \"Salon cleanliness.\", the card is ready", async (t) => {
    t.loopModel!(topicAsPolicy("Other — Salon cleanliness"));
    const thread = t.thread();
    await thread.say("a coaching form for salon cleanliness");
    const reply = await thread.say("Remy Calder");
    ready(reply, /^Salon cleanliness\.$/);
  }),
  fixed("nov17-coaching-topic-is-the-account-c243-topic", "c243 as the trace shows it: \"Remy Calder. make this form for salon cleanliness\" (a coaching form chosen), the model sends topic \"salon cleanliness\" with its evidence and policy \"Other — Salon cleanliness\", no account: the account is \"Salon cleanliness.\", the card is ready", async (t) => {
    t.loopModel!(topicAsPolicy("Other — Salon cleanliness", undefined, "salon cleanliness"));
    const reply = await t.thread().say("Remy Calder. make this coaching form for salon cleanliness");
    ready(reply, /^Salon cleanliness\.$/);
  }),
  fixed("nov17-coaching-topic-account-control-model-account-kept", "Control: the model gives the account itself (\"Left the beds wet after cleaning.\") beside \"Other — Bed cleaning\": its account is kept, never replaced by the topic", async (t) => {
    t.loopModel!(topicAsPolicy("Other — Bed cleaning", "Left the beds wet after cleaning."));
    const reply = await t.thread().say("coaching form for Remy Calder at kearney about bed cleaning, she left the beds wet after cleaning");
    expect(card(reply)?.issue).toBe("Left the beds wet after cleaning.");
  }),
  fixed("nov17-coaching-topic-account-control-not-the-managers-words", "Control: an Other topic the manager never said (\"Other — Sanitation lapses\" for \"about bed cleaning\") is never made the account: nothing is invented", async (t) => {
    t.loopModel!(topicAsPolicy("Other — Sanitation lapses"));
    const reply = await t.thread().say("coaching form for Remy Calder at kearney about bed cleaning");
    expect(card(reply)?.issue ?? "", "an account the manager never gave was invented").not.toMatch(/Sanitation lapses/);
  }),
];
