import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, headingWith, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * THE CARD KEEPS WHAT IT HELD (port of Ask Bubbles #1058: its QA's live round 3, 22 Nov 2026, U21, T1–T12)
 * ============================================================================
 *
 * Found in Ask Bubbles; Sunny has the same gap. Since the port of #1038 (#1230) the model's history shows an earlier card
 * reply as one "[card shown under this reply: <form>]" line, so the model no longer knew what the card held: it proposed
 * the card again with only the field it was changing, and the card lost its account, policy and prior actions (T12
 * "previous coaching: …" asked "What happened this time?"). T10 "make this for <B> instead of <A>" dropped the level and
 * payroll <B>'s card held. T7 passed the policy as the card shows it and it was refused as not_a_heading.
 *
 * The tester's twelve turns keep their words and shape; the people are invented (Tamsyn Brevard, Ilka Morrowe) and the
 * duties are a salon's. An admin login (every salon). With AGENT_LOOP_LIVE=1 the stand-in is skipped.
 */

const TAMSYN: DirectoryRow = { id: "e-tamsyn-brevard", firstName: "Tamsyn", lastName: "Brevard", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };
const ILKA: DirectoryRow = { id: "e-ilka-morrowe", firstName: "Ilka", lastName: "Morrowe", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0307", "loc-0309"], positionName: "Tanning Consultant" };
const ADMIN = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };
const REPORT = "Ask Bubbles' live round 3 (22 Nov 2026, U21; port of #1058): T10 dropped the copied level and payroll; T12 lost the account (\"What happened this time?\", no Create)";

const T = [
  "corrective action",
  "tamsyn brevard",
  "This is what happened: She has recieved coaching on 9/22 for cleaning tasks not being completed. What was observed this weekend is that beds were not wiped down after each session, towels were not done",
  "jba woven policys were acknowledged on 5/26/26",
  "payroll is not deductable",
  "verbal warning",
  "add the direct policy from the official manual that goes with this",
  "make the same corrective action but for ilka morrowe",
  "no i want this to be a corrective action for a new person now",
  "make this for ilka instead of tamsyn",
  "yes",
  "previous coaching: there was a salon meeting in july 2026 and she signed the jba policys on 6/24/24",
] as const;
/* The pinned manual's Care and Cleaning section (as nov22-agent-loop-care-and-cleaning-saved-cases.ts adds it). */
const CARE_HEADING = "Care and Cleaning of Equipment and Facilities";
const CARE = { chunkIndex: 21.5, chunkId: "jba-21-5", locator: `Page 21 — ${CARE_HEADING}`, page: 22, content: `${CARE_HEADING}\nEmployees keep the salon, its beds and its equipment clean and sanitized as directed.`, section: CARE_HEADING, printedPage: 21, sections: [] };
const ACCOUNT = "Tamsyn received coaching on 9/22 for cleaning tasks not being completed. This weekend, beds were not wiped down after each session, and towels were not done.";

/** Ilka's forms on file, as the tester's card listed them. */
function onFile(t: ReplayContext): void {
  const row = (id: string, key: "dpoa" | "coaching", name: string, formDate: string) => ({
    id, ...t.templateIds!(key), variant_key: null, employee_role: null, location_id: KEARNEY.primaryAreaId, location_name: "NE Kearney",
    created_by: "another-manager", created_by_role: "salon_director", source: "ask_sunny", status: "finalized", follow_up_date: null, archived_at: null,
    revises_instance_id: null, template_key: key, template_name: name, employee_name: "Ilka Morrowe", form_date: formDate,
    created_at: `${formDate}T15:00:00Z`, updated_at: `${formDate}T15:00:00Z`,
  });
  (t.forms() as Record<string, unknown>[]).push(
    row("ca-ilka-1114", "dpoa", "Corrective Action Form", "2026-11-14"),
    row("cf-ilka-1116", "coaching", "Coaching Form", "2026-11-16"),
  );
  t.checkOnForm!("ca-ilka-1114", { warning_type: ["verbal"] });
}

const said = (view: LoopView) => view.turns.filter((turn) => turn.role === "user").at(-1)?.text ?? "";
const back = (view: LoopView, text: string) => {
  const asks = view.turns.filter((turn) => turn.role === "user" && (turn.messageIds?.length ?? 0) > 0);
  return Math.max(0, asks.length - 1 - asks.findIndex((turn) => turn.text === text));
};
/** What the model's history says the latest card held ("[card shown under this reply: … it held: <label> = \"…\"; …]"). */
function heldInHistory(view: LoopView): Record<string, string> {
  const line = [...view.turns].reverse().find((turn) => turn.role === "assistant" && /\[card shown under this reply:/.test(turn.text))?.text ?? "";
  const held = /it held: ([^\]]*)\]/.exec(line)?.[1] ?? "";
  return Object.fromEntries([...held.matchAll(/([^;=]+?) = "([^"]*)"/g)].map((match) => [match[1]!.trim(), match[2]!]));
}

/**
 * The stand-in, as the live model: from T4 on it knows the card only from its history, and proposes the card again with
 * what that history says the card held plus the turn's change (with nothing held shown, it proposed the changed field
 * alone, and the card lost its account).
 */
function model(view: LoopView): LoopDecision {
  const message = said(view);
  const result = lastResult(view, "propose_form") as { card?: Record<string, string | null> } | null;
  if (result) {
    /* The card reply, as the live model writes it: the card's own lines under its labels. */
    const card = result.card;
    if (!card) return { text: "That card wasn't made." };
    const line = (label: string, value: string | null | undefined) => (value ? [`**${label}:** ${value}`] : []);
    return { text: ["Here's the Corrective Action Form.", ...line("Observation of Offense", card.observation), ...line("Prior actions", card.prior_actions), ...line("Policy", card.policy), ...line("Type of Warning", card.warning_level), ...(card.payroll_deduct ? [`**Is payroll deduct applicable?** ${card.payroll_deduct}`] : [])].join("\n\n") };
  }
  const held = heldInHistory(view);
  const seen = (text: string) => view.turns.some((turn) => turn.role === "user" && turn.text === text);
  const ilka = seen(T[7]);
  const person = ilka ? { employee_id: ILKA.id, person_evidence: evidenceFrom(view, "ilka morrowe", back(view, T[7])) } : { employee_id: TAMSYN.id, person_evidence: evidenceFrom(view, "tamsyn brevard", back(view, T[1])) };
  const care = headingWith(view, /care and cleaning/i);
  /* As live: the card cites the Standards of Conduct until T7 asks for the policy that goes with it. */
  const policy = { policy: seen(T[6]) ? care : headingWith(view, /^standards of conduct/i) };
  if (message === T[0]) return { text: "Who is this Corrective Action Form for, and what happened?" };
  if (message === T[1]) return { text: "Got it, Tamsyn Brevard. What happened?" };
  if (message === T[2]) return { tool: "propose_form", input: { template_key: "dpoa", ...person, ...policy, what_happened: ACCOUNT, prior_actions: "Coaching — 09/22/2026 (cleaning tasks not being completed)" } };
  if (message === T[8]) return { text: "Got it — who is this new Corrective Action for, and what happened?" };
  if (message === T[10]) return { text: "The card above is still open; press Create when it looks right, or tell me what to change." };
  const base = {
    template_key: "dpoa", ...person, ...policy,
    ...(held["Observation of Offense"] ? { what_happened: held["Observation of Offense"].replace(/\bTamsyn\b/g, ilka ? "Ilka" : "Tamsyn") } : {}),
    ...(held["Prior actions"] && !ilka ? { prior_actions: held["Prior actions"] } : {}),
  };
  if (message === T[3]) return { tool: "propose_form", input: { ...base, prior_actions: `${held["Prior actions"] ?? ""}; Policy acknowledgement — 05/26/2026` } };
  if (message === T[4]) return { tool: "propose_form", input: { ...base, payroll_deduct: "no", payroll_evidence: evidenceFrom(view, T[4]) } };
  if (message === T[5]) return { tool: "propose_form", input: { ...base, warning_level: "verbal", level_evidence: evidenceFrom(view, T[5]) } };
  /* T7 as live: the policy written as the card shows a policy ("<section> — <heading>, JBA Policy Manual p.<n>"). */
  if (message === T[6]) return { tool: "propose_form", input: { ...base, policy: `Standards of Conduct — ${care ?? CARE_HEADING}, JBA Policy Manual p.21` } };
  if (message === T[7]) return { tool: "propose_form", input: { ...base, same_card_evidence: { ...evidenceFrom(view, T[7]), kind: "same_form" } } };
  /* T10 as live: the card asked for again ("this_card_for"), no level or payroll passed. */
  if (message === T[9]) return { tool: "propose_form", input: { ...base, same_card_evidence: { ...evidenceFrom(view, T[9]), kind: "this_card_for" } } };
  /* T12 as live: the stated prior steps, with what the card held. */
  return { tool: "propose_form", input: { ...base, prior_actions: "Salon meeting — July 2026; Signed JBA policies — 06/24/2024" } };
}

export const NOV23_AGENT_LOOP_U21_CARD_KEEPS_WHAT_IT_HELD_CASES: ReplayCase[] = [
  {
    id: "nov23-u21-r3-whole-chat-card-keeps-what-it-held",
    title: "U21 round 3 (the tester's T1–T12, invented people): the card keeps what it held when the model proposes it again — T10 \"make this for ilka instead of tamsyn\" keeps the Verbal/payroll No Ilka's card had (T8), T7's policy written as the card shows it is on the card, T12 \"previous coaching: …\" keeps the account, no reply shows the history's bracketed card line, and none says a change is not on the card",
    report: REPORT,
    status: "fixed",
    fixFlags: ["AGENT_LOOP_ENABLED"],
    async run(t) {
      if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
      vi.setSystemTime(new Date("2026-11-22T18:00:00Z"));
      t.directory([...STAFF, TAMSYN, ILKA]);
      t.as("admin", ADMIN);
      onFile(t);
      t.manualAlsoHas?.([CARE]);
      t.loopModel!(loopStandIn(model));
      const thread = t.thread();
      const cards: { turn: number; issue: string | null; level: string | null; payroll: string | null; policy: string | null; reply: string }[] = [];
      for (const [index, turn] of T.entries()) {
        const reply = await thread.say(turn);
        const card = thread.proposal as { issue?: string | null; warningLevel?: string | null; payrollDeduct?: string | null; policyLine?: string | null } | null;
        cards.push({ turn: index + 1, issue: card?.issue ?? null, level: card?.warningLevel ?? null, payroll: card?.payrollDeduct ?? null, policy: card?.policyLine ?? null, reply: reply.content });
      }
      const at = (turn: number) => cards[turn - 1]!;
      expect(at(10), `T10 dropped the level or payroll Ilka's card held: ${JSON.stringify(cards.slice(6, 10)).slice(0, 2500)}`).toMatchObject({ level: "verbal", payroll: "no" });
      expect(at(7).policy ?? "", `T7's policy, written as the card shows it, is not on the card: ${JSON.stringify(at(7))}`).toMatch(/Care and Cleaning/i);
      expect(at(12).issue ?? "", `T12 lost the account:\n${JSON.stringify(at(12))}`).toMatch(/beds were not wiped/i);
      expect(cards.filter((card) => /\[card shown under this reply/i.test(card.reply)).map((card) => card.turn), "a reply showed the history's card line").toEqual([]);
      /* Live: "That change isn't on the card yet: policy (…). Tell me again" — the policy the manager asked for is on the card. */
      expect(cards.filter((card) => /isn't on the card yet/i.test(card.reply)).map((card) => `T${card.turn}: ${card.reply}`), "a change was reported as not made").toEqual([]);
    },
  },
];
