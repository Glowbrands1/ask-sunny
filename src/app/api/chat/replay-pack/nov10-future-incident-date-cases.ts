import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * OCTOBER TRIAGE #11 — AN INCIDENT DATE AFTER TODAY IS ASKED ABOUT (Sunny #285, the sibling app's #207 BH5)
 * ============================================================================
 *
 * The triage table (written 10/25; the employee invented): "write up <employee>, written warning, for not attending the
 * monthly meeting on 12-20-26" and "writen ca <employee> not atending monthly meeting 12-20-26" gave a card dated
 * 12/20/2026 and no question. A form records what happened; a date that has not come yet is asked about, and the form
 * is never dated by it. FUTURE_INCIDENT_DATE_ASK_ENABLED (`forms/incident-dates.ts`).
 */

const TAMSIN: DirectoryRow = {
  id: "e-nov10-future-date-tamsin",
  firstName: "Tamsin",
  lastName: "Oakridge",
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Tanning Consultant",
};

const TURNS = [
  "write up tamsin oakridge, written warning, for not attending the monthly meeting on 12-20-26",
  "writen ca tamsin oakridge not atending monthly meeting 12-20-26",
];

export const FUTURE_INCIDENT_DATE_FIX = "FUTURE_INCIDENT_DATE_ASK_ENABLED";

export const NOV10_FUTURE_INCIDENT_DATE_CASES: ReplayCase[] = TURNS.map((said, i) => ({
  id: `nov10-future-incident-date-${i === 0 ? "full" : "terse"}`,
  title: `#11: "${said}" (on 10/25) → asks what date it happened; the card is never dated 12/20/2026`,
  report: `October triage #11 (Sunny #285, the sibling app's #207 BH5): "${said}" → a card dated 12/20/2026 and no question`,
  status: { open: "the card is dated 12/20/2026 and nothing is asked" },
  fixFlags: [FUTURE_INCIDENT_DATE_FIX],
  async run(t) {
    vi.setSystemTime(new Date("2026-10-25T15:00:00Z"));
    t.directory([...STAFF, TAMSIN]);
    t.as("salon_director", KEARNEY);
    const thread = t.thread();
    const reply = await thread.say(said);
    expect(thread.proposal?.templateKey, `no Corrective Action card:\n${reply.content}`).toBe("dpoa");
    expect(thread.proposal?.formDate ?? null, reply.content).not.toBe("2026-12-20");
    expect(reply.content).not.toMatch(/\*\*Date:\*\*\s*12\/20\/2026/);
    expect(reply.content, `nothing asks about the future date:\n${reply.content}`).toMatch(/12\/20\/2026\*\*, is after today/);
  },
}));

/* Guards from #285 (hold with production's flags; the flag must not change them). */
const GUARDS: { id: string; said: string; formDate: string | null }[] = [
  { id: "past-beside-future", said: "write up tamsin oakridge, late on 10-20-26, meeting is on 12-20-26", formDate: "2026-10-20" },
  { id: "deadline", said: "write up tamsin oakridge for missing the 11/1 woven deadline", formDate: null },
];

export const NOV10_FUTURE_INCIDENT_DATE_GUARDS: ReplayCase[] = GUARDS.map(({ id, said, formDate }) => ({
  id: `nov10-future-incident-date-guard-${id}`,
  title: `#11 guard: "${said}" (on 10/25) → ${formDate ? `dated ${formDate}, ` : ""}nothing asked about a future date`,
  report: "October triage #11 (Sunny #285): the PR's own guards",
  status: "fixed" as const,
  fixFlags: [FUTURE_INCIDENT_DATE_FIX],
  async run(t) {
    vi.setSystemTime(new Date("2026-10-25T15:00:00Z"));
    t.directory([...STAFF, TAMSIN]);
    t.as("salon_director", KEARNEY);
    const thread = t.thread();
    const reply = await thread.say(said);
    expect(reply.content).not.toMatch(/is after today/);
    // The deadline guard only checks nothing is asked: production dates that card 11/1 today, a separate gap.
    if (formDate) expect(thread.proposal?.formDate ?? null, reply.content).toBe(formDate);
  },
}));
