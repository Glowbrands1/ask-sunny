import { afterEach, describe, expect, it, vi } from "vitest";

import { intentPayrollManagerOnlyEnabled } from "@/lib/config/chat-quality-flags";

import type { ConversationFormState } from "./form-state";
import { decideIntentTurn, type IntentTurnInput } from "./intent-slots";

/**
 * Ported from Ask Bubbles (conv_mvmf4x1i2qxha7u, 24 Oct 2026). The manager
 * said "verbal, no payroll" and the saved state took payrollAmount "25" and
 * payrollDeduct "yes" from the assistant's quote of the Late Opening policy.
 * The turns keep that conversation's shape with this app's salon and
 * Form Monitoring names; the manager's words are unchanged.
 */

const SALONS = [
  { id: "loc-1001", name: "North Salon" },
  { id: "loc-1002", name: "South Salon" },
] as const;

const TEMPLATES = [
  { key: "dpoa", name: "Corrective Action Form" },
  { key: "coaching", name: "Coaching Form" },
] as const;

const HEADINGS = ["Attendance", "Late Opening", "Standards of Conduct"];

const TURNS = [
  { role: "user", content: "CA for Testy Testerson at North Salon" },
  {
    role: "assistant",
    content:
      "I still need which employee — **Testy Testerson** is not in the Woven roster, what happened, the date it happened, and which form.",
  },
  { role: "user", content: "late opening on 10-21" },
  {
    role: "assistant",
    content:
      'Got it — same details as before: late opening on 10/21/2026, verbal, no payroll deduction.\n\nYou already have three Corrective Action Form drafts for Testy Testerson sitting unfinalized from earlier today. Worth checking the Form Monitoring to see if one of those already has what you need before making another, so you don\'t end up with duplicates on file.\n\nFor reference, Late Opening policy says the employee who fails to open is required to reimburse the company $25 via payroll deduction when applicable, and restitution to affected clients is handled by the manager or DM. If you\'re going verbal/no payroll, that\'s your call to document as the deviation from the standard policy language.\n\nJust say "create a corrective action form for Testy Testerson" when you\'re ready and I\'ll bring up a fresh draft card.',
  },
  { role: "user", content: "verbal, no payroll" },
] as const;

/** Each user turn in order, with the state the previous turn saved. */
function replay(): ConversationFormState {
  let saved: ConversationFormState | null = null;
  TURNS.forEach((turn, at) => {
    if (turn.role !== "user") return;
    const input: IntentTurnInput = {
      question: turn.content,
      history: TURNS.slice(0, at).map((item) => ({ role: item.role, content: item.content })),
      today: "2026-10-24",
      saved,
      raw: null,
      people: [],
      salons: SALONS,
      headings: HEADINGS,
      templates: TEMPLATES,
      formInProgress: at > 0,
    };
    saved = decideIntentTurn(input).state;
  });
  return saved!;
}

describe("INTENT_PAYROLL_MANAGER_ONLY_ENABLED", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults off", () => {
    expect(intentPayrollManagerOnlyEnabled()).toBe(false);
  });

  it('keeps "verbal, no payroll" as No and takes no amount from the policy quote', () => {
    vi.stubEnv("INTENT_PAYROLL_MANAGER_ONLY_ENABLED", "true");
    const state = replay();
    expect(state.payrollDeduct).toBe("no");
    expect(state.payrollAmount).toBeNull();
    expect(state.warningLevel).toBe("verbal");
    expect(state.salonId).toBe("loc-1001");
  });

  it("still takes an amount the manager typed", () => {
    vi.stubEnv("INTENT_PAYROLL_MANAGER_ONLY_ENABLED", "true");
    const state = decideIntentTurn({
      question: "CA for Testy Testerson at North Salon, late opening on 10-21, verbal, payroll deduct $25",
      history: [],
      today: "2026-10-24",
      saved: null,
      raw: null,
      people: [],
      salons: SALONS,
      headings: HEADINGS,
      templates: TEMPLATES,
      formInProgress: false,
    }).state;
    expect(state.payrollDeduct).toBe("yes");
    expect(state.payrollAmount).toBe("25");
  });

  it("off, reads the assistant's $25 as before (the Ask Bubbles state on 24 Oct)", () => {
    const state = replay();
    expect(state.payrollAmount).toBe("25");
    expect(state.payrollDeduct).toBe("yes");
  });
});
