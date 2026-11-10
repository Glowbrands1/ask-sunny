import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { offRosterQuestion, withOffRosterAskBeforeCard } from "./off-roster-ask";
import { installPersonRoster } from "./person-guard";

/** OFF_ROSTER_ASK_BEFORE_CARD_ENABLED, ported from the sibling app (QA's round-6 live test there, 9 Nov 2026): "create a coaching form for <full name not on the roster>". */
const STORE = { level: "salon" as const, primaryAreaId: "loc-0309", alsoCoversAreaIds: [] };
const DISTRICT = { level: "district" as const, primaryAreaId: "dist-1", alsoCoversAreaIds: [] };
const card = (employeeName: string) => ({
  content: `Here is what I would put on a **Coaching Form**. I have **${employeeName}**.`,
  formProposal: { employeeName, templateName: "Coaching Form", status: "ready", supportsInlineDraft: true },
});
const asked = (name: string) => `create a coaching form for ${name}`;
const ask = (name: string, scope: typeof STORE | typeof DISTRICT = STORE, history: { role: string; content: string }[] = []) =>
  withOffRosterAskBeforeCard(card(name), { scope, history, question: asked(name) });

beforeEach(() => {
  vi.stubEnv("OFF_ROSTER_ASK_BEFORE_CARD_ENABLED", "true");
  vi.stubEnv("OFF_ROSTER_CONFIRM_ENABLED", "true");
  installPersonRoster(() => ["Marnie Holloway", "Remy Calder"]);
});
afterEach(() => {
  vi.unstubAllEnvs();
  installPersonRoster(() => undefined);
});

describe("withOffRosterAskBeforeCard", () => {
  it("off: the card as it was", () => {
    vi.stubEnv("OFF_ROSTER_ASK_BEFORE_CARD_ENABLED", "");
    expect(ask("Wrenna Pollard").formProposal?.employeeName).toBe("Wrenna Pollard");
  });

  it("on: QA's wording — a salon manager's card for a name not on the roster asks first, with the use-<name> offer", () => {
    const answer = ask("Wrenna Pollard");
    expect(answer.content.startsWith(offRosterQuestion("Wrenna Pollard"))).toBe(true);
    expect(answer.content).toMatch(/reply \*\*use Wrenna Pollard\*\*/);
    expect(answer.formProposal).toMatchObject({ employeeName: null, status: "needs_employee", supportsInlineDraft: false });
  });

  it("on: asked once — after the question, the card comes", () => {
    const history = [{ role: "assistant", content: offRosterQuestion("Wrenna Pollard") }];
    expect(ask("Wrenna Pollard", STORE, history).formProposal?.employeeName).toBe("Wrenna Pollard");
  });

  it("on: a district manager, a roster name, a near miss, a one-word name, or no roster read: unchanged", () => {
    expect(ask("Wrenna Pollard", DISTRICT).formProposal?.employeeName).toBe("Wrenna Pollard");
    expect(ask("marnie holloway").formProposal?.employeeName).toBe("marnie holloway");
    expect(ask("Remy Caldor").formProposal?.employeeName).toBe("Remy Caldor");
    expect(ask("Wrenna").formProposal?.employeeName).toBe("Wrenna");
    installPersonRoster(() => undefined);
    expect(ask("Wrenna Pollard").formProposal?.employeeName).toBe("Wrenna Pollard");
  });
});
