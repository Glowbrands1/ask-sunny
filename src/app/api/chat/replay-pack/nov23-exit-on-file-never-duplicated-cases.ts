import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * THE LIVE DUPLICATE EXIT FORM (QA, 23 Nov 2026; Pau's review). An Assistant Salon Director asked to edit <P>'s exit form
 * for HR. She was told no exit form was on file, though a FINALIZED one from 11/20 was. She said "make  an exit form then",
 * and <P> got a second exit form with HR's edits on the new draft. Then "How did <P> leave …?" was asked twice after
 * "effective immediately".
 * ============================================================================
 *
 * Her turns, word for word; every name swapped for an invented one (the person, the ASD, the salon):
 *   T1 "make thes edits on <P> exit Hi <ASD>, Please make the following edits and resubmit for approval: …"
 *   T2 "make  an exit form then"
 *   T3 "her last day worked was 11/17/2026. she forfeit her bonus and drops to minium wage"
 *
 * Expected (QA):
 *   (a) the edit request finds the finalized exit form (find_past_forms lists it), never "no exit form on file";
 *   (b) a new exit card for someone who already has one is not made: the reply says so and offers to open it or start a
 *       new one (asked once; the manager's answer decides);
 *   (c) the exit type the card showed ("effective immediately" → Immediate Voluntary Resignation) is kept when the same
 *       person's card is proposed again, so "How did <P> leave …?" is not asked again.
 */

const REPORT = "QA, 23 Nov 2026 (Pau's review of a live chat): the AI said no exit form was on file though a finalized one was, made a duplicate exit form, and asked how the person left twice after \"effective immediately\"";
const FLAG = "AGENT_LOOP_ENABLED";
const ASD = "asd-kara-wexley";

const RHEA: DirectoryRow = { id: "e-rhea-cotter", firstName: "Rhea", lastName: "Cotter", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };
const T1 =
  "make thes edits on rhea cotter exit Hi Kara,\nPlease make the following edits and resubmit for approval: \n\n    Remove dates for notice given and notice fulfilled. Dates should only be entered when the Submitted & Fulfilled Notice box is checked.\n\n    How Employee Resigned should state: On dd/mm/yyyy Rhea gave verbal notice of her immediate resignation to Kara Wexley, Assistant Salon Director\n    Additional Details should read: Rhea voluntarily terminated her employment effective immediately and provided no other details regarding her resignation";
const T2 = "make  an exit form then";
const T3 = "her last day worked was 11/17/2026. she forfeit her bonus and drops to minium wage";
const T4 = "what happended should be Rhea voluntarily terminated her employment effective immediately and provided no other details regarding her resignation";

type Row = Record<string, unknown>;

/** Rhea's forms on file, as the live record had them: Corrective Actions, a coaching form, and the finalized exit form of 11/20. */
function onFile(t: ReplayContext, withExit = true): void {
  const row = (key: string, name: string, id: string, formDate: string, status: string): Row => ({
    id, ...t.templateIds!(key), variant_key: null, employee_role: null, location_id: KEARNEY.primaryAreaId, location_name: "NE Kearney",
    created_by: ASD, created_by_role: "assistant_salon_director", source: "ask_sunny", status, follow_up_date: null, archived_at: null,
    revises_instance_id: null, template_key: key, template_name: name, employee_name: "Rhea Cotter", form_date: formDate,
    created_at: `${formDate}T15:00:00Z`, updated_at: `${formDate}T15:00:00Z`,
  });
  (t.forms() as Row[]).push(
    row("dpoa", "Corrective Action Form", "ca-rhea-1111", "2026-11-11", "finalized"),
    row("dpoa", "Corrective Action Form", "ca-rhea-1116", "2026-11-16", "finalized"),
    row("coaching", "Coaching Form", "co-rhea-1109", "2026-11-09", "finalized"),
    ...(withExit ? [row("stc-exit", "Resignation/Exit Form", "exit-rhea-1120", "2026-11-20", "finalized")] : []),
  );
  /* Each Corrective Action's own Type of Warning, as on the live forms: HR's "gave verbal notice" names one of them. */
  t.checkOnForm!("ca-rhea-1111", { warning_type: ["verbal"] });
  t.checkOnForm!("ca-rhea-1116", { warning_type: ["written"] });
  /* The finalized exit form as the live record had it: notice dates entered with the Submitted & Fulfilled box unchecked. */
  if (withExit) t.typeOnForm("exit-rhea-1120", { notice_given_date: "2026-11-17", notice_fulfilled_date: "2026-11-17", resignation_method: "Verbal", details: "Rhea quit." });
}

function start(t: ReplayContext, withExit = true): void {
  vi.setSystemTime(new Date("2026-11-23T19:18:00Z"));
  t.directory([...STAFF, RHEA]);
  t.as("assistant_salon_director", KEARNEY, ASD);
  onFile(t, withExit);
}

const said = (view: LoopView) => view.turns.filter((turn) => turn.role === "user").at(-1)?.text ?? "";
const exitCard = (view: LoopView, extra: Record<string, unknown> = {}) => ({
  tool: "propose_form",
  input: { template_key: "stc-exit", employee_id: RHEA.id, exit_type: "resignation", exit_evidence: { ...evidenceFrom(view, said(view)), kind: "asks_for_exit_form" }, ...extra },
});
const exitForms = (t: ReplayContext) => (t.forms() as Row[]).filter((row) => row.template_key === "stc-exit" || row.template_id === t.templateIds!("stc-exit").template_id);

type FindOut = { forms?: { form?: string; status?: string }[] };
type ProposeOut = { reason_code?: string; ask_exactly?: string; facts?: { exit_ticks?: string[]; exit_unset?: string[] } };

export const NOV23_EXIT_ON_FILE_NEVER_DUPLICATED_CASES: ReplayCase[] = [
  {
    id: "nov23-exit-edit-request-finds-the-finalized-exit-form",
    title: "(a) T1 verbatim (an ASD's \"make thes edits on <P> exit …\"): find_past_forms lists the finalized Resignation/Exit Form of 11/20, so the reply never says none is on file",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
      start(t);
      const seen: FindOut[] = [];
      t.loopModel!(loopStandIn((view): LoopDecision => {
        const found = view.results.filter((result) => result.tool === "find_past_forms");
        if (found.length === 0) return { tool: "find_past_forms", input: { employee_name: "Rhea Cotter", form: "stc-exit", open: true, forms_on_file_evidence: evidenceFrom(view, "rhea cotter exit") } };
        seen.push(...found.map((result) => result.output as FindOut));
        return { text: "Here are Rhea's forms on file." };
      }));
      await t.thread().say(T1);
      const forms = seen.at(-1)?.forms ?? [];
      expect(forms.some((form) => form.form === "Resignation/Exit Form" && form.status === "finalized"), `the finalized exit form is not among her forms on file:\n${JSON.stringify(forms)}`).toBe(true);
    },
  },
  {
    id: "nov23-exit-make-one-then-says-one-is-on-file",
    title: "(b) T2 \"make  an exit form then\" with a finalized exit form on file: no card, no new form; the reply says one is on file and offers to open it or start a new one",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
      start(t);
      const outs: ProposeOut[] = [];
      t.loopModel!(loopStandIn((view): LoopDecision => {
        const result = lastResult(view, "propose_form") as ProposeOut | null;
        if (result) {
          outs.push(result);
          return { text: result.ask_exactly ?? "Here's the Resignation/Exit Form for **Rhea**." };
        }
        if (said(view) === T1) return { text: "Which form do you mean?" };
        return exitCard(view);
      }));
      const thread = t.thread();
      await thread.say(T1);
      const before = exitForms(t).length;
      const reply = await thread.say(T2);
      expect(outs.at(-1)?.reason_code, JSON.stringify(outs.at(-1))).toBe("exit_on_file");
      expect(thread.proposal, "an exit card was made for a person who already has an exit form").toBeFalsy();
      expect(exitForms(t).length, "a second exit form was created").toBe(before);
      expect(reply.content).toMatch(/already has a Resignation\/Exit Form on file \(finalized 11\/20\/2026/);
      expect(reply.content).toMatch(/open it/);
    },
  },
  {
    id: "nov23-exit-new-one-only-after-the-manager-answers",
    title: "(b) asked once: after the on-file question, \"start a new one\" makes the card (the manager's answer decides)",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
      start(t);
      t.loopModel!(loopStandIn((view): LoopDecision => {
        const result = lastResult(view, "propose_form") as ProposeOut | null;
        if (result) return { text: result.ask_exactly ?? "Here's the Resignation/Exit Form for **Rhea**." };
        return exitCard(view);
      }));
      const thread = t.thread();
      await thread.say(T2.replace("then", "for rhea cotter"));
      expect(thread.proposal, "the first ask made a card").toBeFalsy();
      await thread.say("start a new one");
      expect(thread.proposal?.templateKey, "the manager's answer did not make the card").toBe("stc-exit");
    },
  },
  {
    id: "nov23-exit-control-none-on-file-card-made",
    title: "control: no exit form on file for the person, \"make an exit form for rhea cotter\" makes the card at once",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
      start(t, false);
      t.loopModel!(loopStandIn((view): LoopDecision => (lastResult(view, "propose_form") ? { text: "Here's the Resignation/Exit Form for **Rhea**." } : exitCard(view))));
      const thread = t.thread();
      await thread.say("make an exit form for rhea cotter");
      expect(thread.proposal?.templateKey).toBe("stc-exit");
    },
  },
  {
    id: "nov23-exit-type-kept-on-the-same-card",
    title: "(c) T1 → T2 → T3 → T4 verbatim (no exit form on file here): T2's card shows how she left from T1's \"immediate resignation\"; T3 (last day worked) proposes the same card again and keeps it, never asking how she left again",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
      start(t, false);
      const outs: ProposeOut[] = [];
      t.loopModel!(loopStandIn((view): LoopDecision => {
        const result = lastResult(view, "propose_form") as ProposeOut | null;
        if (result) {
          outs.push(result);
          return { text: "Here's the Resignation/Exit Form for **Rhea**." };
        }
        if (said(view) === T1) return { text: "No Resignation/Exit Form is on file for Rhea Cotter." };
        /* As the live model did: T2's card reads how she left from T1's words (exit_how, quoted); T3's call does not repeat it. */
        if (said(view) === T2) return exitCard(view, { exit_how: "immediate_voluntary_resignation", exit_how_evidence: evidenceFrom(view, "her immediate resignation", 1) });
        return exitCard(view);
      }));
      const thread = t.thread();
      await thread.say(T1);
      await thread.say(T2);
      expect(outs.at(-1)?.facts?.exit_ticks ?? [], `T2's card shows no type (the case proves nothing):\n${JSON.stringify(outs.at(-1)?.facts)}`).toContain("Immediate Voluntary Resignation");
      await thread.say(T3);
      const again = outs.at(-1);
      expect(again?.facts?.exit_ticks ?? [], `the same card lost how she left:\n${JSON.stringify(again?.facts)}`).toContain("Immediate Voluntary Resignation");
      expect(again?.facts?.exit_unset ?? [], "the card asks how she left again").not.toContain("resignation_type");
      /* Failure 2, items 5 and 6: her T4 (the account) is proposed on the same card again; how she left stays, never asked. */
      await thread.say(T4);
      const fourth = outs.at(-1);
      expect(fourth?.facts?.exit_ticks ?? [], `T4's card lost how she left:\n${JSON.stringify(fourth?.facts)}`).toContain("Immediate Voluntary Resignation");
      expect(fourth?.facts?.exit_unset ?? [], "T4's card asks how she left again").not.toContain("resignation_type");
    },
  },
  {
    id: "nov23-exit-hr-edits-revise-the-finalized-form",
    title: "Failure 2, items 2 and 4: T1 verbatim (HR's edits pasted) edits the finalized exit form of 11/20 through a revision: both notice dates cleared, How Employee Resigned and Additional Details as HR wrote them; no second exit form, the original untouched",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
      start(t);
      const edits: Row[] = [];
      t.loopModel!(loopStandIn((view): LoopDecision => {
        const edited = lastResult(view, "edit_form") as Row | null;
        if (edited) {
          edits.push(edited);
          return { text: "Done." };
        }
        if (!lastResult(view, "find_past_forms")) return { tool: "find_past_forms", input: { employee_name: "Rhea Cotter", form: "exit", open: true, forms_on_file_evidence: evidenceFrom(view, "rhea cotter exit") } };
        return {
          tool: "edit_form",
          input: {
            instance_id: "exit-rhea-1120",
            forms_on_file_evidence: evidenceFrom(view, "make thes edits on rhea cotter exit"),
            clear_evidence: { notice_given_date: "Remove dates for notice given and notice fulfilled", notice_fulfilled_date: "Remove dates for notice given and notice fulfilled" },
            values: {
              notice_given_date: "",
              notice_fulfilled_date: "",
              resignation_method: "On dd/mm/yyyy Rhea gave verbal notice of her immediate resignation to Kara Wexley, Assistant Salon Director",
              details: "Rhea voluntarily terminated her employment effective immediately and provided no other details regarding her resignation",
            },
          },
        };
      }));
      await t.thread().say(T1);
      const exits = exitForms(t);
      const revision = exits.find((row) => row.revises_instance_id === "exit-rhea-1120");
      expect(revision, `no revision of the finalized exit form:\n${JSON.stringify(edits.at(-1)).slice(0, 600)}`).toBeTruthy();
      expect(exits.filter((row) => row.id !== "exit-rhea-1120" && row.revises_instance_id !== "exit-rhea-1120"), "a second exit form was made").toEqual([]);
      const now = t.values(String(revision!.id));
      expect(now.notice_given_date ?? "", `notice given still dated:\n${JSON.stringify(edits.at(-1)).slice(0, 900)}`).toBe("");
      expect(now.notice_fulfilled_date ?? "", "notice fulfilled still dated").toBe("");
      expect(now.resignation_method).toMatch(/gave verbal notice of her immediate resignation/);
      expect(now.details).toMatch(/voluntarily terminated her employment effective immediately/);
      expect(t.values("exit-rhea-1120").notice_given_date, "the finalized original changed").toBe("2026-11-17");
      /* The reply names every field it cleared or replaced (Pau, 24 Nov brief, item 4). */
      const named = ((edits.at(-1)?.stated_edits ?? []) as { field: string; cleared?: boolean }[]);
      expect(named.filter((line) => line.cleared).map((line) => line.field).sort()).toEqual(["Date that notice was fulfilled", "Date that notice was given"]);
      expect(named.some((line) => /How Employee Resigned/i.test(line.field) && !line.cleared), JSON.stringify(named)).toBe(true);
    },
  },
  {
    id: "nov23-exit-edit-control-unnamed-field-untouched",
    title: "Failure 2, item 4, control: a message that names only Additional Details, with the model also sending the notice dates and How Employee Resigned, changes Additional Details only; the fields the message does not name keep what the manager typed",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
      start(t);
      const ask = "make thes edits on rhea cotter exit Additional Details should read: Rhea voluntarily terminated her employment effective immediately";
      t.loopModel!(loopStandIn((view): LoopDecision => {
        if (lastResult(view, "edit_form")) return { text: "Done." };
        if (!lastResult(view, "find_past_forms")) return { tool: "find_past_forms", input: { employee_name: "Rhea Cotter", form: "exit", open: true, forms_on_file_evidence: evidenceFrom(view, "rhea cotter exit") } };
        return {
          tool: "edit_form",
          input: {
            instance_id: "exit-rhea-1120",
            forms_on_file_evidence: evidenceFrom(view, "make thes edits on rhea cotter exit"),
            clear_evidence: { notice_given_date: "remove the notice dates" },
            values: { notice_given_date: "", notice_fulfilled_date: "", resignation_method: "Rhea quit over the phone to the salon director", details: "Rhea voluntarily terminated her employment effective immediately" },
          },
        };
      }));
      await t.thread().say(ask);
      const revision = exitForms(t).find((row) => row.revises_instance_id === "exit-rhea-1120");
      expect(revision, "no revision opened").toBeTruthy();
      const now = t.values(String(revision!.id));
      expect(now.notice_given_date, "a notice date this message did not name was cleared").toBe("2026-11-17");
      expect(now.notice_fulfilled_date, "a notice date this message did not name was cleared").toBe("2026-11-17");
      expect(now.resignation_method, "How Employee Resigned was replaced with words this message does not hold").toBe("Verbal");
    },
  },
  {
    id: "nov23-exit-last-day-worked-is-not-the-form-date",
    title: "Failure 2, item 7: T3 verbatim (\"her last day worked was 11/17/2026 …\") with the model sending 11/17 as the date, as live: the card's last day worked is 11/17 and its form date stays today's, never moved to the last day worked",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
      start(t, false);
      const outs: (ProposeOut & { card?: { form_date?: string | null } })[] = [];
      t.loopModel!(loopStandIn((view): LoopDecision => {
        const result = lastResult(view, "propose_form") as (ProposeOut & { card?: { form_date?: string | null } }) | null;
        if (result) {
          outs.push(result);
          return { text: "Here's the Resignation/Exit Form for **Rhea**." };
        }
        return said(view) === T3 ? exitCard(view, { incident_date: "11/17/2026" }) : exitCard(view);
      }));
      const thread = t.thread();
      await thread.say("make an exit form for rhea cotter");
      await thread.say(T3);
      expect(thread.proposal?.templateKey).toBe("stc-exit");
      expect(thread.proposal?.formDate, `the form date moved to the last day worked:\n${JSON.stringify(outs.at(-1)).slice(0, 600)}`).not.toBe("2026-11-17");
      expect(thread.proposal?.formDate).toBe("2026-11-23");
    },
  },
  ...(["2026-11-16", "2026-11-22"] as const).map((day): ReplayCase => ({
    id: day === "2026-11-16" ? "nov23-ca-same-incident-date-says-one-is-on-file" : "nov23-ca-other-incident-date-card-made",
    title: day === "2026-11-16"
      ? "Failure 2, item 3: a Corrective Action for the same person and the same incident date as one on file (finalized 11/16): no card; the reply says one is on file for 11/16 and offers to open it; \"start a new one\" then makes the card"
      : "Failure 2, item 3, control: a Corrective Action for the same person on another incident date (11/22) is made at once",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
      start(t, false);
      const ask = `write a verbal CA for rhea cotter, she was late to open on ${day.slice(5, 7)}/${day.slice(8, 10)}`;
      const outs: ProposeOut[] = [];
      t.loopModel!(loopStandIn((view): LoopDecision => {
        const result = lastResult(view, "propose_form") as ProposeOut | null;
        if (result) {
          outs.push(result);
          return { text: result.ask_exactly ?? "Here's the Corrective Action Form for **Rhea**." };
        }
        return {
          tool: "propose_form",
          input: {
            template_key: "dpoa", employee_id: RHEA.id, person_evidence: evidenceFrom(view, "rhea cotter", view.turns.filter((turn) => turn.role === "user").length > 1 ? 1 : 0),
            incident_date: `${day.slice(5, 7)}/${day.slice(8, 10)}/2026`, observation: "Rhea was late to open.",
            warning_level: "verbal", level_evidence: evidenceFrom(view, "a verbal CA", view.turns.filter((turn) => turn.role === "user").length > 1 ? 1 : 0),
          },
        };
      }));
      const thread = t.thread();
      const reply = await thread.say(ask);
      if (day === "2026-11-22") {
        expect(thread.proposal?.templateKey, JSON.stringify(outs.at(-1)).slice(0, 600)).toBe("dpoa");
        return;
      }
      expect(outs.at(-1)?.reason_code, JSON.stringify(outs.at(-1)).slice(0, 600)).toBe("form_on_file_same_date");
      expect(thread.proposal, "a second Corrective Action card for the same incident date").toBeFalsy();
      expect(reply.content).toMatch(/already has a Corrective Action Form on file for 11\/16\/2026 \(finalized/);
      await thread.say("start a new one");
      expect(thread.proposal?.templateKey, `the manager's answer did not make the card:\n${JSON.stringify(outs.at(-1)).slice(0, 600)}`).toBe("dpoa");
    },
  })),
];
