import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * A TYPED NAME'S POSSESSIVE NEVER KEEPS THE PERSON OFF THE ROSTER (the 266-chat run's 053/116/117/138/237/239, QA's step 3, 22 Nov 2026)
 * ============================================================================
 *
 * The manager's turns, word for word (the people invented, the pack's roster): "I need a corrective action for  f", then
 * "<First> <Last>'s, today, - <First> set up a spray booth, then went into Room 4 and stayed there until the first
 * customer arrived at 7:57am. …". The live model passed the name as typed; the card read "**<First> <Last>'s** isn't on
 * your salon's Woven staff list, so I've used the name as you typed it", for a person who is on it.
 *
 * Mechanism (`possessiveRead`, `employee-match.ts`): a trailing 's / ’s on the typed name is grammar. It leaves only when
 * the name without it is the one the roster matches; a surname ending in s ("Ross") is never touched.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "The 266-chat run (cases 053, 116, 117, 138, 237, 239), re-checked on main 7787aa9: \"**<First> <Last>'s** isn't on your salon's Woven staff list, so I've used the name as you typed it\"";
const T1 = "I need a corrective action for  f";
const T2 = (name: string) => `${name}, today, - Remy set up a spray booth, then went into Room 4 and stayed there until the first customer arrived at 7:57am.`;
const ROSS = { id: "e-6", firstName: "Juno", lastName: "Ross", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" } satisfies DirectoryRow;

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-22T18:00:00Z"));
  t.directory([...STAFF, ROSS]);
  t.as("salon_director", KEARNEY);
}

/** The live model: the card with the name exactly as the manager typed it, possessive included. */
function model(typed: string) {
  return loopStandIn((view): LoopDecision => {
    if (lastResult(view, "propose_form")) return { text: "Here's the Corrective Action Form." };
    if (!view.turns.some((turn) => turn.role === "user" && turn.text.includes(typed))) return { text: "Who is this Corrective Action Form for?" };
    return {
      tool: "propose_form",
      input: {
        template_key: "dpoa", employee_name: typed, person_evidence: evidenceFrom(view, typed),
        what_happened: "Remy set up a spray booth, then went into Room 4 and stayed there until the first customer arrived at 7:57am.",
        incident_date: "2026-11-22",
      },
    };
  });
}

/* employeeRole comes from the roster row only: an off-roster name has none. */
const cardOf = (thread: { proposal?: unknown }) => thread.proposal as { employeeName?: string; employeeRole?: string | null } | undefined;

export const NOV22_AGENT_LOOP_POSSESSIVE_TYPED_NAME_CASES: ReplayCase[] = [
  ...["Remy Calder's", "Remy Calder’s"].map((typed): ReplayCase => ({
    id: `nov22-f038-138-possessive-typed-name${typed.includes("’") ? "-curly" : ""}`,
    title: `138: "${typed}, today, - …": the card is for the roster's Remy Calder, never "${typed}" off the roster`,
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
      start(t);
      t.loopModel!(model(typed));
      const thread = t.thread();
      await thread.say(T1);
      const reply = await thread.say(T2(typed));
      expect(cardOf(thread)?.employeeName, `the card keeps the possessive:\n${reply.content}`).toBe("Remy Calder");
      expect(cardOf(thread)?.employeeRole ?? null, "the card is not the roster's Remy Calder (no roster title)").toBe("Tanning Consultant");
    },
  })),
  {
    id: "nov22-f038-138-control-surname-ends-in-s",
    title: "control: \"Juno Ross, today, - …\": a surname ending in s is the roster's Juno Ross, untouched",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
      start(t);
      t.loopModel!(model("Juno Ross"));
      const thread = t.thread();
      await thread.say(T1);
      await thread.say(T2("Juno Ross"));
      expect(cardOf(thread)?.employeeName).toBe("Juno Ross");
      expect(cardOf(thread)?.employeeRole ?? null).toBe("Tanning Consultant");
    },
  },
];
