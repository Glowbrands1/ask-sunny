import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * A FORM THE LIBRARY DOES NOT HAVE IS NEVER SWAPPED SILENTLY (port of Ask Bubbles #1111, board f099 on the loop)
 * ============================================================================
 *
 * In Ask Bubbles, live on the loop, asking for a form the library has no title for made the nearest form's card with
 * nothing said. This app's propose_form had the same gap. The form the manager asked for (form_asked_evidence, this
 * turn's words) is checked by code against the chosen form's own names, only when the quote reads as a form's title:
 * no form answers to it → handed back (form_not_in_library: the reply says so and lists the forms); another library form
 * answers to it → that form (form_asked_is_another); offered in its place only when said (instead_of_asked). Everyday
 * requests that name no form's title keep their cards. Mechanism only; this app's own forms, the pack's roster.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "Port of Ask Bubbles #1111 (board f099 on the loop): a form the library has no title for got the nearest form's card, silently";
const ASKED = "salon manager interview form";
const NO_SUCH = /There's no salon manager interview form in the forms library\. The forms you can create are .+\. Which one do you want\?$/;

type Out = { reason_code?: string; template_key?: string; ask_exactly?: string; facts?: { instead_of_asked?: { say_exactly?: string } } } | null;

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-22T18:00:00Z"));
  t.directory([...STAFF]);
  t.as("admin", { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] });
}

/** The model picks the nearest interview form for the one asked for; on a hand-back it follows it as the rules book says. */
function model(said: string, insteadOfAsked = false) {
  return loopStandIn((view: LoopView): LoopDecision => {
    const result = lastResult(view, "propose_form") as Out;
    if (view.turns.at(-1)?.text !== said) {
      if (result) return { text: "Here's the card." };
      return { tool: "propose_form", input: { template_key: "coaching", employee_id: "e-2", what_happened: "Remy was late to her shift on 11/20/26.", form_asked_evidence: evidenceFrom(view, "coaching form") } };
    }
    if (result?.reason_code === "form_not_in_library") return { text: result.ask_exactly ?? "" };
    if (result?.reason_code === "form_asked_is_another") {
      if (view.results.filter((entry) => entry.tool === "propose_form").length > 1) return { text: "Here's the card." };
      return { tool: "propose_form", input: { template_key: result.template_key, employee_id: "e-2", form_asked_evidence: evidenceFrom(view, ASKED) } };
    }
    if (result) return { text: `Here's the card.${result.facts?.instead_of_asked?.say_exactly ? ` ${result.facts.instead_of_asked.say_exactly}` : ""}` };
    return { tool: "propose_form", input: { template_key: "tanning-consultant-interview", employee_id: "e-2", form_asked_evidence: evidenceFrom(view, ASKED), ...(insteadOfAsked ? { instead_of_asked: true } : {}) } };
  });
}

/** Never a silent swap: the reply says there's no such form, or the card is the form the manager named. */
function noSilentSwap(content: string, card: { templateName?: string } | null | undefined) {
  if (NO_SUCH.test(content)) {
    expect(card?.templateName ?? "", `a card was made in place of the form asked for:\n${content}`).not.toMatch(/Tanning Consultant Interview/);
    return;
  }
  expect(card?.templateName ?? "", `the reply neither says there's no such form nor makes the form asked for:\n${content}`).toMatch(/salon manager interview/i);
}

const loopCase = (id: string, title: string, run: (t: ReplayContext) => Promise<void>): ReplayCase => ({
  id, title, report: REPORT, status: "fixed", fixFlags: [FLAG],
  async run(t) {
    if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
    await run(t);
  },
});

export const NOV23_AGENT_LOOP_NO_SILENT_FORM_SWAP_CASES: ReplayCase[] = [
  loopCase("nov23-loop-no-silent-swap-not-in-library", "\"create a salon manager interview form for Remy Calder\", the model choosing the Tanning Consultant Interview Form: never a silent swap", async (t) => {
    start(t);
    const said = "create a salon manager interview form for Remy Calder";
    t.loopModel!(model(said));
    const reply = await t.thread().say(said);
    noSilentSwap(reply.content, reply.formProposal as { templateName?: string } | null);
  }),
  loopCase("nov23-loop-no-silent-swap-open-coaching-card", "A Coaching card open, \"can you make a salon manager interview form\": never a silent swap", async (t) => {
    start(t);
    const said = "can you make a salon manager interview form";
    t.loopModel!(model(said));
    const thread = t.thread();
    await thread.say("create a coaching form for Remy Calder, she was late to her shift on 11/20/26");
    expect((thread.proposal as { templateKey?: string } | undefined)?.templateKey, "the Coaching card did not open (the case proves nothing)").toBe("coaching");
    const reply = await thread.say(said);
    noSilentSwap(reply.content, reply.formProposal as { templateName?: string } | null);
  }),
  loopCase("nov23-loop-no-silent-swap-instead-of-asked-said", "The Tanning Consultant Interview Form offered in place of the form asked for (instead_of_asked): the card is made and the reply says so", async (t) => {
    start(t);
    const said = "create a salon manager interview form for Remy Calder";
    t.loopModel!(model(said, true));
    const reply = await t.thread().say(said);
    if (/salon manager interview/i.test((reply.formProposal as { templateName?: string } | null)?.templateName ?? "")) return;
    expect(reply.content, reply.content).toMatch(/There's no salon manager interview form in the forms library, so this is the Tanning Consultant Interview Form instead\./);
  }),
  loopCase("nov23-loop-no-silent-swap-control-named-form", "Control: \"create a coaching form for Remy Calder, …\" with form_asked_evidence naming it: the Coaching card, as before", async (t) => {
    start(t);
    t.loopModel!(model("never said"));
    const thread = t.thread();
    const reply = await thread.say("create a coaching form for Remy Calder, she was late to her shift on 11/20/26");
    expect((thread.proposal as { templateKey?: string } | undefined)?.templateKey, reply.content).toBe("coaching");
  }),
  /* Everyday requests name no form's title: each keeps its normal card, even with the model passing form_asked_evidence for it. */
  ...([
    ["write-her-up", "write her up, Remy Calder was late to her shift on 11/20/26", "dpoa", "write her up"],
    ["coach-her", "coach Remy Calder on this, she was late to her shift on 11/20/26", "coaching", "coach Remy Calder on this"],
    ["exit-for", "exit for Remy Calder, she resigned and her last day was 11/20/26", "stc-exit", "exit for Remy Calder"],
    ["do-a-ca", "do a CA for Remy Calder, she was late to her shift on 11/20/26", "dpoa", "do a CA"],
    ["verbal-for", "verbal for Remy Calder, she was late to her shift on 11/20/26", "dpoa", "verbal for Remy Calder"],
    ["she-quit-paperwork", "Remy Calder quit, do the paperwork, her last day was 11/20/26", "stc-exit", "do the paperwork"],
  ] as const).map(([key, said, templateKey, quote]) =>
    loopCase(`nov23-loop-no-silent-swap-everyday-${key}`, `Control: "${said}" (no form's title), with form_asked_evidence "${quote}": the ${templateKey} card as before, never "no such form"`, async (t) => {
      start(t);
      const standIn = loopStandIn((view: LoopView): LoopDecision => {
        const result = lastResult(view, "propose_form") as Out;
        if (result) return { text: result.ask_exactly ?? "Here's the card." };
        return {
          tool: "propose_form",
          input: {
            template_key: templateKey, employee_id: "e-2", form_asked_evidence: evidenceFrom(view, quote),
            ...(templateKey === "stc-exit" ? { exit_type: "resignation", exit_evidence: { ...evidenceFrom(view, quote), kind: "asks_for_exit_form" } } : { what_happened: "Remy was late to her shift on 11/20/26." }),
          },
        };
      });
      t.loopModel!(standIn);
      const thread = t.thread();
      const reply = await thread.say(said);
      const codes = standIn.views.flatMap((view) => view.results).map((entry) => String((entry.output as { reason_code?: unknown }).reason_code ?? ""));
      expect(codes.filter((code) => code === "form_not_in_library" || code === "form_asked_is_another"), reply.content).toEqual([]);
      expect(reply.content, reply.content).not.toMatch(/in the forms library/);
      expect((thread.proposal as { templateKey?: string } | undefined)?.templateKey, `no ${templateKey} card:\n${reply.content}`).toBe(templateKey);
    })),
];
