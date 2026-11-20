import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * A CORRECTIVE ACTION MAY CITE TWO HEADINGS (Pau's ruling via QA, 20 Nov 2026; Runner 2's c091)
 * ============================================================================
 *
 * c091 T2: "… She was also not in dress code, was not wearing her nametag, and did not have a goal sheet until she was
 * asked about it. Written warning …". With the production manual the loop card cited Dress Code and Other — 10-minute
 * sanitization, and Standards of Conduct dropped out: a card cited one heading. Ask Sunny's own saved form ticked
 * Standards of Conduct and Dress Code. Pau's ruling: a Corrective Action may cite two manual headings when the manager
 * describes two offenses. propose_form takes "<heading>; <heading>" (plus an optional "; Other — <topic>"), both real
 * headings, never three; the card line names both with their pages; Create ticks both boxes and Policy Violated names both.
 * One heading stays the norm. Every case runs the real Create path. Names invented (Remy Calder).
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "Pau's ruling via QA (20 Nov 2026): a Corrective Action may cite two manual headings (Runner 2's c091 on the full manual)";
const offline = process.env.AGENT_LOOP_LIVE !== "1";

/** The production manual's Dress Code section, as its chunk lays it out (printed page 15; wording invented). */
const DRESS_CODE = {
  chunkIndex: 44,
  chunkId: "jba-44",
  locator: "Page 15 — Dress Code for The Company",
  page: 16,
  printedPage: 15,
  section: "Dress Code for The Company",
  sections: [{ heading: "Dress Code for The Company", page: 15 }, { heading: "All Locations Dress Code", page: 15 }],
  content: "Dress Code for The Company\nEmployees wear approved work attire and their name tag on every shift.\nAll Locations Dress Code:\nNo mini skirts or short shorts.",
};

/*
 * c091's turns, verbatim (spacing and typos kept), with invented names: Remy Calder is the card's person; Brisa, Corin
 * Rennick and Delphine Sorrowby as Runner 2 masked them.
 */
const C091_T1 = "I need a corrective action for  f";
const C091_T2 = `Remy Calder, today, - Brisa set up a spray booth, then went into Room 4 and stayed there until the first customer arrived at 7:57am.
- When we arrived at 8:15am, the lobby lights were still off.
- When Corin asked whether she had completed her 10-minute sanitization, Brisa said yes. The footage showed that it had not been completed.
- She was also not in dress code, was not wearing her nametag, and did not have a goal sheet until she was asked about it. Written warning. previous coaching. verbal (06/25/2026) and written (07/28/2026). no payroll deducation. TC`;
/* The loop's what_happened on T2 (Runner 2's trace). */
const C091_ACCOUNT = "Brisa set up a spray booth, then went into Room 4 and stayed there until the first customer arrived at 7:57am. When we arrived at 8:15am, the lobby lights were still off. When Corin asked whether she had completed her 10-minute sanitization, Brisa said yes. The footage showed that it had not been completed. She was also not in dress code, was not wearing her nametag, and did not have a goal sheet until she was asked about it.";

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-16T18:00:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
  t.manualAlsoHas!([DRESS_CODE]);
}

/** One loop CA card with this policy; the first propose_form result is kept. */
function card(t: ReplayContext, policy: string, account: string, seen: Record<string, unknown>[]) {
  t.loopModel!(loopStandIn((view): LoopDecision => {
    const result = lastResult(view, "propose_form");
    if (result) {
      seen.push(result);
      return { text: "Here's the card." };
    }
    return { tool: "propose_form", input: { template_key: "dpoa", employee_name: "Remy Calder", person_evidence: evidenceFrom(view, "Remy Calder"), what_happened: account, policy, incident_date: "2026-11-14", warning_level: "written", level_evidence: evidenceFrom(view, "Written warning") } };
  }));
  t.draftWrites({ observation: `Observed:\n${account}\n\nExpectation:\nRemy is expected to follow the policy.` });
}

const policyLineOf = (reply: { formProposal?: unknown }) => String((reply.formProposal as { policyLine?: string } | undefined)?.policyLine ?? "");

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

export const NOV20_AGENT_LOOP_CA_TWO_HEADINGS_CASES: ReplayCase[] = [
  fixed("nov20-ca-two-headings-c091", "c091: \"I need a corrective action for  f\", then \"Remy Calder, today, - Brisa set up a spray booth … She was also not in dress code, was not wearing her nametag, and did not have a goal sheet until she was asked about it. Written warning. …\" proposed (as live) with \"Standards of Conduct; Other — 10-minute sanitization\": dress_code_heading offers both headings, the card made with them cites Dress Code and Standards of Conduct with their pages and the Other; Create ticks dress_code, standards_of_conduct and other, and Policy Violated names both", async (t) => {
    const seen: Record<string, unknown>[] = [];
    t.loopModel!(loopStandIn((view): LoopDecision => {
      const results = view.results.filter((result) => result.tool === "propose_form").map((result) => result.output);
      const last = results.at(-1);
      if (view.turns.filter((turn) => turn.role === "user").length === 1) return { text: "Who is this Corrective Action Form for?" };
      if (last) seen.push(last);
      if (last && (last.reason_code !== "dress_code_heading" || results.length > 1)) return { text: "Here's the card." };
      /* As live: Standards of Conduct and Other first; then the pair the refusal offers, else its first fit. */
      const offered = last ? /cite both: policy "([^"]+)"/.exec(String(last.error ?? ""))?.[1] ?? (last.fits_headings as string[] | undefined)?.[0] : undefined;
      return { tool: "propose_form", input: { template_key: "dpoa", employee_name: "Remy Calder", person_evidence: evidenceFrom(view, "Remy Calder"), what_happened: C091_ACCOUNT, policy: offered ?? "Standards of Conduct; Other — 10-minute sanitization", warning_level: "written", level_evidence: evidenceFrom(view, "Written warning") } };
    }));
    t.draftWrites({ observation: `Observed:\n${C091_ACCOUNT}\n\nExpectation:\nRemy is expected to follow the policy.` });
    const thread = t.thread();
    await thread.say(C091_T1);
    const reply = await thread.say(C091_T2);
    expect(seen[0]?.reason_code, JSON.stringify(seen[0])).toBe("dress_code_heading");
    expect(String(seen[0]?.error ?? ""), "the refusal does not offer both headings").toContain('cite both: policy "Dress Code for The Company; Standards of Conduct; Other — 10-minute sanitization"');
    expect(seen[1]?.reason_code, JSON.stringify(seen[1])).toBeUndefined();
    expect(policyLineOf(reply)).toBe("Dress Code for The Company Policy, JBA Policy Manual p.15; Standards of Conduct Policy, JBA Policy Manual p.12; Other — 10-minute sanitization");
    const id = await thread.create();
    expect([...(t.checked(id).offense_type ?? [])].sort(), "Type of Offense").toEqual(["dress_code", "other", "standards_of_conduct"]);
    const violated = t.values(id).policy_violated ?? "";
    expect(violated, "Policy Violated").toContain("Dress Code for The Company Policy, JBA Policy Manual p.15");
    expect(violated, "Policy Violated").toContain("Standards of Conduct Policy, JBA Policy Manual p.12");
    expect(violated, "Policy Violated").toContain("Other — 10-minute sanitization");
  }),
  fixed("nov20-ca-two-headings-control-one-offense-one-heading", "Control: \"Written warning for Remy Calder, she was not in dress code on 11/14\" proposed with \"Dress Code for The Company\": one heading on the card, and Create ticks Dress Code alone", async (t) => {
    const seen: Record<string, unknown>[] = [];
    card(t, "Dress Code for The Company", "On 11/14 Remy was not in dress code.", seen);
    const thread = t.thread();
    const reply = await thread.say("Written warning for Remy Calder, she was not in dress code on 11/14");
    expect(policyLineOf(reply)).toBe("Dress Code for The Company Policy, JBA Policy Manual p.15");
    const id = await thread.create();
    expect(t.checked(id).offense_type ?? []).toEqual(["dress_code"]);
    expect(t.values(id).policy_violated ?? "").toBe("Dress Code for The Company Policy, JBA Policy Manual p.15");
  }),
  fixed("nov20-ca-two-headings-never-three", "Three headings (\"Dress Code for The Company; Standards of Conduct; Attendance\") are refused with too_many_headings", async (t) => {
    const seen: Record<string, unknown>[] = [];
    card(t, "Dress Code for The Company; Standards of Conduct; Attendance", C091_ACCOUNT, seen);
    await t.thread().say(C091_T2);
    expect(seen[0]?.reason_code, JSON.stringify(seen[0])).toBe("too_many_headings");
  }),
  fixed("nov20-ca-two-headings-second-must-be-a-heading", "A second part that is no heading of the manual (\"Dress Code for The Company; Goal Sheets\") is refused with not_a_heading", async (t) => {
    const seen: Record<string, unknown>[] = [];
    card(t, "Dress Code for The Company; Goal Sheets", C091_ACCOUNT, seen);
    await t.thread().say(C091_T2);
    expect(seen[0]?.reason_code, JSON.stringify(seen[0])).toBe("not_a_heading");
  }),
];
