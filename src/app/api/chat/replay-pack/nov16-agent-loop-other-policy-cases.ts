import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * "OTHER" ONLY WHERE IT BELONGS (QA, 16 Nov 2026: the launch train's 266 re-run)
 * ============================================================================
 *
 * The train cited "Other – <topic>" where this morning's run cited none: c231 (updating clients' accounts), c242
 * (closing duties) and c244 (salon cleanliness), all Coaching cards. The saved coaching forms have no policy field at all.
 * PR 6 had told the model "a Corrective Action or Coaching card always carries its policy (a heading, or Other)". The
 * general rules now:
 * - a Corrective Action (the form with policy fields) always carries a policy; a heading that fits wins over Other;
 * - a Coaching card cites a policy only when the manager names one or a section fits, otherwise none, never "Other"
 *   made from the coaching topic; policy_not_given is for a Corrective Action only;
 * - a Corrective Action citing Other alone, for an incident today's topic reader fits to a manual section, gets
 *   fits_headings (the same fact as a wrong heading);
 * - "Other" stays where it is the rule: Must See Behaviors (Pau, 16 Nov) and a cleaning duty left undone on a CA.
 * c156 and c163 (a CA where the manager named must see behaviors) are #1057's ruling working, not part of this.
 * Invented names only (Remy Calder, Marnie Holloway, Juno Paxton, Rowan Kestrel).
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA, 16 Nov 2026: the launch train's 266 re-run cited \"Other – <topic>\" on c231, c242, c244 (Coaching) where the saved forms have no policy";

const factsOf = (output: Record<string, unknown>) => (output.facts ?? {}) as Record<string, unknown>;
const firstResult = (views: readonly LoopView[], tool: string) => views.flatMap((view) => view.results).find((result) => result.tool === tool)?.output ?? null;
const policyOf = (reply: { formProposal?: unknown }) => String((reply.formProposal as { policyLine?: string } | undefined)?.policyLine ?? "");

function setUp(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-14T22:40:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
}

/** One propose_form call with the given policy (or none), then the reply. */
function oneCard(input: (view: LoopView) => Record<string, unknown>) {
  return loopStandIn((view): LoopDecision => (lastResult(view, "propose_form") ? { text: "Here's the card." } : { tool: "propose_form", input: input(view) }));
}

export const NOV16_AGENT_LOOP_OTHER_POLICY_CASES: ReplayCase[] = [
  {
    id: "nov16-other-policy-coaching-cards-keep-none",
    title: "QA's train re-run (c231, c242, c244 shapes): a Coaching card for updating clients' accounts, closing duties not done, or salon cleanliness, made with no policy, keeps no policy line and gets no policy_not_given (the Coaching form has no policy field)",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      setUp(t);
      for (const [message, name, account] of [
        ["create a coaching form for juno paxton, she told a guest updating their account isn't our job", "juno paxton", "She told a guest that updating their account information isn't our job."],
        ["make a coaching form for rowan kestrel for failure to do closing duties", "rowan kestrel", "She did not complete her closing duties."],
        ["make me a coaching form for remy calder for salon cleanliness", "remy calder", "Coaching on salon cleanliness."],
      ] as const) {
        const model = oneCard((view) => ({ template_key: "coaching", employee_name: name, person_evidence: evidenceFrom(view, message.split(",")[0]!.split(" for ")[0]!), what_happened: account }));
        t.loopModel!(model);
        const reply = await t.thread().say(message);
        const result = firstResult(model.views, "propose_form")!;
        expect(reply.formProposal?.templateKey, message).toBe("coaching");
        expect(policyOf(reply), `${message}: a policy was put on a coaching card`).toBe("");
        expect(factsOf(result).policy_not_given, `${message}: ${JSON.stringify(result)}`).toBeUndefined();
      }
    },
  },
  {
    id: "nov16-other-policy-ca-other-alone-gets-fits-headings",
    title: "A Corrective Action citing \"Other — rude to a guest\" alone, for an incident today's topic reader fits to the Standards of Conduct (\"she was rude to a guest\"), gets fits_headings, and the card made after it cites the Standards of Conduct",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      setUp(t);
      const ca = (view: LoopView, policy: string) => ({ tool: "propose_form", input: { template_key: "dpoa", employee_name: "remy calder", person_evidence: evidenceFrom(view, "ca for remy calder"), what_happened: "She was rude to a guest at the front desk on 11/12.", incident_date: "2026-11-12", policy } });
      const model = loopStandIn((view): LoopDecision => {
        const results = view.results.filter((result) => result.tool === "propose_form");
        if (results.length === 0) return ca(view, "Other — rude to a guest");
        if (results.length === 1 && factsOf(results[0]!.output).fits_headings) return ca(view, (factsOf(results[0]!.output).fits_headings as string[])[0]!);
        return { text: "Here's the Corrective Action Form for **Remy Calder**." };
      });
      t.loopModel!(model);
      const reply = await t.thread().say("ca for remy calder, she was rude to a guest at the front desk on 11/12");
      const first = firstResult(model.views, "propose_form")!;
      expect(factsOf(first).fits_headings, JSON.stringify(first)).toEqual(expect.arrayContaining(["Standards of Conduct"]));
      expect(policyOf(reply), JSON.stringify(reply.formProposal)).toMatch(/Standards of Conduct/);
    },
  },
  {
    id: "nov16-other-policy-controls-stay-other",
    title: "Controls (QA: a correct Other is never overridden): a CA for must see behaviors (Pau's ruling) and a CA for the 10-minute sanitation left undone keep \"Other — …\" with no fits_headings fact",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      setUp(t);
      for (const [message, account, policy, expected] of [
        ["can you create a ca for marnie holloway for must see behaviors, she was below the company average in PPTA and Club Close%", "She was below the company average in PPTA and Club Close%.", "Other — Must See Behaviors", /Other — Must See Behaviors/],
        ["ca for marnie holloway, she did not do the 10 minute sanitation on the beds on 11/12", "She did not do the 10-minute sanitation on the beds on 11/12.", "Other — the 10-minute sanitation", /Other — the 10-minute sanitation/],
      ] as const) {
        const model = oneCard((view) => ({ template_key: "dpoa", employee_name: "marnie holloway", person_evidence: evidenceFrom(view, message.slice(message.indexOf("marnie"), message.indexOf("marnie") + "marnie holloway".length)), what_happened: account, policy }));
        t.loopModel!(model);
        const reply = await t.thread().say(message);
        const result = firstResult(model.views, "propose_form")!;
        expect(factsOf(result).fits_headings, `${message}: a correct Other was pushed to a heading: ${JSON.stringify(result)}`).toBeUndefined();
        expect(policyOf(reply), message).toMatch(expected);
      }
    },
  },
  {
    id: "nov16-other-policy-controls-c156-c241-shapes",
    title: "Controls in the re-run's shapes (QA): c156, a written CA \"on performance\" cited Standards of Conduct, then \"the policy would be must see behaviors on woven\" keeps \"Other — Must See Behaviors\" (Pau's ruling); c241, a CA \"for not following cleaning procedures\" keeps \"Other — cleaning procedures\"; neither gets fits_headings",
    report: `${REPORT}; controls c156, c163 (must see behaviors named) and c241 (cleaning procedures)`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      setUp(t);
      // c156's shape, two turns: the performance CA, then the manager names must see behaviors.
      const thread = t.thread();
      const ca = (view: LoopView, policy: string) => ({ tool: "propose_form", input: { template_key: "dpoa", employee_name: "marnie holloway", person_evidence: evidenceFrom(view, "ca for marnie holloway", view.turns.filter((turn) => turn.role === "user").length > 1 ? 1 : 0), warning_level: "written", what_happened: "She had 24 tans and was below in PPTA, Club Close% and Spa%.", policy } });
      t.loopModel!(oneCard((view) => ca(view, "Standards of Conduct").input));
      const first = await thread.say("can you make a written ca for marnie holloway on performance, she had 24 tans and was below in PPTA, Club Close% and Spa%");
      expect(policyOf(first)).toMatch(/Standards of Conduct/);
      const named = oneCard((view) => ca(view, "Other — Must See Behaviors").input);
      t.loopModel!(named);
      const msb = await thread.say("the policy would be must see behaviors on woven");
      const msbResult = firstResult(named.views, "propose_form")!;
      expect(factsOf(msbResult).fits_headings, JSON.stringify(msbResult)).toBeUndefined();
      expect(policyOf(msb), JSON.stringify(msb.formProposal)).toMatch(/Other — Must See Behaviors/);

      // c241's shape: a CA for not following cleaning procedures stays Other.
      const cleaning = oneCard((view) => ({ template_key: "dpoa", employee_name: "remy calder", person_evidence: evidenceFrom(view, "ca for remy calder"), what_happened: "She did not follow cleaning procedures.", policy: "Other — cleaning procedures" }));
      t.loopModel!(cleaning);
      const reply = await t.thread().say("i need a ca for remy calder for not following cleaning procedures");
      const result = firstResult(cleaning.views, "propose_form")!;
      expect(factsOf(result).fits_headings, JSON.stringify(result)).toBeUndefined();
      expect(policyOf(reply), JSON.stringify(reply.formProposal)).toMatch(/Other — cleaning procedures/);
    },
  },
];
