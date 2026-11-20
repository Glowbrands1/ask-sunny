import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * THE EXIT FORM'S PERMANENT ADDRESS IS ONLY EVER THE MANAGER'S OWN (Pau via QA, item 19, 17 and 20 Nov 2026)
 * ============================================================================
 *
 * An exit form came back with a home address the manager never typed. The staff record the app syncs carries no address,
 * so it can only have come from text the model wrote: the exit card's account (Create drafts from the card's own lines
 * and the manager's turns) or an edit_form value. General rule, on every write path: a Permanent Address is kept only when
 * that address is in a message the manager typed in this chat. The card's account never carries one the manager did not
 * type; Create reads the address from the manager's own lines of the notes, never the card's lines; edit_form refuses a
 * permanent_address value nobody typed (address_not_typed). Invented people and addresses only (Remy Calder).
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "Pau via QA (17 Nov 2026, item 19): an exit form filled a home address the manager never typed";
const offline = process.env.AGENT_LOOP_LIVE !== "1";
const ADDRESS = "412 Ashgrove Ln, Kearney, NE 68847";

type CardOut = { card?: { observation?: string | null } };
type EditOut = { saved?: { field: string }[]; refused?: { field: string; reason_code: string }[] };

function salon(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-14T22:40:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
}

/** The live model's exit card: its account carries a home address, whatever the manager typed. */
function exitCard(first: string) {
  return loopStandIn((view): LoopDecision => {
    const card = lastResult(view, "propose_form") as CardOut | null;
    if (card) return { text: "Here's the Resignation/Exit Form for **Remy Calder**." };
    return {
      tool: "propose_form",
      input: {
        template_key: "stc-exit",
        employee_id: "e-2",
        exit_evidence: { ...evidenceFrom(view, first), kind: "asks_for_exit_form" },
        what_happened: `Quit without notice. Home address ${ADDRESS}.`,
      },
    };
  });
}

export const NOV20_AGENT_LOOP_EXIT_ADDRESS_TYPED_ONLY_CASES: ReplayCase[] = [
  {
    id: "nov20-exit-address-card-and-create-never-untyped",
    title: "Item 19: \"exit form for remy calder, she quit without notice\" and the model's exit card account carries a home address nobody typed: the card's account leaves it out, and the created form's Permanent Address stays blank",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      salon(t);
      const first = "exit form for remy calder, she quit without notice";
      const model = exitCard(first);
      t.loopModel!(model);
      const thread = t.thread();
      await thread.say(first);
      const card = lastResult(model.views.at(-1)!, "propose_form") as CardOut;
      expect(card.card?.observation ?? "", "the card's account carries an address nobody typed").not.toMatch(/Ashgrove/);
      const id = await thread.create();
      expect(t.values(id).permanent_address ?? "", "Create filled a Permanent Address the manager never typed").toBe("");
    },
  },
  {
    id: "nov20-exit-address-typed-by-manager-is-kept",
    title: "Item 19 control: \"exit form for remy calder, she quit without notice. her home address is 412 Ashgrove Ln, Kearney, NE 68847\": the address the manager typed is the created form's Permanent Address",
    report: `${REPORT}; an address the manager typed is still filled`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      salon(t);
      const first = `exit form for remy calder, she quit without notice. her home address is ${ADDRESS}`;
      t.loopModel!(exitCard(first));
      const thread = t.thread();
      await thread.say(first);
      const id = await thread.create();
      expect(t.values(id).permanent_address ?? "", "the address the manager typed was not filled").toMatch(/412 Ashgrove Ln/);
    },
  },
  {
    id: "nov20-exit-address-edit-form-refuses-untyped",
    title: "Item 19 guard: on a saved exit draft, \"fill in her permanent address\" and the model sends edit_form permanent_address with an address nobody typed: refused, and the field stays blank",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      salon(t);
      const first = "exit form for remy calder, she quit without notice";
      t.loopModel!(loopStandIn((view): LoopDecision => (lastResult(view, "propose_form")
        ? { text: "Here's the Resignation/Exit Form for **Remy Calder**." }
        : { tool: "propose_form", input: { template_key: "stc-exit", employee_id: "e-2", exit_evidence: { ...evidenceFrom(view, first), kind: "asks_for_exit_form" }, what_happened: "Quit without notice." } })));
      const thread = t.thread();
      await thread.say(first);
      const id = await thread.create();
      const model = loopStandIn((view): LoopDecision => {
        const edit = lastResult(view, "edit_form") as EditOut | null;
        if (!edit) return { tool: "edit_form", input: { instance_id: id, values: { permanent_address: "77 Larkspur Ct, Kearney, NE 68845" } } };
        return { text: (edit.saved ?? []).length > 0 ? "Saved on the draft." : "I left the Permanent Address blank: tell me the address and I'll add it." };
      });
      t.loopModel!(model);
      await thread.say("fill in her permanent address");
      const refused = lastResult(model.views.at(-1)!, "edit_form") as EditOut;
      // A guard, passing before this change too: the form writer never takes permanent_address from the chat ("manager fields are not drafted").
      expect(refused.refused?.map((row) => row.field), JSON.stringify(refused)).toContain("permanent_address");
      expect(t.values(id).permanent_address ?? "", "edit_form saved an address the manager never typed").toBe("");
    },
  },
];
