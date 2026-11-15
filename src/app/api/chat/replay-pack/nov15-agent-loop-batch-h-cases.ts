import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";
import { lastResult, loopStandIn, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * BATCH H: TODAY'S BEHAVIORS THE LOOP STILL LACKED (QA, 15 Nov 2026; the parity matrix's "AFTER MERGE" gaps)
 * ============================================================================
 *
 * Each the loop's way (Pau: "code may refuse or inform, never rewrite"): a fact on the tool's result and a rules-book
 * line, or tool code that fills the card. One case per item in the managers' own words, through the real chat route
 * with the loop on for this case's manager. Remy Calder is STAFF's invented person; other people are invented here.
 */
const REPORT = "QA, batch H (15 Nov 2026): the parity matrix's AFTER MERGE gaps";
const FLAG = "AGENT_LOOP_ENABLED";

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-11T16:00:00Z"));
  t.directory(STAFF);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

/** propose_form's last result this turn, across the model's views. */
const proposed = (views: readonly LoopView[]) =>
  views.flatMap((view) => view.results).filter((result) => result.tool === "propose_form").at(-1)?.output as
    | { card?: Record<string, unknown>; facts?: Record<string, unknown>; error?: string }
    | undefined;

/** Invented: one with no title on the staff list, one whose title is the shortcut "ASD". */
const JUNO: DirectoryRow = { id: "e-juno-halloway", firstName: "Juno", lastName: "Halloway", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: null as never };
const PERRIN: DirectoryRow = { id: "e-perrin-ashgrove", firstName: "Perrin", lastName: "Ashgrove", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "ASD" };

/** Invented: on the directory with no salon, so the card has none of its own. */
const WREN: DirectoryRow = { id: "e-wren-tallis", firstName: "Wren", lastName: "Tallis", preferredFirstName: null, employmentStatus: "active", salonIds: [], positionName: "Tanning Consultant" };
const GLOBAL_DM = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };

/** A manual section, as the guards cases build them. */
function manualChunk(index: number, page: number, heading: string, body: string) {
  return { chunkIndex: index, chunkId: `h-${index}`, locator: `Page ${page} — ${heading}`, page: page + 1, content: `${heading}\n${body}`, section: heading, printedPage: page, sections: [{ page, heading }] };
}

export const NOV15_AGENT_LOOP_BATCH_H_CASES: ReplayCase[] = [
  {
    id: "nov15-batch-h1-amount-unknown-left-blank",
    title: "H1 AMOUNT_UNKNOWN_ACK: \"yes payroll deduct\" then \"i dont know the amount\": the card's fact says the amount is left blank, never asked again",
    report: `${REPORT}; QA live, 27 Oct 2026: "i dont know the amount" got the card back with no word about it`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      const thread = start(t);
      const card = { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", policy: "Attendance", what_happened: "Remy Calder was 20 minutes late on 11/9/26.", warning_level: "verbal", payroll_deduct: "yes" } } as const;
      const model = loopStandIn((view) => (lastResult(view, "propose_form") ? { text: "Here is the card." } : card));
      t.loopModel!(model);
      await thread.say("verbal ca for remy calder, she was 20 minutes late on 11/9/26");
      await thread.say("yes payroll deduct");
      await thread.say("i dont know the amount");
      const facts = proposed(model.views)?.facts ?? {};
      expect(facts.payroll_amount_unknown, "the unknown amount was not a fact").toBe(true);
      expect(facts.payroll_amount_unset, "the amount was asked again").toBeUndefined();
    },
  },
  {
    id: "nov15-batch-h2-coaching-for-all-team-members-is-the-team-card",
    title: "H2 WHOLE_TEAM_COACHING: \"Coaching form for all team members\" with no draft open is the team Coaching card, never a refusal",
    report: `${REPORT}; a Location Manager, 2 Nov 2026: "it says it cannot make a coaching form for all team members, but it just did it for me earlier"`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      const thread = start(t);
      const model = loopStandIn((view) => (lastResult(view, "coach_team") ? { text: "Here is the team Coaching card." } : { tool: "coach_team", input: {} }));
      t.loopModel!(model);
      const reply = await thread.say("Coaching form for all team members, everyone needs to restock the lotion shelf before close");
      expect(lastResult(model.views.at(-1)!, "coach_team")?.error, "coach_team refused the whole-team request").toBeUndefined();
      expect(reply.formProposal?.employeeName, "no team card").toBe("All team members");
      expect(reply.formProposal?.subject).toBe("team");
    },
  },
  {
    id: "nov15-batch-h2-coaching-for-everyone-one-draft-each",
    title: "H2 COACHING_FOR_EVERYONE: \"Create this coaching form for everyone on my team\" with a Coaching draft open: one confirmation, then \"create all\" makes one draft each",
    report: `${REPORT}; Pau, 3 Nov 2026: "also having to replicate that coaching verbiage to all coaching forms so she doesn't have to copy paste"`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      const thread = start(t);
      const coaching = { tool: "propose_form", input: { template_key: "coaching", employee_id: "e-2", what_happened: "Remy Calder was coached on restocking the lotion shelf before close on 11/9/26." } } as const;
      t.loopModel!(loopStandIn((view) => {
        const said = view.turns.filter((turn) => turn.role === "user").at(-1)?.text ?? "";
        if (/everyone|create all/i.test(said)) {
          const team = lastResult(view, "coach_team") as { app_reply?: { untrusted_text?: string }; error?: string } | null;
          return team ? { text: team.app_reply?.untrusted_text ?? String(team.error) } : { tool: "coach_team", input: {} };
        }
        return lastResult(view, "propose_form") ? { text: "Here is the card." } : coaching;
      }));
      await thread.say("coaching for remy calder, she was coached on restocking the lotion shelf before close on 11/9/26");
      t.draftWrites({ coaching_details: "Remy Calder was coached on restocking the lotion shelf before close on 11/9/26." });
      await thread.create();
      const before = t.forms().length;
      const confirm = await thread.say("Create this coaching form for everyone on my team");
      expect(confirm.content, "no confirmation listing the team").toMatch(/Reply \*\*create all \d+\*\*/);
      expect(t.forms().length, "drafts were made before the confirmation").toBe(before);
      const count = Number(/create all (\d+)/.exec(confirm.content)?.[1] ?? 0);
      expect(count, "the confirmation listed nobody").toBeGreaterThan(0);
      const made = await thread.say(`create all ${count}`);
      expect(made.content).toMatch(/Created \*\*\d+\*\* draft Coaching Form/);
      expect(t.forms().length - before, "not one draft per person").toBe(count);
    },
  },
  {
    id: "nov15-batch-h4-typed-title-after-the-name",
    title: "H4/H6 JOB_TITLE_APPOSITION + FROM_WORDS: \"<name>, tan consultant at kearney\" fills an empty staff-list title, as the title list writes it, and the card carries it",
    report: `${REPORT}; QA S12/S1 live, 27 Oct 2026: "<name>, tan consultant at manhattan" left the Job Title empty, then saved it in lower case`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-11T16:00:00Z"));
      t.directory([...STAFF, JUNO]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      const model = loopStandIn((view) => (lastResult(view, "propose_form") ? { text: "Here is the card." } : { tool: "propose_form", input: { template_key: "dpoa", employee_id: JUNO.id, policy: "Attendance", what_happened: "Juno Halloway was 20 minutes late on 11/9/26." } }));
      t.loopModel!(model);
      const reply = await thread.say("verbal corrective action for juno halloway, tan consultant at kearney, she was 20 minutes late on 11/9/26");
      const result = proposed(model.views);
      expect(reply.formProposal?.employeeRole, "the typed title did not fill the card").toBe("Tan Consultant");
      expect(result?.card?.job_title).toBe("Tan Consultant");
      expect(result?.facts?.job_title_from_your_words).toBe("Tan Consultant");
    },
  },
  {
    id: "nov15-batch-h6-title-shortcut-spelled-out",
    title: "H6 TITLE_SPELLED_OUT: a staff-list title \"ASD\" is on the card as \"Assistant Salon Director\" (Pau: \"spell it out but app must understand ASD\")",
    report: `${REPORT}; Pau, 30 Oct 2026: "yeah i mean spell it out but app must understand ASD meaning"`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-11T16:00:00Z"));
      t.directory([...STAFF, PERRIN]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      const model = loopStandIn((view) => (lastResult(view, "propose_form") ? { text: "Here is the card." } : { tool: "propose_form", input: { template_key: "dpoa", employee_id: PERRIN.id, policy: "Attendance", what_happened: "Perrin Ashgrove was 20 minutes late on 11/9/26." } }));
      t.loopModel!(model);
      const reply = await thread.say("verbal ca for perrin ashgrove, he was 20 minutes late on 11/9/26");
      expect(reply.formProposal?.employeeRole).toBe("Assistant Salon Director");
      expect(proposed(model.views)?.card?.job_title).toBe("Assistant Salon Director");
    },
  },
  ...([
    ["asks-once", "verbal ca for wren tallis, she was 20 minutes late on 11/9/26", null],
    ["named-salon-filled", "verbal ca for wren tallis at kearney, she was 20 minutes late on 11/9/26", "loc-0309"],
  ] as const).map(([key, said, salon]): ReplayCase => ({
    id: `nov15-batch-h5-global-salon-${key}`,
    title: `H5 GLOBAL_SALON_ASK: a global district manager's card ${salon ? "takes the salon they named" : "asks once which salon, and stays ready"}`,
    report: `${REPORT}; Pau's wording, 24 Oct 2026: a global login that is not an admin is asked the salon once`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-11T16:00:00Z"));
      t.directory([...STAFF, WREN]);
      t.as("district_manager", GLOBAL_DM);
      const thread = t.thread();
      // The stand-in follows the rules book's which_salon line, as the model does.
      const model = loopStandIn((view) => {
        const card = lastResult(view, "propose_form") as { facts?: { which_salon?: boolean } } | null;
        if (!card) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: WREN.id, policy: "Attendance", what_happened: "Wren Tallis was 20 minutes late on 11/9/26." } };
        return { text: card.facts?.which_salon ? "Here is the card. Which salon is this about? The card is ready — choose the salon before you create the draft, so it is not filed with no salon." : "Here is the card." };
      });
      t.loopModel!(model);
      const reply = await thread.say(said);
      const facts = proposed(model.views)?.facts ?? {};
      if (salon) {
        expect(reply.formProposal?.locationId, "the salon the manager named was not taken").toBe(salon);
        expect(facts.which_salon).toBeUndefined();
      } else {
        expect(facts.which_salon, "the salon was not asked").toBe(true);
        expect(reply.formProposal?.status, "the card was held").toBe("ready");
        // Asked once: the next card for the same turn of the chat does not ask again.
        const again = await thread.say("make it a written");
        void again;
        expect(proposed(model.views)?.facts?.which_salon, "the salon was asked twice").toBeUndefined();
      }
    },
  })),
  {
    id: "nov15-batch-h7-negated-list-reading-note",
    title: "H7 MANUAL_NEGATED_LIST_NOTE: \"can phones charge in the break room?\" — read_policy carries the reading note that the p.19 list is three places a phone may NOT be",
    report: `${REPORT}; the p.19 phone list read backwards ("charging in the break room" as allowed)`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      const thread = start(t);
      const heading = "Cell Phone Reading Test Section";
      t.manualAlsoHas?.([manualChunk(910, 19, heading, "Phones are kept in the employee's locker during shifts, not in back pockets, charging in the break room, or sitting on top of a drawer till.")]);
      const model = loopStandIn((view) => (lastResult(view, "read_policy") ? { text: "No: the manual lists the break room as a place a phone may not be charged." } : { tool: "read_policy", input: { heading } }));
      t.loopModel!(model);
      await thread.say("can phones charge in the break room?");
      const read = model.views.flatMap((view) => view.results).find((result) => result.tool === "read_policy")?.output as { reading_notes?: string; error?: string } | undefined;
      expect(read?.error, "the section was not read").toBeUndefined();
      expect(read?.reading_notes, "no reading note on the negated list").toMatch(/may NOT be/);
    },
  },
  {
    id: "nov15-batch-h8-newest-turn-salon-wins",
    title: "H8 PLACE_SPAN_GUARD: \"… at grand island\" then \"location is kearney\": the newest turn's salon is the card's",
    report: `${REPORT}; the sibling app's conv (24 Oct 2026): a later "store location is …" did not replace the earlier place`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-11T16:00:00Z"));
      t.directory(STAFF);
      t.as("salon_director", { level: "salon", primaryAreaId: "loc-0309", alsoCoversAreaIds: ["loc-0307"] });
      const thread = t.thread();
      const card = { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", policy: "Attendance", what_happened: "Remy Calder was 20 minutes late on 11/9/26." } } as const;
      t.loopModel!(loopStandIn((view) => (lastResult(view, "propose_form") ? { text: "Here is the card." } : card)));
      await thread.say("verbal ca for remy calder at grand island, she was 20 minutes late on 11/9/26");
      const reply = await thread.say("sorry, location is kearney");
      expect(reply.formProposal?.locationId, "the newest turn's salon was not the card's").toBe("loc-0309");
    },
  },
  {
    id: "nov15-batch-h9-staff-list-not-repeated",
    title: "H9 STAFF_PICKER_NO_REPEAT: a second whole-staff turn for the same salon gets one next-step line, not the staff list again",
    report: `${REPORT}; the staff list sent again on every whole-staff turn`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      const thread = start(t);
      const model = loopStandIn((view) => {
        const listed = lastResult(view, "list_staff") as { salon?: string; already_listed?: boolean } | null;
        if (!listed) return { tool: "list_staff", input: { salon: "kearney" } };
        return { text: listed.already_listed ? `The staff at **${listed.salon}** is listed above.` : `A Corrective Action Form is for one person at a time, so I won't make one card for the whole staff.\n\nHere is the staff at **${listed.salon}** on the directory:\n- Remy Calder` };
      });
      t.loopModel!(model);
      await thread.say("I need a corrective action for my whole staff at kearney");
      await thread.say("I need a corrective action for my whole staff at kearney");
      const lists = model.views.flatMap((view) => view.results).filter((result) => result.tool === "list_staff").map((result) => result.output as { staff?: unknown[]; already_listed?: boolean });
      expect(lists[0]?.staff?.length, "the first turn did not list the staff").toBeGreaterThan(0);
      const second = lists.at(-1)!;
      expect(second.already_listed, "the staff list was sent again").toBe(true);
      expect(second.staff).toBeUndefined();
    },
  },
  {
    id: "nov15-batch-h10-person-carried-from-earlier",
    title: "H10 CARRIED_PERSON_NOTICE: a card whose person was named only before the last six turns carries person_from_earlier",
    report: `${REPORT}; QA's round-6 item (8 Nov 2026): the card named <A> from earlier turns with no notice, a silent carry-over`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      const thread = start(t);
      const model = loopStandIn((view) => {
        const said = view.turns.filter((turn) => turn.role === "user").at(-1)?.text ?? "";
        if (!/verbal ca for her/i.test(said)) return { text: "Noted." };
        return lastResult(view, "propose_form") ? { text: "Here is the card." } : { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", policy: "Attendance", what_happened: "Remy Calder was 20 minutes late on 11/9/26." } };
      });
      t.loopModel!(model);
      await thread.say("remy calder has been late a few times this month");
      for (const question of ["what time do we open on sundays", "how long is a lunch break", "who covers the front desk at close", "when are schedules posted", "how do I request time off", "where do we keep the lotion samples"]) {
        await thread.say(question);
      }
      await thread.say("make a verbal ca for her, she was 20 minutes late on 11/9/26");
      expect(proposed(model.views)?.facts?.person_from_earlier, "the carried person had no notice").toBe("Remy Calder");
    },
  },
  {
    id: "nov15-batch-h11-pasted-outline-goes-to-the-open-draft",
    title: "H11 PASTED_OUTLINE_TO_OPEN_DRAFT: with Remy's CA draft open, a pasted CA for another person (its field labels as headings) is that draft's outline, never refused as \"about another person\"",
    report: `${REPORT}; QA's Sunny round-23 live test of sf-s21: the pasted outline named another person and was read as a new request`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      const thread = start(t);
      let draftId = "";
      const model = loopStandIn((view) => {
        const said = view.turns.filter((turn) => turn.role === "user").at(-1)?.text ?? "";
        if (/Observation of Offense:/.test(said)) return lastResult(view, "edit_form") ? { text: "I used that outline on Remy's draft." } : { tool: "edit_form", input: { instance_id: draftId } };
        return lastResult(view, "propose_form") ? { text: "Here is the card." } : { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", policy: "Attendance", what_happened: "Remy Calder was 20 minutes late on 11/9/26." } };
      });
      t.loopModel!(model);
      await thread.say("verbal ca for remy calder, she was 20 minutes late on 11/9/26");
      t.draftWrites({ observation: "Observed:\nRemy Calder arrived 20 minutes late for her shift on 11/9/26." });
      draftId = await thread.create();
      const pasted = [
        "use this as the outline",
        "Employee Name: Marnie Holloway",
        "Observation of Offense: On 10/2/26 Marnie Holloway arrived 15 minutes late for her opening shift.",
        "Action Plan: Marnie will arrive on time for every scheduled shift. A follow-up is set for two weeks.",
      ].join("\n");
      await thread.say(pasted);
      const edit = model.views.flatMap((view) => view.results).filter((result) => result.tool === "edit_form").at(-1)?.output as { error?: string } | undefined;
      expect(edit, "edit_form was not reached").toBeDefined();
      expect(edit?.error ?? "", "the pasted outline was refused as another person's").not.toMatch(/This message is about/);
    },
  },
  {
    id: "nov15-batch-h12-stated-termination-on-the-card",
    title: "H12 TERMINATION_STATED_TICKS: \"I need a term CA for <B>, she was 20 minutes late on 11/9/26\": the card says Termination with the approval line, never asks the level, and Create ticks it",
    report: `${REPORT}; Pau's P15 ruling, 10 Nov 2026: a stated termination is ticked, with the DM/HR approval line`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      const thread = start(t);
      const model = loopStandIn((view) => (lastResult(view, "propose_form") ? { text: "Here is the card." } : { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", policy: "Attendance", what_happened: "Remy Calder was 20 minutes late on 11/9/26." } }));
      t.loopModel!(model);
      await thread.say("I need a term CA for Remy Calder, she was 20 minutes late on 11/9/26");
      const facts = proposed(model.views)?.facts ?? {};
      // Changed on purpose (15 Nov 2026, the batch H live run): the fact also carries the plan's termination closing, so the card says how Create's plan ends (P15's plan line).
      expect(facts.termination_stated, "the stated termination was not a fact").toEqual({
        approval: "Termination needs your DM/HR approval before you finalize.",
        plan_closing: "Effective immediately, employment is terminated following the progressive corrective action plan.",
      });
      expect((facts.unset as string[] | undefined) ?? [], "the level was asked over a stated termination").not.toContain("warning_level");
      t.draftWrites({ observation: "Observed:\nRemy Calder arrived 20 minutes late for her shift on 11/9/26." });
      const id = await thread.create();
      expect(t.checked(id).warning_type ?? [], "Create did not tick Termination").toContain("termination");
    },
  },
  {
    id: "nov15-batch-h3-date-answer-sets-the-date",
    title: "H3 DATE_ANSWER_APPLIED / DATE_ANSWER_KEEPS_OPEN: after \"Which date goes on the form?\", \"10-15\", \"the 15th\" and \"most recent\" each set the date, and an answer before \"She is at Kearney\" still holds",
    report: `${REPORT}; QA, 26 Oct 2026: "the 15th" read as nothing and the form was dated today`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      // The model leaves incident_date empty every turn: the date on the card is the manager's answer, read by the tool.
      const model = loopStandIn((view) => {
        const facts = (lastResult(view, "propose_form") as { facts?: { dates_given?: string[] } } | undefined)?.facts;
        if (!facts) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", policy: "Attendance", what_happened: "Remy Calder was late on 10/5 and again on 10/15.", warning_level: "verbal" } };
        const asked = (facts.dates_given ?? []).length > 1 && !(lastResult(view, "propose_form") as { card?: { form_date?: string | null } }).card?.form_date;
        return { text: asked ? "Here is the card.\n\nYou mentioned more than one date (**10/5**, **10/15**). Which date goes on the form?" : "Here is the card." };
      });
      for (const [answer, iso] of [["10-15", "2026-10-15"], ["the 15th", "2026-10-15"], ["most recent", "2026-10-15"]] as const) {
        const thread = start(t);
        t.loopModel!(model);
        await thread.say("verbal ca for remy calder, she was late on 10/5 and again on 10/15");
        expect(thread.proposal?.formDate ?? null, "a date was picked before the manager answered").toBeNull();
        await thread.say(answer);
        expect(thread.proposal?.formDate ?? null, `"${answer}" did not set the date`).toBe(iso);
      }
      // DATE_ANSWER_KEEPS_OPEN: the answer, then another turn: the date stays answered.
      const later = start(t);
      t.loopModel!(model);
      await later.say("verbal ca for remy calder, she was late on 10/5 and again on 10/15");
      await later.say("the 15th");
      await later.say("She is at Kearney");
      expect(later.proposal?.formDate ?? null, "the earlier answer was lost a turn later").toBe("2026-10-15");
    },
  },
];
