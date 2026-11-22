import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";
import { evidenceFrom, headingWith, lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * THE SALON PHRASE LEAVES THE ACCOUNT WITH ITS OWN PLACE WORD (QA's live run on Sunny main 9de3675, 22 Nov 2026)
 * ============================================================================
 *
 * The manager's turn, word for word (R13's, the person invented): "create a verbal CA for team member Testy Testerson at
 * Kearney, NE. location. On 10-16-26 Testy did not sanitize …". With the real model, the card's Observation read "On
 * 10/16/26 location, Testy did not …" (the account "On 10/16/26 at Kearney, NE location, Testy …"); "At Kearney, NE
 * location, on …" read "Location, on …". The phrase and its state left (#1223), the word that closed the manager's
 * place phrase stayed. Mechanism
 * (`withoutNamedSalon`): words after the state, up to the phrase's own comma or full stop, that are all words of the
 * phrase (the salon's name or the place words the phrase is already read with) leave with it.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA's live run on Sunny main 9de3675 (22 Nov 2026), nov22-r13-salon-with-state-leaves-account-whole: the Observation read \"On 10/16/26 location, Testy …\"";
const T1 = "create a verbal CA for team member Testy Testerson at Kearney, NE. location. On 10-16-26 Testy did not sanitize the tanning beds between guests. payroll deduct is not applicable";
/** The live model's accounts: QA's live card's (the phrase after the date), the phrase first, and as the manager typed it. */
const LIVE_ACCOUNTS = [
  "On 10/16/26 at Kearney, NE location, Testy did not sanitize the tanning beds between guests.",
  "At Kearney, NE location, on 10/16/26 Testy did not sanitize the tanning beds between guests.",
  "At Kearney, NE. location. On 10/16/26 Testy did not sanitize the tanning beds between guests.",
];

const issueOf = (proposal: unknown) => (proposal as { issue?: string | null } | null)?.issue ?? "";

export const NOV22_AGENT_LOOP_PLACE_WORD_AFTER_STATE_CASES: ReplayCase[] = LIVE_ACCOUNTS.map((account, index): ReplayCase => ({
  id: `nov22-r13-live-place-word-after-state-${index + 1}`,
  title: `R13 live: the model's account "${account.slice(0, 40)} …" for "… at Kearney, NE. location. On 10-16-26 …": the Observation is "On 10/16/26 Testy did not sanitize …", never "Location, on …"`,
  report: REPORT,
  status: "fixed",
  fixFlags: [FLAG],
  async run(t) {
    if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
    vi.setSystemTime(new Date("2026-11-21T18:00:00Z"));
    t.directory([...STAFF]);
    t.as("salon_director", KEARNEY);
    t.loopModel!(loopStandIn((view): LoopDecision => (lastResult(view, "propose_form")
      ? { text: "Here's the Corrective Action Form for **Testy**." }
      : {
          tool: "propose_form",
          input: {
            template_key: "dpoa",
            employee_name: "Testy Testerson",
            what_happened: account,
            incident_date: "2026-10-16",
            warning_level: "verbal",
            level_evidence: evidenceFrom(view, "create a verbal CA"),
            payroll_deduct: "no",
            payroll_evidence: evidenceFrom(view, "payroll deduct is not applicable"),
            policy: headingWith(view, /standards of conduct/i),
            person_evidence: evidenceFrom(view, "Testy Testerson"),
          },
        })));
    const thread = t.thread();
    await thread.say(T1);
    expect(thread.proposal?.locationId, "the case proves nothing: the card is not filed at the salon the manager named").toBe("loc-0309");
    expect(issueOf(thread.proposal), "a word of the salon phrase stayed in the Observation").not.toMatch(/^Location|\bNE\b|Kearney/i);
    expect(issueOf(thread.proposal)).toBe("On 10/16/26 Testy did not sanitize the tanning beds between guests.");
  },
}));
