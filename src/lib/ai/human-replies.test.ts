import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AskResponse } from "@/lib/ai/types";
import { isQuestionNotForm } from "@/lib/ai/question-not-form";
import { NO_INCIDENT_NOTE } from "@/lib/forms/corrective-action-intake";
import { PAYROLL_AMOUNT_QUESTION } from "@/lib/forms/payroll-amount-field";
import { payrollAmountReply, payrollDeductFromConversation, payrollDeductReply } from "@/lib/forms/payroll-deduct";
import { salonQuestionOpen } from "@/lib/forms/salon-reply";
import { levelAskedYesNo } from "@/lib/forms/warning-level";
import type { ChatFormProposal } from "@/types";

import { humanizeFormReply, humanPhrases, NOT_HERE, SHORT_SAVE_NOTICE } from "./human-replies";

/**
 * HUMAN_REPLIES_ENABLED — the Sunny tester's chats, 26 Oct 2026 (production,
 * real register, invented names). The owner: "humanize it". Each reply below
 * is the text main builds, word for word; each manager turn is tried in all
 * lowercase and in sentence case, the way managers type.
 */

const FLAG = "HUMAN_REPLIES_ENABLED";
const TODAY = "2026-10-26";

/* What main builds today. */
const CA_OPENER =
  "I'll draft a **Corrective Action Form** for **Avery Testperson** from what you've described, and check the applicable company policy before anything policy-related goes on it.";
const POLICY = "**Policy:** Late Opening, as you said. I'll quote that section from the current policy manual on the draft.";
const VERBAL = "**Type of Warning:** Verbal Warning, as you said — I'll tick it on the form. Tell me if that should change.";
const WRITTEN = "**Type of Warning:** Written Warning, as you said — I'll tick it on the form. Tell me if that should change.";
const PRIOR = "You'll set any prior coaching or corrective action on the form — I won't guess at it.";
const PAYROLL_ASK =
  "One more question: **Is payroll deduct applicable?** Yes or No? Tell me here, or tick it on the form — I won't answer it for you.";
const PAYROLL_NO = "Is payroll deduct applicable? **No** — tell me if that should change.";
const GLOBAL_NOTICE =
  "Your account covers every salon, so this form won't name one. Create the draft here when you're ready and edit it below — nothing is saved to anyone's file until you do.";
const SALON_NOTICE =
  "Create the draft here when you're ready, and edit it below — nothing is saved to anyone's file until you do.";
const COACHING_OPENER = "Here is what I would put on a **Coaching Form**.";
const COACHING_NOTICE =
  "I have the employee and the salon. Create the draft here when you're ready, and edit it below — nothing is saved to anyone's file until you do.";

/* What a manager reads instead. */
const HUMAN_CA_OPENER = "Here's the **Corrective Action Form** for **Avery Testperson**. I'll check the policy manual before citing anything.";
const HUMAN_POLICY = "**Policy:** Late Opening, as you said. I'll quote the manual's section on the draft.";
const HUMAN_VERBAL = "**Type of Warning:** Verbal Warning, like you said. I'll tick it on the form.";
const HUMAN_PRIOR = "You can set any prior coaching or corrective action on the form.";
const HUMAN_PAYROLL_ASK = "**Is payroll deduct applicable?** Yes or no — here or on the form.";
const HUMAN_GLOBAL_NOTICE = `It won't name a salon, since you cover them all. ${SHORT_SAVE_NOTICE}`;

function ca(...middle: string[]): string {
  return [CA_OPENER, POLICY, ...middle, GLOBAL_NOTICE].join("\n\n");
}

function coaching(messages: "message" | "messages"): string {
  return [COACHING_OPENER, `Everything I need is here, drawn from your ${messages} above.`, COACHING_NOTICE].join("\n\n");
}

function proposal(extra: Partial<ChatFormProposal> = {}): ChatFormProposal {
  return {
    proposalId: "p-1",
    templateKey: "dpoa",
    templateName: "Corrective Action Form",
    status: "ready",
    supportsInlineDraft: true,
    variantKey: null,
    employeeName: "Avery Testperson",
    employeeRole: null,
    locationId: null,
    locationName: null,
    locationResolution: "not_applicable",
    ...extra,
  } as ChatFormProposal;
}

function answer(content: string, card: ChatFormProposal | undefined = proposal()): AskResponse {
  return { content, citations: [], recommendedVideoIds: [], ...(card ? { formProposal: card } : {}) };
}

type Turn = { role: "user" | "assistant"; content: string };

/** The first card as the browser keeps it: already humanized. */
function firstCa(question = "create verbal CA for Avery Testperson, late opening the salon today"): Turn[] {
  const built = answer(ca(VERBAL, PRIOR, PAYROLL_ASK), proposal({ warningLevel: "verbal" }));
  return [
    { role: "user", content: question },
    { role: "assistant", content: humanizeFormReply(built, { history: [], question, today: TODAY }).content },
  ];
}

let saved: string | undefined;
beforeEach(() => {
  saved = process.env[FLAG];
  process.env[FLAG] = "true";
});
afterEach(() => {
  if (saved === undefined) delete process.env[FLAG];
  else process.env[FLAG] = saved;
});

/** A manager turn in all lowercase and in sentence case. */
function cases(words: string): [string][] {
  return [[words.toLowerCase()], [words.charAt(0).toUpperCase() + words.slice(1).toLowerCase()]];
}

describe("(4) the first card says it once, short", () => {
  it.each(cases("create verbal CA for Avery Testperson, late opening the salon today"))("%s", (question) => {
    const built = answer(ca(VERBAL, PRIOR, PAYROLL_ASK), proposal({ warningLevel: "verbal" }));
    const reply = humanizeFormReply(built, { history: [], question, today: TODAY });
    expect(reply.content).toBe(
      [HUMAN_CA_OPENER, HUMAN_POLICY, HUMAN_VERBAL, HUMAN_PRIOR, HUMAN_PAYROLL_ASK, HUMAN_GLOBAL_NOTICE].join("\n\n"),
    );
    expect(reply.formProposal).toBe(built.formProposal);
  });

  it.each(cases("coaching form for avery testperson, skipped a tour today"))("coaching: %s", (question) => {
    const card = proposal({ templateKey: "coaching", templateName: "Coaching Form" });
    const reply = humanizeFormReply(answer(coaching("message"), card), { history: [], question, today: TODAY });
    expect(reply.content).toBe(
      ["Here's the **Coaching Form**.", "I have everything I need from what you wrote.", `Got the employee and salon. ${SHORT_SAVE_NOTICE}`].join(
        "\n\n",
      ),
    );
  });
});

describe("the phrase table, sentence by sentence", () => {
  it.each([
    [
      "I'll draft a **SDIT EPP** for **Avery Testperson** from what you've described, and check the applicable JB & Associates policy before anything policy-related goes on it.",
      "Here's the **SDIT EPP** for **Avery Testperson**. I'll check JB & Associates policy before citing anything.",
    ],
    [
      "I have the employee. Your account covers every salon, so this form won't name one. Create the draft here when you're ready and edit it below — nothing is saved to anyone's file until you do.",
      `Got the employee. It won't name a salon, since you cover them all. ${SHORT_SAVE_NOTICE}`,
    ],
    [
      "This one is for the whole team, and I have the salon. Create the draft here when you're ready, and edit it below — nothing is saved to anyone's file until you do.",
      `It's for the whole team, and I have the salon. ${SHORT_SAVE_NOTICE}`,
    ],
    [
      "Your account covers every salon, so the form won't name one unless you did. Create the draft here when you're ready and edit it below — nothing is saved to anyone's file until you do.",
      `It won't name a salon unless you did, since you cover them all. ${SHORT_SAVE_NOTICE}`,
    ],
    [SALON_NOTICE, SHORT_SAVE_NOTICE],
    [
      "**Nothing has been created.** This is a proposal, not a form — I can't create this one in chat yet.",
      "**Nothing has been created.** I can't make this form in chat yet.",
    ],
    [
      "**Nothing has been created.** This is a proposal, not a form. To file one today, use Create a Form.",
      "**Nothing has been created.** To file it today, use Create a Form.",
    ],
    [
      "**Nothing has been created yet.** Choose the salon below, or tell me which one, and you can create the draft here.",
      "**Nothing has been created yet.** Pick the salon below, or tell me, and you can create the draft.",
    ],
    [
      "**Prior actions:** Coaching 10/1/2026, as you said. I'll list it on the form — tell me if that should change.",
      "**Prior actions:** Coaching 10/1/2026, like you said. I'll list it on the form.",
    ],
    [
      "**On file in Form Monitoring for Avery Testperson:** Coaching Form 10/1/2026. I'll list it under prior coaching and corrective action on the form — remove any that shouldn't count.",
      "**Already on file for Avery Testperson:** Coaching Form 10/1/2026. I'll add it as prior actions — remove any that shouldn't count.",
    ],
    [
      "You'll set the seven expectation marks on the form — I won't guess at them, and they don't hold the plan up.",
      "You can set the seven expectation marks on the form; they don't hold the plan up.",
    ],
    [PAYROLL_NO, "Payroll deduct: **No**."],
    ["**Payroll deduction amount** **$25** — tell me if that should change.", "**Payroll deduction amount:** **$25**."],
    [
      "Who is this **Corrective Action Form** for? Give me their name and I'll draft it from what you've told me — you can set the warning level and anything else on the form itself.",
      "Who is this **Corrective Action Form** for?",
    ],
    [
      "Who is this **Resignation/Exit Form** for? Give me their name and I'll fill in what you've already described.",
      "Who is this **Resignation/Exit Form** for?",
    ],
    [
      "Which of them is this **Resignation/Exit Form** for — **Avery Testperson** or **Jordan Testperson**? Tell me and I'll fill in what you've already described.",
      "Which of them is this **Resignation/Exit Form** for — **Avery Testperson** or **Jordan Testperson**?",
    ],
    ["Who is this form for? Tell me the employee's full name.", "Who is this form for? Full name, please."],
    ["I won't choose which salon this belongs to. Which salon is this about?", "Which salon is this about?"],
    [
      "**KS Topeka** isn't a salon on your assignment, so I can't file a form against it. Which of your salons is this about?",
      "**KS Topeka** isn't one of your salons. Which of your salons is this about?",
    ],
    [
      "I can't confirm which salon this would be filed against, so the proposal has none. A form can only name a salon Ask Sunny can verify you're assigned to.",
      "I can't confirm a salon you're assigned to, so I left it off.",
    ],
    [
      "Great, I can help you create a **Corrective Action Form**. To get started, please provide me with these details:",
      "Sure — for the **Corrective Action Form** I need:",
    ],
    [
      "Once I have that I'll prepare the Corrective Action Form and check the applicable company policy before anything policy-related goes on it.",
      "Then I'll draft it and check the policy manual.",
    ],
    [
      "I took **Avery Testperson** from earlier in this conversation — if this form is for somebody else, tell me who.",
      "I used **Avery Testperson** from earlier. If it's someone else, tell me who.",
    ],
    ["Your role cannot create a **SDIT EPP**, so I will not propose one.", "Your role can't create a **SDIT EPP**."],
    [
      "**Policy:** Attendance — missing the monthly meeting is an absence from a scheduled shift. I'll quote that section from the current policy manual on the draft; tell me if a different policy applies.",
      "**Policy:** Attendance — missing the monthly meeting is an absence from a scheduled shift. I'll quote it on the draft; tell me if it's another policy.",
    ],
    [
      NO_INCIDENT_NOTE,
      "**You haven't told me what happened yet.** Tell me and I'll cite the manual's section and page, or create it now and fill it in yourself.",
    ],
    [
      "Prior coaching is optional. No finalized record is in this app and no note was given, so the line stays blank. The draft can still be created.",
      "Prior coaching is optional — none on file and none given, so it stays blank.",
    ],
    [
      "Redrafted the **Corrective Action Form** for **Avery Testperson** from what you described.\n\n**Direct policy from official manual** now quotes the manual and cites its section and page.\n\nGive it a read below before you finalize.",
      "Updated the draft of the **Corrective Action Form** for **Avery Testperson** — the policy now quotes the manual, with its section and page.\n\nHave a look below before you finalize.",
    ],
  ])("%s", (before, after) => {
    expect(humanPhrases(before)).toBe(after);
    // Applied on the way out, card or no card.
    expect(humanizeFormReply(answer(before, undefined), { history: [], question: "ok", today: TODAY }).content).toBe(after);
  });

  it("the numbered intake list and the payroll amount question stay word for word", () => {
    const list = "1. The employee's full name\n2. What happened — the date and what you saw\n3. Is payroll deduct applicable? (Yes/No)";
    expect(humanPhrases(list)).toBe(list);
    expect(humanPhrases(PAYROLL_AMOUNT_QUESTION)).toBe(PAYROLL_AMOUNT_QUESTION);
  });
});

describe("(1) the opener is said once; a later turn says what changed", () => {
  it.each(cases("no deduct"))("%s", (question) => {
    const built = answer(ca(VERBAL, PRIOR, PAYROLL_NO), proposal({ warningLevel: "verbal", payrollDeduct: "no" }));
    const reply = humanizeFormReply(built, { history: firstCa(), question, today: TODAY });
    expect(reply.content).toBe(`Got it — no payroll deduct.\n\n${SHORT_SAVE_NOTICE}`);
    expect(reply.formProposal).toBe(built.formProposal);
  });

  it.each(cases("date is 10/14"))("%s", (question) => {
    const history: Turn[] = [
      ...firstCa(),
      { role: "user", content: "no deduct" },
      { role: "assistant", content: `Got it — no payroll deduct.\n\n${SHORT_SAVE_NOTICE}` },
    ];
    const card = proposal({ warningLevel: "verbal", payrollDeduct: "no", formDate: "2026-10-14" });
    const reply = humanizeFormReply(answer(ca(VERBAL, PRIOR, PAYROLL_NO), card), { history, question, today: TODAY });
    expect(reply.content).toBe(`Got it — the date's 10/14.\n\n${SHORT_SAVE_NOTICE}`);
  });

  it.each(cases("change it to written"))("%s", (question) => {
    const history: Turn[] = [
      ...firstCa(),
      { role: "user", content: "no deduct" },
      { role: "assistant", content: `Got it — no payroll deduct.\n\n${SHORT_SAVE_NOTICE}` },
      { role: "user", content: "date is 10/14" },
      { role: "assistant", content: `Got it — the date's 10/14.\n\n${SHORT_SAVE_NOTICE}` },
    ];
    const card = proposal({ warningLevel: "written", payrollDeduct: "no", formDate: "2026-10-14" });
    const reply = humanizeFormReply(answer(ca(WRITTEN, PRIOR, PAYROLL_NO), card), { history, question, today: TODAY });
    expect(reply.content).toBe(`Got it — it's a written warning.\n\n${SHORT_SAVE_NOTICE}`);
  });

  it.each(cases("date 10/14"))("coaching: %s", (question) => {
    const card = proposal({
      templateKey: "coaching",
      templateName: "Coaching Form",
      formDate: "2026-10-14",
      locationResolution: "resolved",
      locationId: "loc-1",
      locationName: "KS Lawrence",
    });
    const history: Turn[] = [
      { role: "user", content: "coaching form for avery testperson, skipped a tour today" },
      { role: "assistant", content: humanPhrases(coaching("message")) },
    ];
    const reply = humanizeFormReply(answer(coaching("messages"), card), { history, question, today: TODAY });
    expect(reply.content).toBe(`Got it — the date's 10/14.\n\n${SHORT_SAVE_NOTICE}`);
  });

  it.each(cases("date is 10/14 and make it written"))("two changes at once: %s", (question) => {
    const card = proposal({ warningLevel: "written", formDate: "2026-10-14" });
    const reply = humanizeFormReply(answer(ca(WRITTEN, PRIOR, PAYROLL_ASK), card), { history: firstCa(), question, today: TODAY });
    // The payroll question is still open, so it is still asked.
    expect(reply.content).toBe(`Got it — the date's 10/14 and it's a written warning.\n\n${HUMAN_PAYROLL_ASK}\n\n${SHORT_SAVE_NOTICE}`);
  });

  it.each(cases("she was also on her phone"))("a turn the card has no field for: %s", (question) => {
    const card = proposal({ warningLevel: "verbal" });
    const reply = humanizeFormReply(answer(ca(VERBAL, PRIOR, PAYROLL_ASK), card), { history: firstCa(), question, today: TODAY });
    expect(reply.content).toBe(`Got it — here's the card.\n\n${HUMAN_PAYROLL_ASK}\n\n${SHORT_SAVE_NOTICE}`);
  });

  it("a date from another year keeps its year", () => {
    const card = proposal({ warningLevel: "verbal", formDate: "2025-12-30" });
    const reply = humanizeFormReply(answer(ca(VERBAL, PRIOR, PAYROLL_ASK), card), {
      history: firstCa(),
      question: "date is 12/30/25",
      today: TODAY,
    });
    expect(reply.content.split("\n")[0]).toBe("Got it — the date's 12/30/2025.");
  });

  it.each(cases("No"))("a bare \"%s\" after the payroll question is read back as the payroll answer", (question) => {
    const card = proposal({ warningLevel: "verbal", payrollDeduct: "no" });
    const reply = humanizeFormReply(answer(ca(VERBAL, PRIOR, PAYROLL_NO), card), { history: firstCa(), question, today: TODAY });
    expect(reply.content).toBe(`Got it — no payroll deduct.\n\n${SHORT_SAVE_NOTICE}`);
  });

  it.each(cases("change it to written"))("read-backs side by side on one line: only the part not said before stays (%s)", (question) => {
    const line = (level: string) => `**Issue:** opened late · **Type of warning:** ${level} Warning, as you said — tell me if that should change`;
    const history: Turn[] = [firstCa()[0]!, { role: "assistant", content: humanPhrases([CA_OPENER, line("Verbal"), SALON_NOTICE].join("\n\n")) }];
    const built = answer([CA_OPENER, line("Written"), SALON_NOTICE].join("\n\n"), proposal({ warningLevel: "written" }));
    const reply = humanizeFormReply(built, { history, question, today: TODAY });
    expect(reply.content).toBe(`Got it — it's a written warning.\n\n${SHORT_SAVE_NOTICE}`);
  });

  it.each([[GLOBAL_NOTICE], [SALON_NOTICE], [COACHING_NOTICE]])("the save notice is on every card, short: %s", (notice) => {
    const content = [CA_OPENER, POLICY, VERBAL, notice].join("\n\n");
    const history: Turn[] = [firstCa()[0]!, { role: "assistant", content: humanPhrases(content) }];
    const reply = humanizeFormReply(answer(content, proposal({ warningLevel: "verbal" })), { history, question: "ok", today: TODAY });
    expect(reply.content).toBe(`Got it — here's the card.\n\n${SHORT_SAVE_NOTICE}`);
  });
});

/*
 * QA's hard requirement: a reader that parses the last assistant turn still
 * recognises the rewritten question. Ask → answer → next turn.
 */
describe("the readers still read the rewritten questions", () => {
  // The first card, as the manager reads it.
  const card = humanPhrases(ca(VERBAL, PRIOR, PAYROLL_ASK));

  it.each(cases("no"))("payroll: a bare \"%s\" answers the rewritten payroll question", (reply) => {
    expect(card).toContain(HUMAN_PAYROLL_ASK);
    expect(payrollDeductReply(reply, card)).toBe("no");
    expect(
      payrollDeductFromConversation([
        { role: "user", content: "create verbal CA for Avery Testperson" },
        { role: "assistant", content: card },
        { role: "user", content: reply },
      ]),
    ).toBe("no");
  });

  it.each(cases("yes"))("payroll: a bare \"%s\" answers it too", (reply) => {
    expect(payrollDeductReply(reply, card)).toBe("yes");
  });

  it.each(cases("$25"))("payroll amount: \"%s\" answers the amount question, kept word for word", (reply) => {
    const asked = humanPhrases(`Payroll deduct: **Yes**.\n\n${PAYROLL_AMOUNT_QUESTION}`);
    expect(payrollAmountReply(reply, asked)).toBe("$25");
  });

  it("salon: the rewritten salon question is still the open salon question", () => {
    const asked = humanPhrases(
      "Here is what I would put on a **Coaching Form**.\n\nI won't choose which salon this belongs to. Which salon is this about?",
    );
    expect(salonQuestionOpen([{ role: "assistant", content: asked }])).toBe(true);
  });

  it("warning level: the card's questions are not read as a yes/no about a level", () => {
    expect(levelAskedYesNo(card)).toBeNull();
  });

  it.each(cases("late opening"))("question-not-form: \"%s\" after the card reads the same as after main's card", (reply) => {
    expect(isQuestionNotForm(reply, [{ role: "assistant", content: card }])).toBe(
      isQuestionNotForm(reply, [{ role: "assistant", content: ca(VERBAL, PRIOR, PAYROLL_ASK) }]),
    );
  });

  it("\"You haven't told me what happened yet\" and \"**Nothing has been created\" keep their opening words", () => {
    expect(humanPhrases(NO_INCIDENT_NOTE)).toContain("You haven't told me what happened yet");
    expect(humanPhrases("**Nothing has been created.** This is a proposal, not a form — I can't create this one in chat yet.")).toMatch(
      /^\*\*Nothing has been created/,
    );
  });
});

describe("a question the knowledge base doesn't cover gets a short human answer", () => {
  it.each(cases("Sacramento, CA"))("%s", (question) => {
    const robotic: AskResponse = {
      content:
        "The knowledge base here is just a contacts and registration document for an outside agency — there's nothing in it about Sacramento, CA.",
      citations: [{ id: "c1" } as never],
      recommendedVideoIds: [],
    };
    const reply = humanizeFormReply(robotic, { history: [], question, today: TODAY });
    expect(reply.content).toBe(NOT_HERE);
    expect(reply.citations).toEqual([]);
  });

  it("an answer that uses the knowledge base is left alone", () => {
    const grounded: AskResponse = {
      content: "The knowledge base covers this: openers must be on time (Late Opening, JBA Policy Manual p.15).",
      citations: [],
      recommendedVideoIds: [],
    };
    expect(humanizeFormReply(grounded, { history: [], question: "late opening policy", today: TODAY }).content).toBe(grounded.content);
  });
});

describe("what is never changed", () => {
  it("a card for another employee starts again in full", () => {
    const content = ca(VERBAL, PRIOR, PAYROLL_ASK).replace("Avery Testperson", "Jordan Testperson");
    const reply = humanizeFormReply(answer(content, proposal({ employeeName: "Jordan Testperson" })), {
      history: firstCa(),
      question: "actually it's for jordan testperson",
      today: TODAY,
    });
    expect(reply.content).toBe(humanPhrases(content));
  });

  it("a card for another form starts again in full", () => {
    const card = proposal({ templateKey: "coaching", templateName: "Coaching Form" });
    const reply = humanizeFormReply(answer(coaching("messages"), card), {
      history: firstCa(),
      question: "make it a coaching form instead",
      today: TODAY,
    });
    expect(reply.content).toBe(humanPhrases(coaching("messages")));
  });

  it("\"Nothing has been created\" and \"You haven't told me what happened yet\" stay on a later turn", () => {
    const notCreated = "**Nothing has been created.** This is a proposal, not a form — I can't create this one in chat yet.";
    const content = [CA_OPENER, NO_INCIDENT_NOTE, notCreated].join("\n\n");
    const history: Turn[] = [firstCa()[0]!, { role: "assistant", content: humanPhrases(content) }];
    const reply = humanizeFormReply(answer(content), { history, question: "ok", today: TODAY });
    expect(reply.content).toBe(`Got it — here's the card.\n\n${humanPhrases(NO_INCIDENT_NOTE)}\n\n${humanPhrases(notCreated)}`);
  });

  it("a question that asks who it is for stays a question", () => {
    const who = answer("Who is this **Corrective Action Form** for?", proposal({ status: "needs_employee", employeeName: null }));
    expect(humanizeFormReply(who, { history: firstCa(), question: "ok", today: TODAY }).content).toBe(who.content);
  });

  it("flag off: the reply is exactly as built", () => {
    delete process.env[FLAG];
    const built = answer(ca(VERBAL, PRIOR, PAYROLL_NO), proposal({ warningLevel: "verbal", payrollDeduct: "no" }));
    expect(humanizeFormReply(built, { history: firstCa(), question: "no deduct", today: TODAY })).toBe(built);
  });
});

/*
 * QA, 26 Oct 2026 (the owner: "do not touch the successful green fixes"): the
 * humanizer is wording only. A card's content, a policy citation, a date, a
 * name, the Action Plan and the notes the confirmed-live fixes added pass
 * through unchanged, flag on.
 */
describe("confirmed-live content passes through unchanged", () => {
  it.each([
    ["the Action Plan left blank", "**Action Plan:** left blank for you to complete on the form."],
    ["Late Opening cited at p.15 only", "Late Opening Policy, JBA Policy Manual p.15"],
    ["the Observation of Offense", "**Observation of Offense:** Opened the salon 15 minutes late on 10/14/2026."],
    ["the date", "**Date:** 10/14/2026"],
    ["the employee and salon", "**Employee:** Avery Testperson\n**Salon:** KS Lawrence"],
    ["a note the draft added", "Note: the break room is not a client area, so the incident stays under Standards of Conduct."],
  ])("%s", (_label, content) => {
    expect(humanPhrases(content)).toBe(content);
    const reply = humanizeFormReply(answer(content, undefined), { history: [], question: "ca avery testperson late 10/14", today: TODAY });
    expect(reply.content).toBe(content);
  });

  it.each(cases("ca avery testperson opened late 15 min 10/14 verbal no deduct"))(
    "a short-command card: every name, date and policy in the reply is kept (%s)",
    (question) => {
      const built = answer(
        [CA_OPENER, POLICY, VERBAL, "**Date:** 10/14/2026", "Late Opening Policy, JBA Policy Manual p.15", PAYROLL_NO, SALON_NOTICE].join("\n\n"),
        proposal({ warningLevel: "verbal", payrollDeduct: "no", formDate: "2026-10-14" }),
      );
      const reply = humanizeFormReply(built, { history: [], question, today: TODAY });
      for (const kept of ["**Corrective Action Form**", "**Avery Testperson**", "Late Opening", "Verbal Warning", "**Date:** 10/14/2026", "JBA Policy Manual p.15", "**No**"]) {
        expect(reply.content).toContain(kept);
      }
      expect(reply.formProposal).toBe(built.formProposal);
    },
  );
});
