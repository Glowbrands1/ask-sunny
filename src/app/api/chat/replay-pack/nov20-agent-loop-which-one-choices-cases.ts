import { expect, vi } from "vitest";

import { TESTY, TESTY_ACCOUNT } from "@/lib/ai/agent-loop/phrasing-table";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * THE WHICH-ONE CHOICES TELL THEMSELVES APART (Pau via QA, item 18, 17 and 20 Nov 2026)
 * ============================================================================
 *
 * A person with several forms got a "Which one should I open?" list whose lines read alike (the same form name and the
 * same date). General rule: find_past_forms gives each form a `choice` line, built by code from the form record: its
 * form, status (draft / finalized), date and salon, and, when another listed form has the same form and date, the time
 * it was created. The rules book has the reply list those lines as given; the card-on-screen question uses them too.
 * Test Testy is the app's test employee.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "Pau via QA (17 Nov 2026, item 18): the which-one list showed forms that looked identical (same form, same date)";
const offline = process.env.AGENT_LOOP_LIVE !== "1";

const TEST_TESTY: DirectoryRow = { id: TESTY.id, firstName: TESTY.firstName, lastName: TESTY.lastName, preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };

type Found = { forms?: { instance_id: string; status?: string; choice?: string }[]; which_form_question?: string };

/** Test Testy's Corrective Actions dated 11/10: one finalized, then two drafts made 20 minutes apart. */
async function onFile(t: ReplayContext): Promise<string[]> {
  t.directory([...STAFF, TEST_TESTY]);
  t.as("salon_director", KEARNEY);
  const made: string[] = [];
  for (const [at, finalized] of [["2026-11-12T15:00:00Z", true], ["2026-11-13T15:00:00Z", false], ["2026-11-13T15:20:00Z", false]] as const) {
    vi.setSystemTime(new Date(at));
    /*
     * CHANGED ON PURPOSE (port of Ask Bubbles #1123, 24 Nov 2026): a second CA card for Testy on 11/10 is now asked about
     * ("open that one, or is this a separate incident?") instead of made. Each setup card is proposed on its own day
     * (11/10, 11/09, 11/08); the line below still dates every form 11/10, so what this case checks is unchanged.
     */
    const proposeOn = ["2026-11-10", "2026-11-09", "2026-11-08"][made.length]!;
    t.loopModel!(loopStandIn((view): LoopDecision => (lastResult(view, "propose_form") ? { text: "Here's the card." } : { tool: "propose_form", input: { template_key: "dpoa", employee_id: TESTY.id, what_happened: TESTY_ACCOUNT, incident_date: proposeOn } })));
    const setup = t.thread();
    await setup.say("ca for test testy, she was late to open the salon on 11/10");
    const id = await setup.create();
    Object.assign(t.forms().find((row) => row.id === id)!, { status: finalized ? "finalized" : "draft", form_date: "2026-11-10" });
    made.push(id);
  }
  vi.setSystemTime(new Date("2026-11-14T22:40:00Z"));
  return made;
}

export const NOV20_AGENT_LOOP_WHICH_ONE_CHOICES_CASES: ReplayCase[] = [
  {
    id: "nov20-which-one-choices-tell-apart",
    title: "Item 18: \"open test testy's 11/10 ca\" with three Corrective Actions dated 11/10 (one finalized, two drafts made 20 minutes apart): each choice line names its status and salon, the two drafts also their created time, and no two lines in the which-one reply read alike",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      const ids = await onFile(t);
      const standIn = loopStandIn((view): LoopDecision => {
        const found = lastResult(view, "find_past_forms") as Found | null;
        if (!found) return { tool: "find_past_forms", input: { employee_name: "Test Testy", form: "dpoa", date: "11/10", open: true, forms_on_file_evidence: evidenceFrom(view, "open test testy's 11/10 ca") } };
        // The live model lists what the tool gave it, one line each, then the question.
        const lines = (found.forms ?? []).map((form) => `- ${form.choice ?? "Corrective Action Form from 2026-11-10"}`);
        return { text: [...lines, "", found.which_form_question ?? "Which one?"].join("\n") };
      });
      t.loopModel!(standIn);
      const reply = await t.thread().say("open test testy's 11/10 ca");
      const found = lastResult(standIn.views.at(-1)!, "find_past_forms") as Found;
      const choices = new Map((found.forms ?? []).map((form) => [form.instance_id, form.choice ?? ""]));
      expect(ids.every((id) => choices.has(id)), JSON.stringify(found)).toBe(true);
      expect(choices.get(ids[0]!), "the finalized form's line does not say finalized").toMatch(/finalized/);
      for (const draft of ids.slice(1)) {
        expect(choices.get(draft), "a draft's line does not say draft").toMatch(/\bdraft\b/);
        expect(choices.get(draft), "two drafts on the same date do not say when each was created").toMatch(/created Nov 13, 2026, \d{1,2}:\d{2} [AP]M/);
      }
      for (const line of choices.values()) expect(line, "a choice does not name the salon").toMatch(/Kearney/i);
      expect(new Set(choices.values()).size, `two choices read alike:\n${[...choices.values()].join("\n")}`).toBe(choices.size);
      const listed = reply.content.split("\n").filter((line) => line.startsWith("- "));
      expect(new Set(listed).size, `two lines of the which-one reply read alike:\n${reply.content}`).toBe(listed.length);
    },
  },
  {
    id: "nov20-which-one-choices-no-time-when-dates-differ",
    title: "Item 18 control: two Corrective Actions on different dates (11/10 finalized, 11/12 draft) read apart by date and status alone: no created time is added",
    report: `${REPORT}; the time only when the dates match`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      t.directory([...STAFF, TEST_TESTY]);
      t.as("salon_director", KEARNEY);
      for (const [date, finalized] of [["2026-11-10", true], ["2026-11-12", false]] as const) {
        vi.setSystemTime(new Date("2026-11-13T15:00:00Z"));
        t.loopModel!(loopStandIn((view): LoopDecision => (lastResult(view, "propose_form") ? { text: "Here's the card." } : { tool: "propose_form", input: { template_key: "dpoa", employee_id: TESTY.id, what_happened: TESTY_ACCOUNT, incident_date: date } })));
        const setup = t.thread();
        await setup.say(`ca for test testy, she was late to open the salon on ${date.slice(5).replace("-", "/")}`);
        const id = await setup.create();
        Object.assign(t.forms().find((row) => row.id === id)!, { status: finalized ? "finalized" : "draft", form_date: date });
      }
      vi.setSystemTime(new Date("2026-11-14T22:40:00Z"));
      const standIn = loopStandIn((view): LoopDecision => (lastResult(view, "find_past_forms")
        ? { text: "Which one should I open?" }
        : { tool: "find_past_forms", input: { employee_name: "Test Testy", form: "dpoa", open: true, forms_on_file_evidence: evidenceFrom(view, "open test testy's ca") } }));
      t.loopModel!(standIn);
      await t.thread().say("open test testy's ca");
      const found = lastResult(standIn.views.at(-1)!, "find_past_forms") as Found;
      const lines = (found.forms ?? []).map((form) => form.choice ?? "");
      expect(lines.some((line) => /finalized · dated 11\/10\/2026/.test(line)), JSON.stringify(lines)).toBe(true);
      expect(lines.some((line) => /draft · dated 11\/12\/2026/.test(line)), JSON.stringify(lines)).toBe(true);
      for (const line of lines) expect(line).not.toMatch(/created/);
    },
  },
];
