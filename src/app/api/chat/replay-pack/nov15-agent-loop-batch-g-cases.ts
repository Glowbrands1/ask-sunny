import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";
import { lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

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
        if (!found) return { tool: "find_past_forms", input: { employee_name: "Remy Calder", form: "coaching", date: "10/31", about: "getting rooms ready between guests" } };
        if (found.best_match && !lastResult(view, "open_form")) return { tool: "open_form", input: { instance_id: found.best_match } };
        return { text: "Opened Remy Calder's Coaching Form from 10/31." };
      });
      t.loopModel!(model);
      const thread = t.thread();
      const reply = await thread.say("open the coaching form for remy calder dated 10/31 about getting rooms ready between guests");
      expect(reply.formOpened?.instanceId, `the form on file was not opened:\n${reply.content}`).toBe(rooms);
      expect(reply.formProposal ?? null, "an open request made a new card").toBeNull();
      expect(reply.content, "the reply talks about the staff list").not.toMatch(/staff list/i);
      if (offline) expect(toolResults(model.views, "propose_form")[0], "propose_form did not refuse an open request").toMatch(/asked to open a form on file/);
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
          if (!found) return { tool: "find_past_forms", input: { employee_name: "Remy Calder", form: "coaching", date: "10/31", about: "getting rooms ready between guests" } };
          if (found.best_match && !lastResult(view, "open_form")) return { tool: "open_form", input: { instance_id: found.best_match } };
          return { text: found.error ? "I can't look at forms on file for that." : "Opened the 10/31 Coaching Form." };
        }
        if (!found) return { tool: "find_past_forms", input: { employee_name: "Remy Calder", form: "coaching" } };
        return { text: "Remy Calder has two Coaching Forms on file: 10/31 and 11/5. Which one?" };
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
        if (!found) return { tool: "find_past_forms", input: { employee_name: "remy caldr", form: "ca" } };
        if (found.best_match && !lastResult(view, "open_form")) return { tool: "open_form", input: { instance_id: found.best_match } };
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
];
