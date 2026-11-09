import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * A SHORT CASH DRAWER IS NOT THE MODEL'S "HANDLING THEFT" (QA, round-7c live test 3a, 9 Nov 2026)
 * ============================================================================
 *
 * QA's live test on Sunny main 9f6de2a7 (SECOND_REQUEST_OWN_ACCOUNT on; the people invented and on no directory): T1
 * "create a corrective action for <P>, he was late opening the salon on 11/2", T2 "I need another corrective action for
 * <P>, his cash drawer was short $20 on 11/3". T2's card read "'theft' reads as … Standards of Conduct", cited Handling
 * Theft p.30, and the plan reviewed "the Standards of Conduct and Handling Theft". Neither turn names theft: the slot
 * model read "Handling Theft" for T2, `form-state.ts` stateForTurn kept it as this request's own, it was written in front
 * of the turn ("Policy reference: Handling Theft …") and the topic table read "theft" there. The model reading is
 * scripted as the live card shows it. MODEL_POLICY_DEFERS_TO_TOPIC_ENABLED (`ai/intent-slots.ts`). The pack's manual
 * (wording invented) also has the two Standards of Conduct lines the topics are cited by, on printed page 13.
 */
const CORWIN: DirectoryRow = {
  id: "e-corwin-ashgrove",
  firstName: "Corwin",
  lastName: "Ashgrove",
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Tanning Consultant",
};
/** Invented wording around the manual's two listed lines, inside the Standards of Conduct (before Disciplinary Action). */
const CONDUCT_LINES = {
  chunkIndex: 39.5,
  chunkId: "jba-39-5",
  locator: "Page 13 — Standards of Conduct",
  page: 14,
  content: "o Theft, inappropriate removal or possession of company or customer property\no Register / Bank shortages that are not explained",
  section: "Standards of Conduct",
  printedPage: 13,
  sections: [],
};
const T1 = "create a corrective action for Corwin Ashgrove, he was late opening the salon on 11/2";
const FIX = ["MODEL_POLICY_DEFERS_TO_TOPIC_ENABLED"];
const REPORT = "QA, round-7c live test 3a (9 Nov 2026): \"'theft' reads as … Standards of Conduct\", Handling Theft p.30, for a short cash drawer";
const THEFT_READ = { employee: "Corwin Ashgrove", formType: "Corrective Action Form", formTurn: true, policyHeading: "Handling Theft" };

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-09T05:00:00Z"));
  t.directory([...STAFF, CORWIN]);
  t.as("salon_director", KEARNEY);
  t.manualAlsoHas?.([CONDUCT_LINES]);
  return t.thread();
}

const policyLine = (content: string) => /\*\*Policy:\*\*[^\n]*/.exec(content)?.[0] ?? "";

function shortage(said: string, phrase: RegExp) {
  return async (t: ReplayContext) => {
    const thread = start(t);
    await thread.say(T1);
    t.slotsRead(THEFT_READ);
    const reply = await thread.say(said);
    expect(thread.proposal, `no card for Corwin Ashgrove:\n${reply.content}`).toMatchObject({ templateKey: "dpoa", employeeName: "Corwin Ashgrove" });
    expect(policyLine(reply.content), `the card's Policy line:\n${reply.content}`).toMatch(new RegExp(`${phrase.source}[^\\n]*\\*\\*Standards of Conduct\\*\\* \\(page 13\\)`));
    expect(reply.content, `the card reads theft:\n${reply.content}`).not.toMatch(/theft/i);
  };
}

export const NOV9_MODEL_POLICY_DEFERS_TO_TOPIC_CASES: ReplayCase[] = [
  {
    id: "nov9-model-policy-defers-3a",
    title: "3a: after a late-opening CA, \"I need another corrective action for <P>, his cash drawer was short $20 on 11/3\" (model: Handling Theft): the shortage, never theft",
    report: REPORT,
    // Changed on purpose (9 Nov 2026): fixed in production by MODEL_POLICY_DEFERS_TO_TOPIC_ENABLED, QA round 9, 9 Nov 2026; it now holds with production's flags.
    status: "fixed",
    fixFlags: FIX,
    run: shortage("I need another corrective action for Corwin Ashgrove, his cash drawer was short $20 on 11/3", /"cash drawer was short"/),
  },
  {
    id: "nov9-model-policy-defers-3a-for",
    title: "\"I need another corrective action for <P> for his cash drawer being short $20 on 11/3\" (model: Handling Theft): the shortage",
    report: REPORT,
    // Changed on purpose (9 Nov 2026): fixed in production by MODEL_POLICY_DEFERS_TO_TOPIC_ENABLED, QA round 9, 9 Nov 2026; it now holds with production's flags.
    status: "fixed",
    fixFlags: FIX,
    async run(t) {
      // As its own request: after T1 this wording is read as T1's request carried on (Late Opening), a separate item.
      const thread = start(t);
      t.slotsRead(THEFT_READ);
      const reply = await thread.say("I need another corrective action for Corwin Ashgrove for his cash drawer being short $20 on 11/3");
      expect(policyLine(reply.content), `the card's Policy line:\n${reply.content}`).toMatch(/"cash drawer being short"[^\n]*\*\*Standards of Conduct\*\* \(page 13\)/);
      expect(reply.content, `the card reads theft:\n${reply.content}`).not.toMatch(/theft/i);
    },
  },
  {
    id: "nov9-model-policy-defers-3c",
    title: "3c: \"create a corrective action for <P>, his cash drawer was short $20 on 11/3\" (model: Handling Theft): the shortage",
    report: REPORT,
    // Changed on purpose (9 Nov 2026): fixed in production by MODEL_POLICY_DEFERS_TO_TOPIC_ENABLED, QA round 9, 9 Nov 2026; it now holds with production's flags.
    status: "fixed",
    fixFlags: FIX,
    async run(t) {
      const thread = start(t);
      t.slotsRead(THEFT_READ);
      const reply = await thread.say("create a corrective action for Corwin Ashgrove, his cash drawer was short $20 on 11/3");
      expect(policyLine(reply.content), `the card's Policy line:\n${reply.content}`).toMatch(/"cash drawer was short"[^\n]*\*\*Standards of Conduct\*\* \(page 13\)/);
      expect(reply.content, `the card reads theft:\n${reply.content}`).not.toMatch(/theft/i);
    },
  },
  {
    id: "nov9-model-policy-defers-took-money",
    title: "negative: \"… she took $20 from the register on 11/3\" (model: Handling Theft): theft stays",
    report: `${REPORT} (the condition: the model's heading stands where the words name no incident the code reads)`,
    status: "fixed",
    fixFlags: FIX,
    async run(t) {
      const thread = start(t);
      t.slotsRead(THEFT_READ);
      const reply = await thread.say("create a corrective action for Corwin Ashgrove, she took $20 from the register on 11/3");
      expect(reply.content, `the theft reading is lost:\n${reply.content}`).toMatch(/Handling Theft/);
    },
  },
  {
    id: "nov9-another-for-reason-after-late-opening",
    title: "after a late-opening CA, \"I need another corrective action for <P> for his cash drawer being short $20 on 11/3\": its own request, never the late opening carried on",
    report: `${REPORT} (an untested variant found while tracing: the live 3b, "now make a separate CA for <P> for …", read correctly)`,
    // Open on purpose (QA, 9 Nov 2026: record it, don't fix it here): "another … for <reason>" is not read as a new
    // request after T1, so T1's Late Opening is carried onto the cash request ("Late Opening — read from this request").
    // Changed on purpose (9 Nov 2026): fixed in production by ANOTHER_REQUEST_LEAD_ENABLED, QA round 10, 9 Nov 2026; it now holds with production's flags.
    status: "fixed",
    // No fix flag yet: open with production's flags only.
    async run(t) {
      const thread = start(t);
      await thread.say(T1);
      const reply = await thread.say("I need another corrective action for Corwin Ashgrove for his cash drawer being short $20 on 11/3");
      expect(policyLine(reply.content), `the card carries the late opening:\n${reply.content}`).not.toMatch(/Late Opening/);
      expect(policyLine(reply.content), `the card's Policy line:\n${reply.content}`).toMatch(/\*\*Standards of Conduct\*\* \(page 13\)/);
    },
  },
];
