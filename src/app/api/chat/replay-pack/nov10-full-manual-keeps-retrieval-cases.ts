import { expect, vi } from "vitest";

import { KEARNEY, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * A "POLICY"-LABELLED HOW-TO QUESTION IS ANSWERED FROM THE POLICY MANUAL ALONE (QA's finding, Sunny live, 10 Nov 2026
 * 19:12–19:13Z; FULL_MANUAL_KEEPS_RETRIEVAL_ENABLED)
 * ============================================================================
 *
 * The tester's three questions, word for word (conv_mwb2gsx52k6reh7, conv_mwb2hmb62lroh57, conv_mwb2iugw2fxzr9z). With
 * FULL_MANUAL_CONTEXT on, a turn the normalizer labels "policy" put only the JBA Policy Manual in the prompt and searched
 * nothing, so the reply was "I don't have a Tanning Consultant Manual in the knowledge base" although the TC Tanning
 * Consultant Manual is indexed. The excerpt stands in for that manual's "Spray Tan Cleaning Instructions" (the wording is
 * invented; the title is the indexed document's).
 */
const FIX = ["FULL_MANUAL_KEEPS_RETRIEVAL_ENABLED"];
const REPORT = "QA's finding (Sunny live, 10 Nov 2026 19:12–19:13Z): the TC Tanning Consultant Manual never searched on the full-manual path";
const TC_TITLE = "TC Tanning Consultant Manual 8.4.2026";
const STEP = "After the booth is wiped down, reset the booth from the control panel before the next guest.";

const QUESTIONS = [
  ["reset-step", "how do i coach on the spray tan booth reset step after cleaning?"],
  ["reset-equipment", "how do I reset the spray tan equipment after cleaning it, so I can coach my team on it?"],
  ["cleaning-instructions", "What are the Spray Tan Cleaning Instructions from the Tanning Consultant Manual? What do I do last, to reset the equipment?"],
] as const;

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-10T19:12:00Z"));
  t.as("salon_director", KEARNEY);
  t.fullManualLoads!();
  t.normalizerReads!("policy_question");
  t.knowledgeHas!([
    {
      chunk_id: "tc-spray-tan-cleaning",
      document_id: "doc-tc-manual",
      document_title: TC_TITLE,
      category: "training",
      locator: "Spray Tan Cleaning Instructions",
      page: 21,
      section: "Spray Tan Cleaning Instructions",
      content: STEP,
      similarity: 0.87,
    },
  ]);
  return t.thread();
}

export const NOV10_FULL_MANUAL_KEEPS_RETRIEVAL_CASES: ReplayCase[] = QUESTIONS.map(([key, question]) => ({
  id: `nov10-full-manual-keeps-retrieval-${key}`,
  title: `"${question}": the TC Tanning Consultant Manual reaches the answer beside the policy manual`,
  report: REPORT,
  // Changed on purpose (11 Nov 2026): fixed in production by FULL_MANUAL_KEEPS_RETRIEVAL_ENABLED, QA. Was OPEN ("only the policy manual is in the prompt; the TC manual is never searched").
  status: "fixed",
  fixFlags: FIX,
  async run(t: ReplayContext) {
    const thread = start(t);
    const reply = await thread.say(question);
    const grounding = t.lastGrounding!();
    expect(grounding, `the TC manual never reached the answer:\n${reply.content}`).toContain(TC_TITLE);
    expect(grounding).toContain(STEP);
  },
}));
