import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * AN EVENING FORM IS DATED TODAY, NOT TOMORROW (live bug, QA, 13 Nov 2026)
 * ============================================================================
 *
 * QA, 13 Nov 2026: "Sunny puts tomorrow's date on evening forms." Pau's audit: 27 of 29 evening forms in the last 30
 * days, 6 of them finalized. The form's date defaulted to the UTC date (instances.ts), already tomorrow from about
 * 6–7 PM Central. A salon director asks for a form at 7:30 PM Central on 12 Nov (01:30Z on 13 Nov) and creates it.
 * Invented people.
 */
const FLAG = "FORM_DATE_BUSINESS_TODAY_ENABLED";

export const NOV13_FORM_DATE_BUSINESS_TODAY_CASES: ReplayCase[] = [
  {
    id: "nov13-form-date-evening-request-dated-today",
    title: `an evening request (7:30 PM Central, 12 Nov) creates a form dated 2026-11-12, not 2026-11-13`,
    report: "QA, 13 Nov 2026 (live bug: evening forms dated the next day; Pau's audit)",
    // Changed on purpose (13 Nov 2026): fixed in production by FORM_DATE_BUSINESS_TODAY_ENABLED, QA round 38b. Was OPEN.
    status: "fixed",
    fixFlags: [FLAG],
    async run(t: ReplayContext) {
      vi.setSystemTime(new Date("2026-11-13T01:30:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say("coaching form for marnie holloway, she was on her phone at the front desk");
      t.draftWrites({});
      const id = await thread.create();
      const values = t.values(id);
      const dated = values.form_date ?? values.date ?? null;
      expect(dated, `the form's date: ${JSON.stringify(values)}`).toBe("2026-11-12");
    },
  },
];
