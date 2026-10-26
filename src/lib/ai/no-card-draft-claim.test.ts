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

/*
 * QA-7 (flag on, a reply with no card). Conditional and instructional truths
 * were rewritten as if they claimed a draft; a sentence with a true clause and
 * a false one was replaced whole, naming the wrong person. Only a claim that a
 * draft IS open or created NOW is rewritten, clause by clause, and the honest
 * line names the person of the false claim. QA's sentences, in lowercase,
 * sentence case and CAPS. "Rook Pemberly" stands in for QA's second name: an
 * invented name, the same in both apps.
 */
const QA7_REGISTERS = [
  ["as typed", (text: string) => text],
  ["all lowercase", lower],
  ["sentence case", sentenceCase],
  ["CAPS", (text: string) => text.toUpperCase()],
] as const;

const NAMES_NOBODY =
  "I haven't created a new form yet — say which form and who it's for (for example \"create a corrective action for\" and their name) and I'll put a card here.";

describe("QA-7: only a claim that a draft IS open or created now is rewritten", () => {
  it.each(QA7_REGISTERS)("%s: \"Once you press Create, the draft for Test Employee Two will open.\" is kept", (_label, recase) => {
    const content = recase("Once you press Create, the draft for Test Employee Two will open.");
    for (const context of [{ question: recase(QUESTION), openForm: OPEN }, { question: recase(QUESTION) }]) {
      expect(withoutPhantomDraftClaim(content, context)).toBe(content);
    }
  });

  it.each(QA7_REGISTERS)("%s: \"The form was not created because the salon was missing. Press Create after you add it.\" is kept", (_label, recase) => {
    const content = recase("The form was not created because the salon was missing. Press Create after you add it.");
    for (const context of [{ question: recase(QUESTION), openForm: OPEN }, { question: recase(QUESTION) }]) {
      expect(withoutPhantomDraftClaim(content, context)).toBe(content);
    }
  });

  it.each(QA7_REGISTERS)("%s: a policy answer's closing \"Press Create draft on the card below.\" with no card is dropped, naming nobody", (_label, recase) => {
    const policy = "Arriving late three times in 30 days is an attendance concern under the JBA Policy Manual.";
    const question = recase("Test Employee Two was late again, what does the policy say?");
    for (const context of [{ question, openForm: OPEN }, { question }]) {
      const out = withoutPhantomDraftClaim(recase(`${policy} Press Create draft on the card below.`), context);
      expect(out).toBe(recase(policy));
      expect(out).not.toMatch(/test employee two|press create/i);
    }
  });

  it.each(QA7_REGISTERS)("%s: a reply that is only a phantom-card instruction gets a line that names nobody", (_label, recase) => {
    const out = withoutPhantomDraftClaim(recase("Press Create draft on the card below."), {
      question: recase("Test Employee Two was late again, what does the policy say?"),
    });
    expect(out).toBe(NAMES_NOBODY);
  });

  it.each(QA7_REGISTERS)("%s: two clauses — the true one is kept and the honest line names Rook Pemberly", (_label, recase) => {
    const out = withoutPhantomDraftClaim(
      recase("The draft for Test Employee is open, and I've created a new draft for Rook Pemberly."),
      { question: recase("and one for Rook Pemberly, late today"), openForm: OPEN },
    );
    const kept = `${recase("The draft for Test Employee is open")}. `;
    expect(out.startsWith(kept), out).toBe(true);
    expect(out.slice(kept.length)).toMatch(
      /^I haven't created a form for rook pemberly yet — say "create a corrective action for rook pemberly" and I'll put a card here\.$/i,
    );
    expect(out).not.toMatch(/new form for test employee|I've created/i);
  });

  it("the false clause first: the honest line, then the true clause", () => {
    const out = withoutPhantomDraftClaim(
      "I've created a new draft for Rook Pemberly, and the draft for Test Employee is open.",
      { question: "and one for Rook Pemberly, late today", openForm: OPEN },
    );
    expect(out).toBe(
      "I haven't created a form for Rook Pemberly yet — say \"create a corrective action for Rook Pemberly\" and I'll put a card here. The draft for Test Employee is open.",
    );
  });

  it("several forms open from one message: a line about either is true, another person's is not", () => {
    const openForms: OpenFormSummary[] = [OPEN, { ...OPEN, employeeName: "Test Employee Two" }];
    const content = "The draft for Test Employee Two is open on the card above. When it's right, press Finalize on the card.";
    expect(withoutPhantomDraftClaim(content, { question: "is it ready?", openForms })).toBe(content);
    expect(
      withoutPhantomDraftClaim("The draft for Rook Pemberly is open.", { question: "is it ready?", openForms }),
    ).toMatch(/^I haven't created a form for Rook Pemberly yet/);
  });
});

/*
 * QA-6 re-probe of the QA-7 fix (flag on, a reply with no card). "Wren Alder"
 * is an invented name, the same in both apps. Each sentence in lowercase,
 * sentence case and CAPS.
 */
const QA6_REGISTERS = [
  ["all lowercase", lower],
  ["sentence case", sentenceCase],
  ["CAPS", (text: string) => text.toUpperCase()],
] as const;

describe("QA-6: claims in capitals, policy prose, and a known name that runs on", () => {
  it.each(QA6_REGISTERS)("%s: with another employee's form open, a draft claimed open or created for Wren Alder is rewritten", (_label, recase) => {
    for (const claim of ["A draft for Wren Alder is open.", "The draft for Wren Alder has been created."]) {
      const out = withoutPhantomDraftClaim(recase(claim), {
        question: recase("now one for Wren Alder, late today"),
        openForm: OPEN,
      });
      expect(out, claim).toMatch(
        /^I haven't created a form for wren alder yet — say "create a corrective action for wren alder" and I'll put a card here\.$/i,
      );
    }
  });

  it.each(QA6_REGISTERS)("%s: \"The policy says a draft form is open to review by the manager.\" is policy prose, not a claim", (_label, recase) => {
    const content = recase("The policy says a draft form is open to review by the manager.");
    const question = recase("what does the policy say for Wren Alder?");
    for (const context of [{ question }, { question, openForm: OPEN }]) {
      expect(withoutPhantomDraftClaim(content, context)).toBe(content);
    }
  });

  it.each(QA6_REGISTERS)("%s: with Test Employee's form open, \"the form has been created for test employee two late today.\" is rewritten", (_label, recase) => {
    const out = withoutPhantomDraftClaim(recase("the form has been created for test employee two late today."), {
      question: recase("is it ready?"),
      openForm: OPEN,
    });
    expect(out).toMatch(
      /^I haven't created a form for test employee two yet — say "create a corrective action for test employee two" and I'll put a card here\.$/i,
    );
  });

  it.each(QA6_REGISTERS)("%s: the true lines stay true: the open form's own employee, and a run-on that is not a name", (_label, recase) => {
    for (const content of [
      "The draft for Test Employee is open on the card above.",
      "The form has been created for Test Employee as requested.",
      "The draft for Test Employee has been created.",
    ]) {
      const typed = recase(content);
      expect(withoutPhantomDraftClaim(typed, { question: recase("is it ready?"), openForm: OPEN }), content).toBe(typed);
    }
  });
});
