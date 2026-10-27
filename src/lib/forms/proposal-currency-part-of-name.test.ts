import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { checkProposalIsCurrent } from "./proposal-currency";

/*
 * QA S5, 27 Oct 2026, QA's wording with invented names: the manager's request
 * said "dale ferris dale" and the card was for Dale Ferris; Create refused the
 * card as out of date. CREATE_ACCEPTS_PART_OF_NAME_ENABLED takes a name that is
 * part of the card's as the same person.
 */
const turn = (id: string, content: string) => ({ id, role: "user" as const, content });
const S5 = "create ca form for dale ferris dale had a register shortage of $3.25 on 10-20-26. payroll deduct of $3.25 is applicable / verbal / yes payroll deduct";

afterEach(() => vi.unstubAllEnvs());

describe("CREATE_ACCEPTS_PART_OF_NAME_ENABLED", () => {
  it("off: 'dale ferris dale' against the card for Dale Ferris is refused, as before", () => {
    const check = checkProposalIsCurrent({ conversation: [turn("a", S5)], templateKey: "dpoa", employeeName: "Dale Ferris" });
    expect(check.current).toBe(false);
  });

  it("on: 'dale ferris dale' is part of the card's Dale Ferris, so the card is current", () => {
    vi.stubEnv("CREATE_ACCEPTS_PART_OF_NAME_ENABLED", "true");
    expect(checkProposalIsCurrent({ conversation: [turn("a", S5)], templateKey: "dpoa", employeeName: "Dale Ferris" }).current).toBe(true);
  });

  it("on: a card for a different person with a shared first name is still refused", () => {
    vi.stubEnv("CREATE_ACCEPTS_PART_OF_NAME_ENABLED", "true");
    const conversation = [turn("a", "create ca form for quinn smith was late on 10-20-26 / verbal / no payroll deduct")];
    const check = checkProposalIsCurrent({ conversation, templateKey: "dpoa", employeeName: "Quinn Marlowe" });
    expect(check.current).toBe(false);
  });

  it("on: a correction to another person after the card is still refused", () => {
    vi.stubEnv("CREATE_ACCEPTS_PART_OF_NAME_ENABLED", "true");
    const conversation = [turn("a", "create ca form for quinn marlowe was late on 10-20-26"), turn("b", "No, not Quinn Marlowe. Dale Ferris.")];
    expect(checkProposalIsCurrent({ conversation, templateKey: "dpoa", employeeName: "Quinn Marlowe" }).current).toBe(false);
  });
});
