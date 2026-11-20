import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * THE SAVED WRITE-UP CALLS THE EMPLOYEE BY FIRST NAME (Pau via QA, 17 and 20 Nov 2026; item 15)
 * ============================================================================
 *
 * Item 15 of the saved-form items, on the real Create path (createInlineForm → POST /api/forms/instances → POST …/draft;
 * the drafting model is a stand-in that writes what the live one wrote). Names invented. No she/her/he/him in the saved
 * write-up, including the exit form's Reason line (Runner 2's c151): the first name. Item 19 (QA's production audit):
 * the person's second mention in a sentence reads naturally ("did not come into the scheduled shift").
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "Pau via QA (17 Nov 2026): the saved write-up states only what the manager said";
const offline = process.env.AGENT_LOOP_LIVE !== "1";

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-16T18:00:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
}

async function created(
  t: ReplayContext,
  said: string,
  card: Record<string, unknown>,
  drafted: Record<string, string>,
  draftedChecked?: Record<string, string[]>,
  replyText = "Here's the card.",
) {
  t.loopModel!(loopStandIn((view): LoopDecision => lastResult(view, "propose_form")
    ? { text: replyText }
    : { tool: "propose_form", input: { employee_name: "Remy Calder", person_evidence: evidenceFrom(view, "Remy Calder"), ...card } }));
  t.draftWrites(drafted, draftedChecked);
  const thread = t.thread();
  const reply = await thread.say(said);
  const id = await thread.create();
  return { values: t.values(id), checked: t.checked(id), card: String((reply as { content?: unknown }).content ?? "") };
}

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

export const NOV20_WRITE_UP_FIRST_NAME_CASES: ReplayCase[] = [
  fixed("nov20-write-up-second-mention-natural", `QA's production audit (item 19): "ca for Remy Calder, she did not come into her scheduled shift today": the card's account reads "Remy did not come into the scheduled shift", never "Remy's" after Remy, and no she/her`, async (t) => {
    const saved = await created(
      t,
      "ca for Remy Calder, she did not come into her scheduled shift today",
      { template_key: "dpoa", what_happened: "Remy did not come into her scheduled shift today.", policy: "Attendance", incident_date: "2026-11-16" },
      { observation: "Observed:\nRemy did not come into her scheduled shift on November 16, 2026." },
      undefined,
      // The live model reads the account back with the manager's pronoun (the reply pass names the person).
      "Here's the Corrective Action Form for **Remy**.\n\n**Observation of Offense:** Remy did not come into her scheduled shift today.",
    );
    expect(saved.card, `the card:\n${saved.card}`).toMatch(/Remy did not come into the scheduled shift/);
    expect(saved.card).not.toMatch(/Remy's scheduled|\b(?:she|her)\b(?![^"]*")/i);
    expect(saved.values.observation ?? "").toMatch(/Remy did not come into the scheduled shift/);
  }),
  fixed("nov20-write-up-exit-reason-natural", `Item 19 on c151's shape: the saved Reason reads naturally, never "Remy said Remy's new job"`, async (t) => {
    const saved = await created(
      t,
      "create exit form for Remy Calder. Last day worked 11-5-26. Immediate Vol resignation. Reason for resignation: she said her new job pays more",
      {
        template_key: "stc-exit",
        exit_evidence: { message_id: "m1", quote: "create exit form for Remy Calder", kind: "asks_for_exit_form" },
        exit_type: "resignation",
        incident_date: "2026-11-05",
        what_happened: "Last day worked 11-5-26. Immediate Vol resignation. Reason for resignation: she said her new job pays more.",
      },
      {},
    );
    const reason = saved.values.resignation_reason ?? "";
    expect(reason).toMatch(/^Remy said\b/);
    expect(reason, reason).not.toMatch(/Remy's|\b(?:she|her)\b/i);
  }),
  fixed("nov20-write-up-observation-first-name", `"ca for Remy Calder, she was 20 minutes late to her shift on 11/14", the drafter writes "her shift": the saved Observation names Remy, never she/her`, async (t) => {
    const saved = await created(
      t,
      "ca for Remy Calder, she was 20 minutes late to her shift on 11/14",
      { template_key: "dpoa", what_happened: "Remy was 20 minutes late to her shift on 11/14.", policy: "Attendance", incident_date: "2026-11-14" },
      { observation: "Observed:\nRemy was 20 minutes late to her shift on November 14, 2026.\n\nExpectation:\nRemy is expected to arrive on time for every scheduled shift, and she will call ahead if she is running late." },
    );
    const observation = saved.values.observation ?? "";
    expect(observation, "no Observation was saved (the case proves nothing)").toMatch(/20 minutes late/);
    expect(observation, `the Observation keeps a pronoun for Remy:\n${observation}`).not.toMatch(/\b(?:she|her|he|him|his)\b/i);
  }),
  fixed("nov17-write-up-exit-reason-first-name-c151", "Runner 2's c151 shape: \"Reason for resignation: she said her new job pays more\": the saved Reason names Remy, never she/her", async (t) => {
    const saved = await created(
      t,
      "create exit form for Remy Calder. Last day worked 11-5-26. Immediate Vol resignation. Reason for resignation: she said her new job pays more",
      {
        template_key: "stc-exit",
        exit_evidence: { message_id: "m1", quote: "create exit form for Remy Calder", kind: "asks_for_exit_form" },
        exit_type: "resignation",
        incident_date: "2026-11-05",
        what_happened: "Last day worked 11-5-26. Immediate Vol resignation. Reason for resignation: she said her new job pays more.",
      },
      {},
    );
    const reason = saved.values.resignation_reason ?? "";
    expect(reason, "no Reason was saved (the case proves nothing)").not.toBe("");
    expect(reason, `the Reason keeps a pronoun for Remy: ${reason}`).not.toMatch(/\b(?:she|her|he|him|his)\b/i);
    expect(reason).toMatch(/\bRemy\b/);
  }),
];
