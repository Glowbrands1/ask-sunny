import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase } from "./cases";
import { lastResult, loopStandIn } from "./loop-stand-in";

/**
 * ============================================================================
 * A SHARED LAST NAME IS NOT THE SAME PERSON (FIRST_NAME_MUST_FIT_ENABLED)
 * ============================================================================
 *
 * QA, 15 Nov 2026: a shared last name with a first name that fits nobody is never the same person. (The Ask Bubbles
 * report that raised it was a preferred first name, which already matches; the last case pins that.) Invented example:
 * the manager types "Soren Fairweather"; find_staff finds nobody, but the model searches the surname alone, finds the
 * roster's Marisol Fairweather and seats her by id. With the flag the chat asks instead.
 */

const MARISOL: DirectoryRow = { id: "e-marisol-fairweather-fn", firstName: "Marisol", lastName: "Fairweather", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };
/** QA, 15 Nov 2026: in the report the typed first name was the employee's preferred first name in Woven. */
const LORRAINE: DirectoryRow = { id: "e-lorraine-fairweather-fn", firstName: "Lorraine", lastName: "Fairweather", preferredFirstName: "Rae", employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };
const REPORT = "QA, 15 Nov 2026: a shared last name with a first name that fits nobody is never the same person (invented names)";
const LOOP = "AGENT_LOOP_ENABLED";
const FLAG = "FIRST_NAME_MUST_FIT_ENABLED";

/** A loop model that looks the typed name up, then the surname alone, then proposes whoever it found (or Marisol's id). */
function surnameSearchModel(typed: string, surname: string) {
  return loopStandIn((view) => {
    const searches = view.results.filter((result) => result.tool === "find_staff");
    if (searches.length === 0) return { tool: "find_staff", input: { name: typed } };
    const matches = (lastResult(view, "find_staff")?.matches ?? []) as { employee_id: string }[];
    if (matches.length === 0 && searches.length === 1) return { tool: "find_staff", input: { name: surname } };
    if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: matches[0]?.employee_id ?? MARISOL.id, what_happened: "She was late." } };
    return { text: "Here's the draft." };
  });
}

/** A loop model that looks up the surname alone and proposes whoever it found. */
function surnameOnlyModel(surname: string) {
  return loopStandIn((view) => {
    if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: surname } };
    const matches = (lastResult(view, "find_staff")?.matches ?? []) as { employee_id: string }[];
    if (matches[0] && !lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: matches[0].employee_id, what_happened: "She was late." } };
    return { text: "Here's the draft." };
  });
}

const REVIEW = "QA's review of #1008, 15 Nov 2026";

export const NOV15_FIRST_NAME_FITS_CASES: ReplayCase[] = [
  {
    id: "nov15-first-name-fits-soren-is-not-marisol",
    title: "\"write up soren fairweather for being late\" (agent loop, roster has Marisol Fairweather): the card is never Marisol Fairweather",
    report: REPORT,
    status: { open: "a search for the surname alone finds Marisol Fairweather and her id seats her" },
    fixFlags: [LOOP, FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-14T16:00:00Z"));
      t.directory([...STAFF, MARISOL]);
      t.as("salon_director", KEARNEY);
      const model = surnameSearchModel("soren fairweather", "fairweather");
      t.loopModel!(model);
      const thread = t.thread();
      const reply = await thread.say("write up soren fairweather for being late");
      expect(thread.proposal?.employeeName ?? null, reply.content).not.toBe("Marisol Fairweather");
      const seen = JSON.stringify(model.views.at(-1)?.results ?? []);
      expect(seen, reply.content).toContain("Soren Fairweather isn't on your staff list. Did you mean Marisol Fairweather, or someone else?");
    },
  },
  {
    id: "nov15-first-name-fits-marisal-is-marisol",
    title: "\"write up marisal fairweather for being late\" (agent loop): a close spelling of the first name is still Marisol Fairweather",
    report: REPORT,
    // Already so with the flag off; the flag must not take it away.
    status: "fixed",
    fixFlags: [LOOP, FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-14T16:00:00Z"));
      t.directory([...STAFF, MARISOL]);
      t.as("salon_director", KEARNEY);
      t.loopModel!(surnameSearchModel("marisal fairweather", "fairweather"));
      const thread = t.thread();
      const reply = await thread.say("write up marisal fairweather for being late");
      expect(thread.proposal?.employeeName, reply.content).toBe("Marisol Fairweather");
    },
  },
  {
    id: "nov15-first-name-fits-preferred-first-name",
    title: "\"write up rae fairweather for being late\" (agent loop, roster has Lorraine Fairweather, preferred Rae): the card is hers, with no question",
    report: "QA, 15 Nov 2026: the typed first name was the employee's preferred first name in Woven; the matcher was right",
    status: "fixed",
    fixFlags: [LOOP, FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-14T16:00:00Z"));
      t.directory([...STAFF, LORRAINE]);
      t.as("salon_director", KEARNEY);
      t.loopModel!(surnameSearchModel("rae fairweather", "fairweather"));
      const thread = t.thread();
      const reply = await thread.say("write up rae fairweather for being late");
      expect(thread.proposal?.employeeName, reply.content).toBe("Lorraine Fairweather");
      expect(reply.content).not.toMatch(/Did you mean|isn't on your staff list/);
    },
  },
  ...["coach fairweather on punctuality", "warn fairweather, she was late again", "write up Dr Fairweather for being late"].map(
    (said, index): ReplayCase => ({
      id: `nov15-first-name-fits-verb-or-title-${index + 1}`,
      title: `"${said}" (agent loop, roster has Marisol Fairweather): a verb or title before the surname is no first name; the card is hers`,
      report: REVIEW,
      status: "fixed",
      fixFlags: [LOOP, FLAG],
      async run(t) {
        if (!t.loopOn?.()) return;
        vi.setSystemTime(new Date("2026-11-14T16:00:00Z"));
        t.directory([...STAFF, MARISOL]);
        t.as("salon_director", KEARNEY);
        t.loopModel!(surnameOnlyModel("fairweather"));
        const thread = t.thread();
        const reply = await thread.say(said);
        expect(thread.proposal?.employeeName, reply.content).toBe("Marisol Fairweather");
        expect(reply.content).not.toMatch(/isn't on your staff list/);
      },
    }),
  ),
  {
    id: "nov15-first-name-fits-answer-takes-her",
    title: "\"write up soren fairweather for being late\", asked \"Did you mean Marisol Fairweather?\", then \"yeah that's her\" (agent loop): the card is hers",
    report: REVIEW,
    status: { open: "the first turn already seats Marisol Fairweather by the surname lookup" },
    fixFlags: [LOOP, FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-14T16:00:00Z"));
      t.directory([...STAFF, MARISOL]);
      t.as("salon_director", KEARNEY);
      // The stand-in asks the question the card setter gives it, as the live model does, and repeats its lookups next turn.
      const model = loopStandIn((view) => {
        const searches = view.results.filter((result) => result.tool === "find_staff");
        if (searches.length === 0) return { tool: "find_staff", input: { name: "soren fairweather" } };
        if (searches.length === 1) return { tool: "find_staff", input: { name: "fairweather" } };
        const proposed = lastResult(view, "propose_form");
        if (!proposed) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: MARISOL.id, what_happened: "She was late." } };
        const refused = typeof proposed.error === "string" ? /ask: "([^"]+)"/.exec(proposed.error)?.[1] : undefined;
        return { text: refused ?? "Here's the draft." };
      });
      t.loopModel!(model);
      const thread = t.thread();
      const first = await thread.say("write up soren fairweather for being late");
      expect(thread.proposal?.employeeName ?? null, first.content).not.toBe("Marisol Fairweather");
      expect(first.content).toContain("Did you mean Marisol Fairweather");
      const reply = await thread.say("yeah that's her");
      expect(thread.proposal?.employeeName, reply.content).toBe("Marisol Fairweather");
    },
  },
];
