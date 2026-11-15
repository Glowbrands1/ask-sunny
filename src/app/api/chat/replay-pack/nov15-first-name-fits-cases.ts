import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase } from "./cases";
import { lastResult, loopStandIn } from "./loop-stand-in";

/**
 * ============================================================================
 * A SHARED LAST NAME IS NOT THE SAME PERSON (FIRST_NAME_MUST_FIT_ENABLED)
 * ============================================================================
 *
 * QA, 15 Nov 2026, seen in Ask Bubbles: the manager typed "Salem Pool" and the app switched the form to the roster's
 * "Melanie Pool". The loop's find_staff("salem pool") finds nobody, but the model searched the surname alone ("pool"),
 * found Melanie and seated her by id. With the flag: neither the surname search nor the id seats her, and the chat
 * asks "Salem Pool isn't on your staff list. Did you mean Melanie Pool, or someone else?". Every person is invented.
 */

const MELANIE: DirectoryRow = { id: "e-melanie-pool-fn", firstName: "Melanie", lastName: "Pool", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };
/** QA, 15 Nov 2026: in the report the typed first name was the employee's preferred first name in Woven. */
const LORRAINE: DirectoryRow = { id: "e-lorraine-pool-fn", firstName: "Lorraine", lastName: "Pool", preferredFirstName: "Rae", employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };
const REPORT = "QA, 15 Nov 2026 (from Ask Bubbles): the manager typed \"Salem Pool\" and the form switched to the roster's \"Melanie Pool\"";
const LOOP = "AGENT_LOOP_ENABLED";
const FLAG = "FIRST_NAME_MUST_FIT_ENABLED";

/** A loop model that looks the typed name up, then the surname alone, then proposes whoever it found (or Melanie's id). */
function surnameSearchModel(typed: string, surname: string) {
  return loopStandIn((view) => {
    const searches = view.results.filter((result) => result.tool === "find_staff");
    if (searches.length === 0) return { tool: "find_staff", input: { name: typed } };
    const matches = (lastResult(view, "find_staff")?.matches ?? []) as { employee_id: string }[];
    if (matches.length === 0 && searches.length === 1) return { tool: "find_staff", input: { name: surname } };
    if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: matches[0]?.employee_id ?? MELANIE.id, what_happened: "She was late." } };
    return { text: "Here's the draft." };
  });
}

export const NOV15_FIRST_NAME_FITS_CASES: ReplayCase[] = [
  {
    id: "nov15-first-name-fits-salem-is-not-melanie",
    title: "\"write up salem pool for being late\" (agent loop, roster has Melanie Pool): the card is never Melanie Pool",
    report: REPORT,
    status: { open: "a search for the surname alone finds Melanie Pool and her id seats her" },
    fixFlags: [LOOP, FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-14T16:00:00Z"));
      t.directory([...STAFF, MELANIE]);
      t.as("salon_director", KEARNEY);
      const model = surnameSearchModel("salem pool", "pool");
      t.loopModel!(model);
      const thread = t.thread();
      const reply = await thread.say("write up salem pool for being late");
      expect(thread.proposal?.employeeName ?? null, reply.content).not.toBe("Melanie Pool");
      const seen = JSON.stringify(model.views.at(-1)?.results ?? []);
      expect(seen, reply.content).toContain("Salem Pool isn't on your staff list. Did you mean Melanie Pool, or someone else?");
    },
  },
  {
    id: "nov15-first-name-fits-melany-is-melanie",
    title: "\"write up melany pool for being late\" (agent loop): a close spelling of the first name is still Melanie Pool",
    report: REPORT,
    // Already so with the flag off; the flag must not take it away.
    status: "fixed",
    fixFlags: [LOOP, FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-14T16:00:00Z"));
      t.directory([...STAFF, MELANIE]);
      t.as("salon_director", KEARNEY);
      t.loopModel!(surnameSearchModel("melany pool", "pool"));
      const thread = t.thread();
      const reply = await thread.say("write up melany pool for being late");
      expect(thread.proposal?.employeeName, reply.content).toBe("Melanie Pool");
    },
  },
  {
    id: "nov15-first-name-fits-preferred-first-name",
    title: "\"write up rae pool for being late\" (agent loop, roster has Lorraine Pool, preferred Rae): the card is hers, with no question",
    report: "QA, 15 Nov 2026: the typed first name was the employee's preferred first name in Woven; the matcher was right",
    status: "fixed",
    fixFlags: [LOOP, FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-14T16:00:00Z"));
      t.directory([...STAFF, LORRAINE]);
      t.as("salon_director", KEARNEY);
      t.loopModel!(surnameSearchModel("rae pool", "pool"));
      const thread = t.thread();
      const reply = await thread.say("write up rae pool for being late");
      expect(thread.proposal?.employeeName, reply.content).toBe("Lorraine Pool");
      expect(reply.content).not.toMatch(/Did you mean|isn't on your staff list/);
    },
  },
];
