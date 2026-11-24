import { afterEach, describe, expect, it, vi } from "vitest";

import { withFormDatedToday } from "./form-date-today";

/*
 * FORM_DATE_IS_TODAY (Pau, 24 Nov 2026), the last check on the chat's card. Pau's words, the employee's name swapped for
 * an invented one: "the form date is wrong i told it Odessa was late to work on September 11, 2026. but it put the date
 * …, should be today right". The replay pack covers the route (`nov24-form-date-is-today-cases.ts`).
 */
const TODAY = "2026-11-24";
const SAID = "create a corrective action for Odessa Pellham, she was late to work on September 11, 2026";
const card = (templateKey: string, formDate: string | null) => ({
  content: "Here's the Corrective Action Form for **Odessa Pellham**.\n**Date:** 9/11/2026\n**Salon:** NE Kearney",
  formProposal: { templateKey, formDate },
});

describe("withFormDatedToday", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("off: the card keeps the incident's date", () => {
    expect(withFormDatedToday(card("dpoa", "2026-09-11"), [SAID], TODAY).formProposal?.formDate).toBe("2026-09-11");
  });

  it("on: a Corrective Action carries no incident date, and the reply's Date line goes", () => {
    vi.stubEnv("FORM_DATE_IS_TODAY_ENABLED", "true");
    const out = withFormDatedToday(card("dpoa", "2026-09-11"), [SAID], TODAY);
    expect(out.formProposal?.formDate).toBeNull();
    expect(out.content).not.toMatch(/\*\*Date:\*\*/);
    expect(out.content).toMatch(/\*\*Salon:\*\* NE Kearney/);
  });

  it("on: a date the manager gives the form still dates it", () => {
    vi.stubEnv("FORM_DATE_IS_TODAY_ENABLED", "true");
    vi.stubEnv("FORM_DATE_SAID_SETTLES_ENABLED", "true"); // on in production (src/config/production-flags.json)
    const out = withFormDatedToday(card("dpoa", "2026-09-11"), [SAID, "make the date 11/20/2026"], TODAY);
    expect(out.formProposal?.formDate).toBe("2026-11-20");
    expect(out.content).toMatch(/\*\*Date:\*\* 11\/20\/2026/);
  });

  it("on: a form not dated by an incident (an exit) is left alone", () => {
    vi.stubEnv("FORM_DATE_IS_TODAY_ENABLED", "true");
    expect(withFormDatedToday(card("stc-exit", "2026-11-08"), [SAID], TODAY).formProposal?.formDate).toBe("2026-11-08");
  });
});
