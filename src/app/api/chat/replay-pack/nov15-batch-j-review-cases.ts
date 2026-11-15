import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { lastResult, loopStandIn, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * BATCH J, THE INDEPENDENT REVIEW'S NO-GO (QA, 15 Nov 2026, #1018 @fd621f49)
 * ============================================================================
 *
 * One case per ruling, each failing before its fix. People invented: Juno Paxton and Remy Calder (STAFF's).
 */
const REPORT = "QA, batch J review NO-GO (15 Nov 2026)";
const FLAG = "AGENT_LOOP_ENABLED";
const CARD = { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-3", policy: "Late Opening", what_happened: "Juno Paxton opened the salon late on 11/12." } } as const;
const POLICY = "\n\n**Policy:** Late Opening Policy, JBA Policy Manual p.15";

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-15T05:00:00Z"));
  t.directory(STAFF);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

const latest = (view: LoopView) => view.turns.filter((turn) => turn.role === "user").at(-1)?.text ?? "";
const appCheck = (view: LoopView) => /^\[app check\]/.test(latest(view));

/** Juno's CA, created; each later turn's edit_form values come from `edit`. */
async function draftThen(t: ReplayContext, edit: (said: string, draftId: string) => Record<string, string> | null) {
  let draftId = "";
  const model = loopStandIn((view) => {
    if (appCheck(view)) return { text: `Here's the Corrective Action Form for **Juno Paxton**.${POLICY}` };
    const said = latest(view);
    const values = draftId ? edit(said, draftId) : null;
    if (values) return lastResult(view, "edit_form") ? { text: "Done." } : { tool: "edit_form", input: { instance_id: draftId, values } };
    return lastResult(view, "propose_form") ? { text: `Here's the Corrective Action Form for **Juno Paxton**.${POLICY}` } : CARD;
  });
  const thread = start(t);
  t.loopModel!(model);
  await thread.say("CA for juno paxton, ASD, late to open 11/12");
  t.draftWrites({ observation: "Observed:\nJuno Paxton opened the salon late on 11/12." });
  draftId = await thread.create();
  return { thread, draftId, model };
}

export const NOV15_BATCH_J_REVIEW_CASES: ReplayCase[] = [
  {
    id: "nov15-batch-j-review-1-dictation-never-writes-employee-info",
    title: "review 1: \"Employee Name: Remy Calder, not Juno Paxton\" and \"Location: …\" on Juno's draft never rewrite the printed name or the salon",
    report: `${REPORT}, ruling 1: J2's dictated loop took employee_name, job_title, location and form_date`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      const { thread, draftId } = await draftThen(t, (said): Record<string, string> | null =>
        /^Employee Name:/.test(said) ? { employee_name: "Remy Calder" } : /^Location:/.test(said) ? { location: "KS Manhattan" } : /^Job Title:/.test(said) ? { job_title: "Salon Director" } : null,
      );
      const before = { ...t.values(draftId) };
      await thread.say("Employee Name: Remy Calder, not Juno Paxton");
      await thread.say("Location: KS Manhattan is where this happened");
      await thread.say("Job Title: Salon Director for this one");
      expect(t.values(draftId).employee_name, "the printed name was rewritten").toBe(before.employee_name);
      expect(t.values(draftId).location, "a salon was written with no scope check").toBe(before.location);
      expect(t.values(draftId).job_title, "the job title was written from dictation").toBe(before.job_title);
    },
  },
  {
    id: "nov15-batch-j-review-2-no-dictated-date",
    title: "review 2: \"Date: the twentieth of December 2026\" (model value 2026-12-20T00:00) writes no date, and never last year's",
    report: `${REPORT}, ruling 2: a dictated date reached the CA's printed Date line; isoDate read 2026-12-20T00:00 as 2025-12-20`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      const { thread, draftId } = await draftThen(t, (said) => (/^Date:/.test(said) ? { form_date: "2026-12-20T00:00" } : null));
      const before = t.values(draftId).form_date;
      await thread.say("Date: the twentieth of December 2026");
      expect(t.values(draftId).form_date, "a dictated date was written").toBe(before);
      expect(t.values(draftId).form_date ?? "").not.toBe("2025-12-20");
    },
  },
  {
    id: "nov15-batch-j-review-3-ordinary-date-edits",
    title: "review 3: \"change the date to 11/12/2026, that's when she was late\" and \"Date: 11/12/2026 please\" go through the date path and are saved",
    report: `${REPORT}, ruling 3: J2 refused ordinary date edits as rewordings of a dictated date`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      const { thread, draftId } = await draftThen(t, (said) => (/date/i.test(said) ? { form_date: "2026-11-12" } : null));
      await thread.say("change the date to 11/12/2026, that's when she was late");
      expect(t.values(draftId).form_date, "the date edit was refused").toBe("2026-11-12");
      const again = await draftThen(t, (said) => (/date/i.test(said) ? { form_date: "2026-11-12" } : null));
      await again.thread.say("Date: 11/12/2026 please");
      expect(t.values(again.draftId).form_date, "\"Date: 11/12/2026 please\" was refused").toBe("2026-11-12");
    },
  },
  {
    id: "nov15-batch-j-review-4-another-form-is-a-new-card",
    title: "review 4: \"now a coaching form for Juno\" with Juno's CA draft open is a new Coaching card: find_staff reads the roster, never points at the CA draft",
    report: `${REPORT}, ruling 4: J7 skipped find_staff for any first name of the draft's person, whatever form was asked for`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      let draftId = "";
      const model = loopStandIn((view) => {
        if (appCheck(view)) return { text: "Here is the card." };
        if (/coaching form/.test(latest(view))) {
          const found = lastResult(view, "find_staff") as { open_draft?: unknown; matches?: { employee_id?: string }[] } | undefined;
          if (!found) return { tool: "find_staff", input: { name: "Juno" } };
          if (found.open_draft) return { tool: "edit_form", input: { instance_id: draftId, values: { observation: "coaching" } } };
          return lastResult(view, "propose_form") ? { text: "Here is the Coaching card." } : { tool: "propose_form", input: { template_key: "coaching", employee_id: found.matches?.[0]?.employee_id ?? "e-3", what_happened: "Coaching on opening the salon on time." } };
        }
        return lastResult(view, "propose_form") ? { text: `Here's the Corrective Action Form for **Juno Paxton**.${POLICY}` } : CARD;
      });
      const thread = start(t);
      t.loopModel!(model);
      await thread.say("CA for juno paxton, ASD, late to open 11/12");
      t.draftWrites({ observation: "Observed:\nJuno Paxton opened the salon late on 11/12." });
      draftId = await thread.create();
      const reply = await thread.say("now a coaching form for Juno");
      const looked = model.views.flatMap((view) => view.results).filter((result) => result.tool === "find_staff").at(-1)?.output as { open_draft?: unknown } | undefined;
      expect(looked?.open_draft, "find_staff pointed a coaching request at the CA draft").toBeUndefined();
      expect(reply.formProposal?.templateKey, "no new Coaching card").toBe("coaching");
    },
  },
  {
    id: "nov15-batch-j-review-5-instruction-is-not-the-account",
    title: "review 5: \"Observation: she left the beds dirty. Also make it a verbal\": the account is \"she left the beds dirty.\", the level is set on its own",
    report: `${REPORT}, ruling 5: dictated_text ran on into "Also make it a verbal"`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      // A careless model passes the whole message as the account; the dictation it is handed back ends at the instruction.
      const model = loopStandIn((view) => {
        if (appCheck(view)) return { text: `Here's the Corrective Action Form for **Juno Paxton**.\n\n**Policy:** Standards of Conduct Policy, JBA Policy Manual p.12` };
        const handed = (view.results.at(-1)?.output as { dictated_text?: { untrusted_text?: string } } | undefined)?.dictated_text?.untrusted_text;
        if (lastResult(view, "propose_form") && !handed) return { text: `Here's the Corrective Action Form for **Juno Paxton**.\n\n**Policy:** Standards of Conduct Policy, JBA Policy Manual p.12` };
        return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-3", policy: "Standards of Conduct", warning_level: "verbal", what_happened: handed ?? "she left the beds dirty. Also make it a verbal" } };
      });
      const thread = start(t);
      t.loopModel!(model);
      await thread.say("ca for juno paxton");
      await thread.say("Observation: she left the beds dirty. Also make it a verbal");
      expect(thread.proposal?.issue, "the account holds the instruction").toBe("she left the beds dirty.");
      expect(thread.proposal).toMatchObject({ warningLevel: "verbal" });
    },
  },
  {
    id: "nov15-batch-j-review-6-history-is-not-an-ask",
    title: "review 6: \"she was written up last month\" at the step limit never lists a level as not saved",
    report: `${REPORT}, ruling 6: J3 read a history mention as a level the manager asked for`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      const { thread } = await draftThen(t, () => null);
      // The turn reads until the step limit and changes nothing.
      t.loopModel!(loopStandIn((view) => ({ tool: "read_form", input: { instance_id: (view.results.at(-1)?.output as { instance_id?: string } | undefined)?.instance_id ?? "x" } })));
      const reply = await thread.say("she was written up last month for the same thing");
      expect(reply.content, "a history mention was listed as not saved").not.toMatch(/Not saved yet/);
    },
  },
  {
    id: "nov15-batch-j-review-4b-shared-first-name-is-looked-up",
    title: "review 4: \"make it a written for Juno\" with two Junos on the roster reads the roster; only a unique first name or the full name points at the draft",
    report: `${REPORT}, ruling 4: a first name two roster people share skipped the lookup`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      let draftId = "";
      const model = loopStandIn((view) => {
        if (appCheck(view)) return { text: "Done." };
        if (/make it a written/.test(latest(view))) {
          if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: /Juno Paxton/.test(latest(view)) ? "Juno Paxton" : "Juno" } };
          return { text: "Which Juno?" };
        }
        return lastResult(view, "propose_form") ? { text: `Here's the Corrective Action Form for **Juno Paxton**.${POLICY}` } : CARD;
      });
      vi.setSystemTime(new Date("2026-11-15T05:00:00Z"));
      t.directory([...STAFF, { id: "e-juno-halloway", firstName: "Juno", lastName: "Halloway", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" }]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      t.loopModel!(model);
      await thread.say("CA for juno paxton, ASD, late to open 11/12");
      t.draftWrites({ observation: "Observed:\nJuno Paxton opened the salon late on 11/12." });
      draftId = await thread.create();
      await thread.say("make it a written for Juno");
      const shared = model.views.flatMap((view) => view.results).filter((result) => result.tool === "find_staff").at(-1)?.output as { open_draft?: unknown } | undefined;
      expect(shared?.open_draft, "a first name two people share pointed at the draft").toBeUndefined();
      await thread.say("make it a written for Juno Paxton");
      const full = model.views.flatMap((view) => view.results).filter((result) => result.tool === "find_staff").at(-1)?.output as { open_draft?: { instance_id?: string } } | undefined;
      expect(full?.open_draft?.instance_id, "the draft person's full name did not point at the draft").toBe(draftId);
    },
  },
];
