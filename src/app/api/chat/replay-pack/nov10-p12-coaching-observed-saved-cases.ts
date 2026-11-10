import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";
import { play } from "./nov7-step-b-refusals-cases";
import { STEP_B_REFUSAL_SCENARIOS, SUN_MEETING, patch, type RefusalScenario } from "./nov7-step-b-refusals-scenarios";

/**
 * ============================================================================
 * P12 (QA, 10 Nov 2026; live in both apps): THE SAVED COACHING DETAILS HAVE AN "Observed:" WITH THE ACCOUNT UNDER IT
 * ============================================================================
 *
 * "make me a coaching form for <name> not hitting October numbers" → Create: the SAVED Details of Coaching had no
 * "Observed:" heading, or an empty one. The manager's wording is verbatim; the person is invented (Brisa Talvenor).
 * The drafting model is scripted three ways — writing nothing (the never-blank fallback), Details without the heading,
 * and an empty heading — because the live model was seen doing the last two; the assertion is on what is SAVED.
 */

type T = ReplayContext;

const BRISA: DirectoryRow = {
  id: "e-brisa-talvenor",
  firstName: "Brisa",
  lastName: "Talvenor",
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Tanning Consultant",
};

/** The invented person of this file (a function: the registry reads exported arrays as cases). */
export function p12People(): readonly DirectoryRow[] {
  return [BRISA];
}

const SAID = "make me a coaching form for Brisa Talvenor not hitting October numbers";
const REPORT = `QA, 10 Nov 2026 (P12, live in both apps): "${SAID.replace("Brisa Talvenor", "<name>")}" — the saved Details have no "Observed:" (or an empty one)`;
const FIX = "COACHING_OBSERVED_SAVED_ENABLED";

/** The saved Details: an "Observed:" heading with the account (October numbers) under it. */
function observedWithAccount(details: string): void {
  const observed = /(^|\n)\s*Observed:\s*([^\n]*(?:\n(?!\s*(?:Expectation|Going Forward):)[^\n]*)*)/i.exec(details);
  expect(observed, `the saved Details have no "Observed:":\n${details}`).not.toBeNull();
  expect(observed![2]!.trim(), `the saved "Observed:" is empty:\n${details}`).not.toBe("");
  expect(observed![2]!, `the saved "Observed:" lost the account:\n${details}`).toMatch(/october/i);
}

async function saved(t: T, model: Record<string, string> | null): Promise<string> {
  vi.setSystemTime(new Date("2026-11-10T15:30:00Z"));
  t.directory([...STAFF, BRISA]);
  t.as("salon_director", KEARNEY);
  const thread = t.thread();
  const reply = await thread.say(SAID);
  expect(thread.proposal, `no Coaching card for Brisa Talvenor:\n${reply.content}`).toMatchObject({ templateKey: "coaching", employeeName: "Brisa Talvenor" });
  if (model) t.draftWrites(model);
  const id = await thread.create();
  return t.values(id).coaching_details ?? "";
}

const MODEL_OUTPUTS: readonly [string, Record<string, string> | null][] = [
  ["model-writes-nothing", null],
  ["no-heading", { coaching_details: "Brisa Talvenor did not hit her October sales numbers.\nBrisa is expected to meet her monthly goals going forward." }],
  ["empty-heading", { coaching_details: "Observed:\n\nExpectation:\nBrisa is expected to meet her monthly sales goals, starting with November." }],
];

export const NOV10_P12_COACHING_OBSERVED_SAVED_CASES: ReplayCase[] = MODEL_OUTPUTS.map(([key, model]) => ({
  id: `nov10-p12-coaching-observed-saved-${key}`,
  title: `P12 (${key}): "${SAID}" → Create: the saved Details have "Observed:" with the October account under it`,
  report: REPORT,
  status: { open: "the saved Details have no \"Observed:\", or an empty one" },
  fixFlags: [FIX],
  async run(t: T) {
    observedWithAccount(await saved(t, model));
  },
}));

/*
 * QA's #755 NO-GO (10 Nov 2026): with the flag on, nov7-refusal-sun-monthly-meeting-drift was REFUSED ("I haven't
 * changed the Coaching Form …") where the flag off saved Details. Create had saved Details as only the app's policy
 * line ("Policy reference: Attendance Policy, …"), and the step put that line under "Observed:", so the later "make it
 * for missing out monthly meeting" faced a protected "Observed:" that was not the manager's. A saved edit must never be
 * lost: this case asserts the SAVED Details after the edit, with the flag on (and off: production holds it today).
 */
const MEETING_SCENARIO: RefusalScenario = {
  ...STEP_B_REFUSAL_SCENARIOS.find((scenario) => scenario.id === "sun-monthly-meeting")!,
  id: "p12-monthly-meeting-edit-saved",
  expect: {
    says: "the edit is saved: Details have an \"Observed:\" about the monthly meeting, the policy line is never under it",
    check: (run) => {
      const details = run.saved.coaching_details ?? "";
      if (/haven't changed|didn't change/i.test(run.reply)) return `the edit was refused: "${run.reply.slice(0, 160)}"`;
      if (!/(^|\n)\s*Observed:\s*\n?[^\n]*monthly meeting/i.test(details)) return `the saved Details have no "Observed:" about the monthly meeting:\n${details}`;
      if (/Observed:\s*\n?\s*Policy reference:/i.test(details)) return `the policy line was saved as the account:\n${details}`;
      return null;
    },
  },
  script: {
    patch: {
      [SUN_MEETING]: patch("this_form", [
        { field: "coaching_details", value: "Observed:\nThis coaching session with Perrin addressed the attendance policy. No specific incident was described.", how: "replace", evidence: "missing out monthly meeting" },
      ]),
    },
    revisionFrom: { [SUN_MEETING]: { coaching_details: "Observed:\nPerrin missed the monthly meeting." } },
  },
};

export const NOV10_P12_EDIT_SAVED_CASES: ReplayCase[] = [
  {
    id: "nov10-p12-monthly-meeting-edit-saved",
    title: `P12 (#755 gate): "${SUN_MEETING}" on a saved Coaching Form → the edit is SAVED, with the flag on`,
    report: `QA, 10 Nov 2026 (#755 NO-GO): nov7-refusal-sun-monthly-meeting-drift refused with ${FIX} on — "A saved edit must never be lost."`,
    status: "fixed",
    fixFlags: [FIX],
    run: (t) => play(t, MEETING_SCENARIO),
  },
];
