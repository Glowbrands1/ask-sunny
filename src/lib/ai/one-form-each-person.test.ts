import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { installPersonRoster } from "@/lib/forms/person-guard";

import { withCardNamingEmployee, withDidYouMeanStillAsked, withSeveralPeopleAsked } from "./did-you-mean-stays";
import { acceptedNextFormOffer, peopleRequest, withOneFormEachPerson } from "./two-forms-own-person";
import type { AskRequest, AskResponse } from "./types";

/** QA's P7, Sunny live (10 Nov 2026), in the managers' words; the people invented. */
const T1 = "Make me a coaching form for Tamsin, Corwin, and Ione for not closing duties correctly";
const ASKED = "Did you mean **Tamsin Rookwood** or **Tamsin Ashby**? Tell me which, or give the full name.";
const card = (employeeName: string | null, content = "Here is what I would put on a **Coaching Form**.\n\nI have the employee and the salon.") =>
  ({ content, citations: [], coverage: "not_applicable", recommendedVideoIds: [], formProposal: { templateKey: "coaching", employeeName, status: "ready" } }) as unknown as AskResponse;

afterEach(() => {
  vi.unstubAllEnvs();
  installPersonRoster(() => undefined);
});

describe("peopleRequest", () => {
  it("QA's request is one Coaching Form for each of three people, with the reason", () => {
    const read = peopleRequest(T1)!;
    expect(read.templateKey).toBe("coaching");
    expect(read.people).toEqual(["Tamsin", "Corwin", "Ione"]);
    expect(read.clauseFor("Tamsin")).toBe("Make me a coaching form for Tamsin for not closing duties correctly");
  });

  it("one person, or no form: not this", () => {
    expect(peopleRequest("Make me a coaching form for Tamsin for not closing duties correctly")).toBeNull();
    expect(peopleRequest("Tamsin, Corwin and Ione were late")).toBeNull();
  });
});

describe("withOneFormEachPerson (ONE_FORM_EACH_PERSON_ENABLED)", () => {
  const request = (question: string, history: AskRequest["history"] = []) => ({ question, history }) as unknown as AskRequest;

  it("off: the answer as it was", async () => {
    const answer = vi.fn(async () => card("Tamsin Ashby"));
    expect(await withOneFormEachPerson(card(null, ASKED), request(T1), answer)).toMatchObject({ content: ASKED });
    expect(answer).not.toHaveBeenCalled();
  });

  it("on: the first person's request is answered, the others queued by their roster names", async () => {
    vi.stubEnv("ONE_FORM_EACH_PERSON_ENABLED", "true");
    installPersonRoster(() => ["Tamsin Rookwood", "Tamsin Ashby", "Corwin Halsey", "Ione Marchetti"]);
    const answer = vi.fn(async (turn: AskRequest) => (turn.question.includes("for Tamsin for") ? card(null, ASKED) : card("x")));
    const reply = await withOneFormEachPerson(card(null, "?"), request(T1), answer);
    expect(answer).toHaveBeenCalledWith(expect.objectContaining({ question: "Make me a coaching form for Tamsin for not closing duties correctly" }));
    expect(reply.content).toContain(ASKED);
    expect(reply.content).toMatch(/\*\*Next:\*\* a Coaching Form each for \*\*Corwin Halsey\*\* and \*\*Ione Marchetti\*\*, for not closing duties correctly\./);
  });

  it("on: \"yes\" to the queue after a card is the next person's request; after a question it is not", () => {
    vi.stubEnv("ONE_FORM_EACH_PERSON_ENABLED", "true");
    const next = "**Next:** a Coaching Form each for **Corwin Halsey** and **Ione Marchetti**, for not closing duties correctly. Say **yes** when this one is done and I'll start the next.";
    const afterCard = [{ role: "assistant", content: `I have **Tamsin Ashby** and the salon.\n\n${next}` }] as never;
    expect(acceptedNextFormOffer({ question: "yes", history: afterCard })).toBe("Create a Coaching Form for Corwin Halsey for not closing duties correctly.");
    const afterQuestion = [{ role: "assistant", content: `${ASKED}\n\n${next}` }] as never;
    expect(acceptedNextFormOffer({ question: "yes", history: afterQuestion })).toBeNull();
  });
});

describe("withDidYouMeanStillAsked (DID_YOU_MEAN_STAYS_ASKED_ENABLED)", () => {
  const history = [{ role: "assistant", content: ASKED }];

  it("off: the card as it was", () => {
    expect(withDidYouMeanStillAsked(card("Tamsin Rookwood"), { question: "create draft for failure to do closing duties and staying over hours", history }).formProposal?.employeeName).toBe("Tamsin Rookwood");
  });

  it("on: QA's turn picks neither — no employee, asked again", () => {
    vi.stubEnv("DID_YOU_MEAN_STAYS_ASKED_ENABLED", "true");
    const reply = withDidYouMeanStillAsked(card("Tamsin Rookwood"), { question: "create draft for failure to do closing duties and staying over hours", history });
    expect(reply.formProposal?.employeeName).toBeNull();
    expect(reply.content).toBe(ASKED);
  });

  it("on: a pick by full name, last name or place keeps the card", () => {
    vi.stubEnv("DID_YOU_MEAN_STAYS_ASKED_ENABLED", "true");
    for (const question of ["Tamsin Rookwood", "rookwood", "the first one"]) {
      expect(withDidYouMeanStillAsked(card("Tamsin Rookwood"), { question, history }).formProposal?.employeeName, question).toBe("Tamsin Rookwood");
    }
  });
});

describe("withCardNamingEmployee (CARD_NAMES_EMPLOYEE_ENABLED)", () => {
  it("off as before; on, the reply names the card's employee", () => {
    expect(withCardNamingEmployee(card("Tamsin Ashby")).content).toContain("I have the employee and the salon.");
    vi.stubEnv("CARD_NAMES_EMPLOYEE_ENABLED", "true");
    expect(withCardNamingEmployee(card("Tamsin Ashby")).content).toContain("I have **Tamsin Ashby** and the salon.");
    expect(withCardNamingEmployee(card(null)).content).toContain("I have the employee");
  });
});

describe("withSeveralPeopleAsked (OBSERVATION_OWN_PERSON_ONLY_ENABLED, ONE_FORM_EACH_PERSON off)", () => {
  const Q = "CA for Wilhelmina Corvina and Peregrine Varnholt for being late";
  const ca = { ...card("Wilhelmina Corvina"), formProposal: { templateKey: "dpoa", employeeName: "Wilhelmina Corvina", status: "ready" } } as unknown as AskResponse;

  it("off: the card as it was", () => {
    expect(withSeveralPeopleAsked(ca, Q).formProposal?.employeeName).toBe("Wilhelmina Corvina");
  });

  it("on: QA's control asks which of the two, the card has no employee", () => {
    vi.stubEnv("OBSERVATION_OWN_PERSON_ONLY_ENABLED", "true");
    const reply = withSeveralPeopleAsked(ca, Q);
    expect(reply.formProposal?.employeeName).toBeNull();
    expect(reply.content).toMatch(/Which of them is this \*\*Corrective Action Form\*\* for — \*\*Wilhelmina Corvina\*\* or \*\*Peregrine Varnholt\*\*\?/);
  });

  it("on, with ONE_FORM_EACH_PERSON: one form each instead, the card as it was", () => {
    vi.stubEnv("OBSERVATION_OWN_PERSON_ONLY_ENABLED", "true");
    vi.stubEnv("ONE_FORM_EACH_PERSON_ENABLED", "true");
    expect(withSeveralPeopleAsked(ca, Q).formProposal?.employeeName).toBe("Wilhelmina Corvina");
  });
});
