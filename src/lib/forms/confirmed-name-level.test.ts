import { afterEach, describe, expect, it, vi } from "vitest";

import { withConfirmedNameLevel } from "./confirmed-name-level";

/* TYPO_FULL_NAME_TO_ROSTER_ENABLED (ported from Ask Bubbles: QA's audit item 15.10, sf-b5, and QA's ruling on #776, 12 Nov 2026; invented people). */
const ASKED = "You'll set the verbal/written warning level on the form — I won't guess at it.";
const CARD = { content: `I'll draft a **Corrective Action Form** for **Delphine Marlowe Ostrander**.\n\n${ASKED}`, formProposal: { templateKey: "dpoa", employeeName: "Delphine Marlowe Ostrander", warningLevel: null } };
const HISTORY = [
  { role: "user", content: "create a ca form for Delphine Marlwoe Ostrander" },
  { role: "assistant", content: "Is this for **Delphine Marlowe Ostrander**? Tell me if that should change." },
];
const SF_B5 = "verbal warning The date she complained was Oct 31st . The customer said she was giving her an attitude";

describe("TYPO_FULL_NAME_TO_ROSTER: the level said after the confirmation", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("on: the turn after \"Is this for <name>?\" opening with \"verbal warning\" is the card's level", () => {
    vi.stubEnv("TYPO_FULL_NAME_TO_ROSTER_ENABLED", "true");
    const out = withConfirmedNameLevel(CARD, HISTORY, SF_B5);
    expect(out.formProposal?.warningLevel).toBe("verbal");
    expect(out.content).toContain("**Type of Warning:** Verbal Warning, as you said");
    expect(out.content).not.toContain(ASKED);
  });

  it("on: \"yes\", then the level in a later turn", () => {
    vi.stubEnv("TYPO_FULL_NAME_TO_ROSTER_ENABLED", "true");
    const history = [...HISTORY, { role: "user", content: "yes" }, { role: "assistant", content: `card\n\n${ASKED}` }];
    expect(withConfirmedNameLevel(CARD, history, "written warning, she was rude to a guest").formProposal?.warningLevel).toBe("written");
  });

  it("on: no confirmation asked, another person's card, a level mid-sentence, or a level already set: as given", () => {
    vi.stubEnv("TYPO_FULL_NAME_TO_ROSTER_ENABLED", "true");
    expect(withConfirmedNameLevel(CARD, [HISTORY[0]!], SF_B5)).toBe(CARD);
    expect(withConfirmedNameLevel({ ...CARD, formProposal: { ...CARD.formProposal, employeeName: "Remy Calder" } }, HISTORY, SF_B5).formProposal?.warningLevel).toBeNull();
    expect(withConfirmedNameLevel(CARD, HISTORY, "she had a verbal warning before, now she was rude")).toBe(CARD);
    const set = { ...CARD, formProposal: { ...CARD.formProposal, warningLevel: "written" as const } };
    expect(withConfirmedNameLevel(set, HISTORY, SF_B5)).toBe(set);
  });

  it("off: as given", () => {
    vi.stubEnv("TYPO_FULL_NAME_TO_ROSTER_ENABLED", "");
    expect(withConfirmedNameLevel(CARD, HISTORY, SF_B5)).toBe(CARD);
  });
});
