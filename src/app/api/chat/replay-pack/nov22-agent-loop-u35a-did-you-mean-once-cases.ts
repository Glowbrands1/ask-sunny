import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * "DID YOU MEAN <P>?" IS NOT ASKED AGAIN ONCE THE MANAGER CORRECTED THE TYPO OR THE CARD IS <P>'S (port of Ask Bubbles
 * #1040, its QA's live round-2 re-run, 22 Nov 2026, U35(a))
 * ============================================================================
 *
 * Found in Ask Bubbles, the same code in Sunny. The tester's twelve turns, word for word, with the person invented here (a
 * two-word surname, on no directory but this case's; the typos rebuilt the same way: a swap, a swap, a changed first
 * letter) and the first, unrelated question asked about Sunny's own work. Live, the same "Did you mean **<P>**?" was asked
 * at T3, T5 and T6 though T4 "fix her last name <surname>" had corrected the typo to the offered name.
 *
 * Mechanism: `confirmed-spelling.ts` reads an answer holding the one word that turns the typed name into the offered name
 * as confirming that person (a substitution on the manager's own words, never a list of phrasings); `tools.ts` lets the
 * card's own record (never a reply's words) settle its person, and keeps the card theirs on a close spelling of them.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "Ask Bubbles' QA live round-2 re-run (22 Nov 2026, U35(a); the same gap in Sunny): the same \"Did you mean <P>?\" was re-asked at T3, T5 and T6 after T4 corrected the typo";
const SABINE: DirectoryRow = { id: "e-sabine-lucero-bastida", firstName: "Sabine", lastName: "Lucero Bastida", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };
const TURNS = [
  "tell me how to mix the bed cleaner with ingredinet measurements",
  "i have an employee, Sabine Lucero Batsida that needs a corrective action form with a customer complaint",
  "verbal warning, no payroll deduct, part-time team member,",
  "fix her last name bastida",
  "make that update",
  "under the employee line the name is supposed to be sabine lcuero bastida",
  "redo sabine lucero bastida",
  "make that change to Sabine Jucero Bastida",
  "okay the correct way is Sabine Lucero Bastida",
  "can i review the card",
  "Create a Corrective Action Form from this conversation.",
  "it was a customer complaint about the experience with Sabine",
] as const;

const users = (view: LoopView) => view.turns.filter((turn) => turn.role === "user").length;

const loopCase = (id: string, title: string, report: string, run: (t: ReplayContext) => Promise<void>): ReplayCase => ({
  id,
  title,
  report,
  status: "fixed",
  fixFlags: [FLAG],
  async run(t) {
    if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
    vi.setSystemTime(new Date("2026-11-22T18:00:00Z"));
    await run(t);
  },
});

export const NOV22_AGENT_LOOP_U35A_DID_YOU_MEAN_ONCE_CASES: ReplayCase[] = [
  loopCase("nov22-u35a-did-you-mean-not-repeated-after-card", "U35(a) verbatim (T1–T12, a Kearney salon director, \"Sabine Lucero Batsida\"): from T4 \"fix her last name bastida\" (the typo corrected to the offered name) on, the card is Sabine Lucero Bastida's and no reply asks \"Did you mean **Sabine Lucero Bastida**?\" again", REPORT, async (t) => {
    t.directory([...STAFF, SABINE]);
    t.as("salon_director", KEARNEY);
    /* The stand-in: the card from T2 on, proposed with the name as the manager last typed it (the live model's habit). */
    t.loopModel!(loopStandIn((view): LoopDecision => {
      const turn = users(view);
      const result = lastResult(view, "propose_form") as { card?: unknown; ask_exactly?: string } | null;
      if (result) return { text: result.card ? "Here's the Corrective Action Form for **Sabine**." : (result.ask_exactly ?? "ok") };
      if (turn === 1) return { text: "Here's how to mix the bed cleaner." };
      const said = view.turns.filter((entry) => entry.role === "user").at(-1)!.text;
      /* The name as the manager last typed it; a turn naming nobody re-proposes T2's spelling (the worst case). */
      const typed = /sabine [a-z]+ [a-z]+/i.exec(said)?.[0] ?? "Sabine Lucero Batsida";
      return { tool: "propose_form", input: { template_key: "dpoa", employee_name: typed, person_evidence: evidenceFrom(view, typed, /sabine/i.test(said) ? 0 : turn - 2), what_happened: "A customer complained about the experience with Sabine." } };
    }));
    const thread = t.thread();
    const replies: { turn: number; text: string; card: string | null }[] = [];
    for (const [index, said] of TURNS.entries()) {
      const reply = await thread.say(said);
      replies.push({ turn: index + 1, text: reply.content, card: (thread.proposal as { employeeName?: string } | null)?.employeeName ?? null });
    }
    const askedAgain = replies.slice(3).filter((entry) => /Did you mean \*\*Sabine Lucero Bastida\*\*\?/.test(entry.text));
    expect(askedAgain.map((entry) => `T${entry.turn}: ${entry.text}`), "the same Did-you-mean was asked again after T4's correction").toEqual([]);
    expect(replies.slice(3).some((entry) => entry.card === "Sabine Lucero Bastida"), `the card never became Sabine Lucero Bastida's:\n${JSON.stringify(replies, null, 1)}`).toBe(true);
  }),
  loopCase("nov22-u35a-correction-to-another-name-is-no-yes", "Control: after \"Did you mean **Sabine Lucero Bastida**?\" for \"Sabine Lucero Batsida\", \"fix her last name garcia\" (a word that does not turn the typed name into the offered one) confirms nobody: no card for Sabine Lucero Bastida", `${REPORT}; its QA's ruling: an answer whose word does not make the offered name seats nobody`, async (t) => {
    t.directory([...STAFF, SABINE]);
    t.as("salon_director", KEARNEY);
    t.loopModel!(loopStandIn((view): LoopDecision => {
      const result = lastResult(view, "propose_form") as { card?: unknown; ask_exactly?: string } | null;
      if (result) return { text: result.card ? "Here's the Corrective Action Form for **Sabine**." : (result.ask_exactly ?? "ok") };
      return { tool: "propose_form", input: { template_key: "dpoa", employee_name: "Sabine Lucero Batsida", person_evidence: evidenceFrom(view, "Sabine Lucero Batsida", users(view) - 1), what_happened: "A customer complained about the experience with Sabine." } };
    }));
    const thread = t.thread();
    await thread.say(TURNS[1]);
    const reply = await thread.say("fix her last name garcia");
    expect((thread.proposal as { employeeName?: string } | null)?.employeeName ?? null, reply.content).not.toBe("Sabine Lucero Bastida");
  }),
  loopCase("nov22-u35a-card-account-uses-settled-name", "U35(a) follow-up: once \"fix her last name bastida\" settled Sabine Lucero Bastida, the card's account never keeps the misspelling the model copied (\"Sabine Batsida\"), even with another staff member spelled close", `${REPORT}; its QA's admin live run: the card's account kept the misspelling after the name was settled`, async (t) => {
    /* An admin sees every salon: another staff member elsewhere has a name close to the misspelling (invented: Sabina Batista). */
    t.directory([...STAFF, SABINE, { id: "e-sabina-batista", firstName: "Sabina", lastName: "Batista", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0307"], positionName: "Tanning Consultant" }]);
    t.as("admin", { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] });
    t.loopModel!(loopStandIn((view): LoopDecision => {
      const result = lastResult(view, "propose_form") as { card?: unknown; ask_exactly?: string } | null;
      if (result) return { text: result.card ? "Here's the Corrective Action Form for **Sabine**." : (result.ask_exactly ?? "ok") };
      /* As the live model wrote it: the account with the manager's misspelling, first and last word. */
      return { tool: "propose_form", input: { template_key: "dpoa", employee_name: "Sabine Lucero Batsida", person_evidence: evidenceFrom(view, "Sabine Lucero Batsida", users(view) - 1), what_happened: "Sabine Batsida received a customer complaint about the experience with her." } };
    }));
    const thread = t.thread();
    await thread.say(TURNS[1]);
    await thread.say(TURNS[3]);
    const reply = await thread.say(TURNS[11]);
    const card = thread.proposal as { employeeName?: string; issue?: string } | null;
    expect(card?.employeeName, `the name was not settled (the case proves nothing):\n${reply.content}`).toBe("Sabine Lucero Bastida");
    expect(String(card?.issue ?? ""), `the card's account keeps the misspelling:\n${reply.content}`).not.toMatch(/Batsida/i);
  }),
];
