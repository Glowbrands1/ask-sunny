import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * FIX BATCH ITEM 5: AN EXIT ASK LOST TO ANOTHER PERSON NAMED AS A PARTY (QA's shadow replay, c219, 16 Nov 2026)
 * ============================================================================
 *
 * c219's shape (masked by the Runner): T1 a pasted termination-meeting script naming the person by a first name one letter
 * off (<A'>) and the salon director (<B>, an active roster person) as the one disrespected; T2 "I need an exit form with
 * this information." and the script again; T3 "For <A>" in full (<A> is not on the active roster). The loop's request
 * check read T1 and T2 as <B>'s (request_evidence_other_person), the exit ask was lost and a termination CA came instead.
 * A turn that also names the card's person (a one-edit first name no active roster person has, once the manager named
 * them in full) keeps <B> as a party (QA's ruling, with limits (a) and (b)). Invented names only: Odalys Fenwick (<A>),
 * "Odalis" (<A'>), Juno Paxton (<B>).
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA's 266 shadow replay, c219 (fix batch item 5): an explicit exit request became a Corrective Action; request_evidence_other_person misfired";
const SCRIPT = (first: string) =>
  `${first}, this meeting is about the text you sent your salon director Juno Paxton on 11/3. It was disrespectful. Your employment with us is terminated, effective 11/5. Please return your keys; your final paycheck will be mailed.`;
const ASK = "I need an exit form with this information.";

function start(t: ReplayContext, extra: typeof STAFF = []) {
  vi.setSystemTime(new Date("2026-11-15T22:40:00Z"));
  t.directory([...STAFF, ...extra]);
  t.as("salon_director", KEARNEY);
}

const lastSaid = (view: LoopView) => [...view.turns].reverse().find((turn) => turn.role === "user")?.text ?? "";

/** The model: asks about the name until "use Odalys Fenwick", then the exit card citing T1 and T2 (T2's ask). */
function model() {
  return loopStandIn((view): LoopDecision => {
    const said = lastSaid(view);
    if (/^use Odalys Fenwick/i.test(said)) {
      const card = lastResult(view, "propose_form") as { reason_code?: string } | null;
      if (!card) {
        return {
          tool: "propose_form",
          input: {
            template_key: "stc-exit",
            employee_name: "Odalys Fenwick",
            exit_type: "termination",
            effective_date: "11/5",
            exit_evidence: { ...evidenceFrom(view, ASK, 2), kind: "asks_for_exit_form" },
            request_evidence: [evidenceFrom(view, "this meeting is about the text you sent", 3), evidenceFrom(view, ASK, 2)],
          },
        };
      }
      return { text: card.reason_code ?? "Here's the Resignation/Exit Form for **Odalys Fenwick**." };
    }
    if (/^For Odalys Fenwick/i.test(said)) {
      const staff = lastResult(view, "find_staff") as { note?: string } | null;
      if (!staff) return { tool: "find_staff", input: { name: "Odalys Fenwick", person_evidence: evidenceFrom(view, "Odalys Fenwick") } };
      return { text: /Ask the manager, in these words: ([\s\S]+)$/.exec(staff.note ?? "")?.[1] ?? "Reply **use Odalys Fenwick**." };
    }
    return { text: "I can't find **Odalis** on your staff list. Who is this for?" };
  });
}

async function c219(t: ReplayContext, first: string) {
  const thread = t.thread();
  await thread.say(SCRIPT(first));
  await thread.say(`${ASK} ${SCRIPT(first)}`);
  await thread.say("For Odalys Fenwick");
  const reply = await thread.say("use Odalys Fenwick");
  return { thread, reply };
}

export const NOV16_FIX_BATCH_EXIT_OTHER_PARTY_CASES: ReplayCase[] = [
  {
    id: "nov16-fix-batch-5-exit-ask-kept-when-the-script-names-a-party-c219",
    title: "Fix batch item 5 (c219's shape): a script naming \"Odalis\" and the director Juno Paxton, then \"I need an exit form with this information.\" with the script, then \"For Odalys Fenwick\" and \"use Odalys Fenwick\": the cited turns are this request's (Juno is a party) and the exit card is made for Odalys Fenwick, never a CA",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      t.loopModel!(model());
      const { thread, reply } = await c219(t, "Odalis");
      expect(thread.proposal?.templateKey, `the exit ask was lost to the party named in the script:\n${reply.content}`).toBe("stc-exit");
      expect(thread.proposal?.employeeName).toBe("Odalys Fenwick");
    },
  },
  {
    id: "nov16-fix-batch-5-a-turn-naming-only-the-other-person-is-still-refused",
    title: "Fix batch item 5 control: the same chat with the script naming nobody but Juno Paxton keeps today's refusal (request_evidence_other_person), no card",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      t.loopModel!(model());
      const { thread, reply } = await c219(t, "Hey");
      expect(thread.proposal, "a turn about Juno Paxton alone was cited as Odalys Fenwick's request").toBeFalsy();
      expect(reply.content).toBe("request_evidence_other_person");
    },
  },
  {
    id: "nov16-fix-batch-5-a-spelling-near-two-people-stays-refused",
    title: "Fix batch item 5, QA's limit (b): with Odalie Brandt also on the roster, \"Odalis\" is one edit from two people's first names (Odalys, Odalie), so the turn stays refused (request_evidence_other_person), no card",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t, [{ id: "e-9", firstName: "Odalie", lastName: "Brandt", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" }]);
      t.loopModel!(model());
      const { thread, reply } = await c219(t, "Odalis");
      expect(thread.proposal, "an ambiguous one-edit spelling kept the turn in the request").toBeFalsy();
      expect(reply.content).toBe("request_evidence_other_person");
    },
  },
];
