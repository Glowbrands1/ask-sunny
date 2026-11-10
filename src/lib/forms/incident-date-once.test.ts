import { afterEach, describe, expect, it } from "vitest";

import { withIncidentDateOnce } from "./incident-date-once";

/*
 * INCIDENT_DATE_ONCE_ENABLED. HR's report (21 Oct 2026): "create verbal ca for <A>, she was late to salon 15 minutes on
 * 10-1-26" — the form "repeated the date of the offense". The replay case `nov3-stepb-date-as-given` runs the chat.
 */
const TODAY = "2026-10-21";

afterEach(() => {
  delete process.env.INCIDENT_DATE_ONCE_ENABLED;
});

describe("the incident date, written once", () => {
  it("leaves the Observation's date phrase out when it is only the form's Date", () => {
    const values = { form_date: "2026-10-01", observation: "Pat Rivera was late to salon 15 minutes on 10-1-26." };
    expect(withIncidentDateOnce(values, "2026-10-01", TODAY)).toBe(values);
    process.env.INCIDENT_DATE_ONCE_ENABLED = "true";
    expect(withIncidentDateOnce(values, "2026-10-01", TODAY)).toEqual({ form_date: "2026-10-01", observation: "Pat Rivera was late to salon 15 minutes." });
  });

  it("keeps a field that names any other date", () => {
    process.env.INCIDENT_DATE_ONCE_ENABLED = "true";
    const values = { observation: "Late on 10-1-26 and again on 10-8-26." };
    expect(withIncidentDateOnce(values, "2026-10-01", TODAY)).toEqual(values);
  });
});
