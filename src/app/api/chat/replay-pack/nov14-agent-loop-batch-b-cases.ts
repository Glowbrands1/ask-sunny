import { expect, vi } from "vitest";

import { KEARNEY, STAFF, TWO_SALONS, type DirectoryRow, type ReplayCase } from "./cases";
import { headingWith, lastResult, loopStandIn, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * AGENT LOOP, BATCH B (code-check audit `docs/agent-loop/code-checks.md`)
 * ============================================================================
 *
 * Pau, 14 Nov 2026: "code may refuse or inform, never rewrite". Batch B turns the card-value patches into facts
 * on the tool results, and adds the facts and tool inputs QA's r3 run and live-app pass (14 Nov 2026) asked for.
 * Each case checks what the tool says (the fact) and what reaches the card or the draft; the reply's wording is
 * the model's, from the rules book, and is judged live.
 *
 * All people here are invented.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA, 14 Nov 2026 (agent loop batch B: r3 run and live-app findings)";

const TAMSIN: DirectoryRow = { id: "e-tamsin-orwell", firstName: "Tamsin", lastName: "Orwell", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };
const ISOLDE: DirectoryRow = { id: "e-isolde-varga", firstName: "Isolde", lastName: "Varga", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };
const ISOLDE_TWO: DirectoryRow = { id: "e-isolde-varga-two", firstName: "Isolde", lastName: "Varga Two", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };
/** Works at both of a two-salon manager's salons, so the card asks which. */
const BOTH: DirectoryRow = { id: "e-oriel-fenwick", firstName: "Oriel", lastName: "Fenwick", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0307", "loc-0309"], positionName: "Tanning Consultant" };
/** No longer active in Woven, at the manager's salon. */
const GONE: DirectoryRow = { id: "e-lysander-quaile", firstName: "Lysander", lastName: "Quaile", preferredFirstName: null, employmentStatus: "terminated", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };

const results = (views: readonly LoopView[], tool: string) => views.flatMap((view) => view.results.filter((result) => result.tool === tool)).map((result) => JSON.stringify(result.output));
const latest = (view: LoopView) => [...view.turns].reverse().find((turn) => turn.role === "user")?.text ?? "";

export const NOV14_AGENT_LOOP_BATCH_B_CASES: ReplayCase[] = [
  {
    id: "nov14-agent-loop-salon-answer-reaches-card",
    title: "r3 store-answer and QA live-app item 1: a card waiting for a salon lists the salons by name; the manager's answer (\"kearney\") goes on the card through propose_form's salon input and today's scope check; a salon outside their access is refused as theirs",
    report: `${REPORT}; r3 "kearney, ne" never reached the card; live L3/L4 asked for the salon 3+ times`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-13T22:40:00Z"));
      t.directory([...STAFF, BOTH]);
      t.as("salon_director", TWO_SALONS);
      const model = loopStandIn((view) => {
        const said = latest(view);
        if (!lastResult(view, "propose_form")) {
          const salon = /kearney/i.test(said) ? { salon: "kearney" } : /manhattan/i.test(said) ? { salon: "KS Manhattan" } : {};
          return { tool: "propose_form", input: { template_key: "dpoa", employee_id: BOTH.id, what_happened: /manhattan/i.test(said) ? "Oriel Fenwick was late on 11/12 at KS Manhattan." : "Oriel Fenwick was late on 11/12.", ...salon } };
        }
        return { text: "Here's the Corrective Action Form for **Oriel Fenwick**.\n\n**Observation of Offense:** Late on 11/12." };
      });
      t.loopModel!(model);
      const thread = t.thread();
      await thread.say("ca for oriel fenwick, she was late on 11/12");
      expect(thread.proposal?.status, "the card did not wait for a salon").toBe("needs_location");
      const asked = results(model.views, "propose_form").at(-1) ?? "";
      expect(asked, "the salons are not given by name").toMatch(/"choose_salon_from":\[\{"id":"loc-0\d+","name":"[A-Z]{2} [A-Za-z ]+"/);
      await thread.say("kearney");
      expect(thread.proposal?.locationId, "the answer did not reach the card").toBe("loc-0309");
      expect(thread.proposal?.status).toBe("ready");

      const outside = t.thread();
      await outside.say("ca for oriel fenwick, she was late on 11/12 at KS Manhattan");
      expect(outside.proposal?.locationId ?? null, "a salon outside the manager's access went on the card").not.toBe("loc-0309");
      expect(results(model.views, "propose_form").at(-1), "the outside salon is not a fact").toMatch(/"salon_outside_scope":/);
    },
  },
  {
    id: "nov14-agent-loop-manual-source-card-only-cited",
    title: "QA live-app items 9 and 12: a manual section read with read_policy is a source card like a knowledge passage; only the sources the reply cites ([S<n>]) become cards, the markers never reach the manager, and an uncited product sheet is not shown",
    report: `${REPORT}; B1/B5/B7: the manual quoted with a page and no card; B3/B4/B8: cards that did not match the reply, product sheets nobody cited`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-13T22:40:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      t.knowledgeHas!([
        {
          chunk_id: "kb-product-1",
          document_id: "doc-product-sheet",
          document_title: "Bronzer Product Sheet",
          category: "product",
          locator: "Page 1",
          page: 1,
          section: null,
          content: "A tinted bronzing lotion for indoor tanning.",
          similarity: 0.41,
        },
      ]);
      const model = loopStandIn((view) => {
        if (!lastResult(view, "search_knowledge")) return { tool: "search_knowledge", input: { query: "attendance policy lateness" } };
        if (!lastResult(view, "read_policy")) return { tool: "read_policy", input: { heading: headingWith(view, /attendance/i) ?? "Attendance" } };
        const policy = lastResult(view, "read_policy") as { source?: string };
        return { text: `Lateness falls under the Attendance policy ${policy.source ?? ""}.` };
      });
      t.loopModel!(model);
      const reply = await t.thread().say("what's the policy on lateness?");
      expect(results(model.views, "read_policy")[0], "read_policy gives no source marker").toMatch(/"source":"\[S\d\]"/);
      expect(reply.citations?.length, "the manual section is not a source card").toBe(1);
      expect(reply.citations?.[0]?.documentTitle ?? "", "the card is not the manual's").not.toMatch(/Bronzer/);
      expect(reply.content, "a marker reached the manager").not.toMatch(/\[S\d\]/);
    },
  },
  {
    id: "nov14-agent-loop-inactive-in-woven",
    title: "QA live-app item 7 (L9): a person no longer active in Woven is said to be (inactive_in_woven), not only \"not on the staff list\"; the card has the name as typed",
    report: `${REPORT}; L9: the employee is TERMINATED in Woven, and "isn't on the Woven staff list" was true but unhelpful`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-13T22:40:00Z"));
      t.directory([...STAFF, GONE]);
      t.as("salon_director", KEARNEY);
      const model = loopStandIn((view) => {
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "Lysander Quaile" } };
        if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "dpoa", employee_name: "Lysander Quaile", what_happened: "Lysander Quaile was late on 11/12." } };
        return { text: "**Lysander Quaile** shows as no longer active in Woven; I've used the name as you typed it." };
      });
      t.loopModel!(model);
      const thread = t.thread();
      await thread.say("ca for Lysander Quaile, he was late on 11/12");
      expect(results(model.views, "find_staff")[0], "the inactive person is not a fact").toMatch(/"inactive_in_woven":"Lysander Quaile"/);
      expect(results(model.views, "propose_form").at(-1)).toMatch(/"off_roster_name":"Lysander Quaile".*"inactive_in_woven":true/);
      expect(thread.proposal?.employeeName).toBe("Lysander Quaile");
    },
  },
  {
    id: "nov14-agent-loop-title-differs",
    title: "QA live-app item 8: the card keeps Woven's title when the manager called the person something else (\"Salon Director\"), and the fact says both so the reply states it in one line",
    report: `${REPORT}; the card used Woven's "Assistant Salon Director" while the manager said "Salon Director"`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-13T22:40:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      const model = loopStandIn((view) => {
        if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-3", what_happened: "Juno Paxton was late on 11/12." } };
        return { text: "Here's the card for **Juno Paxton**. Woven lists her as Assistant Salon Director." };
      });
      t.loopModel!(model);
      const thread = t.thread();
      await thread.say("ca for juno paxton, salon director, she was late on 11/12");
      expect(thread.proposal?.employeeRole, "the title is not Woven's").toBe("Assistant Salon Director");
      expect(results(model.views, "propose_form").at(-1), "the differing title is not a fact").toMatch(/"title_differs":\{"woven":"Assistant Salon Director","manager_said":"[^"]*[Ss]alon [Dd]irector"/);
    },
  },
  {
    id: "nov14-agent-loop-read-form-account-field",
    title: "r3 make-that-update: read_form names the account field (coaching_details) and the empty fields, so the model writes the account to the form's own key instead of guessing field names to the step limit",
    report: `${REPORT}; r3 make-that-update / no-false-updated: the first account never reached an empty coaching draft`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-13T22:40:00Z"));
      t.directory([...STAFF, TAMSIN]);
      t.as("salon_director", KEARNEY);
      t.loopModel!(loopStandIn((view) => (lastResult(view, "propose_form") ? { text: "Coaching Form for **Tamsin Orwell**. What happened?" } : { tool: "propose_form", input: { template_key: "coaching", employee_id: TAMSIN.id } })));
      const thread = t.thread();
      await thread.say("create a coaching form for tamsin orwell");
      const id = await thread.create();
      const reader = loopStandIn((view) => {
        const form = lastResult(view, "read_form") as { account_field?: string } | null;
        if (!form) return { tool: "read_form", input: { instance_id: id } };
        if (!lastResult(view, "edit_form") && form.account_field) return { tool: "edit_form", input: { instance_id: id, values: { [form.account_field]: "Tamsin Orwell skipped the spray booth check on 11/12." } } };
        return { text: "Added it to the Details of Coaching." };
      });
      t.loopModel!(reader);
      await thread.say("she skipped the spray booth check on 11/12, put that on the form");
      const read = results(reader.views, "read_form")[0] ?? "";
      expect(read, "read_form does not name the account field").toMatch(/"account_field":"coaching_details"/);
      expect(read, "read_form does not list the empty account field").toMatch(/"empty_fields":\[[^\]]*"coaching_details"/);
      expect(t.values(id).coaching_details ?? "").toMatch(/skipped the spray booth check on 11\/12/);
    },
  },
  {
    id: "nov14-agent-loop-longer-names-on-roster",
    title: "r3 right-persons-account: find_staff for \"Isolde Varga\" says \"Isolde Varga Two\" is also on the roster, so a manager's \"<A> Two\" is never lost to <A>",
    report: `${REPORT}; r3: find_staff returned only Isolde Varga for the second person`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-13T22:40:00Z"));
      t.directory([...STAFF, ISOLDE, ISOLDE_TWO]);
      t.as("salon_director", KEARNEY);
      const model = loopStandIn((view) => (lastResult(view, "find_staff") ? { text: "Which one?" } : { tool: "find_staff", input: { name: "Isolde Varga" } }));
      t.loopModel!(model);
      await t.thread().say("ca for isolde varga two, she was late on 11/12");
      const found = results(model.views, "find_staff")[0] ?? "";
      expect(found).toMatch(/"matches":\[\{"employee_id":"e-isolde-varga"/);
      expect(found, "the longer name is not a fact").toMatch(/"longer_names_on_roster":\["Isolde Varga Two"\]/);
    },
  },
  {
    id: "nov14-agent-loop-card-value-facts",
    title: "code-check batch B (#21, #22, #23): with no account an MSB request counts as naming the policy and the model's policy stays; a cleaning duty beside another offense cites both as the model wrote them, with the cleaning fact; prior actions are the model's, with today's reading as a fact",
    report: `${REPORT}; r3 639: an MSB card lost its policy; Pau 14 Nov: code may refuse or inform, never rewrite`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-13T22:40:00Z"));
      t.directory([...STAFF, TAMSIN]);
      t.as("salon_director", KEARNEY);
      const model = loopStandIn((view) => {
        const said = latest(view);
        if (lastResult(view, "propose_form")) return { text: "Here's the card for **Tamsin Orwell**." };
        if (/must see/i.test(said)) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: TAMSIN.id, policy: headingWith(view, /standards of conduct/i) ?? "Standards of Conduct" } };
        if (/beds/i.test(said)) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: TAMSIN.id, what_happened: "Tamsin Orwell was late on 11/12 and did not clean the beds.", policy: `${headingWith(view, /attendance/i) ?? "Attendance"}; Other — beds not cleaned` } };
        return { tool: "propose_form", input: { template_key: "dpoa", employee_id: TAMSIN.id, what_happened: "Tamsin Orwell was late on 11/12.", prior_actions: "Verbal CA — 10/02/2026" } };
      });
      t.loopModel!(model);

      const msb = t.thread();
      await msb.say("create a ca for must see behaviors for tamsin orwell");
      expect(results(model.views, "propose_form").at(-1), "an MSB request does not count as naming the policy").toMatch(/"policy_named_by_manager":true/);
      expect((msb.proposal as { policyLine?: string | null } | undefined)?.policyLine ?? "", "the MSB card lost its policy").toMatch(/Standards of Conduct/);

      const both = t.thread();
      await both.say("ca for tamsin orwell, she was late on 11/12 and didn't clean the beds");
      expect(results(model.views, "propose_form").at(-1), "the cleaning duty is not a fact").toMatch(/"cleaning_duty":/);
      expect((both.proposal as { policyLine?: string | null } | undefined)?.policyLine ?? "", "both policies are not cited").toMatch(/^Attendance.*; Other — beds not cleaned$/);

      const prior = t.thread();
      await prior.say("ca for tamsin orwell, she was late on 11/12, she had a verbal on 10/2");
      expect(results(model.views, "propose_form").at(-1), "today's reading of the prior step is not a fact").toMatch(/"prior_steps_said":\[/);
      expect((prior.proposal as { priorActions?: string | null } | undefined)?.priorActions, "the model's prior actions were replaced").toBe("Verbal CA — 10/02/2026");
    },
  },
];
