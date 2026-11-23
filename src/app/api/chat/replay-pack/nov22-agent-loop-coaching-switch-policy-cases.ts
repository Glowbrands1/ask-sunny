import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, headingWith, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * CA → COACHING: THE COACHING CARD CITES THE HEADING ITS OWN ACCOUNT FITS (the 266-chat run's 203; Ask Bubbles' R21 / f136; QA's step 3 item 9, 22 Nov 2026)
 * ============================================================================
 *
 * Sunny's 203, word for word (the person invented, the pack's roster): "create corrective action for for <P> for Late
 * Opening from the policy manual. It is a verbal warning", later "Create a Coaching Form from this conversation." The
 * coaching card read "No policy is on the card — the Late Opening heading …". Ask Bubbles' R21 (the same mechanism, its
 * own content; the person invented): T1 "I have an employee <P> at our <store> location who has been out of dress code
 * three shifts. I verbally coached her on the second offense and she still is out of dress code", T2 "Create a Coaching
 * Form from this conversation." (the policy line dropped: "tell me if you'd like a different policy cited, or none"),
 * T3 "Yes" (the card then cited "Other — Dress Code"), and the saved Coaching Form ticked no coaching topic.
 *
 * QA's ruling (22 Nov 2026), keeping the 16 Nov ruling (a non-CA card never copies the CA's heading):
 * (3) the heading the existing topic reader and the manual's headings fit THIS card's own account to is cited;
 * (1) a bare "Yes" to a question that offered no yes / no never sets a policy;
 * (2) a card's "Other — <topic>" reaches the saved form, its topic ticked.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "The 266-chat run (case 203) and Ask Bubbles' R21 (f136), 22 Nov 2026: the CA → Coaching switch dropped the policy; a bare \"Yes\" then set \"Other — Dress Code\"; the saved Coaching Form ticked no topic";
const DRESS_T1 = "I have an employee Remy Calder at our Kearney location who has been out of dress code three shifts. I verbally coached her on the second offense and she still is out of dress code";
const LATE_T1 = "create corrective action for for Remy Calder for Late Opening from the policy manual. It is a verbal warning";
const SWITCH = "Create a Coaching Form from this conversation.";

type Out = { card?: { form?: string; policy?: string | null }; not_on_card?: { field: string; reason_code: string }[] } | null;

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-22T18:00:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
}

const said = (view: LoopView) => view.turns.filter((turn) => turn.role === "user").at(-1)?.text ?? "";

/**
 * The live model: the CA with its heading; on the switch, the coaching card with the CA's own heading (as Sunny's model
 * passes it, the 16 Nov ruling then leaves it off), the same account.
 */
function switchModel(account: string, heading: RegExp) {
  return loopStandIn((view): LoopDecision => {
    const out = lastResult(view, "propose_form") as Out | null;
    if (out?.card) return { text: `Here's the ${out.card.form}.` };
    const switching = said(view) === SWITCH;
    return {
      tool: "propose_form",
      input: {
        template_key: switching ? "coaching" : "dpoa", employee_id: "e-2", person_evidence: evidenceFrom(view, "Remy Calder"),
        what_happened: account, policy: headingWith(view, heading),
        ...(switching ? { form_change_evidence: evidenceFrom(view, SWITCH) } : {}),
      },
    };
  });
}

/* The manual's dress-code section, as the pack's other dress-code cases add it (the pack's manual has none by default). */
const DRESS_CODE_CHUNK = {
  chunkIndex: 60,
  chunkId: "jba-60",
  locator: "Page 15 — Dress Code for The Company",
  page: 16,
  content: "Dress Code for The Company\nEmployees keep a neat, professional appearance.\n\nAll Locations Dress Code:\nName tags are worn at all times while working.",
  section: "Dress Code for The Company",
  printedPage: 15,
  sections: [
    { heading: "Dress Code for The Company", page: 15 },
    { heading: "All Locations Dress Code", page: 15 },
  ],
};

const policyOf = (thread: { proposal?: unknown }) => (thread.proposal as { policyLine?: string | null } | undefined)?.policyLine ?? "";

export const NOV22_AGENT_LOOP_COACHING_SWITCH_POLICY_CASES: ReplayCase[] = [
  {
    id: "nov22-f038-203-switch-keeps-own-heading-dress",
    title: "R21 (Sunny's shape): a dress-code CA, then \"Create a Coaching Form from this conversation.\": the coaching card cites the Dress Code heading its own account fits",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
      start(t);
      t.manualAlsoHas?.([DRESS_CODE_CHUNK]);
      t.loopModel!(switchModel("Remy has been out of dress code for three shifts. Remy was verbally coached on the second offense and is still out of dress code.", /dress/i));
      const thread = t.thread();
      await thread.say(DRESS_T1);
      expect(policyOf(thread), "the CA does not cite the dress code (the case proves nothing)").toMatch(/dress/i);
      await thread.say(SWITCH);
      expect(thread.proposal?.templateKey, "no coaching card (the case proves nothing)").toBe("coaching");
      expect(policyOf(thread), "the coaching card dropped the heading its own account fits").toMatch(/dress/i);
    },
  },
  {
    id: "nov22-f038-203-switch-keeps-own-heading-late-opening",
    title: "203: \"… for Late Opening from the policy manual …\", then \"Create a Coaching Form from this conversation.\": the coaching card's account \"Late Opening.\" cites Late Opening",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
      start(t);
      t.loopModel!(switchModel("Late Opening.", /late open/i));
      const thread = t.thread();
      await thread.say(LATE_T1);
      expect(policyOf(thread), "the CA does not cite Late Opening (the case proves nothing)").toMatch(/late open/i);
      await thread.say(SWITCH);
      expect(thread.proposal?.templateKey, "no coaching card (the case proves nothing)").toBe("coaching");
      expect(policyOf(thread), "the coaching card dropped the heading its own account fits").toMatch(/late open/i);
    },
  },
  {
    id: "nov22-f038-r21-coaching-other-topic-saved",
    title: "R21 (2): a coaching card citing \"Other — Dress Code\": the saved Coaching Form ticks Other and its topic is Dress Code",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
      start(t);
      t.loopModel!(loopStandIn((view): LoopDecision => (lastResult(view, "propose_form")
        ? { text: "Here's the Coaching Form for **Remy**." }
        : { tool: "propose_form", input: { template_key: "coaching", employee_id: "e-2", person_evidence: evidenceFrom(view, "Remy Calder"), what_happened: "Remy has been out of dress code for three shifts.", policy: "Other — Dress Code" } })));
      // The drafting model at Create ticks no coaching topic (R21's saved form: coaching_topics {}).
      t.draftWrites({ coaching_details: "Observed:\nRemy has been out of dress code for three shifts." }, {});
      const thread = t.thread();
      await thread.say("create a coaching form for Remy Calder, out of dress code three shifts");
      expect(policyOf(thread), "the card does not cite Other — Dress Code (the case proves nothing)").toMatch(/^Other — Dress Code/);
      const id = await thread.create();
      const saved = JSON.stringify({ values: t.values(id), checked: t.checked(id) });
      expect(t.checked(id).coaching_topics ?? [], `the saved Coaching Form ticks no Other:\n${saved}`).toContain("other");
      expect(t.values(id).other_topic ?? "", `the saved Other topic is not the card's:\n${saved}`).toBe("Dress Code");
    },
  },
  {
    id: "nov22-f038-r21-bare-yes-sets-no-policy",
    title: "R21 (1): \"tell me if you'd like a different policy cited, or none\", then \"Yes\": the card's policy is not changed to \"Other — Dress Code\"",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
      start(t);
      const account = "Remy has been out of dress code for three shifts. Remy was verbally coached on the second offense and is still out of dress code.";
      const model = loopStandIn((view): LoopDecision => {
        const out = lastResult(view, "propose_form") as (Out & { reason_code?: string }) | null;
        if (out?.reason_code) return { text: "Which policy do you want cited on the card?" };
        if (out?.card) return { text: said(view) === SWITCH ? "Here's the Coaching Form for **Remy**. Tell me if you'd like a different policy cited, or none." : "Here's the card." };
        const base = { employee_id: "e-2", person_evidence: evidenceFrom(view, "Remy Calder"), what_happened: account };
        if (said(view) === SWITCH) return { tool: "propose_form", input: { ...base, template_key: "coaching", form_change_evidence: evidenceFrom(view, SWITCH) } };
        // R21's T2: the live model gave the coaching card no policy and asked an either/or question; T3: it read the bare "Yes" as a policy.
        if (said(view) === "Yes") return { tool: "propose_form", input: { ...base, template_key: "coaching", policy: "Other — Dress Code" } };
        return { tool: "propose_form", input: { ...base, template_key: "dpoa", policy: headingWith(view, /dress/i) } };
      });
      t.manualAlsoHas?.([DRESS_CODE_CHUNK]);
      t.loopModel!(model);
      const thread = t.thread();
      await thread.say(DRESS_T1);
      await thread.say(SWITCH);
      expect(thread.proposal?.templateKey, "no coaching card (the case proves nothing)").toBe("coaching");
      const before = policyOf(thread);
      await thread.say("Yes");
      const refused = model.views.flatMap((view) => view.results.filter((result) => result.tool === "propose_form")).map((result) => (result.output as { reason_code?: string }).reason_code).filter(Boolean);
      expect(policyOf(thread), "a bare Yes set the card's policy").toBe(before);
      expect(refused, "the bare Yes was not handed back").toContain("yes_sets_no_policy");
    },
  },
];
