import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * THE COACHING "OTHER" TOPIC IS THE TOPIC (QA, 17 Nov 2026; the tester's coaching form)
 * ============================================================================
 *
 * The saved Coaching Form's Other topic read "Coaching for test testy on greeting guests at the door": the whole request,
 * the lowercase name included. QA's ruling, (a) with (b) as the fallback:
 * (a) the loop's coaching card carries the topic (`topic`, kept only with topic_evidence from the manager's message of this
 *     request whose quote holds every word of it, never the person's name), and Create writes it as Other's topic;
 * (b) with no topic on the card, the topic is what follows the form's own employee name ("… on greeting guests at the
 *     door" → "Greeting guests at the door").
 * Every case runs the real Create path; the drafting model is a stand-in that ticks Other. Names invented.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA (17 Nov 2026): the tester's coaching form saved the request sentence as the Other topic";
const offline = process.env.AGENT_LOOP_LIVE !== "1";
const SAID = "Coaching for remy calder on greeting guests at the door";

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-16T18:00:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
}

type Facts = { facts?: { topic_not_kept?: unknown } } | undefined;

/** A coaching card with this topic input, then Create; the drafter ticks Other and writes `drafterTopic` (or none). */
async function created(t: ReplayContext, topic: { topic?: string; evidence?: string }, drafterTopic?: string) {
  const results: Facts[] = [];
  t.loopModel!(loopStandIn((view): LoopDecision => {
    const result = lastResult(view, "propose_form");
    if (result) {
      results.push(result as Facts);
      return { text: "Here's the card." };
    }
    const asked = typeof topic.topic === "string" ? { topic: topic.topic, topic_evidence: evidenceFrom(view, String(topic.evidence)) } : {};
    return { tool: "propose_form", input: { template_key: "coaching", employee_name: "Remy Calder", person_evidence: evidenceFrom(view, "remy calder"), what_happened: "Remy is not greeting guests at the door.", ...asked } };
  }));
  t.draftWrites({ coaching_details: "Observed:\nRemy is not greeting guests at the door.", ...(drafterTopic ? { other_topic: drafterTopic } : {}) }, { coaching_topics: ["other"] });
  const thread = t.thread();
  await thread.say(SAID);
  const id = await thread.create();
  return { topic: t.values(id).other_topic ?? "", card: (thread.proposal as { coachingTopic?: string } | null)?.coachingTopic ?? null, facts: results.at(-1)?.facts };
}

const fixed = (id: string, title: string, run: (t: ReplayContext) => Promise<void>): ReplayCase => ({
  id,
  title,
  report: REPORT,
  status: "fixed",
  fixFlags: [FLAG],
  async run(t) {
    if (!t.loopOn?.() || !offline) return;
    start(t);
    await run(t);
  },
});

export const NOV17_COACHING_OTHER_TOPIC_CASES: ReplayCase[] = [
  fixed("nov17-coaching-topic-from-the-card", `(a) "${SAID}", the model names topic "greeting guests at the door" with evidence; the drafter writes the whole sentence as the topic: the saved topic is the card's`, async (t) => {
    const saved = await created(t, { topic: "greeting guests at the door", evidence: "greeting guests at the door" }, SAID);
    expect(saved.card).toBe("Greeting guests at the door");
    expect(saved.topic).toBe("Greeting guests at the door");
  }),
  fixed("nov17-coaching-topic-not-the-managers-words-refused", `(a) refused: a topic the manager never said ("phone use at the desk") is not kept on the card, and the saved topic falls back to the words after the name`, async (t) => {
    const saved = await created(t, { topic: "phone use at the desk", evidence: "greeting guests at the door" });
    expect(saved.card).toBeNull();
    expect(saved.facts?.topic_not_kept, "the model is not told the topic was refused").toBeTruthy();
    expect(saved.topic).toBe("Greeting guests at the door");
  }),
  fixed("nov17-coaching-topic-with-the-name-refused", `(a) refused: a topic holding the person's name ("remy calder on greeting guests") is not kept on the card`, async (t) => {
    const saved = await created(t, { topic: "remy calder on greeting guests", evidence: "remy calder on greeting guests" });
    expect(saved.card).toBeNull();
  }),
  fixed("nov17-coaching-topic-fallback-after-the-name", `(b) no topic from the model, the drafter leaves it blank: the saved topic is the words after the employee's name, not "${SAID}"`, async (t) => {
    const saved = await created(t, {});
    expect(saved.topic).toBe("Greeting guests at the door");
  }),
];
