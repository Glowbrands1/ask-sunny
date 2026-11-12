import { afterEach, describe, expect, it, vi } from "vitest";

import { offRosterOffer } from "./off-roster-confirm";
import { offRosterQuestion } from "./off-roster-ask";
import { placeAnswerOf, placeOnly, withPlaceAnswer } from "./off-roster-place-answer";

/** QA's Sunny 37b live bug (12 Nov 2026): "IA Altoona" to the open "use <C>" offer became the employee. <C> is invented. */
const C = "Brisa Talmadge";
const history = [
  { role: "user", content: `CA for ${C}, do not terminate yet, she was late` },
  { role: "assistant", content: `I couldn't find **${C}** in the Woven roster, so that name is not on the form. ${offRosterOffer(C)}` },
];

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("placeOnly", () => {
  it.each(["IA Altoona", "KS Manhattan", "Manhattan", "Altoona, IA", "kearney, ne", "ne kearney", "NE Lincoln O Street", "at IA Altoona"])("%s is a place", (said) => {
    expect(placeOnly(said)).not.toBeNull();
  });

  it.each(["use Brisa Talmadge", "yes", "Brisa Talmadge", "in Altoona she was late", "me too", "ok", "she was late"])("%s is not a place", (said) => {
    expect(placeOnly(said)).toBeNull();
  });

  it("a directory salon is read as that salon", () => {
    expect(placeOnly("KS Manhattan")).toEqual({ salonId: "loc-0462" });
    expect(placeOnly("IA Altoona")).toEqual({ salonId: null });
  });
});

describe("OFF_ROSTER_PLACE_ANSWER_ENABLED", () => {
  it("off: no place answer", () => {
    expect(placeAnswerOf("IA Altoona", history)).toBeNull();
  });

  it("on: a place to the open offer; no offer, no place answer", () => {
    vi.stubEnv("OFF_ROSTER_PLACE_ANSWER_ENABLED", "true");
    expect(placeAnswerOf("IA Altoona", history)).toEqual({ pending: C, place: "IA Altoona", salonId: null });
    expect(placeAnswerOf("IA Altoona", history.slice(0, 1))).toBeNull();
  });

  it("the card holds no employee, takes an allowed salon, and asks the offer again over the account", () => {
    const card = { employeeName: C, status: "ready", supportsInlineDraft: true, locationId: null, locationName: null };
    const answer = { content: `I'll draft a **Corrective Action Form** for **${C}** from what you've described.\n\n**Observation of Offense:** do not terminate yet, she was late`, formProposal: card };
    const admin = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] } as never;
    const set = withPlaceAnswer(answer, { pending: C, place: "KS Manhattan", salonId: "loc-0462" }, admin);
    expect(set.formProposal).toMatchObject({ employeeName: null, status: "needs_employee", supportsInlineDraft: false });
    expect(set.content).toContain(offRosterQuestion(C));
    expect(set.content).toContain(offRosterOffer(C));
    expect(set.content).toContain("**Observation of Offense:** do not terminate yet, she was late");
    expect(set.content).not.toContain("I'll draft");
    const kearney = { level: "salon", primaryAreaId: "loc-0309", alsoCoversAreaIds: [] } as never;
    const notAllowed = withPlaceAnswer(answer, { pending: C, place: "KS Manhattan", salonId: "loc-0462" }, kearney);
    expect(notAllowed.formProposal?.locationId ?? null).toBeNull();
    expect(notAllowed.content).toMatch(/I read \*\*KS Manhattan\*\* as the salon/);
  });
});

describe("a salon manager's salon-only answer stays OFF_ROSTER_STORE_ANSWER_ONLY's", () => {
  it("on: a directory salon from a salon director is left to that path; from an admin it is read here", () => {
    vi.stubEnv("OFF_ROSTER_PLACE_ANSWER_ENABLED", "true");
    const director = { level: "salon", primaryAreaId: "loc-0309", alsoCoversAreaIds: [] } as never;
    const admin = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] } as never;
    expect(placeAnswerOf("kearney, ne", history, director)).toBeNull();
    expect(placeAnswerOf("kearney, ne", history, admin)).toMatchObject({ pending: C, salonId: "loc-0309" });
    expect(placeAnswerOf("IA Altoona", history, director)).toMatchObject({ pending: C, salonId: null });
  });
});
