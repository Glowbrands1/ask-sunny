import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * A COACHING HOW-TO IS BUILT FROM THE COMPANY'S OWN COACHING GUIDE FIRST (the owner, 26 Nov 2026: "yes use it")
 * ============================================================================
 *
 * The knowledge base already holds the company's coaching scripts: the Performance Management Framework's coaching
 * conversation structure (each step with the line to say), its "Help me coach this employee" answer format, role-play
 * and the Management Diamond. The prep-package rule had the model write its own outline and script. Now a coaching
 * how-to searches the knowledge base first, builds the outline and the words to use from the document's own steps and
 * lines, and names it; an answer written without a search goes back once (`coaching-how-to.ts`). The framework passage
 * below is invented test text in the framework's shape, never the real document.
 */

const LOOP = "AGENT_LOOP_ENABLED";
const REPORT = "The owner, 26 Nov 2026: coaching answers use the scripts in the knowledge base (the Performance Management Framework) first";
const SAID = "how do I coach someone who keeps showing up late";
const FRAMEWORK = "ASK SUNNY PERFORMANCE MANAGEMENT FRAMEWORK KB TEXT";
const FRAMEWORK_LINE = "Tell me what happened from where you stood.";

const PASSAGE = {
  chunk_id: "kb-pmf-conversation",
  document_id: "doc-pmf",
  document_title: FRAMEWORK,
  category: "leadership_coaching",
  locator: "Coaching conversation structure",
  page: null,
  section: null,
  content: `Structure coaching conversations in this order: 1. Open with purpose: "I want a few minutes on [topic] so you know exactly what I need to see." 2. State the observation: "Here is what I saw: [behavior]." 3. Ask for their side: "${FRAMEWORK_LINE}" 4. Explain the impact. 5. State the expectation. 6. Role-play it. 7. Confirm commitment. 8. Set follow-up.`,
  similarity: 0.82,
};

/** A complete prep package written from nothing: what the model did before the rule (no search). */
const OWN_WORDS = [
  "1. Opening: set a calm, private tone.",
  "2. The facts and the expectation.",
  "3. Listen to their side.",
  "4. Agree on next steps.",
  "5. Follow-up date: one week from today.",
  "",
  "\"I wanted to talk with you about the last few shifts, because the team counts on you and I want to help.\"",
  "",
  "Role-play: you play the employee and push back once.",
  "Action plan: on time for five shifts in a row, checked by you; follow-up next week.",
].join("\n");

/** The package built from the framework: its steps and its lines, the placeholders filled, the source named. */
const FROM_FRAMEWORK = [
  "From the Performance Management Framework [S1]:",
  "",
  "1. Open with purpose: \"I want a few minutes on getting to your shifts on time so you know exactly what I need to see.\"",
  "2. State the observation: \"Here is what I saw: you clocked in late three times this week.\"",
  `3. Ask for their side: "${FRAMEWORK_LINE}"`,
  "4. Explain the impact, then state the expectation: on time for every shift.",
  "5. Role-play the first five minutes of a shift; confirm commitment.",
  "",
  "Action plan: on time for the next five shifts, checked by you; follow-up next Friday.",
].join("\n");

const handedBack = (view: LoopView) => /\[app check\]/.test(view.turns.at(-1)?.text ?? "");
const searchedIn = (views: readonly LoopView[]) => views.flatMap((view) => view.results).filter((result) => result.tool === "search_knowledge").map((result) => JSON.stringify(result.output));

function start(t: ReplayContext, rows: readonly Record<string, unknown>[] = [PASSAGE]) {
  vi.setSystemTime(new Date("2026-11-26T18:00:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
  t.knowledgeHas!(rows);
}

const loopCase = (id: string, title: string, run: (t: ReplayContext) => Promise<void>): ReplayCase => ({
  id, title, report: REPORT, status: "fixed", fixFlags: [LOOP],
  async run(t) {
    if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
    await run(t);
  },
});

export const NOV26_COACHING_FRAMEWORK_FIRST_CASES: ReplayCase[] = [
  loopCase("nov26-coaching-framework-first-search", `"${SAID}" answered from the model's own words with no search: handed back, the framework is searched, and the answer uses its lines and names it`, async (t) => {
    start(t);
    const standIn = loopStandIn((view: LoopView): LoopDecision => {
      if (lastResult(view, "search_knowledge")) return { text: FROM_FRAMEWORK };
      if (handedBack(view)) return { tool: "search_knowledge", input: { query: "coaching conversation structure lateness" } };
      return { text: OWN_WORDS };
    });
    t.loopModel!(standIn);
    const reply = await t.thread().say(SAID);
    expect(standIn.views[0]?.system ?? "", "the rules book does not put the company's coaching guidance first").toMatch(/Build it from the company's own coaching guidance first: search the knowledge base/);
    expect(searchedIn(standIn.views).join("\n"), "the framework never reached the model").toContain(FRAMEWORK_LINE);
    expect(reply.content, reply.content).toContain(FRAMEWORK_LINE);
    expect(reply.content, "a source marker reached the manager").not.toMatch(/\[S\d\]/);
    expect((reply.citations ?? []).map((citation) => citation.documentTitle), "the framework is not named as the source").toContain(FRAMEWORK);
    expect(reply.formProposal ?? null, "a card was made for an advice question").toBeNull();
  }),
  loopCase("nov26-coaching-framework-first-kept", "Control: an answer that searched the knowledge base first and has every part is kept as written (no extra model call)", async (t) => {
    start(t);
    const standIn = loopStandIn((view: LoopView): LoopDecision => (lastResult(view, "search_knowledge") ? { text: FROM_FRAMEWORK } : { tool: "search_knowledge", input: { query: "coaching conversation structure" } }));
    t.loopModel!(standIn);
    const reply = await t.thread().say(SAID);
    expect(standIn.views.some(handedBack), "a complete, searched answer was handed back").toBe(false);
    expect(reply.content).toContain(FRAMEWORK_LINE);
  }),
  loopCase("nov26-coaching-framework-first-no-match", "No coaching guide in the knowledge base: the search finds nothing, the answer is a plain outline and script in the model's own words, it names no source, and it is not handed back again", async (t) => {
    start(t, []);
    const standIn = loopStandIn((view: LoopView): LoopDecision => (lastResult(view, "search_knowledge") ? { text: OWN_WORDS } : { tool: "search_knowledge", input: { query: "coaching conversation structure" } }));
    t.loopModel!(standIn);
    const reply = await t.thread().say(SAID);
    expect(standIn.views.some(handedBack), "a searched answer with every part was handed back").toBe(false);
    expect(reply.content).toBe(OWN_WORDS);
    expect(reply.citations ?? [], "a source was named that the search never returned").toEqual([]);
    expect(reply.formProposal ?? null, "a card was made for an advice question").toBeNull();
  }),
];
