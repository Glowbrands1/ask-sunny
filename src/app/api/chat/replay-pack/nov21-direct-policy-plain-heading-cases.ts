import { expect, vi } from "vitest";

import production from "@/test/fixtures/jba-manual-production-151.json";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * LATENESS UNDER ATTENDANCE QUOTES ATTENDANCE, NEVER LATE OPENING (QA2, 21 Nov 2026; a regression from #1146 on 3b0038f4)
 * ============================================================================
 *
 * The live Test Testy draft on main 3b0038f4: the card cited "Attendance Policy p.14; Standards of Conduct p.12", and the
 * saved policy_language was the Late Opening paragraph ("When an employee assigned to open a location is unable to open …
 * reimburse The Company $25.00 …", Source: Attendance, p.14). On 37c2ad8 it was Attendance's own lateness paragraph. #1146
 * read the cited heading's text on into the next chunk, which is the manual's next heading (Late Opening, chunk 42). On the
 * real Create path, with the production manual's own rows 35-44 in place of the pinned fixture's (`inPlace`); the manager's
 * words, the person invented.
 */

const SAID = "ca for Remy Calder, she was 40 minutes late on 11/18, this is the third time in two months, I've had two verbal talks with her already, and a customer said they won't come back because nobody was at the desk";
const ACCOUNT = "Remy was 40 minutes late on 11/18, this is the third time in two months. A customer said they won't come back because nobody was at the desk.";
const PHONE_SAID = "ca for Remy Calder, on the phone while a guest waited, 11/18";
const REPORT = "QA2 (21 Nov 2026), #1146 live on main 3b0038f4: lateness under Attendance saved the Late Opening paragraph as Direct policy";

type Row = (typeof production.chunks)[number];
const ROWS = production.chunks
  .filter((row: Row) => row.chunk_index >= 35 && row.chunk_index <= 44)
  .map((row: Row) => ({ chunkIndex: row.chunk_index, chunkId: `jba-${row.chunk_index}`, locator: row.locator, page: row.page, printedPage: row.metadata.printedPage, section: row.section, sections: row.metadata.sections, content: row.content }));

const fixed = (id: string, title: string, run: (t: ReplayContext) => Promise<void>): ReplayCase => ({
  id,
  title,
  report: REPORT,
  status: "fixed",
  fixFlags: ["AGENT_LOOP_ENABLED"],
  async run(t) {
    if (!t.loopOn?.()) return;
    vi.setSystemTime(new Date("2026-11-20T18:00:00Z"));
    t.directory([...STAFF]);
    t.as("salon_director", KEARNEY);
    t.manualAlsoHas!(ROWS, { inPlace: true });
    await run(t);
  },
});

async function quoted(t: ReplayContext, policy: string, said: string, account: string) {
  t.loopModel!(loopStandIn((view): LoopDecision => lastResult(view, "propose_form")
    ? { text: "Here's the Corrective Action Form for **Remy**." }
    : { tool: "propose_form", input: { template_key: "dpoa", employee_name: "Remy Calder", person_evidence: evidenceFrom(view, "Remy Calder"), what_happened: account, policy, incident_date: "2026-11-18", attendance: "lateness", attendance_evidence: evidenceFrom(view, "40 minutes late") } }));
  t.draftWrites({ observation: `Observed:\n${account}` });
  const thread = t.thread();
  await thread.say(said);
  const id = await thread.create();
  return t.values(id).policy_language ?? "";
}

export const NOV21_DIRECT_POLICY_PLAIN_HEADING_CASES: ReplayCase[] = [
  fixed("nov21-direct-policy-lateness-is-attendance", `"${SAID}", the card citing Attendance and Standards of Conduct: Direct policy quotes Attendance's lateness paragraph, never Late Opening's`, async (t) => {
    const language = await quoted(t, "Attendance; Standards of Conduct", SAID, ACCOUNT);
    expect(language, `no Attendance wording was saved:\n${language}`).toMatch(/know his or her work schedule/);
    expect(language, `Direct policy quotes the Late Opening paragraph:\n${language}`).not.toMatch(/\b(?:assigned|scheduled) to open\b|unable to open|reimburse|\$25/i);
  }),
  fixed("nov21-direct-policy-late-opening-control", `Control: "ca for Remy Calder, she was assigned to open on 11/18 and the salon did not open until 9:40", citing Late Opening: Direct policy quotes Late Opening`, async (t) => {
    const language = await quoted(t, "Late Opening", "ca for Remy Calder, she was assigned to open on 11/18 and the salon did not open until 9:40", "Remy was assigned to open on 11/18 and the salon did not open until 9:40.");
    expect(language).toMatch(/unable to open the location at the proper/);
  }),
  /*
   * QA2's second #1146 case from the same live round (main 3b0038f4): "ca for <P>, on the phone while a guest waited, 11/18",
   * the card citing Standards of Conduct p.12, saved the list block "o Lack of sales performance o Indecent or immoral
   * behavior … o Theft …": it shared only the word "while" with the account. Nothing in the section is about a phone or a
   * guest, so the section's own opening wording stands.
   */
  fixed("nov21-direct-policy-phone-guest-not-a-random-list", `"${PHONE_SAID}", the card citing Standards of Conduct: Direct policy is never an unrelated list block`, async (t) => {
    const language = await quoted(t, "Standards of Conduct", PHONE_SAID, "Remy was on the phone while a guest waited, 11/18.");
    expect(language, "no Direct policy was saved (the case proves nothing)").not.toBe("");
    expect(language, `Direct policy quotes an unrelated list block:\n${language}`).not.toMatch(/sales performance|Indecent or immoral|Theft, inappropriate removal/i);
  }),
];
