import { describe, expect, it } from "vitest";

import type { AskResponse } from "@/lib/ai/types";
import type { ChatMessage } from "@/types";

import type { RosterEmployee } from "./employee-match";
import { offeredCopyForTurn } from "./proposal-continuation";
import {
  asksCopyForNewPerson,
  asksForSameForm,
  copyRequestFor,
  pendingCopyName,
  requestTurn,
  swapName,
  withCopyFrom,
} from "./same-form-copy";

/** QA, 30–31 Oct 2026: the manager's own wording, and the review's. Names are invented. */
describe("asksForSameForm", () => {
  it.each([
    "Do the same coaching form for remy calder",
    "can you create the same draft that we did with marnie holloway by changing the name and position?",
    "copy Marnie's form for remy calder",
    "make the same form as the one for Marnie",
  ])("asks for a copy: %s", (said) => {
    expect(asksForSameForm(said)).toBe(true);
  });

  it.each([
    "create a coaching form for remy calder",
    "ok, create the draft, but include the details of rolling rack.",
    "is this the same policy as last year?",
    // Independent review, 31 Oct 2026: ordinary accounts that the first reading took for a copy.
    "She was late again today, same thing as last week",
    "Add that she did the same thing as Remy Calder last week",
    "same details as before, she left the register open",
    // A copy request that also gives this person's own account is the manager's account, not a copy.
    "Do the same coaching form for Remy, he was late again today",
    // Changed on purpose (review, 31 Oct): no "form"/"draft" said, so not a copy request any more.
    "do the same for remy",
  ])("does not: %s", (said) => {
    expect(asksForSameForm(said)).toBe(false);
  });
});

describe("requestTurn", () => {
  it("the card's own request is the last turn of the notes", () => {
    expect(requestTurn("Do the same coaching form for remy calder\n\ncreate a coaching form for remy calder")).toBe(
      "create a coaching form for remy calder",
    );
  });
});

describe("swapName (independent review, 31 Oct 2026; names invented)", () => {
  it.each([
    ["Will Brandt", "Will Brandt was late. This will not happen again.", "Remy Calder was late. This will not happen again."],
    ["Mark Ellery", "Mark Ellery mixed the batch wrong; mark each tub before it leaves.", "Remy Calder mixed the batch wrong; mark each tub before it leaves."],
    ["Grace Tovey", "Grace Tovey left early. Handle guests with grace.", "Remy Calder left early. Handle guests with grace."],
  ])("a name that is also a word is swapped only as the full name: %s", (from, text, expected) => {
    expect(swapName(text, from, "Remy Calder")).toBe(expected);
  });

  it("an ordinary first and last name is swapped alone, capitalised only", () => {
    expect(swapName("Marnie was late. Holloway knows the rule. marnie (lower case) is left.", "Marnie Holloway", "Remy Calder")).toBe(
      "Remy was late. Calder knows the rule. marnie (lower case) is left.",
    );
  });
});

/*
 * SAME_FORM_COPY_NEW_PERSON_ENABLED (coding3, 5 Nov 2026). The location
 * manager's words, verbatim; every person is invented.
 */
const SAME_DRAFT = "can you create the same draft that we did with Liora Pellow by changing the name and position?";
const person = (firstName: string, lastName: string, preferredFirstName: string | null = null): RosterEmployee =>
  ({ id: `e-${firstName}`, firstName, lastName, preferredFirstName, employmentStatus: "active", salonIds: [] }) as RosterEmployee;
const ROSTER = [person("Liora", "Pellow"), person("Teodric", "Sabrin"), person("Caspian", "Drummet", "Cas")];

describe("asksCopyForNewPerson", () => {
  it("the manager's words, with Liora's own form the one named: a copy for somebody not named yet", () => {
    expect(asksCopyForNewPerson(SAME_DRAFT, "Liora Pellow", ROSTER)).toBe(true);
  });

  it.each([
    // The new person is named in the same turn: the copy paths that already exist answer it.
    "can you create the same draft that we did with Liora Pellow for Teodric Sabrin?",
    // Liora is who the new form is for, never the source.
    "Do the same coaching form for Liora Pellow",
    // Adds to the form, never a copy.
    "Add that she did the same thing as Liora Pellow last week",
    // Not a copy request.
    "create a coaching form for Liora Pellow",
  ])("not for: %s", (said) => {
    expect(asksCopyForNewPerson(said, "Liora Pellow", ROSTER)).toBe(false);
  });

  it("names a different form than the open one: not this path", () => {
    expect(asksCopyForNewPerson(SAME_DRAFT, "Teodric Sabrin", ROSTER)).toBe(false);
  });
});

describe("pendingCopyName — the turn after the ask, or the pending copy is dropped", () => {
  it("a roster person's full name, alone, is the new person", () => {
    expect(pendingCopyName("Teodric Sabrin", "Liora Pellow", ROSTER)).toBe("Teodric Sabrin");
    expect(pendingCopyName("teodric sabrin.", "Liora Pellow", ROSTER)).toBe("Teodric Sabrin");
    // Known by a preferred first name: the roster's own spelling comes back.
    expect(pendingCopyName("Cas Drummet", "Liora Pellow", ROSTER)).toBe("Caspian Drummet");
  });

  it.each([
    // Any other turn drops it.
    "what is the late opening policy?",
    "never mind",
    "yes",
    // A first name alone is not read here (the copy is dropped, the turn answered as before).
    "Teodric",
    // A name inside a sentence is that sentence's, not the answer to "who is it for?".
    "Teodric Sabrin was late opening on Monday",
    // The source herself is never the new person.
    "Liora Pellow",
    // Somebody not on the roster.
    "Marlo Quint",
  ])("dropped: %s", (said) => {
    expect(pendingCopyName(said, "Liora Pellow", ROSTER)).toBeNull();
  });
});

describe("withCopyFrom — only the named person's card of the same template carries the copy", () => {
  const source = { id: "f-liora", templateKey: "coaching", templateName: "Coaching Form", employeeName: "Liora Pellow" };
  const answer = (templateKey: string, employeeName: string | null): AskResponse =>
    ({
      content: "card",
      citations: [],
      recommendedVideoIds: [],
      formProposal: { proposalId: "p", templateKey, templateName: "x", employeeName, sourceMessageIds: [] },
    }) as unknown as AskResponse;

  it("Teodric's Coaching card", () => {
    expect(withCopyFrom(answer("coaching", "Teodric Sabrin"), source, "Teodric Sabrin").formProposal?.copyFromInstanceId).toBe("f-liora");
  });

  it.each([
    ["another template", answer("dpoa", "Teodric Sabrin")],
    ["the source's own person", answer("coaching", "Liora Pellow")],
    ["somebody else", answer("coaching", "Caspian Drummet")],
    ["no employee yet", answer("coaching", null)],
  ])("not on %s", (_label, given) => {
    expect(withCopyFrom(given, source, "Teodric Sabrin").formProposal?.copyFromInstanceId).toBeUndefined();
  });

  it("the turn is read as a request for that person's form of the same template", () => {
    expect(copyRequestFor(source, "Teodric Sabrin")).toBe("create a coaching form for Teodric Sabrin");
  });
});

describe("offeredCopyForTurn — sent back with the next turn only", () => {
  const user = (content: string) => ({ id: content, role: "user", content, createdAt: "" }) as ChatMessage;
  const ASKED = "Who is the new Coaching Form for?";
  const asked = { id: "a1", role: "assistant", content: ASKED, createdAt: "" } as ChatMessage;
  const offered = { fromInstanceId: "f-liora", answer: ASKED };

  it("right after the ask", () => {
    expect(offeredCopyForTurn(offered, [user(SAME_DRAFT), asked])).toBe("f-liora");
  });

  it("cleared once any other answer follows", () => {
    const answered = { id: "a2", role: "assistant", content: "The late opening policy says…", createdAt: "" } as ChatMessage;
    expect(offeredCopyForTurn(offered, [user(SAME_DRAFT), asked, user("what is the late opening policy?"), answered])).toBeUndefined();
  });

  it("never after a failed turn, and nothing when nothing was offered", () => {
    const failed = { ...asked, error: { kind: "network" } } as unknown as ChatMessage;
    expect(offeredCopyForTurn(offered, [user(SAME_DRAFT), failed])).toBeUndefined();
    expect(offeredCopyForTurn(undefined, [user(SAME_DRAFT), asked])).toBeUndefined();
  });
});
