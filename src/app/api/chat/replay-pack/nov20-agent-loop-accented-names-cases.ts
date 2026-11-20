import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * ACCENTS AND CURLY APOSTROPHES IN NAMES (QA's code audit on d7960a5f, item 13, 20 Nov 2026)
 * ============================================================================
 *
 * find_staff's word reader (tools.ts `words`) decomposed "Ramírez" to "rami rez" (the accent mark became a space) and split
 * "D’Angelo" (an iPhone's curly ’) to "d angelo", so a name typed without the accent, or with the other apostrophe,
 * matched nobody; the app's name check (`matchEmployeeName`) found the person "exact", but find_staff handled only
 * "confirm", so the name fell to not_on_roster or was taken as typed: no roster id, title or salon. General rule: accents
 * and apostrophes are folded the same way everywhere a name is compared, and an exact match is found.
 * Invented names only: Lucía Ramírez, Nico D'Angelo.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA's code audit on d7960a5f (20 Nov 2026), item 13: accented names and curly apostrophes missed the roster";
const LUCIA: DirectoryRow = { id: "e-lucia-ramirez", firstName: "Lucía", lastName: "Ramírez", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };
const NICO: DirectoryRow = { id: "e-nico-dangelo", firstName: "Nico", lastName: "D'Angelo", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-19T22:40:00Z"));
  t.directory([...STAFF, LUCIA, NICO]);
  t.as("salon_director", KEARNEY);
}
type Staff = { matches?: { employee_id: string }[]; ask_exactly?: string; reason_code?: string } | null;

/** The live model: find_staff with the name as typed, then the card for the match. */
const model = (typed: string) => loopStandIn((view): LoopDecision => {
  const staff = lastResult(view, "find_staff") as Staff;
  if (!staff) return { tool: "find_staff", input: { name: typed, person_evidence: evidenceFrom(view, typed) } };
  const id = staff.matches?.[0]?.employee_id;
  if (!id) return { text: staff.ask_exactly ?? staff.reason_code ?? "nobody" };
  if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: id, what_happened: "Late on 11/18.", incident_date: "2026-11-18" } };
  return { text: "Here's the card." };
});

const found = (id: string, typed: string, said: string): ReplayCase => ({
  id,
  title: `"${said}": find_staff finds the roster person (${typed}), and the card is the roster person (their title from the staff list)`,
  report: REPORT,
  status: "fixed",
  fixFlags: [FLAG],
  async run(t) {
    if (!t.loopOn?.()) return;
    start(t);
    const standIn = model(typed);
    t.loopModel!(standIn);
    const thread = t.thread();
    const reply = await thread.say(said);
    const staff = standIn.views.flatMap((view) => view.results).find((result) => result.tool === "find_staff")?.output as Staff;
    expect(staff?.matches?.length ?? 0, `find_staff found nobody:\n${JSON.stringify(staff)}`).toBe(1);
    // The roster person's title comes only from the staff list: a name taken as typed has none.
    expect(thread.proposal?.employeeRole, reply.content).toBe("Tanning Consultant");
  },
});

export const NOV20_AGENT_LOOP_ACCENTED_NAMES_CASES: ReplayCase[] = [
  found("nov20-accent-typed-without-accent", "lucia ramirez", "ca for lucia ramirez, late on 11/18"),
  found("nov20-accent-curly-apostrophe", "Nico D’Angelo", "ca for Nico D’Angelo, late on 11/18"),
  found("nov20-accent-control-typed-with-accent", "Lucía Ramírez", "ca for Lucía Ramírez, late on 11/18"),
];
