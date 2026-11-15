import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext, type ReplayThread } from "./cases";
import { lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * fix-name, LIVE s10: "FIX HER LAST NAME" ON A CARD NOT YET CREATED (Pau's ruling, 16 Nov 2026, via QA)
 * ============================================================================
 *
 * QA's live re-test (16 Nov, s10): on a card not yet created, "fix her last name" changed the card's name with no
 * roster check (the typed name went on as an off-roster name). Pau's ruling: it may change the card's name, but only
 * through the same roster check as a new name: an exact roster match is used; a close spelling asks "Did you mean
 * <name>?" with keep-as-typed (ruling A); no match says so and the card keeps its name.
 *
 * The live chat (loop6 s10, the tester's read-only copy; the test name swapped for an invented one, Quill Fenwick):
 * "coaching for <A> on recomending lotions at checkout, and payroll deduct $10 for the bottle she broke" gave a Coaching
 * card for <A> as typed (not on the staff list); "fix her last name, its <changed>" then put the changed name on the
 * card, again as typed, with no roster check.
 *
 * The mocked model does what a model reading "fix her last name, its <X>" does: proposes the same form again with
 * the corrected name typed, no employee_id. Asserted on the card and the tool's structured result, never on wording.
 * Invented names only (Remy Calder is the card's person; Remy Callow is another invented roster person).
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA's live re-test s10 (16 Nov 2026): \"fix her last name\" on an uncreated card changed the name with no roster check";
const ACCOUNT = "She was late to her shift on 11/14.";
/** The manager's words in the live chat (s10), with the invented name. */
const S10_REQUEST = "coaching for quill fenwick on recomending lotions at checkout, and payroll deduct $10 for the bottle she broke";
const S10_FIX = "fix her last name, its fenwyck";
const S10_ACCOUNT = "On recommending lotions at checkout. She broke a bottle.";
/** Quill Hartwell on the roster: the card was made under another surname the roster does not hold. */
const HARTWELL: DirectoryRow = { id: "e-10", firstName: "Quill", lastName: "Hartwell", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };
const CALLOW: DirectoryRow = { id: "e-9", firstName: "Remy", lastName: "Callow", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };

/** Remy Calder's Corrective Action card, shown and not created. */
async function remysCard(t: ReplayContext, extra: DirectoryRow[] = []): Promise<ReplayThread> {
  vi.setSystemTime(new Date("2026-11-14T22:40:00Z"));
  t.directory([...STAFF, ...extra]);
  t.as("salon_director", KEARNEY);
  t.loopModel!(loopStandIn((view): LoopDecision => {
    if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", what_happened: ACCOUNT } };
    return { text: "Here's the Corrective Action Form for **Remy Calder**." };
  }));
  const thread = t.thread();
  await thread.say("CA for Remy Calder, she was late to her shift on 11/14");
  expect(thread.proposal?.employeeName).toBe("Remy Calder");
  return thread;
}

/** Live s10: the Coaching card for Quill Fenwick, a name not on the staff list, as typed; shown and not created. */
async function s10Card(t: ReplayContext, extra: DirectoryRow[] = []): Promise<ReplayThread> {
  vi.setSystemTime(new Date("2026-11-14T22:40:00Z"));
  t.directory([...STAFF, ...extra]);
  t.as("salon_director", KEARNEY);
  t.loopModel!(loopStandIn((view): LoopDecision => {
    if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "coaching", employee_name: "Quill Fenwick", what_happened: S10_ACCOUNT } };
    return { text: "Here's the Coaching Form for **Quill Fenwick**." };
  }));
  const thread = t.thread();
  await thread.say(S10_REQUEST);
  expect(thread.proposal?.employeeName, "the s10 card for a name not on the staff list was not shown (the case proves nothing)").toBe("Quill Fenwick");
  return thread;
}

/** The model re-proposes the card with the corrected name typed; its reply is the question the refusal hands back, if any. */
function fixer(name: string, template = "dpoa", account = ACCOUNT, cardName = "Remy Calder") {
  return loopStandIn((view): LoopDecision => {
    const result = lastResult(view, "propose_form") as { reason_code?: string; error?: string } | null;
    if (!result) return { tool: "propose_form", input: { template_key: template, employee_name: name, what_happened: account } };
    if (result.reason_code === "name_correction_did_you_mean") return { text: result.error!.split("in these words: ")[1]! };
    if (result.reason_code === "name_correction_not_on_roster") return { text: `I couldn't find **${name}** on the staff list, so the card is still for ${cardName}. To put it on as typed, reply **use ${name}**.` };
    return { text: "Done." };
  });
}

const code = (model: ReturnType<typeof fixer>) => (model.views.flatMap((view) => view.results).find((entry) => entry.tool === "propose_form")?.output as { reason_code?: string } | undefined)?.reason_code;

export const NOV16_CARD_NAME_FIX_CASES: ReplayCase[] = [
  {
    id: "nov16-s10-card-name-fix-exact-roster-match",
    title: "fix-name s10: \"fix her last name, it's Callow\" on Remy Calder's uncreated card, and Remy Callow is on the roster: the card is Remy Callow's (the exact roster match is used)",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      const thread = await remysCard(t, [CALLOW]);
      const model = fixer("Remy Callow");
      t.loopModel!(model);
      await thread.say("fix her last name, its callow");
      expect(code(model), "the roster match was refused").toBeUndefined();
      expect(thread.proposal?.employeeName).toBe("Remy Callow");
    },
  },
  {
    id: "nov16-s10-card-name-fix-close-spelling-asks",
    title: "fix-name s10: \"fix her last name, it's Kalder\" on Remy Calder's uncreated card asks \"Did you mean Remy Calder?\" and changes nothing; \"no\" keeps Remy Kalder as typed (ruling A)",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      const thread = await remysCard(t);
      const asking = fixer("Remy Kalder");
      t.loopModel!(asking);
      const reply = await thread.say("fix her last name, its kalder");
      expect(code(asking), "a close spelling was seated without asking").toBe("name_correction_did_you_mean");
      expect(reply.formProposal ?? null, "a card was shown with the near miss").toBeNull();
      const keep = fixer("Remy Kalder");
      t.loopModel!(keep);
      await thread.say("no");
      expect(code(keep), "keep-as-typed was refused after the manager's no").toBeUndefined();
      expect(thread.proposal?.employeeName).toBe("Remy Kalder");
    },
  },
  {
    id: "nov16-s10-card-name-fix-no-match-says-so",
    title: "fix-name s10: \"fix her last name, it's Voss\" on Remy Calder's uncreated card: Remy Voss is on nobody's roster, so it is refused (name_correction_not_on_roster) and no card carries Remy Voss; \"use Remy Voss\" after the offer puts it on as typed",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      const thread = await remysCard(t);
      const model = fixer("Remy Voss");
      t.loopModel!(model);
      const reply = await thread.say("fix her last name, its voss");
      expect(code(model), "a name on nobody's roster went on the card with no check").toBe("name_correction_not_on_roster");
      expect(reply.formProposal ?? null, "a card was shown with the unchecked name").toBeNull();
      const use = fixer("Remy Voss");
      t.loopModel!(use);
      await thread.say("use Remy Voss");
      expect(code(use)).toBeUndefined();
      expect(thread.proposal?.employeeName).toBe("Remy Voss");
    },
  },
  {
    id: "nov16-s10-live-wording-off-roster-card-no-match",
    title: "fix-name s10, the live chat's words: \"fix her last name, its fenwyck\" on Quill Fenwick's Coaching card (not on the staff list, not created): Quill Fenwyck is on nobody's roster, so it is refused (name_correction_not_on_roster), no card carries it, and \"use Quill Fenwyck\" after the offer puts it on as typed",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      const thread = await s10Card(t);
      const model = fixer("Quill Fenwyck", "coaching", S10_ACCOUNT, "Quill Fenwick");
      t.loopModel!(model);
      const reply = await thread.say(S10_FIX);
      expect(code(model), "the live s10 bug: the corrected name went on the card with no roster check").toBe("name_correction_not_on_roster");
      expect(reply.formProposal ?? null, "a card was shown with the unchecked name").toBeNull();
      const use = fixer("Quill Fenwyck", "coaching", S10_ACCOUNT, "Quill Fenwick");
      t.loopModel!(use);
      await thread.say("use Quill Fenwyck");
      expect(code(use)).toBeUndefined();
      expect(thread.proposal?.employeeName).toBe("Quill Fenwyck");
      expect(thread.proposal?.templateKey, "the correction changed the form").toBe("coaching");
    },
  },
  {
    id: "nov16-s10-live-wording-off-roster-card-roster-match",
    title: "fix-name s10, the live chat's wording: when the corrected name is on the roster (Quill Hartwell), \"fix her last name, its hartwell\" puts that roster person on Quill Fenwick's Coaching card (the exact match is used)",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      const thread = await s10Card(t, [HARTWELL]);
      const model = fixer("Quill Hartwell", "coaching", S10_ACCOUNT, "Quill Fenwick");
      t.loopModel!(model);
      await thread.say("fix her last name, its hartwell");
      expect(code(model), "the roster match was refused").toBeUndefined();
      expect(thread.proposal?.employeeName).toBe("Quill Hartwell");
      expect(thread.proposal?.templateKey, "the correction changed the form").toBe("coaching");
    },
  },
];
