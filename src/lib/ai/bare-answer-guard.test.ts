import { afterEach, describe, expect, it } from "vitest";

import type { ChatFormProposal } from "@/types";

import { bindBareAnswer, withBareAnswerBinding } from "./bare-answer-guard";
import type { AskRequest, AskResponse } from "./types";

/**
 * Ask Sunny conv_mvoehonm2pfrkng, 25 Oct 2026. The manager's turns and the
 * app's lines are copied exactly; the employee is invented (Rhea Dunmore).
 * The app's last question was payroll; the manager answered the prior
 * coaching point with "yes coaching for attendance", and the card set
 * Payroll deduct = Yes.
 */
const FLAG = "BARE_ANSWER_BINDING_ENABLED";
const saved = process.env[FLAG];
afterEach(() => {
  if (saved === undefined) delete process.env[FLAG];
  else process.env[FLAG] = saved;
});

function card(extra: Partial<ChatFormProposal> = {}): ChatFormProposal {
  return {
    proposalId: "prop-1",
    supportsInlineDraft: true,
    templateKey: "dpoa",
    templateName: "Corrective Action Form",
    variantKey: null,
    employeeName: "Rhea Dunmore",
    employeeRole: "Tanning Consultant",
    formDate: "2026-09-20",
    locationId: null,
    locationName: null,
    locationResolution: "not_applicable",
    authorizedLocationIds: [],
    status: "ready",
    sourceMessageIds: [],
    ...extra,
  };
}

const ASKED_PAYROLL = [
  "I'll draft a **Corrective Action Form** for **rhea dunmore** from what you've described, and check the applicable company policy before anything policy-related goes on it.",
  "",
  "**Prior actions:** Coaching — signed 09/01/2026, as you said. I'll list it on the form — tell me if that should change.",
  "",
  "One more question: **Is payroll deduct applicable?** Yes or No? Tell me here, or tick it on the form — I won't answer it for you.",
  "",
  "**Job title:** Tanning Consultant",
].join("\n");

const SET_YES = [
  "I'll draft a **Corrective Action Form** for **rhea dunmore** from what you've described, and check the applicable company policy before anything policy-related goes on it.",
  "",
  "**Prior actions:** Coaching — signed 09/01/2026, as you said. I'll list it on the form — tell me if that should change.",
  "",
  "Is payroll deduct applicable? **Yes** — tell me if that should change.",
  "",
  "One more question: **Payroll deduction amount**? Tell me the figure here, or type it on the form — I won't take it from the policy.",
  "",
  "**Job title:** Tanning Consultant",
  "",
  "**Payroll deduction:** Yes",
].join("\n");

const HISTORY = [
  { role: "user", content: "no prior ca, had coaching on 9-1-26. use attendance policy" },
  { role: "assistant", content: ASKED_PAYROLL, formProposal: card() },
];

const RESPONSE = { content: SET_YES, citations: [], formProposal: card({ payrollDeduct: "yes" }) } as unknown as AskResponse;

function ask(question: string, response: AskResponse = RESPONSE) {
  return withBareAnswerBinding(response, { question, history: HISTORY } as unknown as AskRequest);
}

function respondWith(proposal: ChatFormProposal, content: string): AskResponse {
  return { content, citations: [], formProposal: proposal } as unknown as AskResponse;
}

describe("BARE_ANSWER_BINDING_ENABLED off", () => {
  it("keeps Payroll Yes from 'yes coaching for attendance', as main does", () => {
    delete process.env[FLAG];
    expect(ask("yes coaching for attendance")).toBe(RESPONSE);
  });
});

describe("BARE_ANSWER_BINDING_ENABLED on", () => {
  it.each(["yes coaching for attendance", "Yes coaching for attendance", "Yes, coaching for attendance"])("does not read '%s' as the payroll answer", (turn) => {
    process.env[FLAG] = "on";
    const out = ask(turn);
    expect(out.formProposal?.payrollDeduct).toBeNull();
    expect(out.content).not.toContain("Is payroll deduct applicable? **Yes**");
    expect(out.content).not.toContain("**Payroll deduction:** Yes");
    expect(out.content).not.toContain("Payroll deduction amount");
    expect(out.content).toContain("**Is payroll deduct applicable?** Yes or No?");
    expect(out.content).toContain("**Prior actions:** Coaching — signed 09/01/2026");
  });

  it("still reads a bare 'yes' to the payroll question, and 'payroll deduct applies'", () => {
    process.env[FLAG] = "on";
    expect(ask("yes")).toBe(RESPONSE);
    expect(ask("Yes.")).toBe(RESPONSE);
    expect(ask("payroll deduct applies")).toBe(RESPONSE);
    expect(ask("1. Rhea Dunmore\n2. today\n3. late 9-20\n4. verbal\n5. coaching 9-1-26\n6. yes")).toBe(RESPONSE);
  });

  it("does not set payroll from a bare yes when payroll was not the question (exit form, conv_mvofnrm5217ss9v)", () => {
    process.env[FLAG] = "on";
    const exit = { ...card({ templateKey: "stc-exit", templateName: "Resignation/Exit Form" }) };
    const history = [{ role: "assistant", content: "Did they give notice?", formProposal: exit }];
    const response = {
      content: "Is payroll deduct applicable? **Yes** — tell me if that should change.",
      citations: [],
      formProposal: { ...exit, payrollDeduct: "yes" },
    } as unknown as AskResponse;
    const out = bindBareAnswer({ response, question: "yes", history });
    expect(out.formProposal?.payrollDeduct).toBeNull();
  });

  it("never makes a title, a salon, a level or a slot word the employee; a one-word name stays", () => {
    process.env[FLAG] = "on";
    for (const word of ["tc", "Tc", "verbal", "Verbal", "prior", "no prior", "No prior", "yes", "Yes", "f", "F"]) {
      const response = {
        content: `I'll draft a **Corrective Action Form** for **${word}** from what you've described.`,
        citations: [],
        formProposal: card({ employeeName: word }),
      } as unknown as AskResponse;
      const out = bindBareAnswer({ response, question: word, history: HISTORY });
      expect(out.formProposal?.employeeName).toBe("Rhea Dunmore");
      expect(out.content).toContain("**Rhea Dunmore**");
    }
    const named = { content: "for **Lisa**", citations: [], formProposal: card({ employeeName: "Lisa" }) } as unknown as AskResponse;
    expect(bindBareAnswer({ response: named, question: "Lisa", history: [] })).toBe(named);
  });

  it("puts a title given as a bare answer on Job title, not Employee", () => {
    process.env[FLAG] = "on";
    const response = { content: "for **tc**", citations: [], formProposal: card({ employeeName: "tc", employeeRole: null }) } as unknown as AskResponse;
    const out = bindBareAnswer({ response, question: "tc", history: [{ role: "assistant", content: "x", formProposal: card({ employeeRole: null }) }] });
    expect(out.formProposal?.employeeName).toBe("Rhea Dunmore");
    expect(out.formProposal?.employeeRole).toBe("Tanning Consultant");
  });

  it("never keeps a warning level as the Job title", () => {
    process.env[FLAG] = "on";
    const response = {
      content: "**Job title:** Verbal, as you said",
      citations: [],
      formProposal: card({ employeeRole: "Verbal" }),
    } as unknown as AskResponse;
    const out = bindBareAnswer({ response, question: "verbal", history: HISTORY });
    expect(out.formProposal?.employeeRole).toBe("Tanning Consultant");
    expect(out.content).toBe("**Job title:** Tanning Consultant, as you said");
  });

  it("'Yes' after 'Woven has <name>' puts that name on the card", () => {
    process.env[FLAG] = "on";
    const offered = card({ employeeName: "rhea dunmor", wovenCloseMatch: "Woven has Rhea Dunmore" });
    const history = [{ role: "assistant", content: "I'll draft a **Corrective Action Form** for **rhea dunmor**.", formProposal: offered }];
    const response = respondWith(card({ employeeName: "rhea dunmor", wovenCloseMatch: "Woven has Rhea Dunmore" }), "I'll draft a **Corrective Action Form** for **rhea dunmor**.");
    const out = bindBareAnswer({ response, question: "Yes", history });
    expect(out.formProposal?.employeeName).toBe("Rhea Dunmore");
    expect(out.content).toBe("I'll draft a **Corrective Action Form** for **Rhea Dunmore**.");
    // Two close names: a bare yes picks neither.
    const two = card({ employeeName: "rhea dunmor", wovenCloseMatch: "Woven has Rhea Dunmore or Rhea Dunmoore" });
    const both = respondWith(two, "x");
    expect(bindBareAnswer({ response: both, question: "yes", history: [{ role: "assistant", content: "x", formProposal: two }] })).toBe(both);
  });

  // QA, 26 Oct 2026: "doesn't apply" / "not applicable" to the payroll question left Payroll blank.
  it.each(["doesn't apply", "Doesn't apply", "DOESN'T APPLY", "not applicable", "Not applicable", "NOT APPLICABLE", "n/a", "N/A"])(
    "keeps Payroll No from '%s' to the payroll question",
    (answer) => {
      process.env[FLAG] = "on";
      const no = respondWith(card({ payrollDeduct: "no" }), "Is payroll deduct applicable? **No** — tell me if that should change.");
      expect(bindBareAnswer({ response: no, question: answer, history: HISTORY })).toBe(no);
    },
  );

  it("still does not take 'doesn't apply' as payroll when payroll was not the question", () => {
    process.env[FLAG] = "on";
    const asked = [{ role: "assistant", content: "What is the **Job title**? Tell me here.", formProposal: card() }];
    const no = respondWith(card({ payrollDeduct: "no" }), "Is payroll deduct applicable? **No** — tell me if that should change.");
    expect(bindBareAnswer({ response: no, question: "doesn't apply", history: asked }).formProposal?.payrollDeduct).toBeNull();
  });

  it.each(["verbal", "Verbal", "VERBAL", "written", "Written", "WRITTEN"])("leaves the warning level a bare '%s' sets", (answer) => {
    process.env[FLAG] = "on";
    const level = answer.toLowerCase() as "verbal" | "written";
    const asked = [...HISTORY.slice(0, 1), { role: "assistant", content: "Is this a **verbal** or **written** warning?", formProposal: card() }];
    const set = respondWith(card({ warningLevel: level }), `Warning level: **${level}** — tell me if that should change.`);
    expect(bindBareAnswer({ response: set, question: answer, history: asked })).toBe(set);
  });

  // qa-oct21-audit-e2e with the flag on: "no payroll deduct", then "verbal" — the earlier answer stays.
  it.each([
    ["no payroll deduct", "verbal"],
    ["No payroll deduct", "Verbal warning"],
    ["NO PAYROLL DEDUCT", "IT'S A VERBAL"],
  ])("keeps Payroll No said in an earlier turn ('%s'), then '%s'", (earlier, answer) => {
    process.env[FLAG] = "on";
    const history = [
      { role: "user", content: "ca for rhea dunmore, late 10-12" },
      { role: "assistant", content: "Is this a **verbal** or **written** warning?" },
      { role: "user", content: earlier },
      { role: "assistant", content: "Is this a **verbal** or **written** warning?" },
    ];
    const no = respondWith(card({ payrollDeduct: "no" }), "Is payroll deduct applicable? **No** — tell me if that should change.");
    expect(bindBareAnswer({ response: no, question: answer, history })).toBe(no);
  });

  // corrective-action-conversation with the flag on: "no" to the payroll question when another question follows it.
  it.each(["no", "No", "NO", "n/a"])("keeps Payroll No from '%s' when the payroll question is not the last line", (answer) => {
    process.env[FLAG] = "on";
    const asked = [
      {
        role: "assistant",
        content: "1. **Is payroll deduct applicable?** Yes or No? Tell me here, or tick it on the form — I won't answer it for you.\n\nAnything else to add?",
        formProposal: null,
      },
    ];
    const no = respondWith(card({ payrollDeduct: "no" }), "Is payroll deduct applicable? **No** — tell me if that should change.");
    expect(bindBareAnswer({ response: no, question: answer, history: asked })).toBe(no);
  });

  it("reads bare answers the same in lowercase and sentence case", () => {
    process.env[FLAG] = "on";
    const no = { content: "Is payroll deduct applicable? **No** — tell me if that should change.", citations: [], formProposal: card({ payrollDeduct: "no" }) } as unknown as AskResponse;
    for (const answer of ["no", "No", "No.", "yes", "Yes", "YES"]) {
      const response = /^y/i.test(answer) ? RESPONSE : no;
      expect(bindBareAnswer({ response, question: answer, history: HISTORY })).toBe(response);
    }
    for (const word of ["verbal", "Verbal", "VERBAL"]) {
      const out = bindBareAnswer({ response: { content: "x", citations: [], formProposal: card({ employeeRole: word }) } as unknown as AskResponse, question: word, history: HISTORY });
      expect(out.formProposal?.employeeRole).toBe("Tanning Consultant");
    }
  });
});
