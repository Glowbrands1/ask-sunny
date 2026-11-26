import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * A DAILY STATS COACHING-PRIORITIES ANSWER CITES THE FRAMEWORK, NEVER ONLY AN UNRELATED POLICY (SOURCES_ON_TOPIC)
 * ============================================================================
 *
 * QA's live test (24 Nov 2026, admin, global scope): "What are the top coaching priorities in a Daily Stats report?" was
 * answered "Good question to get straight before you dig into an actual report. Here's how the coaching framework
 * approaches it — this is methodology, not a live read of a report…", and its only source card was the Confidential
 * Information Policy, JBA Policy Manual p.22. On 16 Nov the same question cited the framework. The answer mode was not
 * logged, so both paths are covered: Detailed (today's chat path, `server-ask.ts`) and Standard (the agent loop). The
 * framework and the policy passage are invented wording; no person is named.
 */

const FIX = ["SOURCES_ON_TOPIC_ENABLED"];
/* Fixed in production: the owner turned SOURCES_ON_TOPIC_ENABLED on in Vercel (25 Nov 2026). */
const STATUS = "fixed" as const;
const REPORT = "QA's live test (24 Nov 2026): \"What are the top coaching priorities in a Daily Stats report?\" showed only the Confidential Information Policy, JBA Policy Manual p.22";
const SAID = "What are the top coaching priorities in a Daily Stats report?";
const ANSWER = "Good question to get straight before you dig into an actual report. Here's how the coaching framework approaches it — this is methodology, not a live read of a report.";
const FRAMEWORK_TITLE = "ASK SUNNY Daily Stats Interpretation Framework";

const FRAMEWORK = {
  ok: true,
  grounding: {
    role: { id: "daily_stats_interpretation_framework" },
    documentId: "doc-daily-stats-framework",
    documentTitle: FRAMEWORK_TITLE,
    matchedBy: "tag",
    rows: [
      { chunk_id: "dsf-1", document_id: "doc-daily-stats-framework", document_title: FRAMEWORK_TITLE, category: "leadership_coaching", locator: "PRIORITY DECISION TREE", page: null, section: "PRIORITY DECISION TREE", content: "Choose the top three priorities: traffic first, then conversion, then attachment. Coach the behaviour behind the number.", similarity: 0 },
    ],
    presentGroups: ["operating_rules", "priority_decision_tree", "coaching", "recognition"],
  },
};
/** Retrieval's nearest neighbour for "report": the manual's confidential-information passage (wording invented). */
const CONFIDENTIAL = {
  chunk_id: "jba-22",
  document_id: "doc-manual",
  document_title: "2025 JBA Policy Manual - Edited 5-2025",
  category: "policies_compliance",
  locator: "Page 22 — Confidential Information Policy",
  page: 23,
  section: "Confidential Information Policy",
  content: "Confidential Information Policy\nCompany records and internal documents are never shared outside the company.",
  similarity: 0.42,
};

function setUp(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-24T16:00:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
  t.knowledgeHas!([CONFIDENTIAL]);
  t.roleDocumentHas!("daily_stats_interpretation_framework", FRAMEWORK);
}

const titles = (citations: { documentTitle?: string; locator?: string }[] | undefined) => (citations ?? []).map((card) => `${card.documentTitle} | ${card.locator ?? ""}`);

export const NOV24_DAILY_STATS_COACHING_SOURCE_ON_TOPIC_CASES: ReplayCase[] = [
  {
    id: "nov24-daily-stats-coaching-priorities-detailed-cites-framework",
    title: `Detailed mode, "${SAID}": the card is the Daily Stats Interpretation Framework, never the Confidential Information Policy alone`,
    report: REPORT,
    status: STATUS,
    fixFlags: FIX,
    async run(t) {
      setUp(t);
      /* The reply marks the confidential-information passage only, as the live one did ([S3]: after the two frameworks' rows). */
      t.modelSays(`${ANSWER} [S3]`);
      const reply = await t.thread().say(SAID, undefined, { mode: "detailed" });
      expect(t.lastGrounding!(), "the framework never reached the answer").toContain("Choose the top three priorities");
      const cards = titles(reply.citations);
      expect(cards.join("\n"), `the cards:\n${cards.join("\n")}`).not.toMatch(/Confidential Information/);
      expect(cards, "the framework's card").toEqual([`${FRAMEWORK_TITLE} | PRIORITY DECISION TREE`]);
    },
  },
  {
    id: "nov24-daily-stats-coaching-priorities-detailed-full-manual-cites-framework",
    title: `Detailed mode, "${SAID}" heard as a policy question (the whole manual in the prompt): the manual's Confidential Information page is not the card; the framework is`,
    report: `${REPORT} (the full-manual path: its page cards are checked too)`,
    status: STATUS,
    fixFlags: FIX,
    async run(t) {
      setUp(t);
      t.fullManualLoads!();
      t.normalizerReads!("policy_question");
      t.modelSays(`${ANSWER} Keep report figures inside the company (Confidential Information Policy, 2025 JBA Policy Manual p.21 [p.21]).`);
      const reply = await t.thread().say(SAID, undefined, { mode: "detailed" });
      const cards = titles(reply.citations);
      expect(cards.join("\n"), `the cards:\n${cards.join("\n")}`).not.toMatch(/Confidential/);
      expect(cards, "the framework's card").toEqual([`${FRAMEWORK_TITLE} | PRIORITY DECISION TREE`]);
    },
  },
  {
    id: "nov24-daily-stats-coaching-priorities-loop-cites-framework",
    title: `Standard mode (the agent loop), "${SAID}" answered from search_knowledge: the framework is read and is the card; the Confidential Information Policy is not shown`,
    report: REPORT,
    status: STATUS,
    fixFlags: FIX,
    async run(t) {
      if (!t.loopOn?.()) throw new Error("the loop is off");
      setUp(t);
      t.loopModel!(loopStandIn((view): LoopDecision => {
        const found = view.results.find((result) => result.tool === "search_knowledge")?.output as { results?: { source?: string; document?: string }[] } | undefined;
        if (!found) return { tool: "search_knowledge", input: { query: "daily stats coaching priorities" } };
        /* The live reply's one marker: the manual passage. */
        const manual = (found.results ?? []).find((row) => /JBA Policy Manual/.test(row.document ?? ""));
        return { text: `${ANSWER} ${manual?.source ?? ""}`.trim() };
      }));
      const reply = await t.thread().say(SAID);
      const cards = titles(reply.citations);
      expect(cards.join("\n"), `the cards:\n${cards.join("\n")}`).not.toMatch(/Confidential Information/);
      expect(cards, "the framework's card").toEqual([`${FRAMEWORK_TITLE} | PRIORITY DECISION TREE`]);
    },
  },
  {
    id: "nov24-on-topic-sources-policy-question-keeps-its-card",
    title: "Negative: \"What does the confidential information policy say about reports?\" keeps the Confidential Information Policy card (not a Daily Stats question)",
    report: `${REPORT} (the condition: a legitimate source is never dropped)`,
    status: "fixed",
    fixFlags: FIX,
    async run(t) {
      setUp(t);
      t.modelSays("Company records stay inside the company. [S1]");
      const reply = await t.thread().say("What does the confidential information policy say about reports?", undefined, { mode: "detailed" });
      const cards = titles(reply.citations);
      expect(cards.join("\n"), `the cards:\n${cards.join("\n")}`).toMatch(/Confidential Information/);
    },
  },
];
