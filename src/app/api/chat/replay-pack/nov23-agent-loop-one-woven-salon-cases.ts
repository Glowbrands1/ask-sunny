import { expect, vi } from "vitest";

import { STAFF, TWO_SALONS, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * CREATE NEVER SAVES A FORM WITH NO SALON WHEN THE PERSON HAS ONE WOVEN SALON (port of Ask Bubbles #1072, board f140)
 * ============================================================================
 *
 * Bubbles' QA round 2 (R01/R19/U05–U07; Sunny's own salons and roster, the people invented): the card asked "Which
 * salon?" (or, for an admin, filed no salon at all) and Create saved the draft with NO salon, for a person Woven lists at
 * exactly one of the manager's salons. The salon manager's path read only Woven's primary salon, which a directory row
 * can lack, and an admin's card never looked; a former employee's card only offered their salon. Now one Woven salon
 * among the login's salons is the card's salon (salon_from_woven); several still ask; and Create on a card still asking
 * which salon saves nothing and says "Which salon is this about? Choose the salon on the card, then press Create."
 * Remy Calder (STAFF) is at NE Kearney only, with no Woven primary.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "Ask Bubbles #1072 (board f140, its QA's round 2, R01/R19/U05–U07): Create saved the draft with no salon while the card still asked \"Which salon?\"";
const ADMIN = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };
const TWO_SALON_PERSON: DirectoryRow = { id: "e-8", firstName: "Joelle", lastName: "Penrose", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0307", "loc-0309"], positionName: "Tanning Consultant" };
const FORMER: DirectoryRow = { id: "e-9", firstName: "Wynne", lastName: "Albright", preferredFirstName: null, employmentStatus: "terminated", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };

async function ca(t: ReplayContext, role: string, scope: unknown, person: { id?: string; name: string }) {
  vi.setSystemTime(new Date("2026-11-22T18:00:00Z"));
  t.directory([...STAFF, TWO_SALON_PERSON, FORMER]);
  t.as(role, scope);
  const first = person.name.split(" ")[0]!;
  t.loopModel!(loopStandIn((view): LoopDecision => {
    if (lastResult(view, "propose_form")) return { text: `Here's the Corrective Action Form for **${first}**.` };
    const who = person.id ? { employee_id: person.id } : { employee_name: person.name };
    return { tool: "propose_form", input: { template_key: "dpoa", ...who, person_evidence: evidenceFrom(view, person.name), what_happened: `${first} was late to open on 11/21/26.`, incident_date: "2026-11-21" } };
  }));
  const before = (t.forms() as unknown[]).length;
  const thread = t.thread();
  await thread.say(`ca for ${person.name}, late to open on 11/21`);
  const card = thread.proposal as { locationId?: string | null; status?: string } | null;
  let id: string | null = null;
  let refused: string | null = null;
  try {
    id = await thread.create();
  } catch (thrown) {
    refused = String((thrown as Error)?.message ?? thrown);
  }
  const saved = id ? ((t.forms() as Array<{ id: string; location_id?: string | null }>).find((row) => row.id === id)?.location_id ?? null) : null;
  return { card, saved, refused, added: (t.forms() as unknown[]).length - before };
}

const fixed = (id: string, title: string, run: (t: ReplayContext) => Promise<void>): ReplayCase => ({
  id,
  title,
  report: REPORT,
  status: "fixed",
  fixFlags: [FLAG],
  async run(t) {
    if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
    await run(t);
  },
});

export const NOV23_AGENT_LOOP_ONE_WOVEN_SALON_CASES: ReplayCase[] = [
  fixed("nov23-f140-salon-manager-two-salons-person-at-one", "A salon director over two salons; Remy is at one in Woven (no primary): the card is filed there and Create saves that salon, never none", async (t) => {
    const { card, saved } = await ca(t, "salon_director", TWO_SALONS, { id: "e-2", name: "Remy Calder" });
    expect(card?.locationId, JSON.stringify(card)).toBe("loc-0309");
    expect(saved, "Create saved the form with no salon").toBe("loc-0309");
  }),
  fixed("nov23-f140-admin-person-at-one-salon", "An admin (global): Remy is at one salon in Woven: the card is filed there and Create saves that salon, never none", async (t) => {
    const { card, saved } = await ca(t, "admin", ADMIN, { id: "e-2", name: "Remy Calder" });
    expect(card?.locationId, JSON.stringify(card)).toBe("loc-0309");
    expect(saved, "Create saved the form with no salon").toBe("loc-0309");
  }),
  fixed("nov23-f140-former-employee-one-salon", "A former employee (off the active roster) at one Woven salon among a two-salon director's salons: the card is filed there, never only offered", async (t) => {
    const { card, saved } = await ca(t, "salon_director", TWO_SALONS, { name: "Wynne Albright" });
    expect(card?.locationId, JSON.stringify(card)).toBe("loc-0309");
    expect(saved, "Create saved the form with no salon").toBe("loc-0309");
  }),
  fixed("nov23-f140-control-person-at-two-salons-still-asks", "Control: a salon director over two salons; Joelle is at both in Woven, with no primary: the card still asks which salon (no guess), and Create on it saves nothing and says so in one line", async (t) => {
    const { card, refused, added } = await ca(t, "salon_director", TWO_SALONS, { id: "e-8", name: "Joelle Penrose" });
    expect(card?.locationId ?? null, JSON.stringify(card)).toBeNull();
    expect(card?.status, JSON.stringify(card)).toBe("needs_location");
    expect(refused, "Create on a card still asking which salon was not refused").toBe("Which salon is this about? Choose the salon on the card, then press Create.");
    expect(added, "Create saved a form while the card still asked which salon").toBe(0);
  }),
];
