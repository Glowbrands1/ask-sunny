import { afterEach, describe, expect, it, vi } from "vitest";

import { withFutureDateQuestion } from "@/lib/ai/future-incident-date";
import type { AskResponse } from "@/lib/ai/types";

import { decideFormDate, futureIncidentDate } from "./incident-dates";

/* October triage #11 (Sunny #285, the sibling app's #207 BH5), written 10/25; the employee invented. */
const TODAY = "2026-10-25";
const SAID = "write up tamsin oakridge, written warning, for not attending the monthly meeting on 12-20-26";
const decide = (text: string) => decideFormDate({ text, templateKey: "dpoa", history: [], conversation: [{ role: "user", content: text }], today: TODAY });

describe("FUTURE_INCIDENT_DATE_ASK_ENABLED", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("off: nothing is decided or asked, as before", () => {
    vi.stubEnv("FUTURE_INCIDENT_DATE_ASK_ENABLED", "false");
    expect(decide(SAID)).toEqual({});
  });

  it("on: a future incident date is asked about and never the form's date", () => {
    vi.stubEnv("FUTURE_INCIDENT_DATE_ASK_ENABLED", "true");
    expect(decide(SAID)).toEqual({ formDate: null, question: expect.stringContaining("**12/20/2026**, is after today") });
  });

  it("on: deadlines and due dates are not incidents", () => {
    expect(futureIncidentDate("for missing the 11/1 woven deadline", TODAY)).toBeNull();
    expect(futureIncidentDate("the 12-20-26 due date", TODAY)).toBeNull();
    expect(futureIncidentDate("needs to be done by 11/15", TODAY)).toBeNull();
    expect(futureIncidentDate("follow up on 11/15", TODAY)).toBeNull();
    expect(futureIncidentDate("missing the meeting on 11/1", TODAY)).toBe("2026-11-01");
  });

  it("on: the card turn is undated and asks once", () => {
    vi.stubEnv("FUTURE_INCIDENT_DATE_ASK_ENABLED", "true");
    const response = {
      content: "I'll draft a **Corrective Action Form** for **Tamsin Oakridge**.\n\n**Date:** 12/20/2026",
      formProposal: { formDate: "2026-12-20" },
    } as unknown as AskResponse;
    const request = { question: SAID, history: [], context: { todayIso: TODAY } } as never;
    const once = withFutureDateQuestion(response, request);
    expect(once.formProposal?.formDate).toBeNull();
    expect(once.content).not.toMatch(/\*\*Date:\*\*/);
    expect(once.content).toMatch(/is after today/);
    const again = withFutureDateQuestion(response, { ...(request as object), history: [{ role: "assistant", content: once.content }] } as never);
    expect(again.content).not.toMatch(/is after today/);
    expect(again.formProposal?.formDate).toBeNull();
  });
});
