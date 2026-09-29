import { salonById } from "@/data/salons";
import type { ChatFormProposal } from "@/types";

import { answerStatementText } from "./document";
import { EXIT_ANSWER_LINES, EXIT_DETAIL_LABEL, EXIT_OPTION } from "./exit-library";
import { EXIT_ROLE_LABEL, exitFactsSupplied, type ExitDateRole, type ExitFacts } from "./exit-facts";
import {
  exitDetailsSupplied,
  exitDetailValues,
  type ExitAnswerKey,
  type ExitDetails,
} from "./exit-details";

/**
 * ============================================================================
 * WHAT ASK SUNNY SAYS BESIDE A RESIGNATION/EXIT FORM PROPOSAL
 * ============================================================================
 *
 * Three situations, three answers, and the rule running through all of them is
 * the one the form needs most: SAY WHAT WAS FILLED, SAY WHAT WAS LEFT, ASK
 * ONLY FOR WHAT A USEFUL DRAFT IS MISSING.
 *
 *   NOTHING SUPPLIED ("pull up the exit form"). The short intake — who, how
 *   they left, the dates, anything for Details — in one message, because one
 *   question at a time is the interrogation nobody wants.
 *
 *   NO EMPLOYEE, but facts given. The one blocking question: who. A wrong name
 *   on somebody's exit paperwork is the failure nothing downstream undoes.
 *
 *   READY. The facts that will be prefilled, in the form's own labels — the
 *   Details lines in the exact sentences the form will print; the lines left
 *   blank for review; and questions for ONLY what is still missing: the last
 *   day and how they left, and HR's Details lines (the resignation date, how
 *   they told you, the reason, the key and store items, payroll deduction,
 *   minimum wage and bonus, rehire) that nothing the manager said answers —
 *   plus anything they said two ways. A yes/no answer is filled only from the
 *   manager's own words (`exit-details.ts`), never decided by Sunny.
 *
 * WHAT IS NEVER SAID. That the form is signed, filed or complete; that anybody
 * has been removed from MyGlow, taken off payroll or had their Sunlync account
 * changed. Creating a draft does none of that, and the closing line says so.
 *
 * The Details paragraph is drafted by the model after the form is created, so
 * it is described here as what it will be — never quoted.
 */

const TYPE_LABEL: Record<string, string> = {
  [EXIT_OPTION.submittedFulfilledNotice]: "Submitted & Fulfilled Notice",
  [EXIT_OPTION.immediateVoluntary]: "Immediate Voluntary Resignation",
  [EXIT_OPTION.immediateInvoluntary]: "Immediate involuntary separation",
  [EXIT_OPTION.noticeNotFulfilled]: "Did not fulfill required 14 day / 30 day notice",
  [EXIT_OPTION.noCallNoShow]: "No Call No Show",
};

/** The yes/no questions, named the way a manager reads them in a sentence. */
const YES_NO_SHORT: Record<ExitAnswerKey, string> = {
  store_items_returned: "store items returned",
  salon_key_returned: "salon key returned",
  payroll_deduction_applicable: "payroll deduction",
  dropped_to_minimum_wage: "minimum wage",
  forfeit_bonus: "bonus forfeiture",
  eligible_for_rehire: "rehire eligibility",
};

const ROLE_ORDER: Exclude<ExitDateRole, "resigned">[] = ["lastDayWorked", "noticeGiven", "noticeFulfilled"];

/** "2026-09-15" as "September 15, 2026". Read as a calendar date, never a time. */
export function exitDateInWords(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function list(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export const EXIT_DOES_NOT_ACT =
  "Creating the draft doesn't sign anything, remove anyone from MyGlow, change payroll or update Sunlync — the Steps to Finish Termination stay on the form for you to do once it's complete.";

/** The opening intake, for a manager who has only named the form. */
export function exitIntakeRequest(formName: string): string {
  return [
    `I can draft the **${formName}** here. Tell me:`,
    "",
    "1. The employee's full name.",
    "2. Their job title (optional).",
    "3. How they left — gave notice and worked it, quit immediately, didn't finish their notice, no call no show, or was already let go — and how they told you (in person, phone call, text message or email).",
    "4. The date they resigned, their last day worked, and the dates notice was given and fulfilled if there was notice.",
    "5. The reason they gave for leaving.",
    "6. Whether their store items and salon key were returned, whether payroll deduction applies, whether they'll be dropped to minimum wage and forfeit their bonus, and whether they're eligible for rehire.",
    "7. Anything else that belongs under Details.",
    "",
    "Anything you don't know yet stays blank for you to answer on the form — I won't answer it for you. If you give me their permanent address I'll put it on the form; otherwise it's yours to complete, with written notice attached, and the signature lines stay blank.",
  ].join("\n");
}

/** Who the form is for — one question, naming the candidates where there are some. */
export function exitEmployeeQuestion(formName: string, candidates: string[]): string {
  if (candidates.length > 1) {
    const names = candidates.map((name) => `**${name}**`);
    return `Which of them is this **${formName}** for — ${list(names).replace(/ and ([^,]*)$/, " or $1")}? Tell me and I'll fill in what you've already described.`;
  }
  return `Who is this **${formName}** for? Give me their name and I'll fill in what you've already described.`;
}

function ambiguityQuestion(facts: ExitFacts, details: ExitDetails): string[] {
  const dates = facts.ambiguities.map((entry) => {
    if (entry.kind === "date_conflict") {
      return `You gave more than one date for **${EXIT_ROLE_LABEL[entry.role]}** (${list(entry.dates.map(exitDateInWords))}). Which is it?`;
    }
    if (entry.kind === "weekday") {
      return `Which date is "${entry.phrase}" for **${EXIT_ROLE_LABEL[entry.role]}**?`;
    }
    return `You described this as both ${list(entry.described.map((label) => `**${label}**`))}. Which applies?`;
  });
  const answers = details.ambiguities.map(
    (entry) => `You answered **${YES_NO_SHORT[entry.key]}** both yes and no. Which is it?`,
  );
  return [...dates, ...answers];
}

export interface ExitReadyInput {
  proposal: ChatFormProposal;
  facts: ExitFacts;
  details: ExitDetails;
}

/** The prose beside a proposal that names the employee. */
export function exitReady({ proposal, facts, details }: ExitReadyInput): string {
  const filled: string[] = [`- **Name:** ${proposal.employeeName}`];
  if (proposal.employeeRole) filled.push(`- **Job Title:** ${proposal.employeeRole}`);
  /*
   * THE SALON, WHERE IT IS BOTH AUTHORIZED AND ON THE ROSTER. The create route
   * prints the roster's name for the validated id and nothing else, so this is
   * exactly the line the form will carry.
   */
  const salon = proposal.locationId ? salonById(proposal.locationId) : undefined;
  if (salon) filled.push(`- **Location:** ${salon.name}`);
  filled.push("- **Date:** the day the draft is created");
  for (const role of ROLE_ORDER) {
    const iso = facts[role];
    if (iso) filled.push(`- **${EXIT_ROLE_LABEL[role]}:** ${exitDateInWords(iso)}`);
  }
  const ticks = [...facts.noticeOptions, ...facts.typeOptions].map((key) => TYPE_LABEL[key]!);
  if (ticks.length > 0) filled.push(`- **Resignation Details:** ${ticks.join("; ")}`);
  /*
   * THE DETAILS LINES, IN THE FORM'S OWN SENTENCES. `answerStatementText`
   * over `EXIT_ANSWER_LINES` is exactly what the form and the PDF print, so
   * "Salon key was not returned. Employee will be payroll deducted $25…" here
   * is word for word what the manager will read on the page.
   */
  if (details.resignationDate) {
    filled.push(`- **${EXIT_DETAIL_LABEL.resignationDate}:** ${exitDateInWords(details.resignationDate)}`);
  }
  if (details.resignationMethod) {
    filled.push(`- **${EXIT_DETAIL_LABEL.resignationMethod}:** ${details.resignationMethod}`);
  }
  if (details.resignationReason) {
    filled.push(`- **${EXIT_DETAIL_LABEL.resignationReason}:** ${details.resignationReason}`);
  }
  const { checked } = exitDetailValues(details);
  for (const line of EXIT_ANSWER_LINES) {
    const sentence = answerStatementText(line, checked);
    if (sentence) filled.push(`- **${line.label}:** ${sentence}`);
  }
  /* The manager's own words, written as their statement — see `stated-address.ts`. */
  if (proposal.permanentAddress) filled.push(`- **Permanent Address:** ${proposal.permanentAddress}`);
  filled.push("- **Additional Details:** a short account drafted from what you've described");

  /*
   * LOCATION IS BLANK UNLESS AN AUTHORIZED ROSTER SALON SETTLED IT. A salon
   * typed into the conversation counts only when it is one this manager may
   * file against; see `proposeLocationFromConversation` and
   * `resolveLocationName` in the instances route.
   */
  const blank: string[] = [];
  if (!proposal.employeeRole) blank.push("Job Title");
  if (!salon) blank.push("Location");
  if (!proposal.permanentAddress) blank.push("Permanent Address");
  const unsetDates = ROLE_ORDER.filter((role) => !facts[role]).map((role) => EXIT_ROLE_LABEL[role]);
  blank.push(...unsetDates);
  if (ticks.length === 0) blank.push("the Resignation Details boxes");
  blank.push("written notice attached");
  blank.push("all three signature lines");

  const lines = [
    `Here's what I'll fill in on the **${proposal.templateName}** for **${proposal.employeeName}**:`,
    "",
    ...filled,
    "",
    `**Left blank for you to review:** ${list(blank)}.`,
  ];


  /*
   * THE QUESTIONS, AND ONLY THESE. An ambiguity is always asked — a guessed
   * last day is a payroll error. The last day and the manner of leaving are
   * asked when nothing was said about them, because an exit form without
   * either is not yet useful; everything else is a blank line the manager
   * fills on the form.
   */
  const questions = ambiguityQuestion(facts, details);
  const ambiguousRoles = new Set(
    facts.ambiguities.flatMap((entry) => (entry.kind === "separation_conflict" ? [] : [entry.role])),
  );
  const separationUnclear = facts.ambiguities.some((entry) => entry.kind === "separation_conflict");
  if (!facts.lastDayWorked && !ambiguousRoles.has("lastDayWorked")) {
    questions.push("What was their last day worked?");
  }
  if (ticks.length === 0 && !separationUnclear) {
    questions.push(
      "How did they leave — gave notice and worked it, quit immediately, didn't finish their notice, or no call no show?",
    );
  }
  questions.push(...detailQuestions(facts, details, ambiguousRoles));
  if (questions.length > 0) {
    lines.push(
      "",
      questions.length === 1 ? questions[0]! : ["Before you create it:", ...questions.map((question) => `- ${question}`)].join("\n"),
      /*
       * THE SHAPE OF AN ANSWER, because a bare "9/15" names no line and would
       * be left unplaced. "Last day 9/15" is read exactly.
       */
      'You can reply in a line — for example, "last day was 9/15, she quit on the spot by text because she\'s moving, returned her items but not her key, no payroll deduction, not eligible for rehire" — or create the draft now and fill those in on the form.',
    );
  }

  lines.push("", closingLine(proposal), "", EXIT_DOES_NOT_ACT);
  return lines.join("\n");
}

/**
 * ============================================================================
 * HR'S DETAILS LINES THAT NOTHING THE MANAGER SAID ANSWERS
 * ============================================================================
 *
 * Asked in the plain words a manager would use, one line each, and only for
 * what is missing. Two questions that are usually answered together — the
 * items and the key, minimum wage and the bonus — are asked together when
 * both are open. An answer given two ways is already asked by
 * `ambiguityQuestion` and is not asked twice.
 *
 * AN INVOLUNTARY SEPARATION IS NOT A RESIGNATION. Nobody "resigned", so the
 * resignation date, how they resigned and why are not asked; the lines stay
 * blank for the manager, and the yes/no answers are still asked.
 */
function detailQuestions(
  facts: ExitFacts,
  details: ExitDetails,
  ambiguousRoles: ReadonlySet<ExitDateRole>,
): string[] {
  const questions: string[] = [];
  const conflicted = new Set(details.ambiguities.map((entry) => entry.key));
  const open = (key: ExitAnswerKey) => !details.answers[key] && !conflicted.has(key);
  const involuntary = facts.typeOptions.includes(EXIT_OPTION.immediateInvoluntary);

  if (!involuntary) {
    if (!details.resignationDate && !ambiguousRoles.has("resigned")) {
      questions.push("What date did they resign or quit?");
    }
    if (!details.resignationMethod) {
      questions.push("How did they let you know — in person, phone call, text message, email, or no call/no show?");
    }
    if (!details.resignationReason) {
      questions.push("What reason did they give for leaving? (If they didn't give one, just say so.)");
    }
  }
  if (open("store_items_returned") && open("salon_key_returned")) {
    questions.push("Were their store items and salon key returned?");
  } else if (open("store_items_returned")) {
    questions.push("Were their store items returned?");
  } else if (open("salon_key_returned")) {
    questions.push("Was their salon key returned?");
  }
  if (open("payroll_deduction_applicable")) questions.push("Is payroll deduction applicable?");
  if (open("dropped_to_minimum_wage") && open("forfeit_bonus")) {
    questions.push("Will they be dropped to minimum wage and forfeit their bonus?");
  } else if (open("dropped_to_minimum_wage")) {
    questions.push("Will they be dropped to minimum wage?");
  } else if (open("forfeit_bonus")) {
    questions.push("Will they forfeit their bonus?");
  }
  if (open("eligible_for_rehire")) questions.push("Are they eligible for rehire?");
  return questions;
}

function closingLine(proposal: ChatFormProposal): string {
  if (!proposal.supportsInlineDraft) {
    return proposal.status === "needs_location"
      ? "Choose the salon on the card below, then create the draft."
      : "**Nothing has been created.** This is a proposal, not a form, and the published version of this form can't be drafted in chat — an administrator should check it under Form Templates.";
  }
  return proposal.locationResolution === "not_applicable"
    ? "Your account covers every salon, so this form won't name one. Create the draft here when you're ready and edit it below — nothing is saved to anyone's file until you do."
    : "Create the draft here when you're ready, and edit it below — nothing is saved to anyone's file until you do.";
}

/** Whether the manager has told us anything beyond naming the form. */
export function exitNothingSupplied(input: {
  facts: ExitFacts;
  details: ExitDetails;
  employeeKnown: boolean;
  jobTitleKnown: boolean;
}): boolean {
  return (
    !input.employeeKnown &&
    !input.jobTitleKnown &&
    !exitFactsSupplied(input.facts) &&
    !exitDetailsSupplied(input.details)
  );
}
