import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { withExitFormDateFromTermination } from "./exit-form-date";
import { EXIT_TEMPLATE_KEY } from "./exit-library";

/** EXIT_FORM_DATE_FROM_TERMINATION_ENABLED. QA, the live round 11 (9 Nov 2026); the letter's people invented. */
const LETTER = "Marcus Tellefsen,\n\nThis letter confirms that your employment with the company is terminated, effective 11/08/2026, due to repeated no-call no-shows on 11/3, 11/5 and 11/7.";
const answer = (formDate: string | null, templateKey = EXIT_TEMPLATE_KEY) => ({
  content: "Here's what I'll fill in:\n\n- **Name:** Marcus Tellefsen\n- **Date:** November 7, 2026\n- **Resignation Date:** November 8, 2026",
  formProposal: { templateKey, formDate },
});

beforeEach(() => {
  vi.stubEnv("EXIT_FORM_DATE_FROM_TERMINATION_ENABLED", "true");
  vi.stubEnv("EXIT_TERMINATION_STATED_ENABLED", "true");
});
afterEach(() => vi.unstubAllEnvs());

describe("withExitFormDateFromTermination", () => {
  it("off: the card as it was", () => {
    vi.stubEnv("EXIT_FORM_DATE_FROM_TERMINATION_ENABLED", "");
    expect(withExitFormDateFromTermination(answer("2026-11-07"), [LETTER], "2026-11-08").formProposal.formDate).toBe("2026-11-07");
  });

  it("on: QA's letter dates the card and the reply's Date line on the effective date", () => {
    const fixed = withExitFormDateFromTermination(answer("2026-11-07"), [LETTER], "2026-11-08");
    expect(fixed.formProposal.formDate).toBe("2026-11-08");
    expect(fixed.content).toMatch(/^- \*\*Date:\*\* November 8, 2026$/m);
    expect(fixed.content).toMatch(/^- \*\*Resignation Date:\*\* November 8, 2026$/m);
  });

  it("on: no stated termination, another form, or a plan: unchanged", () => {
    expect(withExitFormDateFromTermination(answer("2026-11-07"), ["exit form for Marcus Tellefsen, he quit on 11/7"], "2026-11-08").formProposal.formDate).toBe("2026-11-07");
    expect(withExitFormDateFromTermination(answer("2026-11-07", "other-form"), [LETTER], "2026-11-08").formProposal.formDate).toBe("2026-11-07");
    const plan = "Should your employment be terminated, effective 11/08/2026? Draft an exit form for Marcus Tellefsen.";
    expect(withExitFormDateFromTermination(answer("2026-11-07"), [plan], "2026-11-08").formProposal.formDate).toBe("2026-11-07");
  });
});
