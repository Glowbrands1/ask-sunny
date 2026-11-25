import { expect, vi } from "vitest";

import { STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";
import { lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * AN ADMIN'S CARD ASKS WHICH SALON (QA, 24 Nov 2026, live as an Admin; ADMIN_CARD_ASKS_SALON)
 * ============================================================================
 *
 * QA's wording, the person's first name swapped for an invented one: "Draft a coaching form for <first name>" →
 * "Using **<full name>** from your staff list. Here's the Coaching Form for **<first name>**." The card used the salon
 * Woven lists her at (KS Overland Park) while her form on file in Form Monitoring is at KS Lawrence, and an admin's card
 * with no salon never asked (it said the account covers every salon and left Salon "Not recorded"). Now an admin's card
 * with no salon asks once (the which_salon fact global non-admins get; the card stays ready), and a Woven salon that
 * differs from this person's forms on file is not taken: the card asks which, naming both. A salon the manager named
 * still wins. The update notes' "an admin's card always asks which salon" was not true before this. Every person is
 * invented.
 */
const FLAG = "ADMIN_CARD_ASKS_SALON_ENABLED";
const REPORT = `QA, 24 Nov 2026 (live, Admin): "Draft a coaching form for <first name>" filed the Woven salon though her form on file is at another; an admin's card never asked which salon`;
const OPEN = { open: "ADMIN_CARD_ASKS_SALON_ENABLED is off in production (QA flips it)" };
const ADMIN = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };
const OVERLAND_PARK = "loc-0476";
const LAWRENCE = "loc-0468";
const YSOLDE: DirectoryRow = { id: "e-ysolde-marrick", firstName: "Ysolde", lastName: "Marrick", preferredFirstName: null, employmentStatus: "active", salonIds: [OVERLAND_PARK], positionName: "Tanning Consultant" };
const TWO_SALON_PERSON: DirectoryRow = { id: "e-8", firstName: "Joelle", lastName: "Penrose", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0307", "loc-0309"], positionName: "Tanning Consultant" };

type Facts = { which_salon?: boolean; salon_from_woven?: string; which_salon_woven_and_forms?: { woven: string; forms_on_file: string[]; ask_exactly: string } };

/** Her Coaching Form on file at KS Lawrence. */
function onFileAtLawrence(t: ReplayContext): void {
  (t.forms() as Record<string, unknown>[]).push({
    id: "coach-ysolde-lawrence", ...t.templateIds!("coaching"), variant_key: null, employee_role: null, location_id: LAWRENCE, location_name: "KS Lawrence",
    created_by: "another-manager", created_by_role: "salon_director", source: "ask_sunny", status: "finalized", follow_up_date: null, archived_at: null,
    revises_instance_id: null, template_key: "coaching", template_name: "Coaching Form", employee_name: "Ysolde Marrick", form_date: "2026-10-02",
    created_at: "2026-10-02T15:00:00Z", updated_at: "2026-10-02T15:00:00Z",
  });
}

/** The stand-in follows the rules book's which_salon lines, as the model does. */
function model(employee: { id?: string; name: string }) {
  return loopStandIn((view: LoopView): LoopDecision => {
    const card = lastResult(view, "propose_form") as { facts?: Facts } | null;
    if (!card) {
      const who = employee.id ? { employee_id: employee.id } : { employee_name: employee.name };
      return { tool: "propose_form", input: { template_key: "coaching", ...who, person_evidence: { message_id: view.turns.filter((turn) => turn.role === "user").at(-1)?.messageIds?.at(-1) ?? "current", quote: employee.name }, what_happened: "A performance concern." } };
    }
    const facts = card.facts ?? {};
    const ask = facts.which_salon_woven_and_forms?.ask_exactly ?? (facts.which_salon ? "Which salon is this about? The card is ready — choose the salon before you create the draft, so it is not filed with no salon." : "");
    return { text: `Here's the Coaching Form.${ask ? `\n\n${ask}` : ""}` };
  });
}

async function run(t: ReplayContext, said: string, employee: { id?: string; name: string }) {
  vi.setSystemTime(new Date("2026-11-24T18:00:00Z"));
  t.directory([...STAFF, YSOLDE, TWO_SALON_PERSON]);
  t.as("admin", ADMIN);
  const standIn = model(employee);
  t.loopModel!(standIn);
  const thread = t.thread();
  const reply = await thread.say(said);
  const facts = ([...standIn.views].reverse().map((view) => lastResult(view, "propose_form")).find(Boolean) as { facts?: Facts } | null)?.facts ?? {};
  return { reply, card: thread.proposal as { locationId?: string | null; status?: string; employeeName?: string | null } | null, facts };
}

const loopCase = (id: string, title: string, check: (t: ReplayContext) => Promise<void>, status: ReplayCase["status"] = OPEN): ReplayCase => ({
  id,
  title,
  report: REPORT,
  status,
  fixFlags: [FLAG],
  async run(t) {
    if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
    await check(t);
  },
});

export const NOV24_ADMIN_CARD_ASKS_SALON_CASES: ReplayCase[] = [
  loopCase("nov24-admin-salon-woven-differs-from-forms-on-file", `"Draft a coaching form for Ysolde" (an Admin): Woven lists her at KS Overland Park, her form on file is at KS Lawrence — the card picks neither and asks which, naming both`, async (t) => {
    onFileAtLawrence(t);
    const { reply, card, facts } = await run(t, "Draft a coaching form for Ysolde", { name: "Ysolde" });
    expect(card?.employeeName, JSON.stringify(card)).toBe("Ysolde Marrick");
    expect(card?.locationId ?? null, "the card silently took a salon").toBeNull();
    expect(card?.status, "the card was held").toBe("ready");
    expect(facts.salon_from_woven, "the card said it was filed at the Woven salon").toBeUndefined();
    expect(facts.which_salon_woven_and_forms?.woven).toBe("KS Overland Park");
    expect(facts.which_salon_woven_and_forms?.forms_on_file).toEqual(["KS Lawrence"]);
    expect(reply.content).toMatch(/Which salon is this about\?[^\n]*\*\*KS Overland Park\*\*[^\n]*\*\*KS Lawrence\*\*/);
  }),
  loopCase("nov24-admin-salon-asks-once-no-woven-salon", `An Admin's card for a person Woven lists at two salons: no salon is picked, and which_salon is asked once (the card stays ready)`, async (t) => {
    const { card, facts } = await run(t, "Draft a coaching form for Joelle Penrose", { id: TWO_SALON_PERSON.id, name: "Joelle Penrose" });
    expect(card?.locationId ?? null).toBeNull();
    expect(card?.status, "the card was held").toBe("ready");
    expect(facts.which_salon, "an admin's card with no salon did not ask which salon").toBe(true);
  }),
  loopCase("nov24-admin-salon-named-in-request-wins", `Control: "Draft a coaching form for Ysolde at Lawrence" (an Admin): the salon named wins, nothing is asked`, async (t) => {
    onFileAtLawrence(t);
    const { card, facts } = await run(t, "Draft a coaching form for Ysolde at Lawrence", { name: "Ysolde" });
    expect(card?.locationId, JSON.stringify(card)).toBe(LAWRENCE);
    expect(facts.which_salon).toBeUndefined();
    expect(facts.which_salon_woven_and_forms).toBeUndefined();
  }, "fixed"),
  loopCase("nov24-admin-salon-woven-agrees-no-forms", `Control: an Admin's card for a person at one Woven salon with no forms elsewhere is filed there, nothing is asked`, async (t) => {
    const { card, facts } = await run(t, "Draft a coaching form for Ysolde", { name: "Ysolde" });
    expect(card?.locationId, JSON.stringify(card)).toBe(OVERLAND_PARK);
    expect(facts.which_salon).toBeUndefined();
    expect(facts.which_salon_woven_and_forms).toBeUndefined();
  }, "fixed"),
];
