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
];
