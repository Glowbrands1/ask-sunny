import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * A CLOSE SPELLING OF A PERSON THE MANAGER ALREADY CONFIRMED IS THAT PERSON, NOT ANOTHER DID-YOU-MEAN (port of Ask Bubbles
 * #1055, u35a)
 * ============================================================================
 *
 * Found in Ask Bubbles (its coder's live run 2, 22 Nov 2026), the same code in Sunny. The tester's turns, word for word, with
 * the person invented here (a two-word surname, on no directory but this case's; the typos rebuilt the same way: a swap, a
 * swap, a changed first letter): T2 "i have an employee, <P> that needs a corrective action form with a customer complaint"
 * (the surname mistyped) got "Did you mean **<P>**?"; T4 "fix her last name <surname>" confirmed the person, with no card yet
 * (no account); then T6 "under the employee line the name is supposed to be <P, a swap>" and T8 "make that change to <P, the
 * first letter changed>", new close spellings with <P> the staff list's only close candidate, each asked "Did you mean
 * **<P>**?" again.
 *
 * The fix case confirms at T4 with a plain "yes"; the tester's verbatim T4 "fix her last name <surname>" confirms too since
 * Ask Bubbles' U35(a) (#1040) is ported (`nov22-agent-loop-u35a-did-you-mean-once-cases.ts`).
 *
 * Mechanism (`tools.ts`, find_staff's close-spelling branch): when the staff list's only close candidate is a person the
 * manager already confirmed in this chat (any spelling, from the question records) and this message is no "no", that person
 * is used. Before, a close spelling was settled only when that exact spelling had been confirmed.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "Ask Bubbles' live run 2 (22 Nov 2026, u35a; the same gap in Sunny): after T4 confirmed the person, T6 and T8 (new close spellings) each got the full \"Did you mean **<P>**?\" again";
const SABINE: DirectoryRow = { id: "e-sabine-lucero-bastida", firstName: "Sabine", lastName: "Lucero Bastida", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };
const T4_VERBATIM = "fix her last name bastida";
const TURNS = [
  "i have an employee, Sabine Lucero Batsida that needs a corrective action form with a customer complaint",
  "yes",
  "make that update",
  "under the employee line the name is supposed to be sabine lcuero bastida",
  "redo sabine lucero bastida",
  "make that change to Sabine Jucero Bastida",
] as const;

/** The live model's habit: find_staff with the name as the manager last typed it, and no card (no account yet). */
function setUp(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-22T18:00:00Z"));
  t.directory([...STAFF, SABINE]);
  t.as("salon_director", KEARNEY);
  t.loopModel!(loopStandIn((view): LoopDecision => {
    const result = lastResult(view, "find_staff") as { ask_exactly?: string } | null;
    if (result) return { text: result.ask_exactly ?? "Thanks. What happened with the customer complaint?" };
    const said = view.turns.filter((entry) => entry.role === "user").at(-1)!.text;
    const typed = /sabine [a-z]+ [a-z]+/i.exec(said)?.[0] ?? (/bastida|^yes$/i.test(said.trim()) ? "Sabine Lucero Bastida" : null);
    if (!typed) return { text: "What happened with the customer complaint?" };
    return { tool: "find_staff", input: { name: typed, ...(/sabine/i.test(said) ? { person_evidence: evidenceFrom(view, typed) } : {}) } };
  }));
  return t.thread();
}

async function closeSpellingsAfterConfirm(t: ReplayContext, t4: string) {
  const thread = setUp(t);
  const replies: string[] = [];
  for (const said of [TURNS[0], t4, ...TURNS.slice(2)]) replies.push((await thread.say(said)).content);
  expect(replies[0], "T2 never asked (the case proves nothing)").toMatch(/Did you mean \*\*Sabine Lucero Bastida\*\*\?/);
  expect(replies[1], "T4 did not confirm the person (the case proves nothing)").not.toMatch(/Did you mean/);
  const again = replies.slice(2).map((text, at) => `T${at + 5}: ${text}`).filter((text) => /Did you mean \*\*/.test(text));
  expect(again, "asked again after T4 confirmed the person").toEqual([]);
}

const loopCase = (id: string, title: string, status: ReplayCase["status"], run: (t: ReplayContext) => Promise<void>): ReplayCase => ({
  id,
  title,
  report: REPORT,
  status,
  fixFlags: [FLAG],
  ...(status === "fixed" ? {} : { fixStatus: status }),
  async run(t) {
    if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
    await run(t);
  },
});

export const NOV22_AGENT_LOOP_U35A_CONFIRMED_PERSON_CASES: ReplayCase[] = [
  loopCase("nov22-u35a-confirmed-person-new-close-spelling-not-asked", "u35a (Ask Bubbles' live run 2; T1 and T3 left out): T4 \"yes\" confirms Sabine Lucero Bastida with no card yet; T6 \"…sabine lcuero bastida\" and T8 \"Sabine Jucero Bastida\" (new close spellings) never ask \"Did you mean\" again", "fixed", (t) => closeSpellingsAfterConfirm(t, "yes")),
  loopCase("nov22-u35a-confirmed-person-no-still-asks", "u35a control: after T4 confirmed Sabine Lucero Bastida, \"no, not her\" with a close spelling still asks (a \"no\" is never read as the confirmed person)", "fixed", async (t) => {
    const thread = setUp(t);
    await thread.say(TURNS[0]);
    expect((await thread.say("yes")).content, "T4 did not confirm the person (the case proves nothing)").not.toMatch(/Did you mean/);
    const reply = await thread.say("no, not her, sabine lcuero bastida");
    expect(reply.content, "a \"no\" was read as the confirmed person").toMatch(/Did you mean \*\*Sabine Lucero Bastida\*\*\?/);
  }),
  /* Fixed on purpose (22 Nov 2026): Ask Bubbles' U35(a), #1040 (28ba69dd), is now ported (`confirmed-spelling.ts`: the word that corrects the typo to the offered name confirms the person), so the tester's verbatim T4 confirms. */
  loopCase("nov22-u35a-verbatim-correction-confirms", "u35a verbatim: T4 \"fix her last name bastida\" (the typo corrected to the offered name) confirms Sabine Lucero Bastida, and T6/T8's close spellings never ask again", "fixed", (t) => closeSpellingsAfterConfirm(t, T4_VERBATIM)),
];
