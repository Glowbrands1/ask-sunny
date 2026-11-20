import { expect, vi } from "vitest";

import type { ChatFormProposal } from "@/types";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * "DRS NOTE" IS A DOCTOR'S NOTE (Pau via QA, 20 Nov 2026)
 * ============================================================================
 *
 * Pau: "make sure ai loop understands drs note = doctors note or shortcut for doctor = dr". Managers' shorthand "dr", "dr.",
 * "drs note", "dr's note", "dr note" means doctor / doctor's note: never a person's name or title (no Did-you-mean, no
 * "Dr <name>" person), read as an attendance account (the manual: absent more than two days needs a doctor's note), and
 * spelled out as "doctor's note" on the card and the write-up. A small explicit abbreviation map in the rules book; no word
 * list in code. Production's chat_messages (read only, 20 Nov) hold three managers' messages with this wording, all policy
 * questions: "when does employee need to provide drs note", "what does policy say about drs note", "when does employee need
 * to provide doctors note"; the CA case is written in their style. Invented names only (Remy Calder).
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "Pau via QA (20 Nov 2026): \"make sure ai loop understands drs note = doctors note or shortcut for doctor = dr\"";
const RULE = /Managers' shorthand for a doctor \(Pau, 20 Nov 2026\): "dr", "dr\.", "drs", "dr note", "drs note" and "dr's note" mean doctor and a doctor's note\. They are never a person, a name or a title: no find_staff and no Did-you-mean for them\. Spell them out \("doctor's note", "doctor"\)/;

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-20T09:00:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
}

const managerTurns = (view: LoopView) => view.turns.filter((turn) => turn.role === "user" && (turn.messageIds?.length ?? 0) > 0);
const quoted = (view: LoopView, quote: string) => ({ message_id: managerTurns(view).at(-1)?.messageIds?.at(-1) ?? "current", quote });
const card = (reply: { formProposal?: unknown }) => (reply.formProposal as (ChatFormProposal & { policyLine?: string | null }) | undefined) ?? null;

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

export const NOV20_AGENT_LOOP_DOCTORS_NOTE_CASES: ReplayCase[] = [
  fixed("nov20-drs-note-is-a-doctors-note-ca", "\"ca for remy calder she was absent 3 days in a row 11/12 11/13 11/14 and didnt bring a drs note\": the rules book teaches the shorthand; the card is Remy Calder's attendance CA, its account says \"doctor's note\" (never \"drs note\"), and no Did-you-mean is asked", async (t) => {
    const systems: string[] = [];
    const tools: string[] = [];
    t.loopModel!(loopStandIn((view): LoopDecision => {
      systems.push(view.system);
      tools.push(...view.results.map((result) => result.tool));
      if (view.results.some((result) => result.tool === "propose_form")) return { text: "Here's the Corrective Action Form for **Remy Calder**." };
      return { tool: "propose_form", input: { template_key: "dpoa", employee_name: "Remy Calder", person_evidence: quoted(view, "remy calder"), what_happened: "Was absent 3 days in a row (11/12, 11/13 and 11/14) and did not bring a doctor's note on return.", incident_date: "2026-11-14", policy: "Attendance" } };
    }));
    const reply = await t.thread().say("ca for remy calder she was absent 3 days in a row 11/12 11/13 11/14 and didnt bring a drs note");
    expect(systems[0], "the doctor shorthand is not in the model's instructions").toMatch(RULE);
    expect(card(reply)?.employeeName).toBe("Remy Calder");
    expect(card(reply)?.issue ?? "").toMatch(/doctor's note/);
    expect(card(reply)?.issue ?? "", "the card echoes the shorthand").not.toMatch(/\bdrs?\b/i);
    expect(card(reply)?.policyLine ?? "").toMatch(/^Attendance Policy, JBA Policy Manual p\.\d+$/);
    expect(reply.content, "the shorthand was asked about as a name").not.toMatch(/Did you mean/);
    expect(tools, "the shorthand was looked up as a person").not.toContain("find_staff");
  }),
  fixed("nov20-drs-note-policy-question", "A manager's own question, \"when does employee need to provide drs note\": the rules book teaches the shorthand, the policy is read under Attendance, and nobody is looked up or asked about as a name", async (t) => {
    const systems: string[] = [];
    const tools: string[] = [];
    t.loopModel!(loopStandIn((view): LoopDecision => {
      systems.push(view.system);
      tools.push(...view.results.map((result) => result.tool));
      if (view.results.some((result) => result.tool === "read_policy")) return { text: "Under the Attendance policy, an employee absent from work for more than two days needs a doctor's note on return to work." };
      return { tool: "read_policy", input: { heading: "Attendance" } };
    }));
    const reply = await t.thread().say("when does employee need to provide drs note");
    expect(systems[0], "the doctor shorthand is not in the model's instructions").toMatch(RULE);
    expect(tools).toContain("read_policy");
    expect(tools, "the shorthand was looked up as a person").not.toContain("find_staff");
    expect(reply.content).not.toMatch(/Did you mean|drs note/i);
    expect(card(reply), "a policy question made a card").toBeNull();
  }),
  ...[
    "when does employee need to provide drs note",
    "what does policy say about drs note",
    "when does employee need to provide doctors note",
  ].map((question, index): ReplayCase => ({
    id: `nov20-drs-note-question-path-searches-attendance-${index + 1}`,
    title: `QA's production audit: "${question}" on the question-answering path (not the loop): the search asks for the Attendance section, where the manual's doctor's-note rule is`,
    report: `${REPORT}; QA's production audit (20 Nov 2026): "when does employee need to provide drs note" was answered from Immigration Law Compliance`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      /* No loop model: the pack lists nobody in AGENT_LOOP_USERS, so this manager is answered by the question path. */
      start(t);
      t.normalizerReads?.("policy_question");
      await t.thread().say(question);
      const searched = t.searches?.() ?? [];
      expect(searched.length, "nothing was searched").toBeGreaterThan(0);
      expect(searched.some((query) => /\bAttendance\b/.test(query)), `the search never asked for Attendance: ${JSON.stringify(searched)}`).toBe(true);
    },
  })),
];
