import { expect, vi } from "vitest";

import type { ChatFormProposal } from "@/types";

import { KEARNEY, STAFF, TWO_SALONS, type ReplayCase, type ReplayContext } from "./cases";
import { lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * A TYPED LAST NAME IS NEVER SWAPPED FOR ANOTHER PERSON'S (Runner 2's c163 T2 on d7042447; QA's item b, 16 Nov 2026)
 * ============================================================================
 *
 * c163 T2: the manager typed "<first> <last>", nobody on the staff list by that name, and propose_form's lookup put the
 * staff-list person with the same first name and a DIFFERENT last name on the card ("Using **<first> <other last>** from
 * your staff list"), with no Did-you-mean: a guess (Pau's no-guessing rule). The rule: a typed full name whose last name
 * is not the matched person's (nor a known alias of it) is asked about: a close spelling of it gets the Did-you-mean;
 * a last name not even close is not found ("isn't on the staff list"), offered as typed or the full name. Never seated
 * silently. Invented names only (Remy Calder on the pack's staff list; "Remy Quillfeather", "Remy Caldor" typed).
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "Runner 2's c163 T2 on d7042447 (QA's item b, 16 Nov 2026): a typed full name was seated as the staff-list person with the same first name and another last name, with no Did-you-mean";

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-16T22:15:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
}

const managerTurns = (view: LoopView) => view.turns.filter((turn) => turn.role === "user" && (turn.messageIds?.length ?? 0) > 0);
const quoted = (view: LoopView, quote: string) => ({ message_id: [...managerTurns(view)].reverse().find((turn) => turn.text.toLowerCase().includes(quote.toLowerCase()))?.messageIds?.at(-1) ?? "current", quote });

/** The live T2: propose_form with the typed name; the reply says what the result says (its question, or the card). */
function typedCard(typed: string, outputs: Record<string, unknown>[]) {
  return loopStandIn(typedDecision(typed, outputs));
}

function typedDecision(typed: string, outputs: Record<string, unknown>[]) {
  return (view: LoopView): LoopDecision => {
    const done = lastResult(view, "propose_form");
    if (done) {
      outputs.push(done);
      return { text: typeof done.ask_exactly === "string" ? done.ask_exactly : `Here's the Corrective Action Form for **${String(done.reply_name ?? typed)}**.` };
    }
    return { tool: "propose_form", input: { template_key: "dpoa", employee_name: typed, person_evidence: quoted(view, typed), what_happened: "Was below the company average last month in PPTA and Club Close%.", policy: "Other — Must See Behaviors" } };
  };
}

const employeeOf = (reply: { formProposal?: unknown }) => (reply.formProposal as ChatFormProposal | undefined)?.employeeName ?? null;

export const NOV16_AGENT_LOOP_TYPED_LAST_NAME_CASES: ReplayCase[] = [
  {
    id: "nov16-typed-last-name-not-close-is-not-seated-c163",
    title: "c163 T2: \"Remy Quillfeather was below the company average…\" (only Remy Calder on the staff list; the last name is not close): the card never says Remy Calder; the name is treated as not found (as typed, or the full name)",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      const outputs: Record<string, unknown>[] = [];
      t.loopModel!(typedCard("Remy Quillfeather", outputs));
      const reply = await t.thread().say("Remy Quillfeather was below the company average last month in PPTA and Club Close%, CA for must see behaviors");
      expect(employeeOf(reply), `a different last name was seated silently: ${JSON.stringify(outputs.at(-1))}`).not.toBe("Remy Calder");
      expect(reply.content, "the reply names the staff-list person as if typed").not.toMatch(/Using \*\*Remy Calder\*\*/);
    },
  },
  {
    id: "nov16-typed-last-name-close-asks-did-you-mean",
    title: "QA's item b: \"Remy Caldor was below…\" (a close spelling of Remy Calder's last name): the Did-you-mean is asked, no card for Remy Calder until the manager answers",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      const outputs: Record<string, unknown>[] = [];
      t.loopModel!(typedCard("Remy Caldor", outputs));
      const reply = await t.thread().say("Remy Caldor was below the company average last month in PPTA and Club Close%, CA for must see behaviors");
      expect(reply.content, JSON.stringify(outputs.at(-1))).toMatch(/Did you mean \*\*Remy Calder\*\*\?/);
      expect(employeeOf(reply), "the close spelling was seated before the manager answered").not.toBe("Remy Calder");
    },
  },
  {
    id: "nov16-typed-last-name-inner-letter-dropped-c163-t2",
    title: "c163 T2 in Runner 2's shape: \"can you create a CA for must see behaviors\" (the app asks who), then \"Rowan Kestrl was below the company average…\" (the staff list's Rowan Kestrel with an inner letter dropped; one Rowan in scope): the Did-you-mean is asked, never \"Using Rowan Kestrel from your staff list\"",
    report: `${REPORT}; Runner 2's shape: first name exact, last name the staff one with its 6th of 7 letters dropped, one same-first person in scope`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-16T22:15:00Z"));
      // Runner 2's point 3: a second Rowan on the whole staff list, out of this salon director's two salons, last name unrelated.
      t.directory([...STAFF, { id: "e-9", firstName: "Rowan", lastName: "Thistlewood", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0468"], positionName: "Tanning Consultant" }]);
      t.as("salon_director", TWO_SALONS);
      /*
       * Live c163 T2 seated the close spelling with "Using … from your staff list" (name_from_staff_list), as the code does
       * when NEAR_MISS_NEVER_SEATED is off. The rule must not hang on that flag: run with it off.
       */
      vi.stubEnv("NEAR_MISS_NEVER_SEATED_ENABLED", "false");
      const outputs: Record<string, unknown>[] = [];
      t.loopModel!(loopStandIn((view): LoopDecision => {
        if (managerTurns(view).length === 1) return lastResult(view, "propose_form") ? { text: "Who is this Corrective Action Form for?" } : { tool: "propose_form", input: { template_key: "dpoa", policy: "Other — Must See Behaviors" } };
        return typedDecision("Rowan Kestrl", outputs)(view);
      }));
      const thread = t.thread();
      await thread.say("can you create a CA for must see behaviors");
      const reply = await thread.say("Rowan Kestrl was below the company average last month in the following categories; PPTA, LPSVA, Club Close%, and spa %");
      expect(employeeOf(reply), `the close spelling was seated silently: ${JSON.stringify(outputs.at(-1))}`).not.toBe("Rowan Kestrel");
      expect(reply.content, JSON.stringify(outputs.at(-1))).toMatch(/Did you mean \*\*Rowan Kestrel\*\*\?/);
      vi.unstubAllEnvs();
    },
  },
  {
    id: "nov16-typed-last-name-model-picks-the-roster-id",
    title: "QA's item b, the other path: the model passes Rowan Kestrel's employee_id itself, quoting \"Rowan Kestrl was below…\" as person_evidence (production's flags): the whole first name in the quote does not settle a different last name; the Did-you-mean is asked",
    report: `${REPORT}; closeSpellingNotSettled took the whole first name "Rowan" as settling "Rowan Kestrl"`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      const outputs: Record<string, unknown>[] = [];
      t.loopModel!(loopStandIn((view): LoopDecision => {
        const done = lastResult(view, "propose_form");
        if (done) {
          outputs.push(done);
          return { text: typeof done.ask_exactly === "string" ? done.ask_exactly : "Here's the Corrective Action Form for **Rowan**." };
        }
        return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-4", person_evidence: quoted(view, "Rowan Kestrl was below the company average"), what_happened: "Was below the company average last month in PPTA and Club Close%.", policy: "Other — Must See Behaviors" } };
      }));
      const reply = await t.thread().say("Rowan Kestrl was below the company average last month in PPTA and Club Close%, CA for must see behaviors");
      expect(employeeOf(reply), `the close spelling was seated silently: ${JSON.stringify(outputs.at(-1))}`).not.toBe("Rowan Kestrel");
      expect(reply.content, JSON.stringify(outputs.at(-1))).toMatch(/Did you mean \*\*Rowan Kestrel\*\*\?/);
    },
  },
  {
    id: "nov16-typed-last-name-controls",
    title: "Controls (QA): a first name alone (\"ca for rowan, late on 11/14\", one Rowan), the exact full name, and a nickname with a hyphenated last name (\"Kate Ashdown-Ferrant\") keep today's behaviour: the card is that person's",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      // QA's controls: a nickname (preferred first name) with a hyphenated last name; invented.
      t.directory([...STAFF, { id: "e-10", firstName: "Katherine", lastName: "Ashdown-Ferrant", preferredFirstName: "Kate", employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" }]);
      for (const [message, quote, id, expected] of [
        ["ca for Rowan Kestrel, late on 11/14", "Rowan Kestrel", "e-4", "Rowan Kestrel"],
        ["ca for rowan, late on 11/14", "rowan", "e-4", "Rowan Kestrel"],
        ["ca for Kate Ashdown-Ferrant, late on 11/14", "Kate Ashdown-Ferrant", "e-10", "Kate Ashdown-Ferrant"],
      ] as const) {
        t.loopModel!(loopStandIn((view): LoopDecision => (lastResult(view, "propose_form")
          ? { text: "Here's the Corrective Action Form." }
          : { tool: "propose_form", input: { template_key: "dpoa", employee_id: id, person_evidence: quoted(view, quote), what_happened: "Late on 11/14.", incident_date: "2026-11-14", policy: "Attendance" } })));
        const reply = await t.thread().say(message);
        expect(employeeOf(reply), message).toMatch(new RegExp(expected.split(" ").at(-1)!));
      }
    },
  },
  {
    id: "nov16-typed-last-name-prefix-asked-then-yes",
    title: "Ruling (b), QA 17 Nov (option A): \"ca for tamsin orwel, late on 11/14\" (a last name that is only a prefix of the staff list's Orwell) asks \"Did you mean **Tamsin Orwell**?\"; \"yes\" then seats Tamsin Orwell",
    report: `${REPORT}; QA's ruling on the prefix case: a last name that is only a prefix is asked too`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-16T22:15:00Z"));
      t.directory([...STAFF, { id: "e-tamsin-orwell", firstName: "Tamsin", lastName: "Orwell", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" }]);
      t.as("salon_director", KEARNEY);
      t.loopModel!(loopStandIn((view): LoopDecision => {
        const staff = lastResult(view, "find_staff") as { matches?: { employee_id: string }[]; ask_exactly?: string } | null;
        if (!staff) return { tool: "find_staff", input: { name: "tamsin orwel", person_evidence: quoted(view, "tamsin orwel") } };
        if (staff.ask_exactly) return { text: staff.ask_exactly };
        const done = lastResult(view, "propose_form");
        if (done) return { text: typeof done.ask_exactly === "string" ? done.ask_exactly : "Here's the Corrective Action Form for **Tamsin**." };
        return { tool: "propose_form", input: { template_key: "dpoa", employee_id: staff.matches?.[0]?.employee_id, person_evidence: quoted(view, "tamsin orwel"), what_happened: "Tamsin Orwell was late on 11/14.", incident_date: "2026-11-14", policy: "Attendance" } };
      }));
      const thread = t.thread();
      const ask = await thread.say("ca for tamsin orwel, late on 11/14");
      expect(ask.content).toMatch(/Did you mean \*\*Tamsin Orwell\*\*\?/);
      expect(employeeOf(ask), "seated before the manager answered").toBeNull();
      const yes = await thread.say("yes");
      expect(employeeOf(yes) ?? thread.proposal?.employeeName, yes.content).toBe("Tamsin Orwell");
    },
  },
];
