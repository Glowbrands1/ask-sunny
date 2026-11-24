import { expect, vi } from "vitest";

import type { DirectoryRow, ReplayCase, ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * AN ADDRESS GIVEN AS THE EMPLOYEE'S NEVER PICKS THE CARD'S SALON (port of Ask Bubbles 4f9f706c; its QA, the u22 live run)
 * ============================================================================
 *
 * In Ask Bubbles: T1 "create exit for <P>. …", T2 "address: 123 Test St, <city>, <state>. 00000" got "Filed at
 * **<city>**, as you said.": the employee's home address was read as the card's place. The same readers here read it as
 * the salon. A salon named inside an address line given as the employee's never sets the card's salon; the address belongs
 * in the exit form's Permanent Address. The person's own salon is another one, so a card filed at Manhattan can only have
 * come from the address. Mechanism only; the person and address invented.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "Port of Ask Bubbles 4f9f706c (its QA, u22 live): the manager's home-address line for the employee was read as the card's place (\"Filed at <city>, as you said\")";
const GLOBAL = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };
const MANHATTAN = "loc-0462";
const P: DirectoryRow = { id: "e-perpetua-lindqvist", firstName: "Perpetua", lastName: "Lindqvist", preferredFirstName: null, employmentStatus: "terminated", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };
const T1 =
  "create exit for Perpetua Lindqvist. Perpetua Lindqvist's last day worked was TBD. On 11-14-26 Salon Director, Corwin Ashdown, messaged Perpetua Lindqvist via woven regarding her hours worked on 11-13-26. Perpetua Lindqvist messaged back stating she did not work 11-13-26 and she was quitting effective immediately.";
const T2 = "address: 456 Elm Ave, Manhattan, KS. 00000";
const ACCOUNT = "On 11/14/26, Salon Director Corwin Ashdown messaged Perpetua Lindqvist via Woven regarding Perpetua Lindqvist's hours worked on 11/13/26. Perpetua Lindqvist messaged back stating Perpetua Lindqvist did not work 11/13/26 and was quitting effective immediately.";
const said = (view: LoopView) => view.turns.filter((turn) => turn.role === "user" && (turn.messageIds?.length ?? 0) > 0).at(-1)?.text ?? "";

/** The exit card each turn; at T2 `salon` is what the model passes as the card's salon (none, or the address's city). */
const model = (salon: string | null) =>
  loopStandIn((view): LoopDecision => {
    const result = lastResult(view, "propose_form") as { card?: { salon?: string | null }; reason_code?: string } | null;
    if (result) return { text: result.card ? `Here's the Resignation/Exit Form for **Perpetua Lindqvist**.${result.card.salon ? ` Filed at **${result.card.salon}**.` : ""}` : `refused: ${result.reason_code}` };
    const back = said(view) === T1 ? 0 : 1;
    return {
      tool: "propose_form",
      input: {
        template_key: "stc-exit",
        employee_name: "Perpetua Lindqvist",
        exit_type: "resignation",
        exit_evidence: { ...evidenceFrom(view, "create exit for Perpetua Lindqvist", back), kind: "asks_for_exit_form" },
        what_happened: ACCOUNT,
        person_evidence: evidenceFrom(view, "Perpetua Lindqvist", back),
        ...(salon && said(view) === T2 ? { salon } : {}),
      },
    };
  });

async function chat(t: ReplayContext, salon: string | null, second = T2) {
  vi.setSystemTime(new Date("2026-11-21T18:00:00Z"));
  t.directory([P]);
  t.as("salon_director", GLOBAL);
  t.loopModel!(model(salon));
  const thread = t.thread();
  await thread.say(T1);
  const reply = await thread.say(second);
  return { thread, reply };
}

const loopCase = (id: string, title: string, run: (t: ReplayContext) => Promise<void>): ReplayCase => ({
  id, title, report: REPORT, status: "fixed", fixFlags: [FLAG],
  async run(t) {
    if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
    await run(t);
  },
});

export const NOV23_AGENT_LOOP_HOME_ADDRESS_NEVER_THE_SALON_CASES: ReplayCase[] = [
  loopCase("nov23-home-address-city-is-not-the-salon", `T2 "${T2}" (the employee's address): the card is never filed at Manhattan, and the reply never says it is`, async (t) => {
    const { thread, reply } = await chat(t, null);
    expect(thread.proposal?.locationId ?? null, `the address picked the salon:\n${reply.content}`).not.toBe(MANHATTAN);
    expect(reply.content).not.toMatch(/Filed at \*\*[^*]*Manhattan/);
  }),
  loopCase("nov23-home-address-city-typed-as-salon-not-filed", "The model passes the address's city as the salon (salon \"Manhattan, KS\"): the manager named that city only inside the employee's address, so the card is never filed there", async (t) => {
    const { thread, reply } = await chat(t, "Manhattan, KS");
    expect(thread.proposal?.locationId ?? null, `the address picked the salon:\n${reply.content}`).not.toBe(MANHATTAN);
    expect(reply.content).not.toMatch(/Filed at \*\*[^*]*Manhattan/);
  }),
  loopCase("nov23-home-address-city-typed-as-salon-list-spelling", "The model passes the address's city as the salon list spells it (\"KS Manhattan\"): the card is never filed there", async (t) => {
    const { thread, reply } = await chat(t, "KS Manhattan");
    expect(thread.proposal?.locationId ?? null, `the address picked the salon:\n${reply.content}`).not.toBe(MANHATTAN);
    expect(reply.content).not.toMatch(/Filed at \*\*[^*]*Manhattan/);
  }),
  loopCase("nov23-salon-named-outside-address-still-files", "Control: \"this is for the manhattan, ks salon. address: 456 Elm Ave, Kearney, NE 68847\" names the Manhattan salon outside the address, so the card is filed there (and never at Kearney)", async (t) => {
    const { thread, reply } = await chat(t, null, "this is for the manhattan, ks salon. address: 456 Elm Ave, Kearney, NE 68847");
    expect(thread.proposal?.locationId ?? null, reply.content).toBe(MANHATTAN);
  }),
];
