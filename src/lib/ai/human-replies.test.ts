import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AskResponse } from "@/lib/ai/types";
import type { ChatFormProposal } from "@/types";

import { humanizeFormReply } from "./human-replies";

/**
 * HUMAN_REPLIES_ENABLED — the Sunny tester's chats, 26 Oct 2026 (production,
 * real register, invented names). The owner: "humanize it". Each reply below
 * is the text main builds, word for word; each manager turn is tried in all
 * lowercase and in sentence case, the way managers type.
 *
 * Changed on purpose (QA's ruling (b), 12 Nov 2026): a later turn replaces the
 * opener ONLY. These tests used to expect read-backs left out, a short save
 * notice and the "·" parts trimmed; with those the replay pack's 54 multi-turn
 * cases lost the card's Policy line and read-backs. Now every line after the
 * opener is the card as built, word for word.
 */

const FLAG = "HUMAN_REPLIES_ENABLED";
const TODAY = "2026-10-26";

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

function answer(content: string, card: ChatFormProposal = proposal()): AskResponse {
  return { content, citations: [], recommendedVideoIds: [], formProposal: card };
}

type Turn = { role: "user" | "assistant"; content: string };

const FIRST_CA: Turn[] = [
  { role: "user", content: "create verbal CA for Avery Testperson, late opening the salon today" },
  { role: "assistant", content: ca(VERBAL, PRIOR, PAYROLL_ASK) },
];

let saved: string | undefined;
beforeEach(() => {
  saved = process.env[FLAG];
  process.env[FLAG] = "true";
});
afterEach(() => {
  if (saved === undefined) delete process.env[FLAG];
  else process.env[FLAG] = saved;
});

function cases(words: string): [string][] {
  return [[words.toLowerCase()], [words.charAt(0).toUpperCase() + words.slice(1).toLowerCase()]];
}

/** The reply a later turn gets: the acknowledgement, then the built reply without its opener, word for word. */
const CA_LEAD = "I'll draft a **Corrective Action Form** for **Avery Testperson**";

/** A Corrective Action card keeps its lead ("I'll draft a **<form>** for **<name>** — got it, …"); the turn readers need it. */
function lead(ack: string, built: string): string {
  return built.startsWith(CA_LEAD) ? `${CA_LEAD} — ${ack.replace(/^Got it — /, "got it, ")}` : ack;
}

function later(ack: string, built: string): string {
  const rest = built.split("\n").slice(1);
  while (rest.length > 0 && (rest[0]!.trim() === "" || /^Everything I need is here/.test(rest[0]!.trim()))) rest.shift();
  return [lead(ack, built), rest.join("\n")].join("\n\n");
}

describe("(1) the opener is said once; a later turn says what changed, and nothing else changes", () => {
  it.each(cases("no deduct"))("%s", (question) => {
    const built = answer(ca(VERBAL, PRIOR, PAYROLL_NO), proposal({ warningLevel: "verbal", payrollDeduct: "no" }));
    const reply = humanizeFormReply(built, { history: FIRST_CA, question, today: TODAY });
    expect(reply.content).toBe(later("Got it — no payroll deduct.", built.content));
    expect(reply.formProposal).toBe(built.formProposal);
  });

  it.each(cases("date is 10/14"))("%s", (question) => {
    const card = proposal({ warningLevel: "verbal", payrollDeduct: "no", formDate: "2026-10-14" });
    const built = answer(ca(VERBAL, PRIOR, PAYROLL_NO), card);
    const reply = humanizeFormReply(built, { history: FIRST_CA, question, today: TODAY });
    expect(reply.content).toBe(later("Got it — the date's 10/14.", built.content));
  });

  it.each(cases("change it to written"))("%s", (question) => {
    const card = proposal({ warningLevel: "written", payrollDeduct: "no", formDate: "2026-10-14" });
    const built = answer(ca(WRITTEN, PRIOR, PAYROLL_NO), card);
    const reply = humanizeFormReply(built, { history: FIRST_CA, question, today: TODAY });
    expect(reply.content).toBe(later("Got it — it's a written warning.", built.content));
  });

  it.each(cases("date 10/14"))("coaching: %s", (question) => {
    const history: Turn[] = [
      { role: "user", content: "coaching form for avery testperson, skipped a tour today" },
      { role: "assistant", content: coaching("message") },
    ];
    const card = proposal({ templateKey: "coaching", templateName: "Coaching Form", formDate: "2026-10-14", locationResolution: "resolved", locationId: "loc-1", locationName: "KS Lawrence" });
    const built = answer(coaching("messages"), card);
    const reply = humanizeFormReply(built, { history, question, today: TODAY });
    expect(reply.content).toBe(`Got it — the date's 10/14.\n\n${COACHING_NOTICE}`);
  });

  it.each(cases("date is 10/14 and make it written"))("two changes at once: %s", (question) => {
    const built = answer(ca(WRITTEN, PRIOR, PAYROLL_ASK), proposal({ warningLevel: "written", formDate: "2026-10-14" }));
    const reply = humanizeFormReply(built, { history: FIRST_CA, question, today: TODAY });
    expect(reply.content).toBe(later("Got it — the date's 10/14 and it's a written warning.", built.content));
  });

  it.each(cases("she was also on her phone"))("a turn the card has no field for: %s", (question) => {
    const built = answer(ca(VERBAL, PRIOR, PAYROLL_ASK), proposal({ warningLevel: "verbal" }));
    const reply = humanizeFormReply(built, { history: FIRST_CA, question, today: TODAY });
    expect(reply.content).toBe(later("Got it — here's the card.", built.content));
  });

  it("a date from another year keeps its year", () => {
    const card = proposal({ warningLevel: "verbal", formDate: "2025-12-30" });
    const reply = humanizeFormReply(answer(ca(VERBAL, PRIOR, PAYROLL_ASK), card), {
      history: FIRST_CA,
      question: "date is 12/30/25",
      today: TODAY,
    });
    expect(reply.content.split("\n")[0]).toBe(`${CA_LEAD} — got it, the date's 12/30/2025.`);
  });
});

describe("(2) every card line after the opener stays (QA's ruling (b))", () => {
  it.each([[GLOBAL_NOTICE], [SALON_NOTICE], [COACHING_NOTICE]])("the Policy line, the read-back and the full save notice: %s", (notice) => {
    const content = [CA_OPENER, POLICY, VERBAL, PAYROLL_NO, notice].join("\n\n");
    const history: Turn[] = [FIRST_CA[0]!, { role: "assistant", content }];
    const reply = humanizeFormReply(answer(content, proposal({ warningLevel: "verbal", payrollDeduct: "no" })), { history, question: "ok", today: TODAY });
    expect(reply.content).toBe([`${CA_LEAD} — got it, here's the card.`, POLICY, VERBAL, PAYROLL_NO, notice].join("\n\n"));
  });

  it("read-backs side by side on one line stay whole", () => {
    const line = "**Issue:** opened late · **Type of warning:** Written Warning, as you said — tell me if that should change";
    const built = answer([CA_OPENER, line, SALON_NOTICE].join("\n\n"), proposal({ warningLevel: "written" }));
    const reply = humanizeFormReply(built, { history: FIRST_CA, question: "change it to written", today: TODAY });
    expect(reply.content).toBe([`${CA_LEAD} — got it, it's a written warning.`, line, SALON_NOTICE].join("\n\n"));
  });
});

describe("what is never changed", () => {
  it("the first card turn", () => {
    const built = answer(ca(VERBAL, PRIOR, PAYROLL_ASK), proposal({ warningLevel: "verbal" }));
    const reply = humanizeFormReply(built, { history: [], question: FIRST_CA[0]!.content, today: TODAY });
    expect(reply).toBe(built);
  });

  it("a card for another employee starts again in full", () => {
    const built = answer(ca(VERBAL, PRIOR, PAYROLL_ASK).replace("Avery Testperson", "Jordan Testperson"), proposal({ employeeName: "Jordan Testperson" }));
    const reply = humanizeFormReply(built, { history: FIRST_CA, question: "actually it's for jordan testperson", today: TODAY });
    expect(reply).toBe(built);
  });

  it("a card for another form starts again in full", () => {
    const card = proposal({ templateKey: "coaching", templateName: "Coaching Form" });
    const built = answer(coaching("messages"), card);
    const reply = humanizeFormReply(built, { history: FIRST_CA, question: "make it a coaching form instead", today: TODAY });
    expect(reply).toBe(built);
  });

  it("\"Nothing has been created\" and \"You haven't told me what happened yet\" stay", () => {
    const notCreated = "**Nothing has been created.** This is a proposal, not a form — I can't create this one in chat yet.";
    const noIncident = "**You haven't told me what happened yet**, so I can't cite the policy manual.";
    const content = [CA_OPENER, noIncident, notCreated].join("\n\n");
    const history: Turn[] = [FIRST_CA[0]!, { role: "assistant", content }];
    const reply = humanizeFormReply(answer(content), { history, question: "ok", today: TODAY });
    expect(reply.content).toBe(`${CA_LEAD} — got it, here's the card.\n\n${noIncident}\n\n${notCreated}`);
  });

  it("a reply without a card, or one that asks who it is for", () => {
    const plain: AskResponse = { content: CA_OPENER, citations: [], recommendedVideoIds: [] };
    expect(humanizeFormReply(plain, { history: FIRST_CA, question: "ok", today: TODAY })).toBe(plain);
    const who = answer("Who is this **Corrective Action Form** for?", proposal({ status: "needs_employee", employeeName: null }));
    expect(humanizeFormReply(who, { history: FIRST_CA, question: "ok", today: TODAY })).toBe(who);
  });

  it("flag off: the reply is as built", () => {
    delete process.env[FLAG];
    const built = answer(ca(VERBAL, PRIOR, PAYROLL_NO), proposal({ warningLevel: "verbal", payrollDeduct: "no" }));
    expect(humanizeFormReply(built, { history: FIRST_CA, question: "no deduct", today: TODAY })).toBe(built);
  });
});
