import { expect, vi } from "vitest";

import { KEARNEY, STAFF, TWO_SALONS, type DirectoryRow, type ReplayCase } from "./cases";
import { evidenceFrom, headingWith, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * LIVE ROUND 4 (QA, 14 Nov 2026): OUTCOMES ONLY, FOR THE REAL MODEL
 * ============================================================================
 *
 * The targeted live run after batches A and B (`scripts/agent-loop-live/cases-targeted-r4.txt`). Each case gives the
 * loop a careful stand-in, so it holds offline in CI with production's flags. In a live run (AGENT_LOOP_LIVE=1) the real
 * model takes the stand-in's place (`liveRecording`), so every assertion is about the OUTCOME only: what is on the card,
 * the draft or the source cards, and what the reply never claims. Never which tools were called or in what words.
 *
 * QA's live-app wording (L1-L10, Parts B-E) is kept; every person is invented.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA live-app pass on Pau's account, 14 Nov 2026 (L1-L10, Parts B-E)";

const TAMSIN: DirectoryRow = { id: "e-tamsin-orwell", firstName: "Tamsin", lastName: "Orwell", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };
const LIORA: DirectoryRow = { id: "e-liora-quenby", firstName: "Liora", lastName: "Quenby", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };
const BOTH: DirectoryRow = { id: "e-oriel-fenwick", firstName: "Oriel", lastName: "Fenwick", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0307", "loc-0309"], positionName: "Tanning Consultant" };
const GONE: DirectoryRow = { id: "e-lysander-quaile", firstName: "Lysander", lastName: "Quaile", preferredFirstName: null, employmentStatus: "terminated", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };

const latest = (view: LoopView) => [...view.turns].reverse().find((turn) => turn.role === "user")?.text ?? "";
const allSaid = (view: LoopView) => view.turns.filter((turn) => turn.role === "user").map((turn) => turn.text).join("\n");
const policyLineOf = (card: unknown) => (card as { policyLine?: string | null } | undefined)?.policyLine ?? "";

/** A careful card model for one person: looks them up, proposes with what was said, says the card's facts. */
function careful(person: DirectoryRow, typed: string, build: (view: LoopView) => Record<string, unknown>, say: (view: LoopView) => string): ReturnType<typeof loopStandIn> {
  return loopStandIn((view): LoopDecision => {
    if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: typed } };
    if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: person.id, ...build(view) } };
    // ruling (b), QA 17 Nov: a typed full name whose last name differs from the staff list's is asked, never seated.
    // A model told to ask (the card refused with ask_exactly) asks it, and nothing else.
    const refused = lastResult(view, "propose_form") as { reason_code?: string; ask_exactly?: string } | null;
    if (refused?.reason_code && refused.ask_exactly) return { text: refused.ask_exactly };
    return { text: say(view) };
  });
}

export const NOV14_LIVE_R4_CASES: ReplayCase[] = [
  {
    id: "nov14-live-r4-self-review-written",
    title: "QA's urgent 3 turns (\"please make a ca for … not doing th e10 minute sanitaion\", \"yes payroll, $20\", \"make it a written\"): the card ends with written, payroll yes and $20, and no reply claims a level or amount its card does not hold",
    report: `${REPORT}; chat conv_mwgtunfd2ev7rau (the reply said Written Warning with no card)`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-13T22:40:00Z"));
      t.directory([...STAFF, TAMSIN]);
      t.as("salon_director", KEARNEY);
      t.loopModel!(careful(
        TAMSIN,
        "tamsin orwel",
        (view) => ({
          what_happened: "Tamsin Orwell did not do the 10-minute sanitation.",
          policy: "Other — the 10-minute sanitation",
          ...(/\$20/.test(allSaid(view)) ? { payroll_deduct: "yes", payroll_amount: "20", payroll_evidence: evidenceFrom(view) } : {}),
          ...(/written/.test(allSaid(view)) ? { warning_level: "written", level_evidence: evidenceFrom(view) } : {}),
        }),
        (view) => [
          "Here's the Corrective Action Form for **Tamsin Orwell**.",
          "**Observation of Offense:** Tamsin Orwell did not do the 10-minute sanitation.",
          ...(/written/.test(allSaid(view)) ? ["**Type of Warning:** Written Warning, as you said."] : []),
          ...(/\$20/.test(allSaid(view)) ? ["**Is payroll deduct applicable?** Yes, as you said. **Payroll deduction amount:** $20."] : []),
          "**Policy:** Other — the 10-minute sanitation",
        ].join("\n\n"),
      ));
      const thread = t.thread();
      // ruling (b), QA 17 Nov: a typed full name whose last name differs from the staff list's is asked, never seated. The manager's "yes" to the Did-you-mean follows T1.
      for (const turn of ["please make a ca for tamsin orwel for not doing th e10 minute sanitaion", "yes", "yes payroll, $20", "make it a written"]) {
        const reply = await thread.say(turn);
        const card = thread.proposal;
        if (/Written Warning/i.test(reply.content) && !/isn't on the card yet/.test(reply.content)) expect(card?.warningLevel, `"${turn}": the reply says Written, the card does not:\n${reply.content}`).toBe("written");
        if (/\$20/.test(reply.content) && !/isn't on the card yet/.test(reply.content)) expect((card as { payrollDeductAmount?: string } | undefined)?.payrollDeductAmount, `"${turn}": the reply says $20, the card does not:\n${reply.content}`).toBe("20");
      }
      expect(thread.proposal as unknown, "the card does not have what the manager answered").toMatchObject({ warningLevel: "written", payrollDeduct: "yes", payrollDeductAmount: "20" });
    },
  },
  {
    id: "nov14-live-r4-pre-create-date-and-policy",
    title: "QA's pre-create changes (\"change the date to 11/4\", \"make it attendance instead\"): the card itself changes, and the reply never states a date or policy the card lacks",
    report: `${REPORT}; QA's self-review design (pre-create level, date and policy changes)`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-13T22:40:00Z"));
      t.directory([...STAFF, TAMSIN]);
      t.as("salon_director", KEARNEY);
      t.loopModel!(careful(
        TAMSIN,
        "tamsin orwell",
        (view) => {
          const said = allSaid(view);
          const attendance = /attendance instead/.test(said);
          return {
            what_happened: /11\/4/.test(said) ? "On 11/4, Tamsin Orwell was late for her shift." : "Tamsin Orwell was late for her shift.",
            ...(/11\/4/.test(said) ? { incident_date: "2026-11-04" } : {}),
            ...(attendance ? { policy: headingWith(view, /attendance/i) ?? "Attendance" } : {}),
          };
        },
        (view) => `Here's the card for **Tamsin Orwell**.\n\n**Observation of Offense:** Tamsin Orwell was late for her shift.${/11\/4/.test(allSaid(view)) ? "\n\nDated 11/4." : ""}${/attendance instead/.test(allSaid(view)) ? `\n\n**Policy:** ${headingWith(view, /attendance/i) ?? "Attendance"} Policy, JBA Policy Manual` : ""}`,
      ));
      const thread = t.thread();
      await thread.say("ca for tamsin orwell, she was late for her shift");
      const date = await thread.say("change the date to 11/4");
      expect(thread.proposal?.formDate, `the date did not reach the card:\n${date.content}`).toBe("2026-11-04");
      const policy = await thread.say("make it attendance instead");
      expect(policyLineOf(thread.proposal), `the policy did not reach the card:\n${policy.content}`).toMatch(/^Attendance/);
    },
  },
  {
    id: "nov14-live-r4-salon-asked-once-by-name",
    title: "QA live-app item 1 (L3/L4): an employee at two of the manager's salons: the reply names the salons (never an id) and asks once; the answer puts that salon on the card",
    report: `${REPORT}; L3/L4: the replies alternated between "no need to pick a salon" and asking again, 3+ times`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-13T22:40:00Z"));
      t.directory([...STAFF, BOTH]);
      t.as("salon_director", TWO_SALONS);
      t.loopModel!(careful(
        BOTH,
        "oriel fenwick",
        (view) => ({ what_happened: "Oriel Fenwick was late on 11/12.", ...(/kearney/i.test(latest(view)) ? { salon: "kearney" } : {}) }),
        (view) => (/kearney/i.test(latest(view)) ? "Here's the card for **Oriel Fenwick**, at NE Kearney.\n\n**Observation of Offense:** Late on 11/12." : "Here's the card for **Oriel Fenwick**.\n\n**Observation of Offense:** Late on 11/12.\n\nWhich salon: NE Grand Island or NE Kearney?"),
      ));
      const thread = t.thread();
      const first = await thread.say("ca for oriel fenwick, she was late on 11/12");
      expect(first.content, "a salon id reached the manager").not.toMatch(/\bloc-\d+/);
      expect(first.content, "said no salon is needed while the card needs one").not.toMatch(/no need to (?:pick|choose) a salon/i);
      const answered = await thread.say("kearney");
      expect(thread.proposal?.locationId, `the answer did not reach the card:\n${answered.content}`).toBe("loc-0309");
      expect(answered.content, "asked for the salon again after the answer").not.toMatch(/which salon/i);
    },
  },
  {
    id: "nov14-live-r4-two-dates-not-both",
    title: "QA live-app item 2 (L3): two dates of one repeated incident: the reply either keeps one and notes the other, or asks which; never both in one reply",
    report: `${REPORT}; L3: "I've kept 9/28 as the incident date" and "Which date goes on the form? (9/28, 10/16)" in the same reply`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-13T22:40:00Z"));
      t.directory([...STAFF, TAMSIN]);
      t.as("salon_director", KEARNEY);
      t.loopModel!(careful(
        TAMSIN,
        "tamsin orwell",
        () => ({ what_happened: "Tamsin Orwell left the spray booth dirty on 9/28 and again on 10/16." }),
        () => "Here's the card for **Tamsin Orwell**.\n\n**Observation of Offense:** Left the spray booth dirty on 9/28 and again on 10/16.\n\nYou mentioned more than one date (**9/28**, **10/16**). Which date goes on the form?",
      ));
      const reply = await t.thread().say("ca for tamsin orwell, she left the spray booth dirty on 9/28 and again on 10/16");
      const kept = /\b(?:kept|dated|using)\b[^.\n]*\b(?:9\/28|10\/16)\b/i.test(reply.content);
      const asks = /which date/i.test(reply.content);
      expect(kept && asks, `kept a date AND asked which:\n${reply.content}`).toBe(false);
    },
  },
  {
    id: "nov14-live-r4-inactive-in-woven",
    title: "QA live-app item 7 (L9): a person terminated in Woven is said to be no longer active, not only \"not on the staff list\"; the card has the name as typed",
    report: `${REPORT}; L9: "isn't on the Woven staff list" was true but unhelpful for a terminated employee`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-13T22:40:00Z"));
      t.directory([...STAFF, GONE]);
      t.as("salon_director", KEARNEY);
      t.loopModel!(loopStandIn((view) => {
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "Lysander Quaile" } };
        if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "dpoa", employee_name: "Lysander Quaile", what_happened: "Lysander Quaile was late on 11/12." } };
        return { text: "**Lysander Quaile** shows as no longer active in Woven; I've used the name as you typed it.\n\n**Observation of Offense:** Late on 11/12." };
      }));
      const thread = t.thread();
      const reply = await thread.say("ca for Lysander Quaile, he was late on 11/12");
      expect(thread.proposal?.employeeName).toBe("Lysander Quaile");
      expect(reply.content, "the reply does not say he is no longer active").toMatch(/no longer active/i);
    },
  },
  {
    id: "nov14-live-r4-woven-title-said",
    title: "QA live-app item 8: the card keeps Woven's title when the manager says another (\"salon director\"), and the reply says so",
    report: `${REPORT}; the card used Woven's "Assistant Salon Director" while the manager said "Salon Director"`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-13T22:40:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      t.loopModel!(careful(STAFF[2]!, "juno paxton", () => ({ what_happened: "Juno Paxton was late on 11/12." }), () => "Here's the card for **Juno Paxton**. Woven lists her as Assistant Salon Director.\n\n**Observation of Offense:** Late on 11/12."));
      const thread = t.thread();
      const reply = await thread.say("ca for juno paxton, salon director, she was late on 11/12");
      expect(thread.proposal?.employeeRole).toBe("Assistant Salon Director");
      expect(reply.content, "the reply does not say Woven's title").toMatch(/Assistant Salon Director/);
    },
  },
  {
    id: "nov14-live-r4-msb-146-tans",
    title: "QA live-app item 13 (D2): \"verbal 146 tans Below in PPTA, LPSVA, Average Club, CC%, Spa%\": 146 is the number of tans, never \"146 tans below\"; every metric kept",
    report: `${REPORT}; D2: written as "146 tans below in PPTA…"`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-13T22:40:00Z"));
      t.directory([...STAFF, LIORA]);
      t.as("salon_director", KEARNEY);
      t.loopModel!(careful(
        LIORA,
        "liora quenby",
        (view) => ({ warning_level: "verbal", policy: headingWith(view, /standards of conduct/i) ?? "Standards of Conduct", what_happened: "Across 146 tans, Liora Quenby was below target in PPTA, LPSVA, Average Club, CC% and Spa%." }),
        () => "Here's the card for **Liora Quenby**.\n\n**Observation of Offense:** Across 146 tans, she was below target in PPTA, LPSVA, Average Club, CC% and Spa%.",
      ));
      const thread = t.thread();
      await thread.say("create a ca for must see behaviors for performace this should be for liora quenby - verbal 146 tans Below in PPTA, LPSVA, Average Club, CC%, Spa%");
      const account = thread.proposal?.issue ?? "";
      expect(account, "146 was read as an amount below").not.toMatch(/146 tans below/i);
      for (const metric of ["146", "PPTA", "LPSVA", "Average Club", "CC%", "Spa"]) expect(account, `${metric} was dropped`).toContain(metric);
    },
  },
  {
    id: "nov14-live-r4-manual-source-card",
    title: "QA live-app items 9 and 12 (B1, B5, B8): a manual answer with a page has a source card, and every card is a source the reply uses (no uncited product sheet)",
    report: `${REPORT}; B1/B5/B7: citations[] empty for manual quotes; B8: irrelevant product sheets as cards`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-13T22:40:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      t.knowledgeHas!([
        { chunk_id: "kb-product-9", document_id: "doc-product-sheet", document_title: "Bronzer Product Sheet", category: "product", locator: "Page 1", page: 1, section: null, content: "A tinted bronzing lotion for indoor tanning.", similarity: 0.41 },
      ]);
      t.loopModel!(loopStandIn((view) => {
        if (!lastResult(view, "search_knowledge")) return { tool: "search_knowledge", input: { query: "attendance lateness policy" } };
        if (!lastResult(view, "read_policy")) return { tool: "read_policy", input: { heading: headingWith(view, /attendance/i) ?? "Attendance" } };
        return { text: `Lateness is covered by the Attendance policy in the JBA Policy Manual ${String((lastResult(view, "read_policy") as { source?: string }).source ?? "")}.` };
      }));
      const reply = await t.thread().say("what's the attendance policy say about being late?");
      expect(reply.citations?.length ?? 0, `the manual answer has no source card:\n${reply.content}`).toBeGreaterThan(0);
      for (const card of reply.citations ?? []) {
        if (/Bronzer/.test(card.documentTitle ?? "")) expect(reply.content, "an uncited product sheet is a card").toMatch(/Bronzer/);
      }
      expect(reply.content, "a source marker reached the manager").not.toMatch(/\[S\d+\]/);
    },
  },
  {
    id: "nov14-live-r4-reviews-docs-not-no-access",
    title: "QA live-app item 4 (L7): \"How many google reviews do we have this far\": the documents are searched and their answer given (the reviews SOP's goal), never only \"no access\"",
    report: `${REPORT}; L7: "no access" with no citation, where today cites the reviews SOP (10/month)`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-13T22:40:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      t.knowledgeHas!([
        { chunk_id: "kb-reviews-1", document_id: "doc-reviews-sop", document_title: "Google Reviews SOP", category: "operations", locator: "Page 1", page: 1, section: "Goal", content: "Each salon's goal is 10 new Google reviews a month. Track them on the review tracker.", similarity: 0.78 },
      ]);
      t.loopModel!(loopStandIn((view) => {
        if (!lastResult(view, "search_knowledge")) return { tool: "search_knowledge", input: { query: "google reviews goal" } };
        return { text: `The Google Reviews SOP sets a goal of 10 new reviews a month per salon ${String(((lastResult(view, "search_knowledge") as { results?: { source?: string }[] }).results ?? [])[0]?.source ?? "")}; I can't see the live count from here.` };
      }));
      const reply = await t.thread().say("How many google reviews do we have this far");
      expect(t.searches!().length, "the documents were not searched").toBeGreaterThan(0);
      expect(reply.content, `the documents' answer is missing:\n${reply.content}`).toMatch(/\b10\b/);
    },
  },
];
