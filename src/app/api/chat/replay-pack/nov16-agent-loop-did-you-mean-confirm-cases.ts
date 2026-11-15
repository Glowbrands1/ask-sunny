import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * FIX BATCH ITEM 4: THE "DID YOU MEAN" ANSWER (QA, 16 Nov 2026)
 * ============================================================================
 *
 * HANDOFF section 7, item 4: "'Did you mean' confirmation: one consistent instruction, and accept the full name typed
 * back (c022: 4 turns, no card)." From the targeted re-run of 67 chats on main with the 11 rebuild PRs (the Runner's
 * masked set). Invented people: Remy Calder is on the roster; "Remi Calder" is a close spelling of her that is nobody.
 *
 * Under Pau's ruling A a close spelling is asked, never seated. When the manager typed Remy Calder's full name back,
 * the turn that had typed "Remi Calder" read as another person's request: the card lost that turn's date
 * (date_from_another_request), and find_staff gave no sign the answer was a yes.
 */

const FLAG = "AGENT_LOOP_ENABLED";
/* Pau 15 Nov: A (a close spelling is never seated); on in production. */
const NEAR_MISS = "NEAR_MISS_NEVER_SEATED_ENABLED";
const REPORT = "QA's targeted re-run (16 Nov 2026), c022, from the Runner's masked set; HANDOFF section 7 item 4";

const latest = (view: LoopView) => [...view.turns].reverse().find((turn) => turn.role === "user")?.text ?? "";

type StaffResult = {
  matches?: { employee_id: string; name: string }[];
  note?: string;
  also_ask_if_no_account?: string;
  confirmed_by_manager?: { name: string; typed_before: string; answer: string };
} | null;

async function salon(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-14T22:40:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
}

/**
 * A stand-in that does what the tool results say: it looks up what the manager typed, asks a Did-you-mean in the
 * note's own words, and proposes the card with the account the manager gave in the first turn.
 */
function confirmingModel(seen: StaffResult[]) {
  return loopStandIn((view): LoopDecision => {
    const said = latest(view);
    const staff = lastResult(view, "find_staff") as StaffResult;
    if (!staff) return { tool: "find_staff", input: { name: view.turns.filter((turn) => turn.role === "user").length > 1 ? said.trim() : "Remi Calder" } };
    if (!seen.includes(staff)) seen.push(staff);
    const asked = /Ask the manager, in these words: ([\s\S]+)$/.exec(staff.note ?? "")?.[1];
    if (asked) return { text: [asked, staff.also_ask_if_no_account].filter(Boolean).join("\n\n") };
    const person = staff.matches?.[0];
    if (person && !lastResult(view, "propose_form")) {
      return { tool: "propose_form", input: { template_key: "coaching", employee_id: person.employee_id, what_happened: "She was late to her shift on 11/14.", incident_date: "2026-11-14" } };
    }
    return { text: `Here's the Coaching Form for **${person?.name ?? ""}**.` };
  });
}

export const NOV16_AGENT_LOOP_DID_YOU_MEAN_CONFIRM_CASES: ReplayCase[] = (["Remy Calder", "remy calder"] as const).map((typedBack): ReplayCase => ({
  id: `nov16-item4-full-name-typed-back-is-a-yes-${typedBack === "Remy Calder" ? "c022" : "c022-lowercase"}`,
  title: `Item 4 (c022's shape): "put together a coaching document for Remi Calder, she was late to her shift on 11/14" asks Did you mean **Remy Calder**?; "${typedBack}" typed back is a yes: find_staff says the manager confirmed her, and the card is Remy Calder's, ready, keeping 11/14 from the first turn`,
  report: `${REPORT}: the full name typed back after the Did-you-mean went 4 turns with no card`,
  status: "fixed",
  fixFlags: [FLAG, NEAR_MISS],
  async run(t) {
    if (!t.loopOn?.()) return;
    await salon(t);
    const seen: StaffResult[] = [];
    t.loopModel!(confirmingModel(seen));
    const thread = t.thread();
    const ask = await thread.say("put together a coaching document for Remi Calder, she was late to her shift on 11/14");
    expect(thread.proposal ?? null, `a close spelling was carded:\n${ask.content}`).toBeNull();
    expect(ask.content).toMatch(/Did you mean \*\*Remy Calder\*\*\?/);
    await thread.say(typedBack);
    expect(seen.at(-1)?.confirmed_by_manager, "find_staff did not say the full name typed back confirmed her").toEqual({ name: "Remy Calder", typed_before: "Remi Calder", answer: "full_name" });
    expect(thread.proposal?.employeeName).toBe("Remy Calder");
    expect(thread.proposal?.status, "the card is not ready after the answer").toBe("ready");
    expect(thread.proposal?.formDate, "the first turn's date was dropped as another person's request").toBe("2026-11-14");
  },
}));

/*
 * HANDOFF section 7, item 3: "c137: after 'Did you mean X?', the manager pasted an account naming another person in
 * full, and the loop carded X. A reply that names someone else is not a yes." The stand-in here does what c137's model
 * did: it takes the offered name as if the manager had said yes. Code refuses that card (right_person) and the reply
 * asks; the account's own person is looked up instead.
 */
NOV16_AGENT_LOOP_DID_YOU_MEAN_CONFIRM_CASES.push(
  ...([
    ["roster", "Juno Paxton was late to her shift on 11/14 and did not call ahead."],
    ["off-roster", "Odessa Vantreight was late to her shift on 11/14 and did not call ahead."],
  ] as const).map(([tag, pasted]): ReplayCase => ({
    id: `nov16-item3-reply-naming-someone-else-is-not-a-yes-c137-${tag}`,
    title: `Item 3 (c137's shape): "put together a coaching document for Remi" asks Did you mean **Remy Calder**?; the pasted account "${pasted}" is not a yes: no card for Remy Calder, and the reply asks`,
    report: "QA's targeted re-run (16 Nov 2026), c137, from the Runner's masked set; HANDOFF section 7 item 3",
    status: "fixed",
    fixFlags: [FLAG, NEAR_MISS],
    async run(t) {
      if (!t.loopOn?.()) return;
      await salon(t);
      const refusals: string[] = [];
      t.loopModel!(loopStandIn((view): LoopDecision => {
        const staff = lastResult(view, "find_staff") as StaffResult;
        const second = view.turns.filter((turn) => turn.role === "user").length > 1;
        // c137's model: the offered name, as if the pasted account were a yes.
        if (!staff) return { tool: "find_staff", input: { name: second ? "Remy Calder" : "Remi" } };
        const asked = /Ask the manager, in these words: ([\s\S]+)$/.exec(staff.note ?? "")?.[1];
        if (asked) return { text: [asked, staff.also_ask_if_no_account].filter(Boolean).join("\n\n") };
        const card = lastResult(view, "propose_form") as { error?: string } | null;
        const person = staff.matches?.[0];
        if (person && !card) return { tool: "propose_form", input: { template_key: "coaching", employee_id: person.employee_id, what_happened: "She was late to her shift on 11/14 and did not call ahead.", incident_date: "2026-11-14" } };
        if (card?.error) {
          refusals.push(card.error);
          return { text: /ask: "([^"]+)"/.exec(card.error)?.[1] ?? "Who is this Coaching Form for?" };
        }
        return { text: `Here's the Coaching Form for **${person?.name ?? ""}**.` };
      }));
      const thread = t.thread();
      const ask = await thread.say("put together a coaching document for Remi");
      expect(ask.content).toMatch(/Did you mean \*\*Remy Calder\*\*\?/);
      const reply = await thread.say(pasted);
      expect(thread.proposal?.employeeName ?? null, `a reply naming someone else carded Remy Calder:\n${reply.content}`).not.toBe("Remy Calder");
      expect(refusals.at(-1) ?? "", "propose_form did not refuse the offered name").toMatch(/not a yes/);
      expect(reply.content).toMatch(/Is this form for \*\*(Juno Paxton|Odessa Vantreight)\*\* or \*\*Remy Calder\*\*\?/);
    },
  })),
);

/*
 * HANDOFF section 7, item 6: "c124: a bare first name answering 'Who is it for?' gets no find_staff call; c165: a first
 * name read as an acronym." The stand-in replies as those models did, without a lookup; code hands the turn back once
 * ([app check]) and the second pass looks the name up and cards the person.
 */
NOV16_AGENT_LOOP_DID_YOU_MEAN_CONFIRM_CASES.push(
  ...([
    ["c124", "rowan", "Rowan Kestrel", "Who is this Coaching Form for?"],
    ["c165", "juno", "Juno Paxton", "What does JUNO stand for?"],
  ] as const).map(([tag, answer, person, firstReply]): ReplayCase => ({
    id: `nov16-item6-first-name-answer-is-looked-up-${tag}`,
    title: `Item 6 (${tag}'s shape): "I need a coaching form" asks "Who is this Coaching Form for?"; the bare answer "${answer}" got a reply with no find_staff ("${firstReply}"); code hands it back once and the card is ${person}'s`,
    report: `QA's targeted re-run (16 Nov 2026), ${tag}, from the Runner's masked set; HANDOFF section 7 item 6`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      await salon(t);
      const notes: string[] = [];
      t.loopModel!(loopStandIn((view): LoopDecision => {
        const said = latest(view);
        const managerSaid = view.turns.filter((turn) => turn.role === "user" && !turn.text.startsWith("[app check]")).map((turn) => turn.text);
        if (managerSaid.length === 1) return { text: "Who is this Coaching Form for?" };
        if (!said.startsWith("[app check]")) return { text: firstReply };
        if (!notes.includes(said)) notes.push(said);
        const staff = lastResult(view, "find_staff") as StaffResult;
        const words = managerSaid.at(-1)!;
        if (!staff) return { tool: "find_staff", input: { name: words, person_evidence: { message_id: view.turns.filter((turn) => turn.role === "user").at(-2)?.messageIds?.[0] ?? "", quote: words } } };
        const match = staff.matches?.[0];
        if (match && !lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "coaching", employee_id: match.employee_id } };
        return { text: `Here's the Coaching Form for **${match?.name ?? ""}**. What happened?` };
      }));
      const thread = t.thread();
      await thread.say("I need a coaching form");
      const reply = await thread.say(answer);
      expect(notes, "the turn was not handed back for a lookup").toHaveLength(1);
      expect(notes[0]).toMatch(/no find_staff ran this turn/);
      expect(thread.proposal?.employeeName, `the first name was never looked up:\n${reply.content}`).toBe(person);
    },
  })),
);
