import { field, type TemplateSeed } from "./catalog";
import type { AnswerStatementLine, FormBlock, FormDocument } from "./document";

/**
 * ============================================================================
 * THE RESIGNATION/EXIT FORM — THE PAPERWORK FOR SOMEBODY WHO IS LEAVING
 * ============================================================================
 *
 * Transcribed block for block from `STC Exit.docx`, the exit form the business
 * issues today. Its page header reads "Resignation/Exit Form" over "Sun Tan
 * City", so that is the letterhead and the name the library shows; "STC Exit"
 * is the file's name and is kept as a way to ASK for it (see
 * `template-intent.ts`), not as a title nobody printed.
 *
 * A SEPARATE FILE FROM `library.ts` for the reason `hiring-library.ts` is one:
 * the nine HR forms document somebody who is staying and being coached, and
 * this documents somebody who is going. It lands in its own category, carries
 * its own permission, and answers to a different source document.
 *
 * ============================================================================
 * WHO WRITES WHAT, AND WHY MOST OF IT IS NOT ASK SUNNY
 * ============================================================================
 *
 *   `system`   Name, Date, Job Title, Location — filled from the record at
 *              creation, exactly as on every other HR form. The form's own Date
 *              is the day the form is completed, never the last day worked.
 *
 *   derived    Last Day Worked, the two notice dates and the Resignation
 *              Details ticks. They are `ai` so a draft may carry them, but the
 *              MODEL NEVER WRITES THEM: the drafting route computes them from
 *              the manager's own words with `exit-facts.ts` and discards
 *              anything the model returned for those keys. A date nobody typed
 *              and a separation type nobody described cannot reach the record.
 *              "Immediate involuntary separation" is ticked only when the
 *              manager states an employer-initiated separation that has
 *              ALREADY HAPPENED ("Jane was terminated today"), never from
 *              intent or a question, and never by the model — see
 *              `completedInvoluntary` and `SENSITIVE_ACTION_OPTION_KEYS`.
 *
 *   `ai`       Details — the manager's account of the departure, in prose,
 *              guarded so it cannot answer the yes/no questions below, claim a
 *              signature, or say a termination step has been done.
 *
 *   `manager`  Permanent Address and EVERY yes/no question. Returned items,
 *              the salon key, payroll deduction, bonus forfeiture, minimum wage,
 *              written notice and rehire eligibility are decisions or
 *              verifications a person makes, and a draft that pre-ticked them
 *              would be Ask Sunny making an HR decision. `enforceResponsibilities`
 *              drops any value a model returns for them. Since revision 2 the
 *              ones HR's Details lines state are ticked from the MANAGER'S OWN
 *              WORDS when they gave the answer (`exit-details.ts`, through
 *              `applyStatedFacts`), and otherwise stay visibly blank until a
 *              manager answers. So are the resignation date, how and why.
 *
 *   signature  The three signature lines have no key. Nothing can write into
 *              them, and a draft is never presented as signed.
 *
 * ============================================================================
 * ON FIDELITY
 * ============================================================================
 *
 * Every heading, label, option and sentence is the Word document's own, with
 * the transcription rules the other libraries use: a trailing colon before a
 * blank is the label's punctuation ("Name:" is "Name"), and Word's "Click or
 * tap here to enter text" placeholders are the blanks, not text. Capitalisation
 * is the source's — "Immediate involuntary separation" is lower-case where
 * "Immediate Voluntary Resignation" is not, and that is not corrected here.
 *
 * TWO THINGS IN THE FILE ARE NOT REPRODUCED, and both are deliberate:
 *
 *   1  "Written notice attached?" is saved with its No box already ticked. A
 *      pre-ticked answer on a blank form is the last user's answer, not part of
 *      the form — the same rule the Round 2 interview applies to answers left
 *      in its file — and printing it would tell every future record that no
 *      notice was attached before anybody checked.
 *
 *   2  The bullet glyphs before the three Steps to Finish Termination. The
 *      steps are printed as the form's own instructions, in order, word for
 *      word; the renderer's fonts have no bullet, and a "?" in its place would
 *      be worse than none.
 *
 * THE STEPS ARE INSTRUCTIONS ON PAPER, NOT ACTIONS. "Remove employee from
 * MyGlow", "Notify home office", "Place comment on employee's Sunlync account"
 * are what a manager does after the form is complete. Creating, drafting or
 * finalizing this form does none of them — there is no MyGlow, payroll or
 * Sunlync integration in this codebase for it to call, and the steps carry no
 * field that could record them as done.
 */

/** A Yes / No question as the form prints it. Always the manager's. */
function yesNo(key: string, label: string): FormBlock {
  return {
    kind: "checkbox_group",
    key,
    label,
    options: [
      { key: "yes", label: "Yes" },
      { key: "no", label: "No" },
    ],
    responsibility: "manager",
    columns: 2,
  };
}

/**
 * The option keys of the two Resignation Details groups, named once.
 *
 * Deliberately NOT `termination` or `separation`: those words are escalation
 * keys in `pm-governance.ts`, and a form offering one is drafted under the
 * Performance Management Framework's ladder rules — which describe coaching a
 * current employee, not recording a departure. The involuntary option is kept
 * out of the MODEL's reach by `SENSITIVE_ACTION_OPTION_KEYS` instead.
 */
export const EXIT_NOTICE_GROUP = "resignation_notice";
export const EXIT_TYPE_GROUP = "resignation_type";
export const EXIT_OPTION = {
  submittedFulfilledNotice: "submitted_fulfilled_notice",
  immediateVoluntary: "immediate_voluntary_resignation",
  immediateInvoluntary: "immediate_involuntary_separation",
  noticeNotFulfilled: "notice_not_fulfilled",
  noCallNoShow: "no_call_no_show",
} as const;

export const EXIT_DATE_FIELDS = {
  lastDayWorked: "last_day_worked",
  noticeGiven: "notice_given_date",
  noticeFulfilled: "notice_fulfilled_date",
} as const;

/**
 * The yes/no questions, by key, in the form's order.
 *
 * Six are the Word document's. "Salon key was returned" is HR's (revision 2):
 * the Details section has to say whether the key came back, because a key that
 * did not is a $25 payroll deduction, and a statement needs an answer to read.
 */
export const EXIT_YES_NO_QUESTIONS: readonly { key: string; label: string }[] = [
  { key: "store_items_returned", label: "All store items were returned" },
  { key: "salon_key_returned", label: "Salon key was returned" },
  { key: "payroll_deduction_applicable", label: "Is Payroll Deduction applicable? *" },
  { key: "forfeit_bonus", label: "*Do they forfeit their bonus?" },
  { key: "dropped_to_minimum_wage", label: "*Are they to be dropped to minimum wage?" },
  { key: "written_notice_attached", label: "Written notice attached?" },
  { key: "eligible_for_rehire", label: "Is this employee eligible for rehire?" },
];

/**
 * The three Details lines HR added that are facts rather than yes/no answers.
 * `manager` fields: filled only from the manager's own words
 * (`exit-details.ts`), or by hand — never by the model.
 */
export const EXIT_DETAIL_FIELDS = {
  resignationDate: "resignation_date",
  resignationMethod: "resignation_method",
  resignationReason: "resignation_reason",
} as const;

/** The Details section's labelled lines, in HR's order and HR's words. */
export const EXIT_DETAIL_LABEL = {
  resignationDate: "Resignation Date",
  resignationMethod: "How Employee Resigned",
  resignationReason: "Reason for Resignation",
  storeItems: "Store Items Returned",
  salonKey: "Salon Key Returned",
  payrollDeduction: "Payroll Deduction",
  minimumWageBonus: "Minimum Wage / Bonus Forfeiture",
  rehire: "Eligible for Rehire",
} as const;

/** HR's required wording when the key did not come back. */
export const SALON_KEY_DEDUCTION_STATEMENT =
  "Employee will be payroll deducted $25 for the salon key.";

const yesNoStatement = (key: string, yes: string, no: string) => ({
  key,
  statements: { yes, no },
});

/**
 * The five Details lines that state a yes/no answer, in HR's order. Shared
 * with the chat (`exit-intake.ts`), so what Sunny says it filled is word for
 * word what the form prints.
 */
export const EXIT_ANSWER_LINES: AnswerStatementLine[] = [
  {
    label: EXIT_DETAIL_LABEL.storeItems,
    parts: [
      yesNoStatement(
        "store_items_returned",
        "Store items were returned.",
        "Store items were not returned.",
      ),
    ],
  },
  {
    label: EXIT_DETAIL_LABEL.salonKey,
    parts: [
      yesNoStatement(
        "salon_key_returned",
        "Salon key was returned.",
        `Salon key was not returned. ${SALON_KEY_DEDUCTION_STATEMENT}`,
      ),
    ],
  },
  {
    label: EXIT_DETAIL_LABEL.payrollDeduction,
    parts: [
      yesNoStatement(
        "payroll_deduction_applicable",
        "Payroll deduction is applicable.",
        "Payroll deduction is not applicable.",
      ),
    ],
  },
  {
    label: EXIT_DETAIL_LABEL.minimumWageBonus,
    parts: [
      yesNoStatement(
        "dropped_to_minimum_wage",
        "Employee will be dropped to minimum wage.",
        "Employee will not be dropped to minimum wage.",
      ),
      yesNoStatement("forfeit_bonus", "Employee will forfeit bonus.", "Employee will not forfeit bonus."),
    ],
    combined: {
      "yes+yes": "Employee will be dropped to minimum wage and forfeit bonus.",
      "yes+no": "Employee will be dropped to minimum wage and will not forfeit bonus.",
      "no+yes": "Employee will not be dropped to minimum wage and will forfeit bonus.",
      "no+no": "Employee will not be dropped to minimum wage and will not forfeit bonus.",
    },
  },
  {
    label: EXIT_DETAIL_LABEL.rehire,
    parts: [
      yesNoStatement(
        "eligible_for_rehire",
        "Employee is eligible for rehire.",
        "Employee is not eligible for rehire.",
      ),
    ],
  },
];

const FROM_MANAGER_DATE =
  "Filled only from a date the manager stated in the conversation. Left blank otherwise.";

export function exitFormDocument(): FormDocument {
  return {
    paper: "letter",
    /*
     * THE WORD SOURCE'S OWN LOOK, the same one the Coaching Form's source has:
     * centred headings over rules, the title and brand stacked in the header,
     * the Sun Tan City mark top right and a 1in page. The logo in this file is
     * a smaller copy of the same approved mark, so it resolves to the asset
     * already lifted from the Coaching Form rather than to a second copy of
     * the brand. The width is the file's own: 962025 EMU is 76pt.
     */
    style: {
      headingStyle: "rule",
      letterhead: "centered",
      margins: "wide",
      signatureLayout: "ruled",
      logo: { assetKey: "sun-tan-city", placement: "top-right", widthPt: 76 },
    },
    blocks: [
      { kind: "letterhead", brand: "Sun Tan City", title: "Resignation/Exit Form" },

      { kind: "section", label: "Employee Information" },
      {
        kind: "field_row",
        fields: [
          field("employee_name", "Name", "system"),
          field("form_date", "Date", "system", "date"),
        ],
      },
      {
        kind: "field_row",
        fields: [
          field("job_title", "Job Title", "system"),
          field("location", "Location", "system"),
        ],
      },
      {
        kind: "field_row",
        fields: [
          field("permanent_address", "Permanent Address", "manager"),
          field(EXIT_DATE_FIELDS.lastDayWorked, "Last Day Worked", "ai", "date", {
            help: FROM_MANAGER_DATE,
          }),
        ],
      },

      { kind: "section", label: "Resignation Details" },
      /*
       * TWO GROUPS, BECAUSE THE PAGE PUTS THE NOTICE DATES BETWEEN THEM. The
       * two dates belong to "Submitted & Fulfilled Notice" and are printed
       * directly beneath it, before the other four options; one group would
       * move them below all five. The Word form's boxes are independent ticks
       * either way, so nothing about what can be recorded changes.
       */
      {
        kind: "checkbox_group",
        key: EXIT_NOTICE_GROUP,
        options: [{ key: EXIT_OPTION.submittedFulfilledNotice, label: "Submitted & Fulfilled Notice" }],
        responsibility: "ai",
        columns: 2,
      },
      {
        kind: "field_row",
        fields: [
          field(EXIT_DATE_FIELDS.noticeGiven, "Date that notice was given", "ai", "date", {
            help: FROM_MANAGER_DATE,
          }),
          field(EXIT_DATE_FIELDS.noticeFulfilled, "Date that notice was fulfilled", "ai", "date", {
            help: FROM_MANAGER_DATE,
          }),
        ],
      },
      {
        kind: "checkbox_group",
        key: EXIT_TYPE_GROUP,
        options: [
          { key: EXIT_OPTION.immediateVoluntary, label: "Immediate Voluntary Resignation" },
          { key: EXIT_OPTION.immediateInvoluntary, label: "Immediate involuntary separation" },
          {
            key: EXIT_OPTION.noticeNotFulfilled,
            label: "Did not fulfill required 14 day / 30 day notice",
          },
          { key: EXIT_OPTION.noCallNoShow, label: "No Call No Show" },
        ],
        responsibility: "ai",
        columns: 2,
      },
      ...EXIT_YES_NO_QUESTIONS.map((question) => yesNo(question.key, question.label)),

      /*
       * ======================================================================
       * DETAILS — HR'S LABELLED LINES, THEN THE MANAGER'S ACCOUNT
       * ======================================================================
       *
       * Revision 2, from HR (Colene Schildt, 28 Sep 2026): Details must state
       * the resignation date, how and why the employee left, whether store
       * items and the salon key came back (a missing key is a $25 payroll
       * deduction), whether payroll deduction applies, whether they are
       * dropped to minimum wage and forfeit the bonus, and rehire eligibility.
       *
       * THE FIRST THREE ARE FIELDS; THE REST ARE THE TICKS ABOVE, SAID AGAIN.
       * The yes/no answers are stored once, in their groups, and
       * `answer_statements` prints each as HR's sentence — so the tick and
       * the sentence cannot disagree. An unanswered question prints a blank.
       */
      { kind: "section", label: "Details" },
      {
        kind: "field",
        field: field(EXIT_DETAIL_FIELDS.resignationDate, EXIT_DETAIL_LABEL.resignationDate, "manager", "date", {
          help: "The date the employee quit or resigned, as the manager gave it.",
        }),
      },
      {
        kind: "field",
        field: field(EXIT_DETAIL_FIELDS.resignationMethod, EXIT_DETAIL_LABEL.resignationMethod, "manager", "text", {
          help: "In person, phone call, text message, email, no call/no show, and so on.",
        }),
      },
      {
        kind: "field",
        field: field(EXIT_DETAIL_FIELDS.resignationReason, EXIT_DETAIL_LABEL.resignationReason, "manager", "text", {
          help: "The reason the employee gave, in the manager's words. Never supplied by Ask Sunny.",
        }),
      },
      { kind: "answer_statements", lines: EXIT_ANSWER_LINES },
      {
        kind: "field",
        field: field("details", "Additional Details", "ai", "long_text", {
          help:
            "Anything else the manager described about the departure, in their own facts. " +
            "Never an answer to the yes/no questions above, and never a statement that the form was signed or a step below was done.",
        }),
      },

      { kind: "section", label: "Acknowledgement of Receipt" },
      {
        kind: "acknowledgement",
        text: "By signing this form, I confirm that I understand the information in this resignation/exit form. Signing this form does not necessarily indicate that I agree with the information (use the back of this form for comments). I also confirm that my supervisor and I have discussed the resignation/exit.",
      },
      { kind: "signature_row", label: "Employee Signature", dateLabel: "Date" },
      { kind: "signature_row", label: "Supervisor Signature", dateLabel: "Date" },
      {
        kind: "signature_row",
        label: "District Manager/Witness Signature (when required)",
        dateLabel: "Date",
      },

      { kind: "section", label: "Steps to Finish Termination" },
      {
        kind: "paragraph",
        text: "Upload Exit Form to employee’s personal file and remove employee from MyGlow.",
      },
      {
        kind: "paragraph",
        text: "Notify home office of employee’s final date of employment for HR, Payroll, and Security System purposes.",
      },
      {
        kind: "paragraph",
        text: "Place comment on employee’s Sunlync account stating they are no longer employed, verify tanning has been removed.",
      },
    ],
  };
}

/**
 * The key the exit form is stored under. Taken from the source file's name,
 * which is how the business refers to it, and stable across any rename of the
 * display title.
 */
export const EXIT_TEMPLATE_KEY = "stc-exit";

/**
 * The Separation & Exit library.
 *
 * `displayOrder` 15 is the next free number after the Follow-Up Coaching Form's
 * 14, for the reason that one gives: `display_order` is written on INSERT only,
 * so renumbering anything already seeded would leave code and database
 * disagreeing.
 */
export const EXIT_TEMPLATE_SEEDS: TemplateSeed[] = [
  {
    key: EXIT_TEMPLATE_KEY,
    name: "Resignation/Exit Form",
    shortName: "Exit Form",
    description:
      "The STC exit paperwork for an employee who is leaving: how they left, their last day and notice, the payroll and rehire questions, and the steps to finish the termination.",
    category: "separation",
    layoutFamily: "exit",
    requiredPermission: "create_exit_form",
    displayOrder: 15,
    document: exitFormDocument(),
    variants: [],
    /*
     * 2: HR's Details lines (resignation date, how and why they resigned, the
     * salon key, and the yes/no answers as statements). A form already created
     * keeps the version it was pinned to; new ones get this one.
     */
    revision: 2,
    revisionNote:
      "Details section: resignation date, how and why the employee resigned, salon key returned, and the returned-items, payroll deduction, minimum wage/bonus and rehire answers as statements (HR request, 28 Sep 2026).",
    bundledPdfName: "Resignation Exit Form.pdf",
  },
];
