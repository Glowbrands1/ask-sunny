import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * A COACHING FORM'S "OTHER" TOPIC IS THE TOPIC THE CARD NAMES, NEVER A SENTENCE OF THE ACCOUNT (port from the sibling
 * app, its QA's live re-run, 23 Nov 2026, A1)
 * ============================================================================
 *
 * A Coaching card whose policy was "Other" saved Topic of Coaching "Other" with the account's first sentence as its text:
 * the card's bare "Other" took the account's first 120 characters as its topic, and the Other write-in guard
 * (`other-write-in.ts`) filled the empty write-in from the notes. A loop card's write-in is the topic the card names
 * ("Other — <topic>" on its policy line, or its coaching topic); with none, it stays empty. Invented person (on no
 * fixture): Aubrielle Kestrin.
 */

const REPORT = "Sibling app QA's live re-run (23 Nov 2026, A1): a Coaching card with policy \"Other\" saved other_topic as the account's first sentence";
const AUBRIELLE: DirectoryRow = { id: "e-aubrielle-kestrin", firstName: "Aubrielle", lastName: "Kestrin", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };
const ACCOUNT = "Aubrielle skipped the opening checklist on 11/21. Aubrielle did not count the register before opening.";

async function savedFor(t: Parameters<ReplayCase["run"]>[0], said: string, policy: string) {
  vi.setSystemTime(new Date("2026-11-22T18:00:00Z"));
  t.directory([...STAFF, AUBRIELLE]);
  t.as("salon_director", KEARNEY);
  t.loopModel!(loopStandIn((view): LoopDecision => (lastResult(view, "propose_form")
    ? { text: "Here's the Coaching Form." }
    : { tool: "propose_form", input: { template_key: "coaching", employee_id: AUBRIELLE.id, person_evidence: evidenceFrom(view, "Aubrielle Kestrin"), what_happened: ACCOUNT, incident_date: "2026-11-21", policy } })));
  const thread = t.thread();
  await thread.say(said);
  const card = String((thread.proposal as { policyLine?: string | null } | null)?.policyLine ?? "");
  /* The drafting model ticks Other and leaves its write-in empty. */
  t.draftWrites({ coaching_details: `Observed:\n${ACCOUNT}`, other_topic: "" }, { coaching_topics: ["other"] });
  const id = await thread.create();
  return { card, values: t.values(id), checked: t.checked(id) };
}

export const NOV23_AGENT_LOOP_OTHER_TOPIC_FROM_CARD_CASES: ReplayCase[] = [
  {
    id: "nov23-other-topic-is-the-cards-topic",
    title: "Port (sibling A1): a Coaching card citing \"Other — Opening checklist\": the saved Other topic is \"Opening checklist\", never the account's first sentence",
    report: REPORT,
    status: "fixed",
    async run(t) {
      const { card, values } = await savedFor(t, "coaching form for Aubrielle Kestrin, policy other opening checklist, she skipped the opening checklist on 11/21 and did not count the register", "Other — Opening checklist");
      expect(card, "the card does not cite Other — Opening checklist (the case proves nothing)").toMatch(/Other — Opening checklist/i);
      expect(values.other_topic ?? "", JSON.stringify(values)).toMatch(/^opening checklist$/i);
    },
  },
  {
    id: "nov23-other-topic-empty-when-card-names-none",
    title: "Port (sibling A1): a Coaching card citing bare \"Other\": the saved Other topic stays empty, never a sentence of the account",
    report: REPORT,
    status: "fixed",
    async run(t) {
      const { card, values } = await savedFor(t, "coaching form for Aubrielle Kestrin, policy other, she skipped the opening checklist on 11/21 and did not count the register", "Other");
      expect(card, "the card does not cite Other (the case proves nothing)").toMatch(/^Other$/i);
      expect(values.other_topic ?? "", JSON.stringify(values)).toBe("");
    },
  },
];
