import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { lastResult, loopStandIn, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * COACHING FOR EVERYONE THROUGH THE AGENT LOOP'S coach_team (QA's code audit on main 9e1d1f67, 20 Nov 2026)
 * ============================================================================
 *
 * A. "Create all" from the team card put a first name where "All" was: "All guests must be greeted…" became
 *    "<First> guests must be greeted…" (the placeholder's words were swapped alone).
 * B. A failed draft in "create all" was reported as "That lookup failed just now.", and the retry listed the empty
 *    failed drafts as "already made".
 * C. Ordinary answers to "create all?" ("yes please", "go ahead and make them", "create all of them") went nowhere, and
 *    a confirmation the model said in its own words was never read as asked.
 * D. "Do this coaching for the whole team" with one person's Coaching draft open made a new "All team members" card.
 * Through the real chat route, the loop on for this case's manager. Invented names only (STAFF's people).
 */
const REPORT = "QA's code audit of coach_team / coaching for everyone (main 9e1d1f67, 20 Nov 2026)";
const FLAG = "AGENT_LOOP_ENABLED";
const offline = process.env.AGENT_LOOP_LIVE !== "1";

/** The turns coach_team answers: the team request and any answer to its confirmation. */
const TEAM_TURN = /everyone|whole team|team members|create all|^yes|go ahead/i;

type TeamResult = { app_reply?: { untrusted_text?: string }; error?: string } | null;

/**
 * The loop's stand-in: coach_team for a team turn, said back as given (or, with `paraphrase`, a confirmation in the
 * model's own words); propose_form for Remy's Coaching card otherwise.
 */
function standIn(paraphrase = false) {
  return loopStandIn((view: LoopView) => {
    const said = view.turns.filter((turn) => turn.role === "user").at(-1)?.text ?? "";
    if (TEAM_TURN.test(said)) {
      const team = lastResult(view, "coach_team") as TeamResult;
      if (!team) return { tool: "coach_team", input: {} };
      const text = team.app_reply?.untrusted_text ?? String(team.error);
      return { text: paraphrase && /Reply \*\*create all/.test(text) ? `I can make one draft for each person at Kearney (${/\*\*(\d+)\*\* draft/.exec(text)?.[1]} people). Want me to go ahead?` : text };
    }
    if (lastResult(view, "propose_form") || lastResult(view, "coach_team")) return { text: "Here is the card." };
    return { tool: "propose_form", input: { template_key: "coaching", employee_id: "e-2", what_happened: "Remy Calder was coached on restocking the lotion shelf before close on 11/18/26." } };
  });
}

function start(t: ReplayContext, paraphrase = false) {
  vi.setSystemTime(new Date("2026-11-20T16:00:00Z"));
  t.directory(STAFF);
  t.as("salon_director", KEARNEY);
  t.loopModel!(standIn(paraphrase));
  return t.thread();
}

/** Remy Calder's Coaching draft, created and filled; the thread has it open. */
async function remysDraft(t: ReplayContext, paraphrase = false) {
  const thread = start(t, paraphrase);
  await thread.say("coaching for remy calder, she was coached on restocking the lotion shelf before close on 11/18/26");
  t.draftWrites({ coaching_details: "Remy Calder was coached on restocking the lotion shelf before close on 11/18/26." });
  await thread.create();
  return thread;
}

const newForms = (t: ReplayContext, before: number) => t.forms().slice(before);

export const NOV20_COACH_TEAM_CASES: ReplayCase[] = [
  {
    id: "nov20-coach-team-a-team-card-all-is-not-a-name",
    title: "A: \"create all\" from the team card swaps only \"All team members\": \"All guests must be greeted…\" keeps \"All\"",
    report: `${REPORT}, item A: "All guests must be greeted…" was saved as "<First> guests must be greeted…"`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      const thread = start(t);
      const card = await thread.say("Coaching form for all team members, everyone needs to greet guests at the door");
      expect(card.formProposal?.employeeName, "no team card").toBe("All team members");
      t.draftWrites({ coaching_details: "All guests must be greeted at the door. All team members restock the lotion shelf before close." });
      await thread.create();
      const before = t.forms().length;
      const confirm = await thread.say("Create this coaching form for everyone on my team");
      const count = Number(/create all (\d+)/.exec(confirm.content)?.[1] ?? 0);
      expect(count, confirm.content).toBeGreaterThan(0);
      await thread.say(`create all ${count}`);
      const made = newForms(t, before);
      expect(made.length, "not one draft per person").toBe(count);
      for (const form of made) {
        const details = t.values(String(form.id)).coaching_details ?? "";
        const name = String(form.employee_name);
        expect(details, `${name}'s draft: ${details}`).toContain("All guests must be greeted at the door.");
        expect(details, `${name}'s draft`).not.toMatch(new RegExp(`\\b${name.split(" ")[0]} guests|\\bMembers\\b`));
      }
    },
  },
  {
    id: "nov20-coach-team-b-failed-draft-reported-and-retried",
    title: "B: a draft that fails in \"create all\" is named as not made (never \"That lookup failed\"), and the retry fills it instead of listing it as already made",
    report: `${REPORT}, item B: a partial failure read "That lookup failed just now."; the retry listed empty drafts as "already made"`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      const thread = await remysDraft(t);
      const before = t.forms().length;
      const confirm = await thread.say("Create this coaching form for everyone on my team");
      const count = Number(/create all (\d+)/.exec(confirm.content)?.[1] ?? 0);
      expect(count, confirm.content).toBeGreaterThan(0);
      t.failSavesOf!("coaching_details");
      const failed = await thread.say(`create all ${count}`);
      expect(failed.content, "the failure read as a failed lookup").not.toMatch(/lookup failed/i);
      expect(failed.content, "the failed drafts were not named").toMatch(/Not made: \*\*/);
      expect(failed.content, "a failed draft was reported as created").not.toMatch(/Created \*\*/);
      t.failSavesOf!("");
      const retried = await thread.say(`create all ${count}`);
      expect(retried.content, "the empty drafts were listed as already made").not.toMatch(/Already made/);
      expect(retried.content).toMatch(new RegExp(`Created \\*\\*${count}\\*\\* draft Coaching Form`));
      for (const form of newForms(t, before)) {
        expect(t.values(String(form.id)).coaching_details, `${String(form.employee_name)}'s draft is empty`).toMatch(/restocking the lotion shelf/);
      }
    },
  },
  {
    id: "nov20-coach-team-c-yes-please-to-own-words-confirmation",
    title: "C: the model asks \"create all?\" in its own words and the manager says \"yes please\": one draft each is made",
    report: `${REPORT}, item C: "yes", "yes please" never answered the confirmation; it also had to be echoed word for word`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      const thread = await remysDraft(t, true);
      const before = t.forms().length;
      const confirm = await thread.say("Create this coaching form for everyone on my team");
      const count = Number(/\((\d+) people\)/.exec(confirm.content)?.[1] ?? 0);
      expect(count, confirm.content).toBeGreaterThan(0);
      const made = await thread.say("yes please");
      expect(made.content).toMatch(/Created \*\*\d+\*\* draft Coaching Form/);
      expect(newForms(t, before).length, "not one draft per person").toBe(count);
    },
  },
  {
    id: "nov20-coach-team-c-go-ahead-and-make-them",
    title: "C: \"go ahead and make them\" answers the confirmation said as given",
    report: `${REPORT}, item C: "go ahead and make them", "create all of them" went to wrong_tool`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      const thread = await remysDraft(t);
      const before = t.forms().length;
      const confirm = await thread.say("Create this coaching form for everyone on my team");
      const count = Number(/create all (\d+)/.exec(confirm.content)?.[1] ?? 0);
      const made = await thread.say("go ahead and make them");
      expect(made.content).toMatch(/Created \*\*\d+\*\* draft Coaching Form/);
      expect(newForms(t, before).length, "not one draft per person").toBe(count);
    },
  },
  {
    id: "nov20-coach-team-d-whole-team-copies-open-draft",
    title: "D: \"Do this coaching for the whole team\" with Remy's Coaching draft open asks to make one draft each from it, never a new team card",
    report: `${REPORT}, item D: "do this coaching for the whole team" made a new "All team members" card`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      const thread = await remysDraft(t);
      const reply = await thread.say("Do this coaching for the whole team");
      expect(reply.formProposal?.employeeName ?? null, "a new team card was made").not.toBe("All team members");
      expect(reply.content, "no one-draft-each confirmation").toMatch(/Reply \*\*create all \d+\*\*/);
    },
  },
];
