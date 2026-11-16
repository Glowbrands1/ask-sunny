import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, headingWith, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * THE POLICY FITS WHAT HAPPENED: DRESS CODE, AND MSB ONLY WHEN SAID (QA, the 266 audit by Runner 2, train 4, main 6d0b4ab1)
 * ============================================================================
 *
 * 1. c261 and c263: a coat, or the wrong top, worn during a shift ("out of dresscode") was cited as the Standards of
 *    Conduct. The rules book says a coat or the wrong top during a shift is dress code (All Locations Dress Code p.15).
 *    General rule: when the manager's offense words name dress code, or an item of clothing worn on shift, propose_form
 *    refuses another heading and answers with the manual's own Dress Code headings.
 * 2. c207: "a performace ca for an employee who did not meet their numbers for the month of october … verbal" was cited
 *    "Other — Must See Behaviors", though the manager never said MSB. General rule: "Other — Must See Behaviors" only when
 *    the request's words say MSB or must see behaviors (Pau's ruling, 16 Nov 2026); under-performance is the Standards of
 *    Conduct.
 * QA's wording, word for word; invented names only: Wren Ashdale (roster). c207's "an employee … verbal" is its name and
 * level turn, as the manager answered "Who is this for?".
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA (16 Nov 2026): the 266 audit by Runner 2, train 4 on main 6d0b4ab1 — c261/c263 dress code cited as Standards of Conduct; c207 carded Other — Must See Behaviors with no MSB said";
const WREN: DirectoryRow = { id: "e-wren-ashdale", firstName: "Wren", lastName: "Ashdale", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };

/** The manual's dress-code sections as the production manual prints them (page 15); the wording invented. */
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

const C261 = "Create a CA for Wren Ashdale being out of dresscode. Wren Ashdale was wearing her coat during her shift on 11/13 after previously being asked to take it off multiple times";
const C263_T1 = "CA written warning for Wren Ashdale for being out of dresscode on 11/13. Wren Ashdale wore her coat during the shift";
const C263_T2 = "having a black crewneck on during her shift, not a zip up jacket";
const C207 = "a performace ca for an employee who did not meet their numbers for the month of october";

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-15T22:40:00Z"));
  t.directory([...STAFF, WREN]);
  t.as("salon_director", KEARNEY);
  t.manualAlsoHas?.([DRESS_CODE_CHUNK]);
}
const userTurns = (view: LoopView) => view.turns.filter((turn) => turn.role === "user");
type Out = { ask_exactly?: string; reason_code?: string; error?: string; fits_headings?: string[]; card?: { policy?: string | null } } | null;
const policyOf = (thread: { proposal?: unknown }) => (thread.proposal as { policyLine?: string | null } | undefined)?.policyLine ?? "";
const proposeResults = (model: { views: LoopView[] }) => model.views.flatMap((view) => view.results).filter((result) => result.tool === "propose_form").map((result) => result.output as Out);

/**
 * The live model: the card cited under `first` (the audit's heading), and after a refusal the heading the refusal fits.
 * `accountFor` is the account it writes for the turn's words.
 */
const liveModel = (first: (view: LoopView) => string | null, extra: (view: LoopView) => Record<string, unknown> = () => ({})) => loopStandIn((view): LoopDecision => {
  const tries = view.results.filter((result) => result.tool === "propose_form");
  const last = tries.at(-1)?.output as Out | undefined;
  if (last?.card) return { text: `Here's the Corrective Action Form for **Wren Ashdale**.\n\n**Policy:** ${last.card.policy ?? ""}` };
  if (last?.ask_exactly) return { text: last.ask_exactly };
  if (tries.length >= 3) return { text: last?.error ?? "" };
  const policy = last?.fits_headings?.[0] ?? first(view);
  return {
    tool: "propose_form",
    input: { template_key: "dpoa", employee_id: WREN.id, ...(policy ? { policy } : {}), request_evidence: [evidenceFrom(view, undefined, 0)], ...extra(view) },
  };
});
const conduct = (view: LoopView) => headingWith(view, /standards of conduct/i);

export const NOV16_AGENT_LOOP_POLICY_DRESS_CODE_MSB_CASES: ReplayCase[] = [
  {
    id: "nov16-policy-c261-coat-on-shift-is-dress-code",
    title: "c261: \"Create a CA for <P> being out of dresscode. <P> was wearing her coat during her shift on 11/13 …\" cited as the Standards of Conduct is refused; the card cites the manual's Dress Code heading",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      const model = liveModel(conduct, () => ({ what_happened: "Wren Ashdale was out of dress code: she wore her coat during her shift on 11/13 after being asked to take it off multiple times.", incident_date: "2026-11-13" }));
      t.loopModel!(model);
      const thread = t.thread();
      await thread.say(C261);
      const first = proposeResults(model)[0];
      expect(first?.reason_code, `the Standards of Conduct was taken:\n${JSON.stringify(first)}`).toBe("dress_code_heading");
      expect(first?.fits_headings).toEqual(["Dress Code for The Company", "All Locations Dress Code"]);
      expect(policyOf(thread), "the card does not cite Dress Code").toMatch(/Dress Code/);
      expect(policyOf(thread)).not.toMatch(/Standards of Conduct/);
    },
  },
  {
    id: "nov16-policy-c263-coat-then-crewneck-is-dress-code",
    title: "c263: \"CA written warning for <P> for being out of dresscode on 11/13. <P> wore her coat during the shift\", then \"having a black crewneck on during her shift, not a zip up jacket\": both cards cite Dress Code, never the Standards of Conduct",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      const thread = t.thread();
      const firstModel = liveModel(conduct, () => ({ what_happened: "Wren Ashdale was out of dress code on 11/13: she wore her coat during the shift.", incident_date: "2026-11-13" }));
      t.loopModel!(firstModel);
      await thread.say(C263_T1);
      expect(proposeResults(firstModel)[0]?.reason_code).toBe("dress_code_heading");
      expect(policyOf(thread), "turn 1 does not cite Dress Code").toMatch(/Dress Code/);
      const secondModel = liveModel(conduct, (view) => ({ what_happened: "Wren Ashdale was out of dress code on 11/13: she wore her coat during the shift, and had a black crewneck on during her shift, not a zip up jacket.", incident_date: "2026-11-13", request_evidence: [evidenceFrom(view, undefined, 1), evidenceFrom(view, undefined, 0)] }));
      t.loopModel!(secondModel);
      await thread.say(C263_T2);
      expect(proposeResults(secondModel)[0]?.reason_code, `turn 2 kept the Standards of Conduct:\n${JSON.stringify(proposeResults(secondModel)[0])}`).toBe("dress_code_heading");
      expect(policyOf(thread), "turn 2 does not cite Dress Code").toMatch(/Dress Code/);
    },
  },
  {
    id: "nov16-policy-crewneck-alone-is-dress-code",
    title: "A top worn on shift with no \"dress code\" said (\"… having a black crewneck on during her shift, not a zip up jacket\") is still dress code: the Standards of Conduct is refused",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      const model = liveModel(conduct, () => ({ what_happened: "Wren Ashdale had a black crewneck on during her shift, not a zip up jacket, on 11/13.", incident_date: "2026-11-13" }));
      t.loopModel!(model);
      const thread = t.thread();
      await thread.say(`Write me a CA form for Wren Ashdale ${C263_T2} on 11/13`);
      expect(proposeResults(model)[0]?.reason_code).toBe("dress_code_heading");
      expect(policyOf(thread)).toMatch(/Dress Code/);
    },
  },
  {
    id: "nov16-policy-dress-code-control-manager-names-conduct",
    title: "Control: the manager names the Standards of Conduct themselves (\"… out of dresscode on 11/13, use the standards of conduct policy\"): their policy stays",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      const model = liveModel(conduct, () => ({ what_happened: "Wren Ashdale was out of dress code on 11/13.", incident_date: "2026-11-13" }));
      t.loopModel!(model);
      const thread = t.thread();
      await thread.say("CA for Wren Ashdale for being out of dresscode on 11/13, use the standards of conduct policy");
      expect(proposeResults(model)[0]?.reason_code ?? null).toBeNull();
      expect(policyOf(thread)).toMatch(/^Standards of Conduct/);
    },
  },
  {
    id: "nov16-policy-dress-code-control-late-not-attire",
    title: "Control: lateness with no clothing in it (\"CA for <P>, she was late for her shift on 11/13\") is not refused as dress code",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      const model = liveModel((view) => headingWith(view, /^attendance/i), () => ({ what_happened: "Wren Ashdale was late for her shift on 11/13.", incident_date: "2026-11-13" }));
      t.loopModel!(model);
      const thread = t.thread();
      await thread.say("CA for Wren Ashdale, she was late for her shift on 11/13");
      expect(proposeResults(model)[0]?.reason_code ?? null).toBeNull();
      expect(policyOf(thread)).toMatch(/^Attendance/);
    },
  },
  {
    id: "nov16-policy-c207-numbers-not-msb",
    title: "c207: \"a performace ca for an employee who did not meet their numbers for the month of october\" … \"Wren Ashdale, verbal\": \"Other — Must See Behaviors\" is refused (no MSB said); the card cites the Standards of Conduct",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      const thread = t.thread();
      t.loopModel!(loopStandIn((): LoopDecision => ({ text: "Who is this Corrective Action Form for?" })));
      await thread.say(C207);
      const model = liveModel(() => "Other — Must See Behaviors", (view) => ({
        what_happened: "Wren Ashdale did not meet their numbers for the month of October.",
        warning_level: "verbal", level_evidence: evidenceFrom(view, "verbal"),
        request_evidence: [evidenceFrom(view, undefined, 1), evidenceFrom(view, undefined, 0)],
      }));
      t.loopModel!(model);
      await thread.say("Wren Ashdale, verbal");
      const first = proposeResults(model)[0];
      expect(first?.reason_code, `Other — Must See Behaviors was taken with no MSB said:\n${JSON.stringify(first)}`).toBe("msb_not_said");
      expect(policyOf(thread), "the card cites Must See Behaviors").not.toMatch(/Must See/i);
      expect(policyOf(thread)).toMatch(/^Standards of Conduct/);
      expect(userTurns(model.views.at(-1)!).length).toBe(2);
    },
  },
  {
    id: "nov16-policy-msb-control-msb-said",
    title: "Control: \"verbal ca for Wren Ashdale for MSB, she did not meet her numbers in october\" keeps \"Other — Must See Behaviors\" (Pau's ruling)",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      const model = liveModel(() => "Other — Must See Behaviors", () => ({ what_happened: "Wren Ashdale did not meet her numbers in October." }));
      t.loopModel!(model);
      const thread = t.thread();
      await thread.say("verbal ca for Wren Ashdale for MSB, she did not meet her numbers in october");
      expect(proposeResults(model)[0]?.reason_code ?? null).toBeNull();
      expect(policyOf(thread)).toBe("Other — Must See Behaviors");
      expect(lastResult(model.views.at(-1)!, "propose_form")).not.toBeNull();
    },
  },
];
