import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * "SHOW ME <LAST>S FORMS" ASKS ABOUT THAT PERSON'S FORMS (Ask Bubbles coder 2's finding, via QA, 22 Nov 2026)
 * ============================================================================
 *
 * The privacy guard's person check (`formsOnFileAskedFor`, namedIn) read a full name or a first name, never a last
 * name alone: "show me <last>s forms" was refused as someone else's forms. A last name names the person when exactly
 * one person on the manager's roster has it (roster data, no word list); a last name two people share names nobody, so
 * the guard stays closed. Invented people: the pack's STAFF.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "Ask Bubbles coder 2 (via QA, 22 Nov 2026): Sunny's namedIn never accepts a last name alone (\"show me <last>s forms\")";
const SHARED_SURNAME: DirectoryRow = { id: "e-7", firstName: "Odette", lastName: "Calder", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };

type Found = { forms?: { instance_id?: string }[]; best_match?: string; reason_code?: string };

/** Remy Calder's CA on file, made the way the pack makes one. */
async function onFile(t: ReplayContext, extra: DirectoryRow[] = []): Promise<string> {
  vi.setSystemTime(new Date("2026-11-19T15:00:00Z"));
  t.directory([...STAFF, ...extra]);
  t.as("salon_director", KEARNEY);
  t.loopModel!(loopStandIn((view): LoopDecision => (lastResult(view, "propose_form") ? { text: "Here's the card." } : { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", what_happened: "Remy was late to open on 11/19.", incident_date: "2026-11-19" } })));
  const setup = t.thread();
  await setup.say("ca for remy calder, late to open on 11/19");
  const id = await setup.create();
  vi.setSystemTime(new Date("2026-11-22T15:00:00Z"));
  return id;
}

/** The model asks for Remy Calder's forms with the manager's words as evidence. */
async function ask(t: ReplayContext, said: string): Promise<Found> {
  const model = loopStandIn((view): LoopDecision => (lastResult(view, "find_past_forms") ? { text: "ok" } : { tool: "find_past_forms", input: { employee_name: "Remy Calder", forms_on_file_evidence: evidenceFrom(view, said) } }));
  t.loopModel!(model);
  await t.thread().say(said);
  return lastResult(model.views.at(-1)!, "find_past_forms") as Found;
}

export const NOV22_AGENT_LOOP_LAST_NAME_ALONE_FORMS_CASES: ReplayCase[] = [
  ...["show me calders forms", "show me Calder's forms"].map((said): ReplayCase => ({
    id: `nov22-named-in-last-name-alone${said.includes("'") ? "-apostrophe" : ""}`,
    title: `"${said}": the last name alone names Remy Calder (the only Calder on the roster); the forms are found`,
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
      const id = await onFile(t);
      const found = await ask(t, said);
      expect(found.reason_code ?? null, JSON.stringify(found)).not.toBe("privacy_not_this_person");
      expect([found.best_match, ...(found.forms ?? []).map((form) => form.instance_id)], JSON.stringify(found)).toContain(id);
    },
  })),
  {
    id: "nov22-named-in-last-name-control-other-person",
    title: "Control: \"show me paxtons forms\" (another roster person's last name) keeps Remy Calder's forms closed",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
      await onFile(t);
      expect((await ask(t, "show me paxtons forms")).reason_code).toBe("privacy_not_this_person");
    },
  },
  {
    id: "nov22-named-in-last-name-control-shared-surname",
    title: "Control: \"show me calders forms\" with two Calders on the roster names nobody: Remy Calder's forms stay closed",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
      await onFile(t, [SHARED_SURNAME]);
      expect((await ask(t, "show me calders forms")).reason_code).toBe("privacy_not_this_person");
    },
  },
];
