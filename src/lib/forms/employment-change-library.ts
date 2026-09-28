import { field, type TemplateSeed } from "./catalog";
import type { FormBlock, FormDocument } from "./document";

/**
 * ============================================================================
 * EMPLOYMENT CHANGE FORMS — DEMOTION, POSITION TRANSFER, RESIGNATION/EXIT
 * ============================================================================
 *
 * The forms that record a CHANGE to somebody's employment: their title, their
 * salon, their status, their pay, or the end of it. Separate from `library.ts`
 * for the reason the hiring forms are: they answer to different source
 * documents (GlowBrands' own Word files) and grow at different times.
 *
 * ============================================================================
 * WHO FILLS WHAT, AND WHY THE FACTS ARE NEVER DRAFTED
 * ============================================================================
 *
 *   `system`   Employee Name, Date, Job Title and Location — the four lines
 *              `createInstance` already fills from the record. On these forms
 *              Job Title and Location are the CURRENT ones; the chat path
 *              passes the title the manager moved the employee FROM, never
 *              the one they are moving TO. See `employment-change.ts`.
 *
 *   `manager`  Every fact about the change: statuses, pay rates, the new title
 *              and salon, voluntary or involuntary, and on the exit form every
 *              yes/no. A model is structurally unable to write these —
 *              `enforceResponsibilities` drops anything it returns for them —
 *              so a demotion cannot come back marked Involuntary, or a pay rate
 *              appear, because a sentence sounded like it. What Ask Sunny DOES
 *              put in them comes from the manager's own words, read
 *              deterministically; see `STATED_FACT_KEYS` below.
 *
 *   `ai`       The reason / details paragraph only. It is prose, the manager
 *              has usually already said it, and the drafting guards (no
 *              invented dates, figures or placeholders) apply to it.
 *
 * ============================================================================
 * ON FIDELITY
 * ============================================================================
 *
 * Labels, option wording, the demotion form's printed example and both
 * acknowledgements are transcribed from the supplied documents
 * (`Demotion Form (3).docx`, `Position Transfer Form.docx`). The same rules the
 * hiring library applies hold here: a trailing colon is Word punctuation, and
 * the business's own wording — including "dd/mm/yyyy" on a U.S. form — is not
 * corrected.
 *
 * `STC Demotion Example.docx` is NOT a template. It is the same document as the
 * Demotion Form (the text is identical; only the title's line break differs),
 * kept by the business as a reference for how a completed one reads. It shapes
 * how the reason is drafted and nothing else — there is exactly one Demotion
 * Form in the library.
 *
 * WHY `layoutFamily` IS "coaching". The column is a Postgres enum, and adding a
 * value is a migration that must be approved and applied before the seeder can
 * insert a row — until then the whole Forms page would fail to load. "coaching"
 * is the single-page, non-ladder layout (employee block, tick boxes, a written
 * section, an acknowledgement, signatures), which is exactly the shape of these
 * documents. "corrective" would be wrong in a way that matters: it is a rung of
 * the Performance Management ladder, and drafting would then require the
 * framework and apply its escalation rules to a transfer.
 */

/* -------------------------------------------------------------- helpers --- */

const GLOWBRANDS = "GlowBrands";

function statusGroup(key: string, label: string, partTime: string, fullTime: string): FormBlock {
  return {
    kind: "checkbox_group",
    key,
    label,
    options: [
      { key: "part_time", label: partTime },
      { key: "full_time", label: fullTime },
    ],
    responsibility: "manager",
    columns: 2,
  };
}

function voluntaryGroup(key: string, label: string): FormBlock {
  return {
    kind: "checkbox_group",
    key,
    label,
    options: [
      { key: "voluntary", label: "Voluntary" },
      { key: "involuntary", label: "Involuntary" },
    ],
    responsibility: "manager",
    columns: 2,
  };
}

/** The current-employee block both the demotion and the transfer forms open with. */
function currentEmployee(section: string | null, partTime: string, fullTime: string): FormBlock[] {
  return [
    ...(section ? [{ kind: "section", label: section } as FormBlock] : []),
    {
      kind: "field_row",
      fields: [
        field("employee_name", "Employee Name", "system"),
        field("form_date", "Date", "system", "date"),
      ],
    },
    statusGroup("current_status", "Employment Status", partTime, fullTime),
    {
      kind: "field_row",
      fields: [
        field("job_title", "Job Title", "system"),
        field("location", "Location", "system"),
      ],
    },
    { kind: "field", field: field("current_pay_rate", "Rate of Pay", "manager") },
  ];
}

/* ------------------------------------------------------------- demotion --- */

export const DEMOTION_EXAMPLE = [
  "On dd/mm/yyyy (employee first name) requested a voluntary demotion because......",
  "(Employee) is moving from a FT (Job Title) at $x.xx /hr at (location, State abbr.) to a PT Tanning Consultant at $x.xx /hr at (location,State abbr.) effective dd/mm/yyyy. (**Effective date must be the start of a pay period).",
  "Any elected benefits will terminate effective dd/mm/yyyy (last date of the month). As a PT employee, (Name) will not be eligible for benefits or the monthly manager bonus.",
];

export const DEMOTION_ACKNOWLEDGEMENT =
  "By signing this form, I confirm that I understand the information in this document is correct and that a demotion is desired. I also confirm that my supervisor and I have discussed all options for demotion and have decided on the best option for all parties involved. Furthermore, I understand if I am currently a full-time employee and change my status to part-time, I will lose my PTO benefits as of the status change date and will lose my insurance benefits at the end of the current month of the status change date. In addition, I understand that my pay rate may be reduced, and my pay type may be changed to hourly from salary due to this demotion. If an employee is moving from management to a part-time position, they may be required to transfer locations to maintain morale and business functions. Note:  Employees who were full-time and changed their status to part-time for more than 90 calendar days before returning to full-time status will restart their benefits eligibility waiting period and years of service calculation based on their new full-time date. Those who are part-time 90 days or less and return to full-time status, will resume their benefits from their original full-time accrual date, and will retain any unused PTO hours that existed at the time they initially changed to part time status.";

/**
 * The reason paragraph's drafting brief, in the shape of the business's own
 * completed example. What it forbids is the point: the example's benefits
 * sentence carries a computed end-of-month date and an eligibility statement,
 * both of which are HR determinations, so they are left to the manager.
 */
const DEMOTION_REASON_HELP =
  'One short paragraph in the style of the form\'s own example, using only what the manager said: if the employee asked for it, "On <date> <first name> requested a voluntary demotion because <reason>."; then "<Name> is moving from a <FT/PT> <current title> at <rate> at <location> to a <FT/PT> <new title> at <rate> at <location> effective <date>." Leave out any part the manager did not give — never supply a status, rate, location, date or reason yourself — and never write the benefits or eligibility sentence.';

export function demotionDocument(): FormDocument {
  return {
    paper: "letter",
    blocks: [
      { kind: "letterhead", brand: GLOWBRANDS, title: "Demotion Form" },
      ...currentEmployee("Current Employee Information", "Part Time", "Full Time"),

      { kind: "section", label: "New Employee Information" },
      { kind: "field", field: field("new_job_title", "New Job Title", "manager") },
      { kind: "field", field: field("new_location", "New Location, if applicable", "manager") },
      statusGroup("new_status", "New Employment Status", "Part Time", "Full Time"),
      { kind: "field", field: field("new_pay_rate", "New Rate of Pay", "manager") },
      voluntaryGroup("demotion_type", "Type of Demotion"),

      { kind: "section", label: "Reason (please attach corrective action if given)" },
      ...DEMOTION_EXAMPLE.map((text): FormBlock => ({ kind: "note", text })),
      {
        kind: "field",
        field: field(
          "reason",
          "Please provide a brief summary/ reason for demotion",
          "ai",
          "long_text",
          { help: DEMOTION_REASON_HELP },
        ),
      },

      { kind: "section", label: "Acknowledgement of Receipt of Demotion" },
      { kind: "acknowledgement", text: DEMOTION_ACKNOWLEDGEMENT },
      { kind: "signature_row", label: "Employee Signature", dateLabel: "Date" },
      { kind: "signature_row", label: "Supervisor Signature", dateLabel: "Date" },
      { kind: "signature_row", label: "Witness Signature", dateLabel: "Date" },
    ],
  };
}

/* ------------------------------------------------------ position transfer --- */

export const TRANSFER_ACKNOWLEDGEMENT = [
  "By signing this form, I confirm that I understand the information in this document is correct. I also confirm that my supervisor and I have discussed all options for transfer and have decided on the best option for all parties involved.",
  "Furthermore, I understand that if I am currently a full-time employee and change my status to part-time, I will lose my PTO benefits as of the status change date and will lose my insurance benefits at the end of the current month of the status change date. Note: Employees who were full-time and changed their status to part-time for more than 90 calendar days before returning to full-time status will restart their benefits eligibility waiting period and years of service calculation based on their new full-time date. Those who are part-time 90 days or less and return to full-time status, will resume their benefits from their original full-time accrual date, and will retain any unused PTO hours that existed at the time they initially changed to part time status.",
];

const TRANSFER_REASON_HELP =
  'One short paragraph using only what the manager said: why the employee is transferring, and "<Name> is transferring from <current title> at <location> to <new title> at <new location>", with statuses, rates and a date only where the manager gave them. Never supply a status, rate, location, date or reason yourself.';

/**
 * The Position Transfer Form.
 *
 * No heading over the first block because the document has none — it opens on
 * the Employee Name line. New Employment Status reads PT / FT, not Part Time /
 * Full Time, because that is how this document prints it; the option KEYS are
 * the same as the demotion form's so the same stated fact lands in either.
 *
 * THE WITNESS LINE is printed in the document's footer rather than its body,
 * and it is a signature line all the same, so it is the third signature row.
 */
export function positionTransferDocument(): FormDocument {
  return {
    paper: "letter",
    blocks: [
      { kind: "letterhead", brand: GLOWBRANDS, title: "Position Transfer Form" },
      ...currentEmployee(null, "Part Time", "Full Time"),

      { kind: "section", label: "New Employee Information" },
      { kind: "field", field: field("new_job_title", "New Job Title", "manager") },
      { kind: "field", field: field("new_location", "New Location, if applicable", "manager") },
      statusGroup("new_status", "New Employment Status", "PT", "FT"),
      { kind: "field", field: field("new_pay_rate", "New Pay Rate", "manager") },
      voluntaryGroup("transfer_type", "Type of Transfer"),

      { kind: "section", label: "Reason" },
      {
        kind: "field",
        field: field(
          "reason",
          "Please provide a brief summary / reason for transfer",
          "ai",
          "long_text",
          { help: TRANSFER_REASON_HELP },
        ),
      },

      { kind: "section", label: "Acknowledgement of Receipt of Transfer" },
      ...TRANSFER_ACKNOWLEDGEMENT.map((text): FormBlock => ({ kind: "acknowledgement", text })),
      { kind: "signature_row", label: "Employee Signature", dateLabel: "Date" },
      { kind: "signature_row", label: "Supervisor Signature", dateLabel: "Date" },
      { kind: "signature_row", label: "Witness Signature", dateLabel: "Date" },
    ],
  };
}

/* ------------------------------------------------------ resignation/exit --- */

/**
 * ============================================================================
 * THE RESIGNATION/EXIT FORM IS BUILT AND NOT YET PUBLISHED
 * ============================================================================
 *
 * Its source document, `STC Exit(1).docx`, was named in the request and not
 * attached. The fields below are the ones the request lists, but the form's
 * ACKNOWLEDGEMENT and its STEPS TO FINISH TERMINATION are the business's own
 * wording, and writing either from memory would be inventing HR policy on a
 * document an employee signs as they leave.
 *
 * So the two texts are `null`, `resignationExitDocument` refuses to build
 * without them, and the seed is left out of `EMPLOYMENT_CHANGE_TEMPLATE_SEEDS`.
 * Everything else — the chat aliases, the resignation-versus-separation
 * question, the stated-fact reading of last day, notice dates and each yes/no —
 * is live and tested, so a manager asking for an exit form is told plainly that
 * it is not published yet rather than handed a different document.
 *
 * TO PUBLISH IT: paste the two texts, verbatim, into the constants below. The
 * seed joins the library by itself and the next page load installs it.
 */
export const EXIT_ACKNOWLEDGEMENT: string | null = null;
export const EXIT_TERMINATION_STEPS: readonly string[] | null = null;

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

/** The exit form's yes/no questions, by field key, in the order the form asks them. */
export const EXIT_YES_NO_QUESTIONS: readonly { key: string; label: string }[] = [
  { key: "store_items_returned", label: "Store Items Returned" },
  { key: "payroll_deduction", label: "Payroll Deduction Applicable" },
  { key: "forfeit_bonus", label: "Forfeit Bonus" },
  { key: "minimum_wage", label: "Drop to Minimum Wage" },
  { key: "written_notice_attached", label: "Written Notice Attached" },
  { key: "eligible_for_rehire", label: "Eligible for Rehire" },
];

export function resignationExitDocument(): FormDocument {
  if (EXIT_ACKNOWLEDGEMENT === null || EXIT_TERMINATION_STEPS === null) {
    throw new Error(
      "The Resignation/Exit Form needs its acknowledgement and termination steps from the source document before it can be built.",
    );
  }
  return {
    paper: "letter",
    blocks: [
      { kind: "letterhead", brand: "Sun Tan City", title: "Resignation/Exit Form" },
      { kind: "section", label: "Employee Information" },
      {
        kind: "field_row",
        fields: [
          field("employee_name", "Employee Name", "system"),
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
      { kind: "field", field: field("permanent_address", "Permanent Address", "manager") },
      { kind: "field", field: field("last_day_worked", "Last Day Worked", "manager", "date") },

      { kind: "section", label: "Resignation / Separation" },
      {
        kind: "checkbox_group",
        key: "separation_type",
        options: [
          { key: "submitted_fulfilled_notice", label: "Submitted & Fulfilled Notice" },
          { key: "immediate_voluntary_resignation", label: "Immediate Voluntary Resignation" },
          { key: "immediate_involuntary_separation", label: "Immediate Involuntary Separation" },
          { key: "did_not_fulfill_notice", label: "Did not fulfill required 14/30-day notice" },
          { key: "no_call_no_show", label: "No Call No Show" },
        ],
        responsibility: "manager",
        columns: 2,
      },
      {
        kind: "field_row",
        fields: [
          field("notice_given_date", "Date notice was given", "manager", "date"),
          field("notice_fulfilled_date", "Date notice was fulfilled", "manager", "date"),
        ],
      },
      ...EXIT_YES_NO_QUESTIONS.map((entry) => yesNo(entry.key, entry.label)),

      { kind: "section", label: "Details" },
      {
        kind: "field",
        field: field("details", "Details", "ai", "long_text", {
          help: "What the manager described about the employee leaving, in their own facts only. Never state rehire eligibility, deductions, bonus, wage or whether the separation was voluntary — those are ticked by the manager.",
        }),
      },

      { kind: "section", label: "Acknowledgement" },
      { kind: "acknowledgement", text: EXIT_ACKNOWLEDGEMENT },
      { kind: "signature_row", label: "Employee Signature", dateLabel: "Date" },
      { kind: "signature_row", label: "Supervisor Signature", dateLabel: "Date" },
      { kind: "signature_row", label: "District Manager or Witness Signature", dateLabel: "Date" },

      { kind: "section", label: "Steps to Finish Termination" },
      ...EXIT_TERMINATION_STEPS.map((text): FormBlock => ({ kind: "note", text })),
    ],
  };
}

/** True once the exit form's source wording has been supplied. */
export function exitFormSourceSupplied(): boolean {
  return EXIT_ACKNOWLEDGEMENT !== null && EXIT_TERMINATION_STEPS !== null;
}

/* ------------------------------------------------------------ the seeds --- */

export const DEMOTION_TEMPLATE_KEY = "demotion";
export const POSITION_TRANSFER_TEMPLATE_KEY = "position-transfer";
export const RESIGNATION_EXIT_TEMPLATE_KEY = "resignation-exit";

const DEMOTION_SEED: TemplateSeed = {
  key: DEMOTION_TEMPLATE_KEY,
  name: "Demotion Form",
  shortName: "Demotion",
  description:
    "Records a move to a lower title, status or pay — current and new details, voluntary or involuntary, and the reason.",
  category: "employment_changes",
  layoutFamily: "coaching",
  requiredPermission: "create_employment_change_form",
  /* 15 and up: display_order is written only on insert, and 14 is the last one in use. */
  displayOrder: 15,
  document: demotionDocument(),
  variants: [],
  revision: 1,
  revisionNote:
    "Published from the GlowBrands Demotion Form source document. The STC Demotion Example is the same document, kept as a reference for the reason's wording; it is not a separate template.",
  bundledPdfName: "Demotion Form.pdf",
};

const POSITION_TRANSFER_SEED: TemplateSeed = {
  key: POSITION_TRANSFER_TEMPLATE_KEY,
  name: "Position Transfer Form",
  shortName: "Position Transfer",
  description:
    "Records a move to another salon or position — current and new title, location, status and pay, voluntary or involuntary, and the reason.",
  category: "employment_changes",
  layoutFamily: "coaching",
  requiredPermission: "create_employment_change_form",
  displayOrder: 16,
  document: positionTransferDocument(),
  variants: [],
  revision: 1,
  revisionNote: "Published from the GlowBrands Position Transfer Form source document.",
  bundledPdfName: "Position Transfer Form.pdf",
};

function resignationExitSeed(): TemplateSeed {
  return {
    key: RESIGNATION_EXIT_TEMPLATE_KEY,
    name: "Resignation/Exit Form",
    shortName: "Resignation/Exit",
    description:
      "Records an employee leaving — last day, how notice was given, returned items, payroll and rehire answers, and the details.",
    category: "employment_changes",
    layoutFamily: "coaching",
    requiredPermission: "create_employment_change_form",
    displayOrder: 17,
    document: resignationExitDocument(),
    variants: [],
    revision: 1,
    revisionNote: "Published from the Sun Tan City STC Exit source document.",
    bundledPdfName: "Resignation Exit Form.pdf",
  };
}

/**
 * The published employment change forms. The exit form joins the moment its
 * source wording exists — see `EXIT_ACKNOWLEDGEMENT`.
 */
export const EMPLOYMENT_CHANGE_TEMPLATE_SEEDS: TemplateSeed[] = [
  DEMOTION_SEED,
  POSITION_TRANSFER_SEED,
  ...(exitFormSourceSupplied() ? [resignationExitSeed()] : []),
];

/**
 * ============================================================================
 * THE FIELDS ASK SUNNY MAY FILL FROM THE MANAGER'S OWN STATEMENT
 * ============================================================================
 *
 * An explicit list, the way `createInstance`'s record map is explicit — not an
 * inference from a label. A key here is written only when (1) the pinned
 * version has it, (2) a person could edit it, and (3) it is currently empty. So
 * a stated fact never overwrites anything, including the salon the record was
 * filed against or a value the manager already typed.
 */
export const STATED_FACT_KEYS: ReadonlySet<string> = new Set([
  "job_title",
  "location",
  "current_status",
  "current_pay_rate",
  "new_job_title",
  "new_location",
  "new_status",
  "new_pay_rate",
  "demotion_type",
  "transfer_type",
  "permanent_address",
  "last_day_worked",
  "separation_type",
  "notice_given_date",
  "notice_fulfilled_date",
  ...EXIT_YES_NO_QUESTIONS.map((entry) => entry.key),
]);
