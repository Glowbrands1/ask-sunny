import { expect, vi } from "vitest";

import { TWO_SALONS, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * HOW THE PERSON RESIGNED IS HOW THEY QUIT, NOT HOW THE MANAGER REACHED THEM (port from Ask Bubbles #1021, U26)
 * ============================================================================
 *
 * The manager's turn, word for word (the people invented, the former employee on no directory but this case's):
 * "I want to create an exit form for <P10>.  On 11-11-2026 <P11>, Salon Director, called and left a voicemail for <P10>
 * when she did not show for her shift. Later that day <P10> returned the call and told <P1>, Assistant Salon Director,
 * this job was not working out because of her other job and she quit effective immediately."
 *
 * The saved form said How Employee Resigned "Voicemail": the voicemail was the Salon Director's, and she quit on the call
 * back. And the card asked which salon though Woven lists <P10> (no longer active) at one salon only. Sunny's invented
 * people, titles and salon stand in for the sibling app's.
 *
 * Mechanism:
 *   - the model reads how the person resigned (propose_form `exit_method`, one of the line's own methods) and quotes the
 *     manager's words for it (`exit_method_evidence`), kept when the quote names that method (`quoteNamesMethod`) and is
 *     this request's; Create writes it as the manager's statement after checking the quote in the chat's manager turns;
 *   - with none from the model, a loop card's draft reads the method only from the sentences the exit form's own reader
 *     reads a resignation type from (`resignationStatementMethod`), never from the rest of the account;
 *   - a former employee's own Woven salons in the manager's scope are offered first (`employee_salon`), as an active
 *     person's are.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "Port from Ask Bubbles (#1021, its QA's round 2, 22 Nov 2026, U26): an exit form saved How Employee Resigned \"Voicemail\" (the director's voicemail, not how she quit) and asked which salon for a former employee Woven lists at one";
const P10: DirectoryRow = { id: "e-odessa-varnell", firstName: "Odessa", lastName: "Varnell", preferredFirstName: null, employmentStatus: "terminated", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };
const T1 =
  "I want to create an exit form for Odessa Varnell.  On 11-11-2026 Corin Vale, Salon Director, called and left a voicemail for Odessa Varnell when she did not show for her shift. Later that day Odessa Varnell returned the call and told Marlo Quint, Assistant Salon Director, this job was not working out because of her other job and she quit effective immediately.";
const KEARNEY_NAME = "NE Kearney";

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-21T18:00:00Z"));
  t.directory([P10]);
  t.as("salon_director", TWO_SALONS);
}

type Result = { card?: Record<string, unknown>; facts?: Record<string, unknown> } & Record<string, unknown>;

/** The live model: the exit card for the name as typed; `method` and its quote when it reads how she quit; then the salon it is offered. */
const live = (method: string | null, quote: string | null) =>
  loopStandIn((view: LoopView): LoopDecision => {
    const last = lastResult(view, "propose_form") as Result | null;
    const base = {
      template_key: "stc-exit",
      employee_name: "Odessa Varnell",
      exit_type: "resignation",
      exit_evidence: { ...evidenceFrom(view, "I want to create an exit form for Odessa Varnell"), kind: "asks_for_exit_form" },
      person_evidence: evidenceFrom(view, "Odessa Varnell"),
      ...(method ? { exit_method: method, exit_method_evidence: evidenceFrom(view, quote ?? method) } : {}),
    };
    if (!last) return { tool: "propose_form", input: base };
    const offered = typeof last.facts?.employee_salon === "string" ? last.facts.employee_salon : null;
    const proposals = view.results.filter((result) => result.tool === "propose_form").length;
    if (offered && last.card?.status === "needs_location" && proposals < 2) return { tool: "propose_form", input: { ...base, salon: offered } };
    return { text: `Here's the Resignation/Exit Form for **Odessa Varnell**.` };
  });

const results = (views: readonly LoopView[]) => views.flatMap((view) => view.results.filter((result) => result.tool === "propose_form").map((result) => result.output as Result));

export const NOV22_AGENT_LOOP_EXIT_METHOD_IS_THE_QUITTERS_CASES: ReplayCase[] = [
  {
    id: "nov22-u26-exit-method-from-model-phone-call",
    title: "U26: \"… left a voicemail for <P> … <P> returned the call and told <P1> … she quit effective immediately\" — the model's \"Phone call\" (quoting \"returned the call\") is How Employee Resigned, never \"Voicemail\"",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      const thread = t.thread();
      const model = live("Phone call", "Odessa Varnell returned the call");
      t.loopModel!(model);
      await thread.say(T1);
      expect(results(model.views).at(-1)?.card?.how_resigned, "the card does not state how she resigned").toBe("Phone call");
      const id = await thread.create();
      expect(t.values(id).resignation_method, "How Employee Resigned is not the model's reading").toBe("Phone call");
    },
  },
  {
    id: "nov22-u26-exit-method-none-not-the-voicemail",
    title: "U26, no method from the model: How Employee Resigned is read only from the sentence that states the resignation — never \"Voicemail\" from the director's call before it",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      const thread = t.thread();
      t.loopModel!(live(null, null));
      await thread.say(T1);
      const id = await thread.create();
      expect(t.values(id).resignation_method ?? "", "the GM's voicemail was saved as how she resigned").not.toMatch(/voicemail/i);
    },
  },
  {
    id: "nov22-u26-exit-method-quote-does-not-name-it",
    title: "U26, control: a method whose quote does not name it (\"Text message\" quoting \"she quit effective immediately\") is not kept",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      const thread = t.thread();
      const model = live("Text message", "she quit effective immediately");
      t.loopModel!(model);
      await thread.say(T1);
      expect(results(model.views).at(-1)?.card?.how_resigned ?? null).toBeNull();
      const id = await thread.create();
      expect(t.values(id).resignation_method ?? "").not.toMatch(/text|voicemail/i);
    },
  },
  {
    id: "nov22-u26-former-employee-own-salon-offered-first",
    title: "U26: a former employee Woven lists at Kearney (in the manager's scope): that salon is offered first (employee_salon), and the card is filed there",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      const thread = t.thread();
      const model = live("Phone call", "Odessa Varnell returned the call");
      t.loopModel!(model);
      await thread.say(T1);
      const all = results(model.views);
      expect(all[0]?.card?.status, "the case proves nothing: the first card already had a salon").toBe("needs_location");
      expect(all[0]?.facts?.employee_salon, "her own Woven salon was not offered").toBe(KEARNEY_NAME);
      expect(thread.proposal?.locationId, "the card was not filed at her Woven salon").toBe("loc-0309");
    },
  },
];
