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
 * the one managers asked for (20 Oct 2026): DRAFT IT AND LET THEM EDIT. Say
 * what will be filled, say what will be left blank, and ask nothing a manager
 * can fill in on the form themselves.
 *
 *   NOTHING SUPPLIED ("pull up the exit form"). One question — who it is for —
 *   with an invitation to add whatever they already know in their own words.
 *   Not a numbered intake: every line it used to ask about is a line on the
 *   form they can fill in.
 *
 *   NO EMPLOYEE, but facts given. The one blocking question: who. A wrong name
 *   on somebody's exit paperwork is the failure nothing downstream undoes.
 *
 *   READY. The facts that will be prefilled, in the form's own labels — the
 *   Details lines in the exact sentences the form will print — and every line
 *   left blank for review, the unanswered Details lines among them. Nothing is
 *   asked except what the manager said two ways (two last days, a notice both
 *   worked and not worked, a key both returned and kept): those are left blank
 *   rather than guessed, and the manager is told which. A yes/no answer is
 *   filled only from the manager's own words (`exit-details.ts`), never
 *   decided by Sunny.
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
    `I can draft the **${formName}** for you. Who is it for?`,
    "",
    "Add anything you already know in your own words — how and when they left, why, what was returned, rehire — and I'll fill it in. Anything you leave out stays blank for you to fill in on the form, and the signature lines stay blank.",
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
  // EXIT_INTAKE_FIX_ENABLED: the address the manager typed (`readPermanentAddress`).
  if (details.permanentAddress) filled.push(`- **Permanent Address:** ${details.permanentAddress}`);
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
  if (!details.permanentAddress) blank.push("Permanent Address");
  const unsetDates = ROLE_ORDER.filter((role) => !facts[role]).map((role) => EXIT_ROLE_LABEL[role]);
  blank.push(...unsetDates);
  if (ticks.length === 0) blank.push("the Resignation Details boxes");
  blank.push(...blankDetailLines(facts, details));
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
   * NOTHING IS ASKED BUT A CONTRADICTION. A missing answer is a blank line the
   * manager fills on the form — asking for each one was the interrogation
   * managers said they did not want. Something said two ways is different: it
   * is left blank rather than guessed (a guessed last day is a payroll error),
   * and the manager is told so in one line each.
   */
  const conflicts = ambiguityQuestion(facts, details);
  if (conflicts.length > 0) {
    lines.push(
      "",
      conflicts.length === 1
        ? `${conflicts[0]!} I've left it blank until you say — or fix it on the form.`
        : ["I've left these blank because you said them two ways — tell me, or fix them on the form:", ...conflicts.map((question) => `- ${question}`)].join("\n"),
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
 * Named in the form's own labels so the manager can find them on the page. A
 * line answered two ways is blank too, and is also named by
 * `ambiguityQuestion`.
 *
 * AN INVOLUNTARY SEPARATION IS NOT A RESIGNATION. Nobody "resigned", so the
 * resignation date, how they resigned and why are not listed; the yes/no
 * lines still are.
 */
function blankDetailLines(facts: ExitFacts, details: ExitDetails): string[] {
  const blank: string[] = [];
  const involuntary = facts.typeOptions.includes(EXIT_OPTION.immediateInvoluntary);
  if (!involuntary) {
    if (!details.resignationDate) blank.push(EXIT_DETAIL_LABEL.resignationDate);
    if (!details.resignationMethod) blank.push(EXIT_DETAIL_LABEL.resignationMethod);
    if (!details.resignationReason) blank.push(EXIT_DETAIL_LABEL.resignationReason);
  }
  const { checked } = exitDetailValues(details);
  for (const line of EXIT_ANSWER_LINES) {
    const answered = line.parts.filter((part) => (checked[part.key] ?? []).length === 1).length;
    if (answered < line.parts.length) blank.push(line.label);
  }
  return blank;
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
