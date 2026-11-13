import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/ai/chat-trace-store", () => ({ updateChatTrace: vi.fn() }));

import type { AskResponse } from "@/lib/ai/types";

import { CARD_CHECK_MAX_CALLS, accountFromWords, addedFacts, issueProblem, personProblem, withCardCheckedAgainstWords, type CardCheckModel, type CardPerson } from "./card-checked-against-words";


const ROSTER: CardPerson[] = [
  { firstName: "Marnie", lastName: "Holloway", positionName: "Tanning Consultant" },
  { firstName: "Wren", lastName: "Tallis", positionName: "Salon Director" },
];

function card(issue: string | null, employeeName: string | null = "Marnie Holloway"): AskResponse {
  return {
    content: `I'll draft a **Corrective Action Form** for **${employeeName}** from what you've described.\n\n**Issue:** ${issue ?? ""} · **Salon:** Lincoln, as you said — tell me if that should change`,
    citations: [],
    coverage: "not_applicable",
    recommendedVideoIds: [],
    formProposal: { employeeName, issue, status: "ready" } as never,
  };
}

const NO_MODEL: CardCheckModel = async () => ({ fallback: "error" });

afterEach(() => vi.unstubAllEnvs());

describe("CARD_CHECKED_AGAINST_WORDS_ENABLED: the code's checks", () => {
  const input = { turns: ["CA for Marnie Holloway, do not terminate yet, she was late"], roster: ROSTER };

  it("names what is wrong with an Issue: a hedge, a level, a title, a name", () => {
    expect(issueProblem("do not terminate yet", "Marnie Holloway", input)).toBe("issue_hedge");
    expect(issueProblem("verbal warning", "Marnie Holloway", input)).toBe("issue_title");
    expect(issueProblem("Tanning Consultant", "Marnie Holloway", input)).toBe("issue_title");
    expect(issueProblem("Marnie Holloway", "Marnie Holloway", input)).toBe("issue_name");
    expect(issueProblem("she was late", "Marnie Holloway", input)).toBeNull();
  });

  it("a person who is a job title is a problem; a name is not", () => {
    expect(personProblem("Tanning Consultant", input)).toBe("person_title");
    expect(personProblem("Marnie Holloway", input)).toBeNull();
  });

  it("the account from the manager's own clauses, without the hedge", () => {
    expect(accountFromWords("Marnie Holloway", input)).toBe("she was late");
  });
});

describe("CARD_CHECKED_AGAINST_WORDS_ENABLED: the card", () => {
  const input = { turns: ["CA for Marnie Holloway, do not terminate yet, she was late"], roster: ROSTER };

  it("off: the card as built", async () => {
    vi.stubEnv("CARD_CHECKED_AGAINST_WORDS_ENABLED", "false");
    const built = card("do not terminate yet");
    expect(await withCardCheckedAgainstWords(built, input, NO_MODEL)).toBe(built);
  });

  it("on: QA's 17o wording — the hedge is replaced by the account, from her words, with no model call", async () => {
    vi.stubEnv("CARD_CHECKED_AGAINST_WORDS_ENABLED", "true");
    const model = vi.fn(NO_MODEL);
    const out = await withCardCheckedAgainstWords(card("do not terminate yet"), input, model);
    expect(out.formProposal?.issue).toBe("she was late");
    expect(out.content).toContain("**Issue:** she was late ·");
    expect(model).not.toHaveBeenCalled();
  });

  it("on: nothing in her words repairs it and the model has no quote — the Issue is blank and the card asks what happened (never a guess)", async () => {
    vi.stubEnv("CARD_CHECKED_AGAINST_WORDS_ENABLED", "true");
    const only = { turns: ["CA for Marnie Holloway, do not terminate yet"], roster: ROSTER };
    const invents: CardCheckModel = async () => ({ ok: true, output: { issue: { value: "she was rude to a guest", quote: "she was rude to a guest" } } });
    const model = vi.fn(invents);
    const out = await withCardCheckedAgainstWords(card("do not terminate yet"), only, model);
    expect(out.formProposal?.issue).toBeNull();
    expect(out.content).not.toMatch(/\*\*Issue:\*\*/);
    expect(out.content).toMatch(/What happened\?/);
    expect(model).toHaveBeenCalledTimes(CARD_CHECK_MAX_CALLS);
  });

  it("on: a model correction that quotes her words stands", async () => {
    vi.stubEnv("CARD_CHECKED_AGAINST_WORDS_ENABLED", "true");
    const turns = { turns: ["write up Marnie Holloway", "verbal warning. she left the register unlocked overnight"], roster: ROSTER };
    const model: CardCheckModel = async () => ({ ok: true, output: { issue: { value: "left the register unlocked overnight", quote: "she left the register unlocked overnight" } } });
    const out = await withCardCheckedAgainstWords(card("verbal warning"), turns, model);
    expect(out.formProposal?.issue).toBe("left the register unlocked overnight");
  });

  it("on: a person who is a job title is taken off the card, and it asks who it is for", async () => {
    vi.stubEnv("CARD_CHECKED_AGAINST_WORDS_ENABLED", "true");
    const out = await withCardCheckedAgainstWords(card("she was late", "Tanning Consultant"), input, NO_MODEL);
    expect(out.formProposal?.employeeName).toBeNull();
    expect(out.formProposal?.status).toBe("needs_employee");
    expect(out.content).toMatch(/Who is this card for\?/);
  });

  it("on: a card that is already right is left exactly as built", async () => {
    vi.stubEnv("CARD_CHECKED_AGAINST_WORDS_ENABLED", "true");
    const built = card("she was late");
    const model = vi.fn(NO_MODEL);
    const out = await withCardCheckedAgainstWords(built, input, model);
    expect(out).toEqual(built);
    expect(model).not.toHaveBeenCalled();
  });
});

describe("CARD_CHECKED_AGAINST_WORDS_ENABLED: a fact added on the open card (the sibling app's 17r-c live test, ported)", () => {
  const live = { turns: ["create a CA for Marnie Holloway, she was late on 11/3/26", "she also didn't call to say she'd be late"], roster: ROSTER };

  it("the added detail is a fact not already held, in her words without \"also\"", () => {
    expect(addedFacts("she was late on 11/3/26", "Marnie Holloway", live)).toEqual(["she didn't call to say she'd be late"]);
  });

  it("guards: an answer to the card's question, a question, or a repeated fact is never added", () => {
    const answer = { turns: ["create a CA for Marnie Holloway, she was late on 11/3/26", "verbal warning"], roster: ROSTER };
    expect(addedFacts("she was late on 11/3/26", "Marnie Holloway", answer)).toEqual([]);
    const asked = { turns: ["create a CA for Marnie Holloway, she was late on 11/3/26", "she also left early, should I add that?"], roster: ROSTER };
    expect(addedFacts("she was late on 11/3/26", "Marnie Holloway", asked)).toEqual([]);
    const again = { turns: ["create a CA for Marnie Holloway, she was late on 11/3/26", "she was late on 11/3/26"], roster: ROSTER };
    expect(addedFacts("she was late on 11/3/26", "Marnie Holloway", again)).toEqual([]);
  });
});
