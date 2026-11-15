import { expect, vi } from "vitest";

import { KEARNEY, STAFF, TWO_SALONS, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";
import { lastResult, loopStandIn, type LoopDecision, type LoopView, evidenceFrom } from "./loop-stand-in";

/**
 * ============================================================================
 * BATCH G: THE LOOP WITH A FORM OPEN (QA's first live test with a draft open, 15 Nov 2026)
 * ============================================================================
 *
 * The first live test of the agent loop with a form open (a Corrective Action with a sectioned Observation) found
 * edit-path bugs. Pau then paused rewording ("make it professional"): G0 turns it off (nothing is written, the
 * reply says so). G3, G4 and G5 are the add, open and payroll paths. Every person here is invented, and the
 * managers' wording is kept.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA's live test with a form open (15 Nov 2026)";
const PAUSED = "Rewording isn't available yet. Tell me exactly what to change and I'll update it.";

const toolResults = (views: readonly LoopView[], tool: string) => views.flatMap((view) => view.results.filter((result) => result.tool === tool)).map((result) => JSON.stringify(result.output));
/** Offline only: a live run checks outcomes, never which tool facts the real model asked for. */
const offline = process.env.AGENT_LOOP_LIVE !== "1";

/** Close in spelling to Remy Calder (G4's two-close-names case). */
const REMI: DirectoryRow = { id: "e-remi-calder", firstName: "Remi", lastName: "Calder", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };

/** At both of the manager's salons; Woven lists Kearney (loc-0309) as her salon (G14). */
const ISLA: DirectoryRow & { primarySalonId: string } = { id: "e-isla-marrow", firstName: "Isla", lastName: "Marrow", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0307", "loc-0309"], positionName: "Tanning Consultant", primarySalonId: "loc-0309" };

/** Legal name Josephine Quill; goes by "Jo" in Woven (Pau's name ruling, 15 Nov 2026). */
const JO: DirectoryRow = { id: "e-josephine-quill", firstName: "Josephine", lastName: "Quill", preferredFirstName: "Jo", employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };

/** A created form on file for <employee id>: form, date and account as given; returns its instance id. */
async function onFile(t: ReplayContext, employeeId: string, name: string, templateKey: string, date: string, account: string): Promise<string> {
  t.loopModel!(loopStandIn((view): LoopDecision => {
    if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name } };
    if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: templateKey, employee_id: employeeId, what_happened: account, incident_date: date } };
    return { text: `Here's the form for **${name}**.\n\n**Observation of Offense:** ${account}` };
  }));
  const thread = t.thread();
  await thread.say(`${templateKey === "coaching" ? "coaching form" : "ca"} for ${name.toLowerCase()}, ${account}`);
  return thread.create();
}

export const NOV15_AGENT_LOOP_BATCH_G_CASES: ReplayCase[] = [
  {
    id: "nov15-agent-loop-g0-reword-on-a-draft-writes-nothing",
    title: "G0 (Pau 15 Nov: rewording paused): \"make it professional\" with a draft open writes nothing and says rewording isn't available yet",
    report: `${REPORT}: a reword touched the Action Plan and merged the Observation's sections; Pau paused rewording`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-14T22:40:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      t.loopModel!(loopStandIn((view): LoopDecision => {
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "remy calder" } };
        if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "coaching", employee_id: "e-2", what_happened: "Remy Calder didn't check the beds between clients." } };
        return { text: "Here's the Coaching Form for **Remy Calder**.\n\n**Observation of Offense:** Remy Calder didn't check the beds between clients." };
      }));
      const thread = t.thread();
      await thread.say("coaching form for remy calder, she didnt check the beds between clients");
      const id = await thread.create();
      t.typeOnForm(id, { coaching_details: "Remy Calder didnt check the beds between clients." });
      const before = JSON.stringify(t.values(id));
      const model = loopStandIn((view): LoopDecision => {
        const edit = lastResult(view, "edit_form") as { reword_paused?: boolean } | null;
        if (!edit) return { tool: "edit_form", input: { instance_id: id, values: { coaching_details: "Remy Calder did not check the beds between guest sessions." } } };
        return { text: edit.reword_paused ? PAUSED : "Reworded." };
      });
      t.loopModel!(model);
      const reply = await thread.say("make it professional");
      expect(JSON.stringify(t.values(id)), "a reword was written while rewording is paused").toBe(before);
      expect(reply.formUpdate ?? null).toBeNull();
      expect(reply.content, `the reply does not say rewording is paused:\n${reply.content}`).toMatch(/Rewording isn't available yet/);
      if (offline) expect(toolResults(model.views, "edit_form")[0], "edit_form did not refuse the reword").toMatch(/"reword_paused":true/);
    },
  },
  {
    id: "nov15-agent-loop-g0-reword-on-a-card-writes-nothing",
    title: "G0 (Pau 15 Nov: rewording paused): \"reword it\" with a card on screen leaves the card as it is and says rewording isn't available yet",
    report: `${REPORT}: Pau paused rewording; a same-card re-proposal with new wording is refused too`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-14T22:40:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      const model = loopStandIn((view): LoopDecision => {
        const said = [...view.turns].reverse().find((turn) => turn.role === "user")?.text ?? "";
        const proposed = lastResult(view, "propose_form") as { reword_paused?: boolean } | null;
        if (/reword/i.test(said)) {
          if (!proposed) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", what_happened: "Remy Calder arrived twenty minutes after the start of her scheduled shift on 11/12." } };
          return { text: proposed.reword_paused ? PAUSED : "Reworded the card." };
        }
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "remy calder" } };
        if (!proposed) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", what_happened: "Remy Calder was 20 minutes late on 11/12." } };
        return { text: "Here's the Corrective Action Form for **Remy Calder**.\n\n**Observation of Offense:** Remy Calder was 20 minutes late on 11/12." };
      });
      t.loopModel!(model);
      const thread = t.thread();
      await thread.say("ca for remy calder, she was 20 minutes late on 11/12");
      const card = thread.proposal?.issue;
      const reply = await thread.say("reword it");
      expect(thread.proposal?.issue, "the card was reworded while rewording is paused").toBe(card);
      expect(reply.content, `the reply does not say rewording is paused:\n${reply.content}`).toMatch(/Rewording isn't available yet/);
      if (offline) expect(toolResults(model.views, "propose_form").some((result) => /"reword_paused":true/.test(result)), "propose_form did not refuse the reword").toBe(true);
    },
  },
  {
    id: "nov15-agent-loop-g3-added-fact-at-the-end-of-observed",
    title: "G3: \"she also left 20 minutes early\" on a draft with Observed / Expectation / Going Forward goes at the end of Observed, and \"She is expected\" stays word for word",
    report: `${REPORT}: the new sentence landed between Expectation and Going Forward, and "She is expected" became "<name> is expected"`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-14T22:40:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      t.loopModel!(loopStandIn((view): LoopDecision => {
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "remy calder" } };
        if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", what_happened: "Remy Calder was 20 minutes late on 11/12." } };
        return { text: "Here's the Corrective Action Form for **Remy Calder**.\n\n**Observation of Offense:** Remy Calder was 20 minutes late on 11/12." };
      }));
      const thread = t.thread();
      await thread.say("ca for remy calder, she was 20 minutes late on 11/12");
      const id = await thread.create();
      const old = "Observed: Remy Calder was 20 minutes late on 11/12.\nExpectation: She is expected to arrive on time for every scheduled shift.\nGoing Forward: Remy will clock in by her start time.";
      t.typeOnForm(id, { observation: old });
      // A model that first puts the fact mid-text and renames "She", then fixes it when edit_form reports where it went.
      const model = loopStandIn((view): LoopDecision => {
        const edits = view.results.filter((result) => result.tool === "edit_form").map((result) => result.output as { add_changed_sentences?: unknown; add_not_at_end_of_observed?: unknown });
        if (edits.length === 0) return { tool: "edit_form", input: { instance_id: id, values: { observation: "Observed: Remy Calder was 20 minutes late on 11/12.\nExpectation: Remy Calder is expected to arrive on time for every scheduled shift.\nShe also left 20 minutes early.\nGoing Forward: Remy will clock in by her start time." } } };
        if (edits.length === 1 && (edits[0]!.add_changed_sentences || edits[0]!.add_not_at_end_of_observed)) return { tool: "edit_form", input: { instance_id: id, values: { observation: "Observed: Remy Calder was 20 minutes late on 11/12. She also left 20 minutes early.\nExpectation: She is expected to arrive on time for every scheduled shift.\nGoing Forward: Remy will clock in by her start time." } } };
        return { text: "Added to the Observation: She also left 20 minutes early." };
      });
      t.loopModel!(model);
      await thread.say("she also left 20 minutes early");
      const saved = t.values(id).observation ?? "";
      expect(saved, "the added fact is not in the Observed section").toMatch(/^Observed:[^\n]*left 20 minutes early/);
      expect(saved, "another sentence was rewritten").toMatch(/Expectation: She is expected to arrive on time for every scheduled shift\./);
      expect(saved.indexOf("left 20 minutes early"), "the added fact went after Expectation").toBeLessThan(saved.indexOf("Expectation:"));
      if (offline) expect(toolResults(model.views, "edit_form")[0], "the misplaced add is not a fact").toMatch(/"add_not_at_end_of_observed":\["observation"\]/);
    },
  },
  {
    id: "nov15-agent-loop-g4-open-by-description-never-a-new-card",
    title: "G4: \"open the coaching form for <B> dated 10/31 about getting rooms ready between guests\" opens that form on file, never a new card",
    report: `${REPORT}: no formOpened; it proposed a new Coaching card and said "<B> isn't on the Woven staff list"`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-14T22:40:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      const rooms = await onFile(t, "e-2", "Remy Calder", "coaching", "2026-10-31", "Remy Calder did not get rooms ready between guests on 10/31.");
      await onFile(t, "e-2", "Remy Calder", "coaching", "2026-11-05", "Remy Calder was late to her shift on 11/5.");
      // A model that first reaches for a new card (the live bug), then finds and opens the form on file.
      const model = loopStandIn((view): LoopDecision => {
        const found = lastResult(view, "find_past_forms") as { best_match?: string } | null;
        if (!view.results.some((result) => result.tool === "propose_form")) return { tool: "propose_form", input: { template_key: "coaching", employee_id: "e-2", what_happened: "Getting rooms ready between guests." } };
        if (!found) return { tool: "find_past_forms", input: { employee_name: "Remy Calder", form: "coaching", date: "10/31", about: "getting rooms ready between guests", forms_on_file_evidence: evidenceFrom(view), open: true } };
        if (found.best_match && !lastResult(view, "open_form")) return { tool: "open_form", input: { instance_id: found.best_match, forms_on_file_evidence: evidenceFrom(view) } };
        return { text: "Opened Remy Calder's Coaching Form from 10/31." };
      });
      t.loopModel!(model);
      const thread = t.thread();
      const reply = await thread.say("open the coaching form for remy calder dated 10/31 about getting rooms ready between guests");
      expect(reply.formOpened?.instanceId, `the form on file was not opened:\n${reply.content}`).toBe(rooms);
      expect(reply.formProposal ?? null, "an open request made a new card").toBeNull();
      expect(reply.content, "the reply talks about the staff list").not.toMatch(/staff list/i);
      // Changed on purpose (the rebuild plan's PR 1b: OPEN_REQUEST, a word list, is gone): the card the model proposed first is withdrawn when it finds the form to open (find_past_forms open: true).
      if (offline) expect(toolResults(model.views, "find_past_forms")[0], "the card proposed first was not withdrawn").toMatch(/"card_withdrawn"/);
    },
  },
  {
    id: "nov15-agent-loop-g4-pick-one-by-date-and-words",
    title: "G4: \"open my coaching form for <B>\" asks which; \"the 10/31 one about getting rooms ready between guests\" opens it in one step",
    report: `${REPORT}: the answer "the 10/31 one about getting rooms ready between guests" hit the step limit after 49.7s`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-14T22:40:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      const rooms = await onFile(t, "e-2", "Remy Calder", "coaching", "2026-10-31", "Remy Calder did not get rooms ready between guests on 10/31.");
      await onFile(t, "e-2", "Remy Calder", "coaching", "2026-11-05", "Remy Calder was late to her shift on 11/5.");
      const model = loopStandIn((view): LoopDecision => {
        const said = [...view.turns].reverse().find((turn) => turn.role === "user")?.text ?? "";
        const found = lastResult(view, "find_past_forms") as { forms?: unknown[]; best_match?: string; error?: string } | null;
        if (/10\/31 one/.test(said)) {
          if (!found) return { tool: "find_past_forms", input: { employee_name: "Remy Calder", form: "coaching", date: "10/31", about: "getting rooms ready between guests", forms_on_file_evidence: evidenceFrom(view), open: true } };
          if (found.best_match && !lastResult(view, "open_form")) return { tool: "open_form", input: { instance_id: found.best_match, forms_on_file_evidence: evidenceFrom(view) } };
          return { text: found.error ? "I can't look at forms on file for that." : "Opened the 10/31 Coaching Form." };
        }
        if (!found) return { tool: "find_past_forms", input: { employee_name: "Remy Calder", form: "coaching", forms_on_file_evidence: evidenceFrom(view), open: true } };
        return { text: `Remy Calder has two Coaching Forms on file:\n- 10/31\n- 11/5\n\n${(found as { which_form_question?: string }).which_form_question ?? "Which one?"}` };
      });
      t.loopModel!(model);
      const thread = t.thread();
      await thread.say("open my coaching form for remy calder");
      const before = model.views.length;
      const reply = await thread.say("the 10/31 one about getting rooms ready between guests");
      expect(reply.formOpened?.instanceId, `the picked form was not opened:\n${reply.content}`).toBe(rooms);
      // Each step's view repeats the turn's earlier results: the last view holds them all.
      const calls = Math.max(0, ...model.views.slice(before).map((view) => view.results.length));
      expect(calls, "picking one took more than find_past_forms and open_form").toBeLessThanOrEqual(2);
    },
  },
  {
    id: "nov15-agent-loop-g4-single-out-the-one-with-no-salon",
    title: "G4 follow-up (QA, 15 Nov 2026): \"open the coaching form for <B> with no salon\", when only one of her two Coaching Forms on file has no salon, opens that one instead of listing both",
    report: `${REPORT}; QA's G4 follow-up: a description that singles out one form still listed the candidates`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-14T22:40:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      const noSalon = await onFile(t, "e-2", "Remy Calder", "coaching", "2026-10-31", "Remy Calder did not get rooms ready between guests on 10/31.");
      await onFile(t, "e-2", "Remy Calder", "coaching", "2026-11-05", "Remy Calder was late to her shift on 11/5.");
      // One of the two lost its salon (filed before the salon was known).
      const row = (t.rows?.("form_instances") ?? []).find((entry) => entry.id === noSalon)!;
      row.location_id = null;
      row.location_name = null;
      const model = loopStandIn((view): LoopDecision => {
        const said = [...view.turns].reverse().find((turn) => turn.role === "user")?.text ?? "";
        const found = lastResult(view, "find_past_forms") as { forms?: { instance_id: string; salon: string | null; form_date: string }[]; single_out?: string; which_form_question?: string } | null;
        if (!found) return { tool: "find_past_forms", input: { employee_name: "Remy Calder", form: "coaching", forms_on_file_evidence: evidenceFrom(view), open: true } };
        // The model decides, from the facts: the manager's "no salon" fits exactly one form's salon.
        const fits = found.single_out && /no salon/.test(said) ? (found.forms ?? []).filter((form) => form.salon === "no salon") : [];
        if (fits.length === 1 && !lastResult(view, "open_form")) return { tool: "open_form", input: { instance_id: fits[0]!.instance_id, forms_on_file_evidence: evidenceFrom(view) } };
        if (lastResult(view, "open_form")) return { text: "Opening the 10/31 Coaching Form (no salon)." };
        return { text: `Remy Calder has two Coaching Forms on file:\n- 10/31\n- 11/5\n\n${found.which_form_question ?? "Which one?"}` };
      });
      t.loopModel!(model);
      const thread = t.thread();
      const reply = await thread.say("open the coaching form for remy calder with no salon");
      expect(reply.formOpened?.instanceId, `the one form with no salon was not opened:\n${reply.content}`).toBe(noSalon);
      expect(reply.content, "the candidates were listed").not.toMatch(/Which one should I open\?/);
    },
  },
  {
    id: "nov15-agent-loop-g4-edit-a-misspelled-name-ca",
    title: "G4 (REOPEN_CLOSE_SPELLING, parity gap #43): \"edit remy caldr ca\" opens the one form on file whose employee's name it closely spells; two close names are asked about",
    report: `${REPORT}; parity matrix #43: "Edit <misspelled name> CA" with that person's CA on file`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-14T22:40:00Z"));
      t.directory([...STAFF, REMI]);
      t.as("salon_director", KEARNEY);
      const ca = await onFile(t, "e-2", "Remy Calder", "dpoa", "2026-11-12", "Remy Calder was 20 minutes late on 11/12.");
      const model = loopStandIn((view): LoopDecision => {
        const found = lastResult(view, "find_past_forms") as { best_match?: string; close_names?: string[] } | null;
        if (!found) return { tool: "find_past_forms", input: { employee_name: "remy caldr", form: "ca", forms_on_file_evidence: evidenceFrom(view), open: true } };
        if (found.best_match && !lastResult(view, "open_form")) return { tool: "open_form", input: { instance_id: found.best_match, forms_on_file_evidence: evidenceFrom(view) } };
        return { text: found.close_names ? `Which one: ${found.close_names.join(" or ")}?` : "Opening **Remy Calder**'s form." };
      });
      t.loopModel!(model);
      const reply = await t.thread().say("edit remy caldr ca");
      expect(reply.formOpened?.instanceId, `the close spelling's form was not opened:\n${reply.content}`).toBe(ca);
      // A second person on file with a name as close: ask which, open nothing.
      await onFile(t, REMI.id, "Remi Calder", "dpoa", "2026-11-10", "Remi Calder was late on 11/10.");
      t.loopModel!(model);
      const both = await t.thread().say("edit remy caldr ca");
      expect(both.formOpened ?? null, "a form was opened although two names are as close").toBeNull();
      expect(both.content, `the two names were not asked about:\n${both.content}`).toMatch(/Remy Calder/);
      expect(both.content).toMatch(/Remi Calder/);
    },
  },
  {
    id: "nov15-agent-loop-g5-written-and-payroll-on-a-draft",
    title: "G5: \"make it a written and yes payroll $15\" on a Corrective Action draft ticks Written, ticks payroll Yes and saves $15",
    report: `${REPORT}: warning_type written was saved but payroll was not; the reply said "Payroll deduct isn't something I'm able to tick on the form directly"`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-14T22:40:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      t.loopModel!(loopStandIn((view): LoopDecision => {
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "remy calder" } };
        if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", what_happened: "Remy Calder was 20 minutes late on 11/12." } };
        return { text: "Here's the Corrective Action Form for **Remy Calder**.\n\n**Observation of Offense:** Remy Calder was 20 minutes late on 11/12." };
      }));
      const thread = t.thread();
      await thread.say("ca for remy calder, she was 20 minutes late on 11/12");
      const id = await thread.create();
      const model = loopStandIn((view): LoopDecision => {
        const edit = lastResult(view, "edit_form") as { updated?: string[] } | null;
        if (!edit) return { tool: "edit_form", input: { level_evidence: evidenceFrom(view), payroll_evidence: evidenceFrom(view), instance_id: id, values: { warning_type: "written", payroll_deduct: "yes", payroll_deduct_amount: "$15" } } };
        return { text: `Updated: ${(edit.updated ?? []).join(", ")}. **Type of Warning:** Written Warning. **Is payroll deduct applicable?** Yes. **Payroll deduction amount:** $15.` };
      });
      t.loopModel!(model);
      const reply = await thread.say("make it a written and yes payroll $15");
      const ticked = t.checked(id);
      expect(ticked.warning_type, "Written was not ticked").toEqual(["written"]);
      expect(ticked.payroll_deduct, `payroll Yes was not ticked:\n${reply.content}`).toEqual(["yes"]);
      expect(t.values(id).payroll_deduct_amount ?? "", "the $15 was not saved").toMatch(/15/);
      expect(reply.content, "the reply says payroll can't be ticked").not.toMatch(/not something I'm able to tick|can't tick|cannot tick/i);
    },
  },
  {
    id: "nov15-agent-loop-g5-yes-payroll-no-amount-asks-it",
    title: "G5: \"yes payroll\" with no amount on a draft ticks payroll Yes only, and the reply asks the amount; an amount the manager never typed is refused",
    report: `${REPORT}: payroll on a draft (QA's G5 conditions)`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-14T22:40:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      t.loopModel!(loopStandIn((view): LoopDecision => {
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "remy calder" } };
        if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", what_happened: "Remy Calder was 20 minutes late on 11/12." } };
        return { text: "Here's the Corrective Action Form for **Remy Calder**.\n\n**Observation of Offense:** Remy Calder was 20 minutes late on 11/12." };
      }));
      const thread = t.thread();
      await thread.say("ca for remy calder, she was 20 minutes late on 11/12");
      const id = await thread.create();
      // A model that also puts an amount nobody typed: refused whole; then the tick alone, and the question.
      const model = loopStandIn((view): LoopDecision => {
        const edits = view.results.filter((result) => result.tool === "edit_form").map((result) => result.output as { error?: string; updated?: string[] });
        if (edits.length === 0) return { tool: "edit_form", input: { payroll_evidence: evidenceFrom(view), instance_id: id, values: { payroll_deduct: "yes", payroll_deduct_amount: "$25" } } };
        if (edits.length === 1 && edits[0]!.error) return { tool: "edit_form", input: { payroll_evidence: evidenceFrom(view), instance_id: id, values: { payroll_deduct: "yes" } } };
        return { text: "Payroll deduct is now Yes. What's the payroll deduction amount?" };
      });
      t.loopModel!(model);
      const reply = await thread.say("yes payroll");
      expect(t.checked(id).payroll_deduct, "payroll Yes was not ticked").toEqual(["yes"]);
      expect(t.values(id).payroll_deduct_amount ?? "", "an amount nobody typed was saved").toBe("");
      expect(reply.content, "the reply does not ask the amount").toMatch(/amount/i);
      if (offline) expect(toolResults(model.views, "edit_form")[0], "an untyped amount was not refused").toMatch(/must come from the manager's own words/);
    },
  },
  {
    id: "nov15-agent-loop-g6-exit-last-day-after-today-kept",
    title: "G6 (Pau's question, via QA): an exit \"she gave notice, last day is 11/28\" on 11/15: the card is dated 11/28, never blanked as after today",
    report: `${REPORT}; G6: E12's after-today rule blanked an exit's future last day (a regression on main for exit forms)`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-15T18:00:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      const model = loopStandIn((view): LoopDecision => {
        const result = lastResult(view, "propose_form") as { facts?: { date_after_today?: unknown } } | null;
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "remy calder" } };
        if (!result) return { tool: "propose_form", input: { template_key: "stc-exit", exit_evidence: { ...evidenceFrom(view), kind: "asks_for_exit_form" }, employee_id: "e-2", incident_date: "2026-11-28" } };
        return { text: `Here's the Employee Exit Form for **Remy Calder**.\n\n${result.facts?.date_after_today ? "11/28 is after today." : "Last day 11/28/2026, as you said."}` };
      });
      t.loopModel!(model);
      const thread = t.thread();
      const reply = await thread.say("exit form for remy calder, she gave notice, last day is 11/28");
      expect(thread.proposal?.templateKey).toBe("stc-exit");
      expect(thread.proposal?.formDate, `the exit's last day was blanked:\n${reply.content}`).toBe("2026-11-28");
      if (offline) expect(toolResults(model.views, "propose_form").some((result) => /date_after_today/.test(result)), "an exit's future last day was treated as after today").toBe(false);
    },
  },
  {
    id: "nov15-agent-loop-g6-follow-up-date-after-today-written",
    title: "G6: on a Follow-Up Coaching draft, \"next follow up 12/1\" (after today) is written; a follow-up date is never refused",
    report: `${REPORT}; G6: follow-up dates are future by design`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-15T18:00:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      t.loopModel!(loopStandIn((view): LoopDecision => {
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "remy calder" } };
        if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "follow-up-coaching", employee_id: "e-2", what_happened: "Remy Calder now checks the beds between clients." } };
        return { text: "Here's the Follow-Up Coaching Form for **Remy Calder**." };
      }));
      const thread = t.thread();
      await thread.say("follow up coaching for remy calder, she now checks the beds between clients");
      const id = await thread.create();
      const model = loopStandIn((view): LoopDecision => {
        const edit = lastResult(view, "edit_form") as { error?: string } | null;
        if (!edit) return { tool: "edit_form", input: { instance_id: id, values: { next_follow_up: "12/1/2026" } } };
        return { text: edit.error ? "I couldn't set that date." : "Next Follow-Up: 12/1/2026." };
      });
      t.loopModel!(model);
      await thread.say("next follow up 12/1/2026");
      expect(toolResults(model.views, "edit_form")[0] ?? "", "a follow-up date after today was refused").not.toMatch(/after today/);
      expect(t.values(id).next_follow_up ?? "", "the follow-up date was not written").toMatch(/12\/1\/2026/);
    },
  },
  {
    id: "nov15-agent-loop-exit-termination-no-incident-questions",
    title: "Exit (Pau: coaching, exit and CA first): \"exit form for <name>, termination effective 11/20, not eligible for rehire, no call no show 3 shifts\": an exit card dated 11/20, with no \"what happened\", no policy and no warning level",
    report: `${REPORT}; Pau via QA: the exit form (76 in 90 days) is covered as well as CA and coaching`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-15T18:00:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      t.loopModel!(loopStandIn((view): LoopDecision => {
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "remy calder" } };
        // QA's design (15 Nov 2026): the model decides the exit is a termination; the tool locks it on the word.
        if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "stc-exit", exit_evidence: { ...evidenceFrom(view), kind: "asks_for_exit_form" }, employee_id: "e-2", incident_date: "2026-11-20", exit_type: "termination", effective_date: "11/20" } };
        return { text: "Here's the Employee Exit Form for **Remy Calder**: a termination, effective 11/20/2026, as you said. Not eligible for rehire; reason: no call no show for 3 shifts." };
      }));
      const thread = t.thread();
      const reply = await thread.say("exit form for remy calder, termination effective 11/20, not eligible for rehire, no call no show 3 shifts");
      expect(thread.proposal?.templateKey, `no exit card:\n${reply.content}`).toBe("stc-exit");
      expect(thread.proposal?.formDate, "the effective date is not on the exit card").toBe("2026-11-20");
      expect(reply.content, "an exit was asked what happened").not.toMatch(/what happened\?/i);
      expect(reply.content, "an exit cites a policy").not.toMatch(/\*\*Policy:\*\*|JBA Policy Manual/);
      expect(reply.content, "an exit was asked a warning level").not.toMatch(/warning level|verbal or written/i);
    },
  },
  {
    id: "nov15-agent-loop-g14-filed-at-woven-salon-by-the-tool",
    title: "G14 (honesty): a manager on two salons, an employee Woven lists at one: the card IS filed there on the first proposal (salon_from_woven), so \"Filed at **NE Kearney**\" is true; a reply naming another salon is handed back",
    report: `${REPORT}; the tester's batch E re-test: "Filed at <salon>, where Woven lists <name>" while the card stayed needs_location`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-14T22:40:00Z"));
      t.directory([...STAFF, ISLA]);
      t.as("salon_director", TWO_SALONS);
      // A model that proposes once with no salon, then names a salon the card does not hold until the app hands it back.
      const model = loopStandIn((view): LoopDecision => {
        const said = [...view.turns].reverse().find((turn) => turn.role === "user")?.text ?? "";
        const result = lastResult(view, "propose_form") as { facts?: { salon_from_woven?: string } } | null;
        if (/\[app check\]/.test(said)) return { text: "Here's the Corrective Action Form for **Isla Marrow**. Filed at **NE Kearney**, where Woven lists Isla; say if it's another salon." };
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "isla marrow" } };
        if (!result) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: ISLA.id, what_happened: "Isla Marrow was late on 11/12." } };
        return { text: `Here's the Corrective Action Form for **Isla Marrow**. Filed at **${result.facts?.salon_from_woven ? "NE Grand Island" : "?"}**, where Woven lists Isla.` };
      });
      t.loopModel!(model);
      const thread = t.thread();
      const reply = await thread.say("ca for isla marrow, she was late on 11/12");
      expect(thread.proposal?.locationId, `the card is not filed at Woven's salon:\n${reply.content}`).toBe("loc-0309");
      expect(thread.proposal?.status).toBe("ready");
      expect(reply.content, `the reply names a salon the card does not hold:\n${reply.content}`).not.toMatch(/Filed at \*\*NE Grand Island\*\*/);
      if (offline) {
        expect(toolResults(model.views, "propose_form")[0], "salon_from_woven is not a fact").toMatch(/"salon_from_woven":"NE Kearney"/);
        expect(model.views.some((view) => /\[app check\][^\n]*salon \(NE Grand Island\)/.test([...view.turns].reverse().find((turn) => turn.role === "user")?.text ?? "")), "a reply naming another salon was not handed back").toBe(true);
      }
    },
  },
  {
    id: "nov15-agent-loop-g15-account-keeps-who-did-it",
    title: "G15 (accuracy): \"<A> failed to have <C> complete required policy acknowledgements\" for <A>'s CA keeps <A> as the one responsible; an account that blames <C> is a fact the model fixes",
    report: `${REPORT}; the tester's batch E re-test: the card said "<C> did not complete required policy acknowledgements in Woven during her onboarding"`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-14T22:40:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      const blamed = "Juno Paxton did not complete required policy acknowledgements in Woven during her onboarding.";
      const kept = "Remy Calder failed to have Juno Paxton complete required policy acknowledgements in Woven during her onboarding.";
      // A model that first blames the new hire (the live bug), then keeps the manager's subject when the fact says so.
      const model = loopStandIn((view): LoopDecision => {
        const tries = view.results.filter((result) => result.tool === "propose_form").map((result) => result.output as { facts?: { account_subject_changed?: unknown } });
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "remy calder" } };
        if (tries.length === 0) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", what_happened: blamed } };
        if (tries.length === 1 && tries[0]!.facts?.account_subject_changed) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", what_happened: kept } };
        return { text: `Here's the Corrective Action Form for **Remy Calder**.\n\n**Observation of Offense:** ${kept}` };
      });
      t.loopModel!(model);
      const thread = t.thread();
      const reply = await thread.say("ca for remy calder, Remy Calder failed to have Juno Paxton complete required policy acknowledgements in Woven during her onboarding");
      expect(thread.proposal?.employeeName).toBe("Remy Calder");
      expect(thread.proposal?.issue ?? "", `the account blames someone else:\n${reply.content}`).not.toMatch(/^Juno Paxton did not/);
      expect(thread.proposal?.issue ?? "", "the employee is not the one responsible").toMatch(/Remy Calder failed to have Juno Paxton/);
      if (offline) expect(toolResults(model.views, "propose_form")[0], "the changed subject is not a fact").toMatch(/"account_subject_changed":\{"employee":"Remy Calder","account_says_it_was":"Juno Paxton"\}/);
    },
  },
  {
    id: "nov15-agent-loop-g16-which-date-asked-once",
    title: "G16 (fewer questions): two dates in the account; the date is asked at most once in the chat, and \"create the ca\" afterwards uses the incident's date and says so",
    report: `${REPORT}; the tester's batch E re-test: L4 asked "which date, 9/28 or 10/16?" on t3, t4 ("create the ca") and t5`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-14T22:40:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      const model = loopStandIn((view): LoopDecision => {
        const result = lastResult(view, "propose_form") as { facts?: { dates_given?: string[]; dates_asked_before?: boolean } } | null;
        const asked = view.results.filter((entry) => entry.tool === "propose_form").length;
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "remy calder" } };
        const account = "Remy Calder was a no call no show on 9/28. The report was run on 10/16.";
        if (asked === 0) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", what_happened: account } };
        if (asked === 1 && result?.facts?.dates_asked_before) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", what_happened: account, incident_date: "2026-09-28" } };
        if (result?.facts?.dates_asked_before || asked > 1) return { text: "Here's the Corrective Action Form for **Remy Calder**.\n\nDated 9/28/2026 (when it happened); say if you want 10/16." };
        return { text: "Here's the Corrective Action Form for **Remy Calder**.\n\nYou mentioned more than one date (**9/28**, **10/16**). Which date goes on the form?" };
      });
      t.loopModel!(model);
      const thread = t.thread();
      const replies = [(await thread.say("ca for remy calder, she was a no call no show on 9/28, i ran the report on 10/16")).content];
      replies.push((await thread.say("create the ca")).content);
      const asks = replies.filter((reply) => /which date/i.test(reply)).length;
      expect(asks, `the date was asked ${asks} times:\n${replies.join("\n---\n")}`).toBeLessThanOrEqual(1);
      expect(thread.proposal?.formDate, "\"create the ca\" did not use the incident's date").toBe("2026-09-28");
      expect(replies.at(-1) ?? "").toMatch(/Dated 9\/28\/2026/);
    },
  },
  {
    id: "nov15-agent-loop-g18-just-make-it-names-the-policy",
    title: "G18: \"cite the animals in the workplace policy\" then \"just make it\": the question names the policy with its page (\"Corrective Action citing **Animals in the Workplace** (p.30). Who is it for?\")",
    report: `${REPORT}; the tester's batch E re-test: "just make it" asked "who is this Corrective Action Form for?" without naming the policy`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-14T22:40:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      const model = loopStandIn((view): LoopDecision => {
        const said = [...view.turns].reverse().find((turn) => turn.role === "user")?.text ?? "";
        if (/just make it/i.test(said)) {
          const tried = lastResult(view, "propose_form") as { ask_exactly?: string } | null;
          if (!tried) return { tool: "propose_form", input: { template_key: "dpoa" } };
          return { text: tried.ask_exactly ?? "Who is this Corrective Action Form for?" };
        }
        const read = lastResult(view, "read_policy") as { heading?: string; page?: number } | null;
        if (!read) return { tool: "read_policy", input: { heading: "Animals in the Workplace" } };
        return { text: `**${read.heading}** (p.${read.page}) covers animals brought to work.` };
      });
      t.loopModel!(model);
      const thread = t.thread();
      await thread.say("cite the animals in the workplace policy");
      const reply = await thread.say("just make it");
      expect(reply.content, `the question does not name the policy:\n${reply.content}`).toMatch(/Corrective Action citing \*\*Animals in the Workplace\*\* \(p\.30\)\. Who is it for\?/);
    },
  },
  {
    id: "nov15-agent-loop-g7c-exit-create-fills-the-exit-fields",
    title: "G7c: Create from the loop's exit card writes the manager's exit facts into the draft's own fields (today's exit reader): last day 11/28, notice and resignation date, rehire yes and the reason",
    report: `${REPORT}; the tester's exit sweep: the exit card holds only employee, salon and date; the rest was only in the reply`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-15T18:00:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      t.loopModel!(loopStandIn((view): LoopDecision => {
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "remy calder" } };
        if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "stc-exit", exit_evidence: { ...evidenceFrom(view), kind: "asks_for_exit_form" }, employee_id: "e-2", incident_date: "2026-11-28" } };
        return { text: "Here's the Employee Exit Form for **Remy Calder**: a resignation with notice. Last day 11/28/2026, as you said." };
      }));
      const thread = t.thread();
      await thread.say("exit form for remy calder, she gave her two weeks notice on 11/14, her last day is 11/28, she is eligible for rehire, she is leaving to go back to school");
      const id = await thread.create();
      const values = t.values(id);
      const ticked = t.checked(id);
      expect(values.last_day_worked, "the last day is not on the draft").toBe("2026-11-28");
      expect(values.notice_given_date, "the notice date is not on the draft").toBe("2026-11-14");
      // A resignation with notice: the notice date is the resignation date. Notice is not fulfilled until 11/28, so "Submitted & Fulfilled Notice" stays for the manager.
      expect(values.resignation_date, "the resignation date is not on the draft").toBe("2026-11-14");
      expect(ticked.eligible_for_rehire ?? [], "rehire is not on the draft").toEqual(["yes"]);
      expect(values.resignation_reason ?? values.details ?? "", "the reason is not on the draft").toMatch(/back to school/i);
    },
  },
  {
    id: "nov15-agent-loop-g7a-exit-termination-not-a-resignation",
    /*
     * Changed on purpose (QA's ruling, batch G2 item 2, 15 Nov 2026): "terminate <name>, 3 no call no shows on …" tells
     * an offense with the termination, so it is the Corrective Action Form with Termination, dated the offense's day,
     * plus one line offering the exit form; it was an exit card. The exit's own checks (no Resignation Date, no
     * policy, no CA labels) moved to nov15-agent-loop-g7a-exit-paperwork-asked, where the manager asks for the exit.
     */
    title: "G7a (the tester's exit sweep; QA's ruling in batch G2): \"terminate <name>, 3 no call no shows on 11/10, 11/12 and 11/13\" is the Corrective Action Form with Termination plus one line offering the exit form, never an exit card",
    report: `${REPORT}; the tester's exit sweep, and QA's live run part 2 on batch G (15 Nov 2026), item 2`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-15T18:00:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      const model = loopStandIn((view): LoopDecision => {
        const results = view.results.filter((result) => result.tool === "propose_form").map((result) => result.output as { exit_not_stated?: boolean; facts?: { termination_stated?: { approval: string } } });
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "remy calder" } };
        // A model that reaches for the exit form first: the tool refuses it, as the manager asked for no exit.
        if (results.length === 0) return { tool: "propose_form", input: { template_key: "stc-exit", employee_id: "e-2", incident_date: "2026-11-10", exit_type: "termination" } };
        if (results.length === 1 && results[0]!.exit_not_stated) return { tool: "propose_form", input: { level_evidence: evidenceFrom(view), template_key: "dpoa", employee_id: "e-2", what_happened: "3 no call no shows on 11/10, 11/12 and 11/13.", incident_date: "2026-11-13", warning_level: "termination" } };
        const stated = results.at(-1)!.facts?.termination_stated;
        return { text: `Here's the Corrective Action Form for **Remy Calder**.\n\n${stated ? `**Type of Warning:** Termination, as you said — I'll tick it on the form. Tell me if that should change.\n${stated.approval}` : ""}\n\nWant the Employee Exit Form for Remy Calder too?` };
      });
      t.loopModel!(model);
      const thread = t.thread();
      const reply = await thread.say("terminate remy calder, 3 no call no shows on 11/10, 11/12 and 11/13");
      expect(thread.proposal?.templateKey, `not the Corrective Action Form:\n${reply.content}`).toBe("dpoa");
      expect(reply.content).toMatch(/Termination, as you said/);
      expect(reply.content).toContain("Want the Employee Exit Form for Remy Calder too?");
      const id = await thread.create();
      expect(t.checked(id).warning_type, "Create did not tick Termination").toEqual(["termination"]);
    },
  },
  {
    id: "nov15-agent-loop-g7a-exit-paperwork-asked",
    title: "G7a/G7b, exit half (QA's ruling in batch G2): \"terminate <name>, effective 11/20, exit paperwork please\" opens the Employee Exit Form as an involuntary separation dated 11/20, with no Resignation Date, no policy and no CA labels",
    report: `${REPORT}; the tester's exit sweep: read back as "**Resignation Date:** November 10, 2026", dated 11/10, with an Attendance policy line`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-15T18:00:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      const model = loopStandIn((view): LoopDecision => {
        const result = lastResult(view, "propose_form") as { card?: { policy?: string | null }; facts?: { exit_termination?: { effective: string; dated_today?: boolean } } } | null;
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "remy calder" } };
        // A model that reaches for the CA's Attendance policy: an exit cites none.
        if (!result) return { tool: "propose_form", input: { template_key: "stc-exit", exit_evidence: { ...evidenceFrom(view), kind: "asks_for_exit_form" }, employee_id: "e-2", policy: "Attendance", effective_date: "11/20", exit_type: "termination" } };
        const exit = result.facts?.exit_termination;
        return {
          text: [
            "Here's the Employee Exit Form for **Remy Calder**.",
            exit ? "Filed as an **Immediate involuntary separation** (a termination), as you said." : "Filed as a resignation.",
            exit?.dated_today ? "Dated today; say if the termination is effective another day." : `Effective ${exit?.effective ?? ""}, as you said.`,
            ...(result.card?.policy ? [`**Policy:** ${result.card.policy}`] : []),
          ].join("\n\n"),
        };
      });
      t.loopModel!(model);
      const thread = t.thread();
      const reply = await thread.say("terminate remy calder, effective 11/20, exit paperwork please");
      expect(thread.proposal?.templateKey, `the exit form did not open:\n${reply.content}`).toBe("stc-exit");
      expect(thread.proposal?.formDate, `the exit is not dated the day the manager typed:\n${reply.content}`).toBe("2026-11-20");
      expect((thread.proposal as { policyLine?: string | null } | undefined)?.policyLine ?? null, "an exit cites a policy").toBeNull();
      expect(reply.content, "a termination read back as a resignation").not.toMatch(/Resignation Date/);
      expect(reply.content, "an exit uses CA labels").not.toMatch(/Observation of Offense|\*\*Policy:\*\*|Type of Warning/);
    },
  },
  {
    id: "nov15-agent-loop-g7d-exit-two-salons-filed-at-woven",
    title: "G7d (the tester's exit sweep, as G14): an exit for an employee Woven lists at one of the manager's two salons is filed there, ready, with Create",
    report: `${REPORT}; the tester's exit sweep: "Filed at **<salon>**" while the exit card stayed needs_location with no Create button`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-15T18:00:00Z"));
      t.directory([...STAFF, ISLA]);
      t.as("salon_director", TWO_SALONS);
      t.loopModel!(loopStandIn((view): LoopDecision => {
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "isla marrow" } };
        if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "stc-exit", exit_evidence: { ...evidenceFrom(view), kind: "asks_for_exit_form" }, employee_id: ISLA.id, incident_date: "2026-11-28" } };
        return { text: "Here's the Employee Exit Form for **Isla Marrow**. Filed at **NE Kearney**, where Woven lists Isla; say if it's another salon. Last day 11/28/2026, as you said." };
      }));
      const thread = t.thread();
      const reply = await thread.say("exit form for isla marrow, she gave notice, last day is 11/28");
      expect(thread.proposal?.locationId, `the exit is not filed at Woven's salon:\n${reply.content}`).toBe("loc-0309");
      expect(thread.proposal?.status).toBe("ready");
      expect(thread.proposal?.formDate).toBe("2026-11-28");
    },
  },
  {
    id: "nov15-agent-loop-name-as-the-manager-said-it",
    title: "Pau's name ruling (15 Nov, \"Preferred name is fine let it be flexible\"): \"ca for jo quill\" for Josephine Quill, who goes by Jo, puts Jo Quill on the card and the form, and the reply names the Woven legal name once; \"ca for josephine quill\" puts Josephine Quill",
    report: `${REPORT}; Pau's ruling via QA: the name is the one the manager used, preferred or legal, with the surname`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-14T22:40:00Z"));
      t.directory([...STAFF, JO]);
      t.as("salon_director", KEARNEY);
      const model = (typed: string) => loopStandIn((view): LoopDecision => {
        const found = lastResult(view, "find_staff") as { matches?: { employee_id: string }[] } | null;
        const result = lastResult(view, "propose_form") as { card?: { employee?: string }; facts?: { legal_name_in_woven?: string } } | null;
        if (!found) return { tool: "find_staff", input: { name: typed } };
        if (!result) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: found.matches?.[0]?.employee_id ?? JO.id, what_happened: "She was late on 11/12." } };
        const legal = result.facts?.legal_name_in_woven;
        return { text: `Here's the Corrective Action Form for **${result.card?.employee ?? ""}**${legal ? ` (${legal} in Woven)` : ""}.\n\n**Observation of Offense:** She was late on 11/12.` };
      });
      t.loopModel!(model("jo quill"));
      const preferred = t.thread();
      const reply = await preferred.say("ca for jo quill, she was late on 11/12");
      expect(preferred.proposal?.employeeName, `the card does not carry the name the manager used:\n${reply.content}`).toBe("Jo Quill");
      expect(reply.content, "the reply does not name the Woven legal name once").toMatch(/\(Josephine Quill in Woven\)/);
      const id = await preferred.create();
      expect(t.values(id).employee_name, "the form does not carry the name the manager used").toBe("Jo Quill");
      t.loopModel!(model("josephine quill"));
      const legal = t.thread();
      const typed = await legal.say("ca for josephine quill, she was late on 11/12");
      expect(legal.proposal?.employeeName, `the legal name the manager typed is not on the card:\n${typed.content}`).toBe("Josephine Quill");
      expect(typed.content).not.toMatch(/in Woven\)/);
    },
  },
  {
    id: "nov15-agent-loop-preferred-and-legal-name-are-one-person",
    title: "QA's addition 2 to Pau's name ruling (15 Nov): Josephine Quill, who goes by Jo, is one person by either name: past forms filed as Jo Quill or Josephine Quill are found by either name, an edit naming her as Jo goes on her Josephine Quill draft, and another roster person is never merged",
    report: `${REPORT}; QA's addition 2 (15 Nov 2026): preferred and legal names are one person in find_past_forms, read_form and edit-by-name`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-14T22:40:00Z"));
      t.directory([...STAFF, JO]);
      t.as("salon_director", KEARNEY);
      const asJo = await onFile(t, JO.id, "Jo Quill", "coaching", "2026-11-05", "Jo Quill was late to her shift on 11/5.");
      const asJosephine = await onFile(t, JO.id, "Josephine Quill", "dpoa", "2026-11-10", "Josephine Quill left the front desk unattended on 11/10.");
      const remys = await onFile(t, "e-2", "Remy Calder", "coaching", "2026-11-06", "Remy Calder did not restock the lotion shelf on 11/6.");

      // find_past_forms (the "On file" lines), by either name: both of hers, never Remy's.
      const lookup = (typed: string) => loopStandIn((view): LoopDecision => {
        const found = lastResult(view, "find_past_forms") as { forms?: { instance_id: string }[] } | null;
        if (!found) return { tool: "find_past_forms", input: { employee_name: typed, forms_on_file_evidence: evidenceFrom(view), open: true } };
        const read = lastResult(view, "read_form");
        if (!read && found.forms?.[0]) return { tool: "read_form", input: { instance_id: found.forms[0].instance_id, forms_on_file_evidence: evidenceFrom(view) } };
        return { text: `On file for ${typed}: ${found.forms?.length ?? 0} forms.` };
      });
      for (const typed of ["Jo Quill", "Josephine Quill"]) {
        const model = lookup(typed);
        t.loopModel!(model);
        const reply = await t.thread().say(`what forms are on file for ${typed.toLowerCase()}`);
        const found = (model.views.flatMap((view) => view.results).find((result) => result.tool === "find_past_forms")?.output ?? {}) as { forms?: { instance_id: string }[] };
        const ids = (found.forms ?? []).map((form) => form.instance_id).sort();
        expect(ids, `${typed} did not find both of her forms:\n${reply.content}`).toEqual([asJo, asJosephine].sort());
        expect(ids, `${typed} merged another roster person`).not.toContain(remys);
        expect(toolResults(model.views, "read_form")[0] ?? "", `read_form did not read her form by ${typed}`).not.toMatch(/"error"/);
      }
      const remyModel = lookup("Remy Calder");
      t.loopModel!(remyModel);
      await t.thread().say("what forms are on file for remy calder");
      const remyFound = (remyModel.views.flatMap((view) => view.results).find((result) => result.tool === "find_past_forms")?.output ?? {}) as { forms?: { instance_id: string }[] };
      expect((remyFound.forms ?? []).map((form) => form.instance_id), "another roster person's forms were merged").toEqual([remys]);

      // Edit by name: her draft is filed as Josephine Quill; the manager calls her Jo.
      t.loopModel!(loopStandIn((view): LoopDecision => {
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "Josephine Quill" } };
        if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: JO.id, what_happened: "Josephine Quill was late on 11/12." } };
        return { text: "Here's the Corrective Action Form for **Josephine Quill**.\n\n**Observation of Offense:** Josephine Quill was late on 11/12." };
      }));
      const thread = t.thread();
      await thread.say("ca for josephine quill, she was late on 11/12");
      const id = await thread.create();
      const editor = (said: string) => loopStandIn((view): LoopDecision => {
        if (!lastResult(view, "edit_form")) return { tool: "edit_form", input: { instance_id: id, values: { observation: `Josephine Quill was late on 11/12. ${said}` } } };
        return { text: "Done." };
      });
      const jo = editor("Jo Quill was also late on 11/13.");
      t.loopModel!(jo);
      await thread.say("add that jo quill was also late on 11/13");
      expect(toolResults(jo.views, "edit_form")[0] ?? "", "an edit naming her as Jo was refused as someone else's").not.toMatch(/This message is about/);
      expect(t.values(id).observation ?? "").toMatch(/also late on 11\/13/);
      const remy = editor("Remy Calder was also late on 11/13.");
      t.loopModel!(remy);
      await thread.say("now remy calder was late on 11/13 too");
      expect(toolResults(remy.views, "edit_form")[0] ?? "", "another roster person's account went on her form").toMatch(/This message is about Remy Calder/);
    },
  },
  {
    id: "nov15-agent-loop-review-g3-exit-not-a-termination",
    title: "QA's review of batch G, item 3: \"exit form for remy calder, she gave notice, last day 11/28. Not a termination.\" keeps the stated last day as the card's date; it is no involuntary separation",
    report: `${REPORT}; QA's review of batch G (15 Nov 2026), item 3`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-15T18:00:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      for (const said of ["exit form for remy calder, she gave notice, last day 11/28. Not a termination.", "exit form for remy calder. She quit, last day 11/28. She was fired from her last job btw"]) {
        const model = loopStandIn((view): LoopDecision => {
          if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "remy calder" } };
          if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "stc-exit", exit_evidence: { ...evidenceFrom(view), kind: "asks_for_exit_form" }, employee_id: "e-2", incident_date: "2026-11-28" } };
          return { text: "Here's the Employee Exit Form for **Remy Calder**." };
        });
        t.loopModel!(model);
        const thread = t.thread();
        await thread.say(said);
        expect(thread.proposal?.formDate, `the stated last day was replaced after "${said}"`).toBe("2026-11-28");
        if (offline) expect(toolResults(model.views, "propose_form")[0] ?? "", `"${said}" was read as a termination`).not.toMatch(/exit_termination/);
      }
    },
  },
];
