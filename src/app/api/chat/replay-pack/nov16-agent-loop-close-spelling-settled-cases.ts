import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * A CLOSE SPELLING IS ASKED, EVEN WHEN THE MODEL LOOKS UP THE ROSTER SPELLING (QA, the live set on 1a53042, 16 Nov 2026)
 * ============================================================================
 *
 * Live: "tamsen orwel" was seated as the roster person with no "Did you mean". find_staff asks for "tamsen orwel", but the
 * model looked up "Tamsin Orwell" itself (Coding-B's diagnosis), so the roster's exact name matched. General rule: a
 * roster person is settled only by the manager's own words naming them exactly (a full name, legal or preferred, or a
 * whole first name; case and spacing ignored) or by this chat's recorded confirmation. A close spelling in their words
 * gets the Did-you-mean, from find_staff and from propose_form given an employee_id. Invented name: Tamsin Orwell.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const NEAR_MISS = "NEAR_MISS_NEVER_SEATED_ENABLED";
const REPORT = "QA's live set on #1064 (1a53042, 16 Nov 2026): \"tamsen orwel\" was seated as the existing roster person with no \"Did you mean\"";
const TAMSIN: DirectoryRow = { id: "e-tamsin-orwell", firstName: "Tamsin", lastName: "Orwell", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };
const ASKED = /Did you mean \*\*Tamsin Orwell\*\*/;

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-15T22:40:00Z"));
  t.directory([...STAFF, TAMSIN]);
  t.as("salon_director", KEARNEY);
}

const lastSaid = (view: LoopView) => [...view.turns].reverse().find((turn) => turn.role === "user")?.text ?? "";
type StaffOut = { note?: string; matches?: { employee_id: string }[]; did_you_mean?: unknown[] } | null;
type CardOut = { reason_code?: string; ask_exactly?: string } | null;

/**
 * The live model: it looks up the roster spelling ("Tamsin Orwell"), quoting the manager's words when `quote` is given,
 * then proposes the CA with the employee_id it got. `direct`: it skips the lookup and proposes by id.
 */
function model(options: { quote?: string; direct?: boolean } = {}) {
  return loopStandIn((view): LoopDecision => {
    const said = lastSaid(view);
    const card = lastResult(view, "propose_form") as CardOut;
    if (card) return { text: card.ask_exactly ?? card.reason_code ?? "Here's the Corrective Action Form for Tamsin." };
    const staff = lastResult(view, "find_staff") as StaffOut;
    if (!options.direct && !staff) {
      return { tool: "find_staff", input: { name: /^yes\b/i.test(said) ? "Tamsin Orwell" : "Tamsin Orwell", ...(options.quote ? { person_evidence: evidenceFrom(view, options.quote) } : {}) } };
    }
    if (staff && !(staff.matches ?? []).length) {
      const asked = /Ask the manager, in these words: ([\s\S]+)$/.exec(staff.note ?? "")?.[1];
      return { text: asked ?? "Did you mean **Tamsin Orwell**?" };
    }
    return { tool: "propose_form", input: { template_key: "dpoa", employee_id: staff?.matches?.[0]?.employee_id ?? TAMSIN.id, what_happened: "She was late to her shift on 11/14.", incident_date: "2026-11-14" } };
  });
}

export const NOV16_AGENT_LOOP_CLOSE_SPELLING_SETTLED_CASES: ReplayCase[] = [
  ...([
    ["the model looks up the roster spelling, quoting \"tamsen orwel\"", { quote: "tamsen orwel" }],
    ["the model looks up the roster spelling with no quote", {}],
    ["the model proposes Tamsin Orwell's employee_id with no lookup", { direct: true }],
  ] as const).map(([how, options], index): ReplayCase => ({
    id: `nov16-close-spelling-asked-${["quoted", "unquoted", "by-id"][index]}`,
    title: `"ca for tamsen orwel, she was late to her shift on 11/14": ${how}; Tamsin Orwell is never seated without a yes, and the reply asks "Did you mean **Tamsin Orwell**?"`,
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG, NEAR_MISS],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      t.loopModel!(model(options));
      const thread = t.thread();
      const reply = await thread.say("ca for tamsen orwel, she was late to her shift on 11/14");
      expect(thread.proposal ?? null, `a close spelling was seated as the roster person:\n${reply.content}`).toBeNull();
      expect(reply.content).toMatch(ASKED);
      // A "yes" to the Did-you-mean seats her.
      t.loopModel!(model());
      await thread.say("yes");
      expect(thread.proposal?.employeeName, "the yes did not seat the confirmed person").toBe("Tamsin Orwell");
    },
  })),
  {
    id: "nov16-close-spelling-edit-after-the-card-is-asked",
    title: "sf-s26 shape: after Tamsin Orwell's card (\"ca for tamsin orwell …\"), \"edit tamsen orwel ca\" with the model looking up \"Tamsin Orwell\" is asked (Did you mean), never seated",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG, NEAR_MISS],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      const standIn = model();
      t.loopModel!(standIn);
      const thread = t.thread();
      await thread.say("ca for tamsin orwell, she was late to her shift on 11/14");
      expect(thread.proposal?.employeeName, "the exact name did not seat her").toBe("Tamsin Orwell");
      t.loopModel!(model());
      const edit = await thread.say("edit tamsen orwel ca");
      expect(edit.content, `the close spelling was seated:\n${edit.content}`).toMatch(ASKED);
    },
  },
  {
    id: "nov16-close-spelling-controls-exact-and-first-name-seat",
    title: "Controls: \"ca for TAMSIN  orwell …\" (exact, case and spacing aside) and \"ca for tamsin, …\" (the whole first name, one Tamsin) seat Tamsin Orwell at once",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG, NEAR_MISS],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      for (const said of ["ca for TAMSIN  orwell, she was late to her shift on 11/14", "ca for tamsin, she was late to her shift on 11/14"]) {
        t.loopModel!(model());
        const thread = t.thread();
        const reply = await thread.say(said);
        expect(thread.proposal?.employeeName, `"${said}" was not seated:\n${reply.content}`).toBe("Tamsin Orwell");
      }
    },
  },
];
