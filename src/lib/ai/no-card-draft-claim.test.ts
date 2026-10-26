import { describe, expect, it } from "vitest";

import {
  noCardNoDraftClaim,
  withoutPhantomDraftClaim,
} from "./no-card-draft-claim";
import type { AskResponse, OpenFormSummary } from "./types";

/**
 * The guard behind NO_CARD_NO_DRAFT_CLAIM_ENABLED (QA B22-2). The route test
 * (`api/chat/no-card-draft-claim-b22.test.ts`) carries QA's exact turn; these
 * pin the reading of each kind of claim. Invented names only.
 */

const OPEN: OpenFormSummary = {
  templateName: "Corrective Action Form",
  employeeName: "Test Employee",
  status: "draft",
  lines: [],
  unverifiedPolicy: [],
};

const QUESTION =
  "now one for Test Employee Two, Tanning Consultant, late today";

function reply(content: string, extra: Partial<AskResponse> = {}): AskResponse {
  return { content, citations: [], ...extra } as AskResponse;
}

describe("withoutPhantomDraftClaim", () => {
  it("replaces a draft claimed for another employee, and its Finalize line, once", () => {
    const out = withoutPhantomDraftClaim(
      "A new Corrective Action Form draft is open for Test Employee Two, Tanning Consultant, for arriving late on today's date, 2026-10-25. Press **Finalize** on the card when it's ready.",
      { question: QUESTION, openForm: OPEN },
    );
    expect(out).toBe(
      "I haven't created a form for Test Employee Two yet — say \"create a corrective action for Test Employee Two\" and I'll put a card here.",
    );
  });

  it("with no form open at all, a claimed draft and a Create instruction are both phantoms", () => {
    const out = withoutPhantomDraftClaim(
      "I've drafted the Corrective Action Form for Test Employee Two. Click Create on the card to save it.\n\nBeing late is an attendance matter.",
      { question: QUESTION },
    );
    expect(out).toMatch(/^I haven't created a form for Test Employee Two yet/);
    expect(out).not.toMatch(/Click Create|I've drafted/);
    expect(out).toMatch(/Being late is an attendance matter\.$/);
  });

  it("takes the person from the manager's turn when the claim names nobody", () => {
    const out = withoutPhantomDraftClaim("A new draft is ready on screen.", {
      question: QUESTION,
      openForm: OPEN,
    });
    expect(out).toMatch(/for Test Employee Two yet/);
  });

  it("keeps a true line about the open draft", () => {
    const content =
      "The draft for Test Employee is open on the card above. When it's right, press Finalize on the card.";
    expect(
      withoutPhantomDraftClaim(content, {
        question: "is it ready?",
        openForm: OPEN,
      }),
    ).toBe(content);
  });

  it("keeps a Create instruction while an earlier proposal card is waiting", () => {
    const content = "Press Create on the card above to save it.";
    expect(
      withoutPhantomDraftClaim(content, {
        question: "what now?",
        proposalPending: true,
      }),
    ).toBe(content);
  });

  it("leaves hedged and negated sentences, and replies with no claim, alone", () => {
    for (const content of [
      "Once the form is created, it shows up below.",
      "No form has been created for Test Employee Two yet.",
      "Late arrivals count toward attendance.",
    ]) {
      expect(
        withoutPhantomDraftClaim(content, {
          question: QUESTION,
          openForm: OPEN,
        }),
      ).toBe(content);
    }
  });
});

/*
 * Register rule (Pau): the manager's turn and the model's reply, all
 * lowercase and in sentence case with the names typed lowercase or
 * Capitalized. The person is found whatever the case, so a lowercase name in
 * a claim is still read as another employee.
 */
const lower = (text: string) => text.toLowerCase();
const sentenceCase = (text: string) =>
  text.toLowerCase().replace(/(^|[.!?]\s+|\n+)([a-z])/g, (_m, lead: string, first: string) => `${lead}${first.toUpperCase()}`);
const namesCapitalized = (text: string) =>
  sentenceCase(text).replace(/\btest employee( two)?\b/gi, (name) =>
    name.replace(/\b[a-z]/g, (letter) => letter.toUpperCase()),
  );

const REGISTERS = [
  ["as typed", (text: string) => text],
  ["all lowercase", lower],
  ["sentence case, names lowercase", sentenceCase],
  ["sentence case, names Capitalized", namesCapitalized],
] as const;

describe("withoutPhantomDraftClaim in any register", () => {
  it.each(REGISTERS)("%s: the B22-2 claim and its Finalize line are replaced, naming the employee", (_label, recase) => {
    const out = withoutPhantomDraftClaim(
      recase(
        "A new Corrective Action Form draft is open for Test Employee Two, Tanning Consultant, for arriving late on today's date, 2026-10-25. Press **Finalize** on the card when it's ready.",
      ),
      { question: recase(QUESTION), openForm: OPEN },
    );
    expect(out).not.toMatch(/draft is open|press \*\*finalize/i);
    expect(out).toMatch(/^I haven't created a form for test employee two yet — say "create a corrective action for test employee two"/i);
  });

  it.each(REGISTERS)("%s: a draft claimed open for another employee without \"new\" is still replaced", (_label, recase) => {
    const out = withoutPhantomDraftClaim(
      recase("The Corrective Action Form draft is open for Test Employee Two. Late arrivals count toward attendance."),
      { question: recase(QUESTION), openForm: OPEN },
    );
    expect(out).not.toMatch(/draft is open/i);
    expect(out).toMatch(/^I haven't created a form for test employee two yet/i);
    expect(out).toMatch(/late arrivals count toward attendance\.$/i);
  });

  it("a known first name does not cut a longer capitalised name short", () => {
    const out = withoutPhantomDraftClaim("The draft is open for Test Employee Two.", {
      question: "is it ready?",
      openForm: OPEN,
    });
    expect(out).toMatch(/^I haven't created a form for Test Employee Two yet/);
  });

  it.each(REGISTERS)("%s: a lowercase name that runs on into other words is still read", (_label, recase) => {
    const out = withoutPhantomDraftClaim(recase("A draft is open for Test Employee Two late today."), {
      question: recase("now one for Test Employee Two late today"),
      openForm: OPEN,
    });
    expect(out).toMatch(/^I haven't created a form for test employee two yet/i);
  });

  it.each(REGISTERS)("%s: a true line about the open draft is kept as it came", (_label, recase) => {
    const content = recase(
      "The draft for Test Employee is open on the card above. When it's right, press Finalize on the card.",
    );
    expect(withoutPhantomDraftClaim(content, { question: recase("is it ready?"), openForm: OPEN })).toBe(content);
  });

  it.each(REGISTERS)("%s: hedged and negated sentences are left alone", (_label, recase) => {
    for (const content of [
      "Once the form is created, it shows up below.",
      "No form has been created for Test Employee Two yet.",
    ]) {
      const typed = recase(content);
      expect(withoutPhantomDraftClaim(typed, { question: recase(QUESTION), openForm: OPEN })).toBe(typed);
    }
  });
});

describe("noCardNoDraftClaim", () => {
  it("returns a response that carries a card as it came", () => {
    for (const card of [
      { formProposal: { templateKey: "dpoa" } },
      { formProposals: [{ templateKey: "dpoa" }] },
      { formSelection: { options: [] } },
      { formUpdate: { instanceId: "i-1", updated: ["observation"] } },
      {
        formOpened: {
          instanceId: "i-2",
          templateName: "Corrective Action Form",
          revisesInstanceId: null,
        },
      },
    ]) {
      const response = reply(
        "A new Corrective Action Form draft is open for Test Employee Two. Press Finalize on the card.",
        card as Partial<AskResponse>,
      );
      expect(
        noCardNoDraftClaim(response, { question: QUESTION, openForm: OPEN }),
      ).toBe(response);
    }
  });

  it("returns the same object when nothing is claimed", () => {
    const response = reply("Late arrivals count toward attendance.");
    expect(
      noCardNoDraftClaim(response, { question: QUESTION, openForm: OPEN }),
    ).toBe(response);
  });
});
