import { afterEach, describe, expect, it, vi } from "vitest";

import { groundPriorActions, NO_PRIOR_ACTION } from "./prior-actions";

/*
 * PRIOR_ACTIONS_UNSAID_BLANK (QA's Bubbles 17x live test, 14 Nov 2026): at Create, prior_actions was AI-filled
 * "None — first occurrence" though the card had said it would not guess. Invented wording.
 */
afterEach(() => vi.unstubAllEnvs());

const TODAY = "2026-11-14";
const UNSAID = "ca for marnie holloway at grand island, she was late on 11/3/26";

describe("PRIOR_ACTIONS_UNSAID_BLANK", () => {
  it("off: the drafter's \"None — first occurrence\" is kept (as on main)", () => {
    vi.stubEnv("PRIOR_ACTIONS_UNSAID_BLANK_ENABLED", "");
    expect(groundPriorActions({ drafted: NO_PRIOR_ACTION, notes: UNSAID, today: TODAY }).value).toBe(NO_PRIOR_ACTION);
  });

  it("on: an unsaid history stays blank", () => {
    vi.stubEnv("PRIOR_ACTIONS_UNSAID_BLANK_ENABLED", "true");
    const grounded = groundPriorActions({ drafted: NO_PRIOR_ACTION, notes: UNSAID, today: TODAY });
    expect(grounded.value).toBe("");
    expect(grounded.removed).toEqual([NO_PRIOR_ACTION]);
  });

  it("on: \"first time\" said by the manager still reads \"None — first occurrence\"", () => {
    vi.stubEnv("PRIOR_ACTIONS_UNSAID_BLANK_ENABLED", "true");
    const said = `${UNSAID}. this is her first time, no prior coaching`;
    expect(groundPriorActions({ drafted: NO_PRIOR_ACTION, notes: said, today: TODAY }).value).toBe(NO_PRIOR_ACTION);
    expect(groundPriorActions({ drafted: "", notes: said, today: TODAY }).value).toBe(NO_PRIOR_ACTION);
  });

  it("on: a history the manager gave is untouched", () => {
    vi.stubEnv("PRIOR_ACTIONS_UNSAID_BLANK_ENABLED", "true");
    const said = `${UNSAID}. i gave her a verbal warning on 10/20/26`;
    expect(groundPriorActions({ drafted: "Verbal warning — 10/20/2026", notes: said, today: TODAY }).value).toMatch(/Verbal warning/);
  });
});
