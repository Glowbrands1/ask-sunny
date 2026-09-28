import type { ChatFormProposal } from "@/types";

import { EXIT_OPTION, EXIT_YES_NO_QUESTIONS } from "./exit-library";
import { EXIT_ROLE_LABEL, exitFactsSupplied, type ExitDateRole, type ExitFacts } from "./exit-facts";

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
 *   READY. The facts that will be prefilled, in the form's own labels; the
 *   lines left blank for review, naming the six yes/no questions every time so
 *   nobody reads a blank as "Sunny decided No"; and at most a few questions —
 *   the last day worked and how they left when neither was said, and anything
 *   the manager said two ways.
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

/** The six yes/no questions, named the way a manager reads them in a sentence. */
const YES_NO_SHORT: Record<string, string> = {
  store_items_returned: "store items returned",
  payroll_deduction_applicable: "payroll deduction",
  forfeit_bonus: "bonus forfeiture",
  dropped_to_minimum_wage: "minimum wage",
  written_notice_attached: "written notice attached",
  eligible_for_rehire: "rehire eligibility",
};

const ROLE_ORDER: ExitDateRole[] = ["lastDayWorked", "noticeGiven", "noticeFulfilled"];

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

/** The yes/no questions, always the same six, always named. */
function yesNoLine(): string {
  return `the yes/no questions (${list(EXIT_YES_NO_QUESTIONS.map((question) => YES_NO_SHORT[question.key]!))})`;
}

export const EXIT_DOES_NOT_ACT =
  "Creating the draft doesn't sign anything, remove anyone from MyGlow, change payroll or update Sunlync — the Steps to Finish Termination stay on the form for you to do once it's complete.";

export const EXIT_INVOLUNTARY_NOTE =
  "You described an involuntary separation. I haven't ticked **Immediate involuntary separation** — a termination goes through your District Manager and the leadership process, so tick it yourself once it's approved.";

/** The opening intake, for a manager who has only named the form. */
export function exitIntakeRequest(formName: string): string {
  return [
    `I can draft the **${formName}** here. Tell me:`,
    "",
    "1. The employee's full name.",
    "2. Their job title (optional).",
    "3. How they left — gave notice and worked it, quit immediately, didn't finish their notice, no call no show, or let go.",
    "4. Their last day worked, and the dates notice was given and fulfilled if there was notice.",
    "5. Anything else that belongs under Details.",
    "",
    `I'll leave ${yesNoLine()} for you to answer on the form, and the signature lines stay blank.`,
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

function ambiguityQuestion(facts: ExitFacts): string[] {
  return facts.ambiguities.map((entry) => {
    if (entry.kind === "date_conflict") {
      return `You gave more than one date for **${EXIT_ROLE_LABEL[entry.role]}** (${list(entry.dates.map(exitDateInWords))}). Which is it?`;
    }
    if (entry.kind === "weekday") {
      return `Which date is "${entry.phrase}" for **${EXIT_ROLE_LABEL[entry.role]}**?`;
    }
    return `You described this as both ${list(entry.described.map((label) => `**${label}**`))}. Which applies?`;
  });
}

export interface ExitReadyInput {
  proposal: ChatFormProposal;
  facts: ExitFacts;
}

/** The prose beside a proposal that names the employee. */
export function exitReady({ proposal, facts }: ExitReadyInput): string {
  const filled: string[] = [`- **Name:** ${proposal.employeeName}`];
  if (proposal.employeeRole) filled.push(`- **Job Title:** ${proposal.employeeRole}`);
  filled.push("- **Date:** the day the draft is created");
  for (const role of ROLE_ORDER) {
    const iso = facts[role];
    if (iso) filled.push(`- **${EXIT_ROLE_LABEL[role]}:** ${exitDateInWords(iso)}`);
  }
  const ticks = [...facts.noticeOptions, ...facts.typeOptions].map((key) => TYPE_LABEL[key]!);
  if (ticks.length > 0) filled.push(`- **Resignation Details:** ${ticks.join("; ")}`);
  filled.push("- **Details:** a short account drafted from what you've described");

  /*
   * LOCATION IS ALWAYS LISTED AS BLANK, and that is accurate rather than modest.
   * The verified salon goes on the RECORD as an id, but no salon name is
   * printed from chat: there is no roster to take one from, and a salon typed
   * into the conversation is not something the server can verify. See
   * `resolveLocationName` in the instances route.
   */
  const blank: string[] = [];
  if (!proposal.employeeRole) blank.push("Job Title");
  blank.push("Location", "Permanent Address");
  const unsetDates = ROLE_ORDER.filter((role) => !facts[role]).map((role) => EXIT_ROLE_LABEL[role]);
  blank.push(...unsetDates);
  if (ticks.length === 0) blank.push("the Resignation Details boxes");
  blank.push(yesNoLine());
  blank.push("all three signature lines");

  const lines = [
    `Here's what I'll fill in on the **${proposal.templateName}** for **${proposal.employeeName}**:`,
    "",
    ...filled,
    "",
    `**Left blank for you to review:** ${list(blank)}.`,
  ];

  if (facts.involuntaryDescribed) lines.push("", EXIT_INVOLUNTARY_NOTE);

  /*
   * THE QUESTIONS, AND ONLY THESE. An ambiguity is always asked — a guessed
   * last day is a payroll error. The last day and the manner of leaving are
   * asked when nothing was said about them, because an exit form without
   * either is not yet useful; everything else is a blank line the manager
   * fills on the form.
   */
  const questions = ambiguityQuestion(facts);
  const ambiguousRoles = new Set(
    facts.ambiguities.flatMap((entry) => (entry.kind === "separation_conflict" ? [] : [entry.role])),
  );
  const separationUnclear = facts.ambiguities.some((entry) => entry.kind === "separation_conflict");
  if (!facts.lastDayWorked && !ambiguousRoles.has("lastDayWorked")) {
    questions.push("What was their last day worked?");
  }
  if (ticks.length === 0 && !facts.involuntaryDescribed && !separationUnclear) {
    questions.push(
      "How did they leave — gave notice and worked it, quit immediately, didn't finish their notice, or no call no show?",
    );
  }
  if (questions.length > 0) {
    lines.push(
      "",
      questions.length === 1 ? questions[0]! : ["Before you create it:", ...questions.map((question) => `- ${question}`)].join("\n"),
      /*
       * THE SHAPE OF AN ANSWER, because a bare "9/15" names no line and would
       * be left unplaced. "Last day 9/15" is read exactly.
       */
      'You can reply in a line — for example, "last day was 9/15, she quit on the spot" — or create the draft now and fill those in on the form.',
    );
  }

  lines.push("", closingLine(proposal), "", EXIT_DOES_NOT_ACT);
  return lines.join("\n");
}

function closingLine(proposal: ChatFormProposal): string {
  if (!proposal.supportsInlineDraft) {
    return proposal.status === "needs_location"
      ? "Choose the salon on the card below, then create the draft."
      : "**Nothing has been created.** This is a proposal, not a form. To file one today, use Create a Form.";
  }
  return proposal.locationResolution === "not_applicable"
    ? "Your account covers every salon, so this form won't name one. Create the draft here when you're ready and edit it below — nothing is saved to anyone's file until you do."
    : "Create the draft here when you're ready, and edit it below — nothing is saved to anyone's file until you do.";
}

/** Whether the manager has told us anything beyond naming the form. */
export function exitNothingSupplied(input: {
  facts: ExitFacts;
  employeeKnown: boolean;
  jobTitleKnown: boolean;
}): boolean {
  return !input.employeeKnown && !input.jobTitleKnown && !exitFactsSupplied(input.facts);
}
