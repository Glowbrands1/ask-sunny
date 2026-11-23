import { expect, vi } from "vitest";

import type { DirectoryRow, ReplayCase, ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * AN EXIT CARD'S REPLY READS BACK ONLY WHAT CREATE SAVES (port of Ask Bubbles #1034: its QA's round 2, 22 Nov 2026, U22)
 * ============================================================================
 *
 * Found in Ask Bubbles, the same code in Sunny. The manager's turns, word for word (this app's job title; a global login; the people invented, the former employee on no directory
 * but this case's; the address QA's test one): T1 "create exit for <P17>. <P17>'s last day worked was TBD. On 11-14-26
 * Salon Director, <P18>, messaged <P17> via woven regarding her hours worked on 11-13-26. <P17> messaged back stating she
 * did not work 11-13-26 and she was quitting effective immediately.", T2 "address: 123 Test St, Lees Summit, MO. 00000".
 * The T2 reply read back "**Date that notice was given:** 11/14/2026" (never stated; not saved) and "**Reason for
 * Resignation:** <the account>" (saved to Additional Details).
 *
 * Mechanism (`agent-loop/exit-read-back.ts`; QA, with Pau's "as you said only for manager facts"): the exit card's result
 * lists the lines Create saves (reads_back); a reply line under one of the exit form's own labels that is not one of them
 * goes back once, and is left out if it is still there.
 */

const REPORT = "Ask Bubbles' round 2 (22 Nov 2026, U22; port of #1034): the exit reply read back a notice date nobody stated and labelled the account by a field it is not saved to";
const GLOBAL = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };
const P17: DirectoryRow = { id: "e-perpetua-lindqvist", firstName: "Perpetua", lastName: "Lindqvist", preferredFirstName: null, employmentStatus: "terminated", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };
const T1 =
  "create exit for Perpetua Lindqvist. Perpetua Lindqvist's last day worked was TBD. On 11-14-26 Salon Director, Corwin Ashdown, messaged Perpetua Lindqvist via woven regarding her hours worked on 11-13-26. Perpetua Lindqvist messaged back stating she did not work 11-13-26 and she was quitting effective immediately.";
const T2 = "address: 123 Test St, Lees Summit, MO. 00000";
const ACCOUNT =
  "On 11/14/26, Salon Director Corwin Ashdown messaged Perpetua Lindqvist via Woven regarding Perpetua Lindqvist's hours worked on 11/13/26. Perpetua Lindqvist messaged back stating Perpetua Lindqvist did not work 11/13/26 and was quitting effective immediately.";

/* Stand-ins replay the live model's replies: they prove the loop's checks, so they do not run against the live model. */
function start(t: ReplayContext): boolean {
  if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return false;
  vi.setSystemTime(new Date("2026-11-21T18:00:00Z"));
  t.directory([P17]);
  t.as("salon_director", GLOBAL);
  return true;
}

type Card = { card?: { observation?: string | null; reads_back?: string[] } } | null;
const said = (view: LoopView) => view.turns.filter((turn) => turn.role === "user" && (turn.messageIds?.length ?? 0) > 0).at(-1)?.text ?? "";
const handedBack = (view: LoopView) => view.turns.some((turn) => /^\[app check\]/.test(turn.text) && /exit field/.test(turn.text));

/**
 * The live model's reply: the account labelled "Reason for Resignation" and a notice date; `fixes`: the second reply reads
 * back `reads_back`. `oneLine` (QA, 23 Nov 2026: the case failed live): the opening and the notice date on one line, after
 * the former-employee line, as the live reply wrote them.
 */
const live = (fixes: boolean, oneLine = false) =>
  loopStandIn((view): LoopDecision => {
    const result = lastResult(view, "propose_form") as Card;
    if (!result) {
      return {
        tool: "propose_form",
        input: {
          template_key: "stc-exit",
          employee_name: "Perpetua Lindqvist",
          exit_type: "resignation",
          exit_evidence: { ...evidenceFrom(view, "create exit for Perpetua Lindqvist", said(view) === T1 ? 0 : 1), kind: "asks_for_exit_form" },
          what_happened: ACCOUNT,
          person_evidence: evidenceFrom(view, "Perpetua Lindqvist", said(view) === T1 ? 0 : 1),
        },
      };
    }
    const intro = "Here's the Resignation/Exit Form for **Perpetua Lindqvist**.";
    if (handedBack(view) && fixes) return { text: [intro, ...(result.card?.reads_back ?? [])].join("\n\n") };
    if (oneLine) return { text: ["**Perpetua Lindqvist** shows as no longer active in Woven; I've used the name as you typed it.", `${intro} **Date that notice was given:** 11/14/2026`, `**Reason for Resignation:** ${result.card?.observation ?? ""}`].join("\n\n") };
    return { text: [intro, "**Date that notice was given:** 11/14/2026", `**Reason for Resignation:** ${result.card?.observation ?? ""}`, "Filed as: Immediate Voluntary Resignation."].join("\n\n") };
  });

export const NOV22_AGENT_LOOP_EXIT_READS_BACK_SAVED_CASES: ReplayCase[] = [
  {
    id: "nov22-u22-exit-reply-reads-back-only-saved",
    title: "U22: T2 \"address: 123 Test St, …\" — the reply's \"Date that notice was given: 11/14/2026\" (never stated) and \"Reason for Resignation: <account>\" go back once; the reply then reads the account back as Additional Details, with no notice date",
    report: REPORT,
    status: "fixed",
    fixFlags: ["AGENT_LOOP_ENABLED"],
    async run(t) {
      if (!start(t)) return;
      const thread = t.thread();
      const model = live(true);
      t.loopModel!(model);
      await thread.say(T1);
      const reply = await thread.say(T2);
      expect(model.views.some(handedBack), "the unsaved lines were never handed back").toBe(true);
      expect(reply.content, "a notice date nobody stated was read back").not.toMatch(/Date that notice was given/);
      expect(reply.content, "the account is labelled by a field it is not saved to").not.toMatch(/Reason for Resignation/);
      expect(reply.content).toMatch(/\*\*Additional Details:\*\* On 11\/14\/26/);
    },
  },
  {
    id: "nov22-u22-exit-unsaved-lines-twice-left-out",
    title: "U22, the model repeats the unsaved lines after the hand-back: they are left out of the reply (the card shows what is saved), never offered as a change",
    report: REPORT,
    status: "fixed",
    fixFlags: ["AGENT_LOOP_ENABLED"],
    async run(t) {
      if (!start(t)) return;
      const thread = t.thread();
      t.loopModel!(live(false));
      await thread.say(T1);
      const reply = await thread.say(T2);
      expect(reply.content).not.toMatch(/Date that notice was given|Reason for Resignation/);
      expect(reply.content, "the unsaved line was offered as a change").not.toMatch(/isn't on the card yet/);
      /*
       * CHANGED ON PURPOSE (port of Ask Bubbles #1098; its QA's live check): a live reply opened "Here is the
       * **Resignation/Exit Form** for **<P>**", the right opening with the form's name in bold. The check still wants the
       * form's name and then the person in bold; the form's name may be bold too.
       */
      expect(reply.content).toMatch(/(?:\*\*)?Resignation\/Exit Form(?:\*\*)? for \*\*Perpetua/);
    },
  },
  {
    id: "nov23-u22-exit-unsaved-line-on-opening-line-keeps-opening",
    title: "U22 (port of Ask Bubbles #1098): the reply writes \"Here's the Resignation/Exit Form for **<P>**. **Date that notice was given:** 11/14/2026\" on one line, twice; only the unsaved line leaves, and the reply still names the form",
    report: "Port of Ask Bubbles #1098 (its QA, 23 Nov 2026): the exit reply opened on \"<P> shows as no longer active…\" instead of \"Resignation/Exit Form for <P>\"",
    status: "fixed",
    fixFlags: ["AGENT_LOOP_ENABLED"],
    async run(t) {
      if (!start(t)) return;
      const thread = t.thread();
      t.loopModel!(live(false, true));
      await thread.say(T1);
      const reply = await thread.say(T2);
      expect(reply.content).not.toMatch(/Date that notice was given|Reason for Resignation/);
      expect(reply.content, "the opening left with the unsaved line").toMatch(/Resignation\/Exit Form for \*\*Perpetua/);
    },
  },
  {
    id: "nov23-u22-card-reply-with-no-opening-gets-the-cards",
    title: "U22 (port of Ask Bubbles #1098, its QA's RUN A): T2's ready exit card came with a reply that named no form; the reply opens with the card's own \"Here's the Resignation/Exit Form for **<P>**.\"",
    report: "Port of Ask Bubbles #1098 (its QA, 23 Nov 2026): a ready exit card's reply named no form; the model wrote no opening",
    status: "fixed",
    fixFlags: ["AGENT_LOOP_ENABLED"],
    async run(t) {
      if (!start(t)) return;
      const thread = t.thread();
      const runA = "**Perpetua Lindqvist** shows as no longer active in Woven; I've used the name as you typed it.\n\n**How Employee Resigned:** Woven message\n\nLast day worked isn't set; tell me the date (you listed it as TBD).";
      t.loopModel!(loopStandIn((view): LoopDecision => {
        if (lastResult(view, "propose_form")) return { text: said(view) === T2 ? runA : "Here's the Resignation/Exit Form for **Perpetua**." };
        return { tool: "propose_form", input: { template_key: "stc-exit", employee_name: "Perpetua Lindqvist", exit_type: "resignation", exit_evidence: { ...evidenceFrom(view, "create exit for Perpetua Lindqvist", said(view) === T1 ? 0 : 1), kind: "asks_for_exit_form" }, what_happened: ACCOUNT, person_evidence: evidenceFrom(view, "Perpetua Lindqvist", said(view) === T1 ? 0 : 1) } };
      }));
      await thread.say(T1);
      const reply = await thread.say(T2);
      expect(thread.proposal?.templateKey, "T2 made no exit card (the case proves nothing)").toBe("stc-exit");
      expect(reply.content, "the card reply names no form").toMatch(/^Here's the Resignation\/Exit Form for \*\*Perpetua/);
      expect(reply.content).toMatch(/How Employee Resigned/);
    },
  },
];
