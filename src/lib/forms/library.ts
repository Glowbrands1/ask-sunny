import type {
  FormBlock,
  FormDocument,
  FormField,
  FormVariant,
} from "./document";

/**
 * THE TEMPLATE LIBRARY — nine forms, four layouts.
 *
 * Built from the nine reference captures, and grouped the way those captures
 * actually group rather than one template per file:
 *
 *   coaching    Coaching Form
 *   corrective  Disciplinary Plan of Action, Policy Review
 *   epp         SDIT EPP, TSD EPP, ASD-SDIT Performance EPP, FTTC Performance EPP
 *   dmit_epp    DMIT EPP — TSD Review, DMIT EPP — DMIT Review
 *
 * The EPP four are the same three-page document with a different title and a
 * different pairing of reviewer and subject — pixel-diffed at 0.06%–0.07% on
 * pages 2 and 3. The two DMIT reviews are ONE six-page document read two ways;
 * their captures differ by 0.96% on page 1 and 0.19% on page 3 and by nothing
 * anywhere else. So they are variants, not templates, and the misspelled
 * filenames (`REVIVIEW`, `TSd`) name no additional form.
 *
 * RESPONSIBILITIES ARE COPIED FROM THE REFERENCES, FIELD BY FIELD, not inferred
 * from what a field is called. The DMIT EPP's self-assessment is marked FILLED
 * BY HAND on the capture and is `manual` here; the SDIT EPP's "Assistant Salon
 * Director Thoughts" carries an AI FILLS chip and is `ai`. Two questions that
 * read almost identically, two different answers, because the business decided
 * so and not because a rule was inferred.
 */

const BRAND = "SUN TAN CITY";

/* ------------------------------------------------------------- helpers --- */

const field = (
  key: string,
  label: string,
  responsibility: FormField["responsibility"],
  input: FormField["input"] = "text",
  extra: Partial<FormField> = {},
): FormField => ({ key, label, input, responsibility, ...extra });

/** The header block every one of the nine forms opens with. */
function employeeInformation(): FormBlock[] {
  return [
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
  ];
}

/**
 * The acknowledgement and its two signature pairs.
 *
 * `signature` fields have no key by design — see `responsibility.ts`. Nothing
 * can write into them because there is nothing to write into.
 */
function acknowledgement(text: string): FormBlock[] {
  return [
    { kind: "section", label: "Acknowledgement" },
    { kind: "acknowledgement", text },
    { kind: "signature_row", label: "Employee Signature", dateLabel: "Date" },
    { kind: "signature_row", label: "Supervisor Signature", dateLabel: "Date" },
  ];
}

/* ------------------------------------------------------------ coaching --- */

export function coachingDocument(): FormDocument {
  return {
    paper: "letter",
    blocks: [
      { kind: "letterhead", brand: BRAND, title: "Coaching Form" },
      ...employeeInformation(),

      { kind: "section", label: "Type Of Coaching" },
      {
        kind: "checkbox_group",
        key: "coaching_type",
        options: [
          { key: "under_performance", label: "Under Performance" },
          { key: "training_plan", label: "Training Plan of Action" },
          { key: "re_training", label: "Re-Training" },
        ],
        responsibility: "ai",
        columns: 3,
      },

      { kind: "section", label: "Topic Of Coaching" },
      {
        kind: "checkbox_group",
        key: "coaching_topics",
        options: [
          { key: "salon_tours", label: "Salon Tours" },
          { key: "selling_memberships", label: "Selling Memberships" },
          { key: "open_ended_questions", label: "Open-ended Questions" },
          { key: "upgrading_options", label: "Upgrading Options" },
          { key: "closing_the_sale", label: "Closing the Sale" },
          { key: "making_recommendations", label: "Making Recommendations" },
          { key: "overcoming_objections", label: "Overcoming Objections" },
          { key: "lotion_basics", label: "Lotion Basics" },
          { key: "client_engagement", label: "Client Engagement" },
          { key: "other", label: "Other" },
        ],
        responsibility: "ai",
        columns: 2,
      },
      {
        kind: "field",
        field: field("other_topic", "Other", "ai", "text", {
          help: "Only when the Other box is ticked. Left empty otherwise.",
        }),
      },

      { kind: "section", label: "Details" },
      {
        kind: "field",
        field: field("coaching_details", "Details", "ai", "long_text", {
          help: "What was observed, what was expected, and what good looks like next time.",
        }),
      },

      { kind: "section", label: "Acknowledgement of Training" },
      {
        kind: "acknowledgement",
        text: "I confirm that my supervisor and I have discussed this training and plan for improvement.",
      },
      { kind: "signature_row", label: "Employee Signature", dateLabel: "Date" },
      { kind: "signature_row", label: "Supervisor Signature", dateLabel: "Date" },
    ],
  };
}

/* ---------------------------------------------------------- corrective --- */

/**
 * The Disciplinary Plan of Action.
 *
 * The policy trio — what was observed, which policy it breached, and the manual's
 * own words — is the part that must never be improvised. `policyGrounded` marks
 * the two that quote policy; the assistant may only fill those from a knowledge
 * match and leaves them for the manager when it has none.
 */
export function disciplinaryDocument(): FormDocument {
  return {
    paper: "letter",
    blocks: [
      { kind: "letterhead", brand: BRAND, title: "Disciplinary Plan of Action" },
      ...employeeInformation(),

      { kind: "section", label: "Type of Warning" },
      {
        kind: "checkbox_group",
        key: "warning_type",
        options: [
          { key: "verbal", label: "Verbal Warning" },
          { key: "written", label: "Written Warning" },
          { key: "termination", label: "Termination" },
          { key: "demotion", label: "Demotion" },
        ],
        responsibility: "ai",
        columns: 2,
      },
      {
        kind: "field",
        field: field("previous_action", "Previous disciplinary action for this policy infraction", "ai"),
      },
      { kind: "field", field: field("previous_action_date", "Date of previous action", "ai", "date") },

      { kind: "section", label: "Type of Offense" },
      {
        kind: "checkbox_group",
        key: "offense_type",
        options: [
          { key: "tardiness", label: "Tardiness/Leaving Early" },
          { key: "absenteeism", label: "Absenteeism" },
          { key: "standards_of_conduct", label: "Standards of Conduct" },
          { key: "under_performance", label: "Under Performance" },
          { key: "dress_code", label: "Dress Code Violation" },
          { key: "company_policies", label: "Violation of Company Policies" },
        ],
        responsibility: "ai",
        columns: 2,
      },
      { kind: "field", field: field("other_offense", "Other", "ai") },

      { kind: "section", label: "Details" },
      {
        kind: "field",
        field: field("observation", "Observation of Offense", "ai", "long_text"),
      },
      {
        kind: "field",
        field: field("policy_violated", "Policy Violated", "ai", "text", {
          policyGrounded: true,
          help: "Named from the approved manual. Left for the manager when no approved policy matches.",
        }),
      },
      {
        kind: "field",
        field: field("policy_language", "Direct policy from official manual", "ai", "long_text", {
          policyGrounded: true,
          help: "Quoted verbatim from the manual. Never paraphrased and never invented.",
        }),
      },
      { kind: "field", field: field("action_plan", "Action Plan", "ai", "long_text") },

      { kind: "section", label: "Acknowledgement of Receipt of Warning" },
      {
        kind: "acknowledgement",
        text: "Employee and supervisor discussed the warning and plan for improvement. Further violations may result in additional action.",
      },
      { kind: "signature_row", label: "Employee Signature", dateLabel: "Date" },
      { kind: "signature_row", label: "Supervisor Signature", dateLabel: "Date" },
    ],
  };
}

export function policyReviewDocument(): FormDocument {
  return {
    paper: "letter",
    blocks: [
      { kind: "letterhead", brand: BRAND, title: "Policy Review Form" },
      ...employeeInformation(),

      { kind: "section", label: "Type" },
      {
        kind: "checkbox_group",
        key: "review_types",
        options: [
          { key: "under_performance", label: "Under Performance" },
          { key: "tpoa", label: "TPOA" },
          { key: "policy_review", label: "Policy Review" },
        ],
        responsibility: "ai",
        columns: 3,
      },

      { kind: "section", label: "Topic" },
      { kind: "field", field: field("topic", "Topic", "ai") },

      { kind: "section", label: "Details" },
      { kind: "field", field: field("observation", "Observation", "ai", "long_text") },
      {
        kind: "field",
        field: field("policy_violated", "Policy Violated", "ai", "text", {
          policyGrounded: true,
          help: "Named from the approved manual. Left for the manager when no approved policy matches.",
        }),
      },
      {
        kind: "field",
        field: field("policy_language", "Direct policy from official manual", "ai", "long_text", {
          policyGrounded: true,
          help: "Quoted verbatim from the manual. Never paraphrased and never invented.",
        }),
      },
      { kind: "field", field: field("plan_of_action", "Plan of Action", "ai", "long_text") },

      { kind: "section", label: "Acknowledgement of Training" },
      {
        kind: "acknowledgement",
        text: "I confirm that my supervisor and I have discussed this training and plan for improvement.",
      },
      { kind: "signature_row", label: "Employee Signature", dateLabel: "Date" },
      { kind: "signature_row", label: "Supervisor Signature", dateLabel: "Date" },
    ],
  };
}

/* ----------------------------------------------------------------- EPP --- */

/**
 * The three-page Employee Performance Plan, shared by four templates.
 *
 * `{{role}}` is the reviewer — Training Salon Director, District Manager, Salon
 * Director — and `{{roleAbbr}}` is who is being reviewed: ASD, SD, TC. The four
 * templates differ in their title and in that pairing, and in nothing else,
 * which is why they are one builder taking two arguments rather than four
 * copies that can drift.
 *
 * Only the FIRST line of each numbered list carries an AI chip on the captures;
 * the rest are ruled lines the manager fills in conversation. That is preserved
 * — the list is one `ai` field whose drafted lines populate downward.
 */
export function eppDocument(title: string): FormDocument {
  return {
    paper: "letter",
    blocks: [
      { kind: "letterhead", brand: BRAND, title },
      ...employeeInformation(),

      { kind: "section", label: "To be filled out by {{role}}" },
      {
        kind: "field",
        field: field("where_succeeding", "In what areas is the {{roleAbbr}} currently succeeding?", "ai", "long_text"),
      },
      {
        kind: "field",
        field: field("needs_improvement", "In what areas does the {{roleAbbr}} currently need improvement?", "ai", "long_text"),
      },
      {
        kind: "numbered_list",
        key: "top_strengths",
        label: "Overall top three strengths",
        count: 3,
        responsibility: "ai",
      },
      {
        kind: "numbered_list",
        key: "improvement_areas",
        label: "Overall two biggest areas of improvement",
        count: 2,
        responsibility: "ai",
      },
      {
        kind: "field",
        field: field("employee_productivity", "{{roleAbbr}}'s current productivity", "ai", "long_text"),
      },
      {
        kind: "field",
        field: field("salon_productivity", "Salon's current productivity", "ai", "long_text"),
      },

      { kind: "section", label: "{{roleAbbr}} Thoughts" },
      {
        kind: "field",
        field: field("employee_self_review", "Self review", "ai", "long_text", {
          help: "Drafted from the conversation, then reviewed with the employee before signing.",
        }),
      },
      {
        kind: "numbered_list",
        key: "salon_goals",
        label: "Salon Goals: current top three goals",
        count: 3,
        responsibility: "ai",
      },

      { kind: "section", label: "Plan of Action" },
      {
        kind: "field",
        field: field("plan_of_action", "Plan, objectives and goals", "ai", "long_text"),
      },
      {
        kind: "field",
        field: field("follow_up_week", "{{role}} and {{roleAbbr}} will meet and re-evaluate the week of", "ai", "date"),
      },

      ...acknowledgement(
        "I confirm that my supervisor and I have discussed this training document and I will participate in the plan for improvement.",
      ),
    ],
  };
}

/** The reviewer/subject pairing each EPP template is printed for. */
export function eppVariant(role: string, roleAbbr: string, label: string): FormVariant[] {
  return [{ key: "default", label, role, roleAbbr }];
}

/* ------------------------------------------------------------ DMIT EPP --- */

/**
 * The six-page DMIT Employee Performance Plan, in two readings.
 *
 * What the reference shows and this reproduces:
 *
 *   a boxed POSITION DESCRIPTION printed for the reviewed position, different
 *   per variant and marked as such on the page;
 *   an explicit PAGE BREAK before the section the employee completes;
 *   a whole section marked FILLED BY HAND — the employee's own answers, which
 *   the assistant never drafts;
 *   Follow-up, Acknowledgement, then RE-EVALUATION and a SECOND acknowledgement,
 *   all in the one document.
 *
 * The re-evaluation is part of this form rather than a separate one, which is
 * why a form instance carries the whole lifecycle and a revision points back at
 * what it revised.
 */
export function dmitEppDocument(): FormDocument {
  return {
    paper: "letter",
    blocks: [
      { kind: "letterhead", brand: BRAND, title: "Employee Performance Plan" },
      ...employeeInformation(),

      {
        kind: "reference",
        label: "Printed for the reviewed position — TSD",
        variantKey: "tsd",
        body: [
          "To be reviewed with District Manager",
          "First we need to understand what the purpose and responsibilities are for a District Manager with Sun Tan City:",
          "General Purpose of Position",
          "The District Manager is responsible for overseeing several salons. Responsibilities include managing sales and operations, driving revenue, controlling expenses and payroll budgets, handling personnel issues, accounting, merchandising, and loss prevention. District Managers are also ultimately responsible for ensuring the highest level of client service throughout the salons.",
        ],
      },
      {
        kind: "reference",
        label: "Printed for the reviewed position — DMIT",
        variantKey: "dmit",
        body: [
          "To be reviewed with District Manager in Training",
          "First we need to understand what the purpose and responsibilities are for a District Manager in Training with Sun Tan City:",
          "General Purpose of Position",
          "The District Manager in Training is learning to oversee several salons: sales and operations, revenue, expense and payroll control, personnel, accounting, merchandising and loss prevention, while being assessed against the District Manager standard.",
        ],
      },

      { kind: "section", label: "To be filled out by {{role}}" },
      {
        kind: "field",
        field: field("where_succeeding", "In what areas is the {{roleAbbr}} currently succeeding?", "ai", "long_text"),
      },
      {
        kind: "field",
        field: field("needs_improvement", "In what areas does the {{roleAbbr}} currently need improvement?", "ai", "long_text"),
      },
      {
        kind: "numbered_list",
        key: "top_strengths",
        label: "What are the {{roleAbbr}}'s overall top three strengths?",
        count: 3,
        responsibility: "ai",
      },
      {
        kind: "numbered_list",
        key: "improvement_areas",
        label: "What are the {{roleAbbr}}'s overall two biggest areas of improvement?",
        count: 2,
        responsibility: "ai",
      },
      {
        kind: "field",
        field: field("employee_productivity", "{{role}}'s current productivity", "ai", "long_text"),
      },
      {
        kind: "field",
        field: field("salon_productivity", "Salon's current productivity", "ai", "long_text"),
      },

      { kind: "page_break" },

      { kind: "section", label: "To be filled out by {{role}}" },
      {
        kind: "note",
        text: "This section is completed by hand, in the conversation. Ask Sunny does not draft it.",
      },
      {
        kind: "field",
        field: field("most_important_skill", "What do you feel is the most important skill for a {{role}} to possess?", "manual"),
      },
      {
        kind: "field",
        field: field("self_succeeding", "In what areas do you feel you are currently succeeding?", "manual", "long_text"),
      },
      {
        kind: "field",
        field: field("self_improvement", "In what areas do you feel you need improvement?", "manual", "long_text"),
      },
      {
        kind: "numbered_list",
        key: "self_strengths",
        label: "What are your overall top three strengths?",
        count: 3,
        responsibility: "manual",
      },
      {
        kind: "numbered_list",
        key: "self_improvement_areas",
        label: "What are your overall two biggest areas of improvement?",
        count: 2,
        responsibility: "manual",
      },
      {
        kind: "numbered_list",
        key: "salon_goals",
        label: "Salon Goals: What are your salon's current top three goals?",
        count: 3,
        responsibility: "manual",
      },

      { kind: "section", label: "Plan of Action" },
      { kind: "paragraph", text: "Review and adjust together with the employee." },
      {
        kind: "field",
        field: field("plan_of_action", "Plan, objectives and goals", "ai", "long_text"),
      },

      { kind: "page_break" },

      { kind: "section", label: "Follow-up" },
      {
        kind: "field",
        field: field("follow_up_week", "{{role}} and {{roleAbbr}} will meet and re-evaluate the week of", "ai", "date"),
      },
      ...acknowledgement(
        "I confirm that my supervisor and I have discussed this training document and I will participate in the plan for improvement.",
      ),

      { kind: "section", label: "Re-Evaluation" },
      {
        kind: "field",
        field: field("objectives_met", "Which objectives were met?", "ai", "long_text"),
      },
      {
        kind: "field",
        field: field("reevaluation_plan", "Plan of Action", "ai", "long_text"),
      },
      ...acknowledgement(
        "I confirm that my supervisor and I have discussed this training document and I will participate in the plan for improvement.",
      ),
    ],
  };
}

export const DMIT_VARIANTS: FormVariant[] = [
  {
    key: "tsd",
    label: "TSD Review",
    role: "District Manager",
    roleAbbr: "TSD",
    reviewedPosition: "TSD",
  },
  {
    key: "dmit",
    label: "DMIT Review",
    role: "District Manager",
    roleAbbr: "DMIT",
    reviewedPosition: "DMIT",
  },
];

/* ------------------------------------------------------- the nine forms --- */

export interface TemplateSeed {
  key: string;
  name: string;
  shortName: string;
  description: string;
  layoutFamily: "coaching" | "corrective" | "epp" | "dmit_epp";
  requiredPermission: string;
  displayOrder: number;
  document: FormDocument;
  variants: FormVariant[];
  /** The bundled PDF this template falls back to when nothing is uploaded. */
  bundledPdfName: string;
}

export const TEMPLATE_SEEDS: TemplateSeed[] = [
  {
    key: "coaching",
    name: "Coaching Form",
    shortName: "Coaching",
    description:
      "The everyday documented coaching conversation. Names the gap, the expectation and the follow-up.",
    layoutFamily: "coaching",
    requiredPermission: "create_coaching_form",
    displayOrder: 1,
    document: coachingDocument(),
    variants: [],
    bundledPdfName: "Coaching Form.pdf",
  },
  {
    key: "dpoa",
    name: "Disciplinary Plan of Action",
    shortName: "DPOA",
    description:
      "The formal corrective step after coaching. Records the warning, the policy breached in the manual's own words, and the plan.",
    layoutFamily: "corrective",
    requiredPermission: "create_corrective_action",
    displayOrder: 2,
    document: disciplinaryDocument(),
    variants: [],
    bundledPdfName: "Disciplinary Plan of Action (DPOA).pdf",
  },
  {
    key: "policy-review",
    name: "Policy Review",
    shortName: "Policy Review",
    description:
      "A documented review of a policy with an employee, quoting the approved manual.",
    layoutFamily: "corrective",
    requiredPermission: "create_policy_review",
    displayOrder: 3,
    document: policyReviewDocument(),
    variants: [],
    bundledPdfName: "Policy Review Form.pdf",
  },
  {
    key: "sdit-epp",
    name: "SDIT EPP",
    shortName: "SDIT EPP",
    description: "Employee Performance Plan for a Salon Director in training.",
    layoutFamily: "epp",
    requiredPermission: "create_epp",
    displayOrder: 4,
    document: eppDocument("Employee Performance Plan - SDIT"),
    variants: eppVariant("Training Salon Director", "ASD", "SDIT review"),
    bundledPdfName: "Employee EPP (SDIT).pdf",
  },
  {
    key: "tsd-epp",
    name: "TSD EPP",
    shortName: "TSD EPP",
    description: "Employee Performance Plan for a Training Salon Director.",
    layoutFamily: "epp",
    requiredPermission: "create_epp",
    displayOrder: 5,
    document: eppDocument("Employee Performance Plan - TSD"),
    variants: eppVariant("District Manager", "SD", "TSD review"),
    bundledPdfName: "Management EPP (TSD).pdf",
  },
  {
    key: "asd-sdit-epp",
    name: "ASD-SDIT Performance EPP",
    shortName: "ASD-SDIT",
    description: "Performance plan covering the ASD to SDIT development track.",
    layoutFamily: "epp",
    requiredPermission: "create_epp",
    displayOrder: 6,
    document: eppDocument("Performance EPP - ASD/SDIT"),
    variants: eppVariant("Training Salon Director", "ASD", "ASD/SDIT review"),
    bundledPdfName: "ASD-SDIT Performance EPP.pdf",
  },
  {
    key: "fttc-epp",
    name: "FTTC Performance EPP",
    shortName: "FTTC",
    description: "Performance plan for a full-time Tanning Consultant.",
    layoutFamily: "epp",
    requiredPermission: "create_epp",
    displayOrder: 7,
    document: eppDocument("Performance EPP - FTTC"),
    variants: eppVariant("Salon Director", "TC", "FTTC review"),
    bundledPdfName: "FTTC Performance EPP.pdf",
  },
  {
    key: "dmit-epp-tsd",
    name: "DMIT EPP — TSD Review",
    shortName: "DMIT / TSD",
    description:
      "The TSD reading of the DMIT Employee Performance Plan, through re-evaluation.",
    layoutFamily: "dmit_epp",
    requiredPermission: "create_epp",
    displayOrder: 8,
    document: dmitEppDocument(),
    variants: DMIT_VARIANTS,
    bundledPdfName: "DMIT EPP - TSD Review.pdf",
  },
  {
    key: "dmit-epp-dmit",
    name: "DMIT EPP — DMIT Review",
    shortName: "DMIT / DMIT",
    description:
      "The DMIT reading of the DMIT Employee Performance Plan, through re-evaluation.",
    layoutFamily: "dmit_epp",
    requiredPermission: "create_epp",
    displayOrder: 9,
    document: dmitEppDocument(),
    variants: DMIT_VARIANTS,
    bundledPdfName: "DMIT EPP - DMIT Review.pdf",
  },
];

/** The default variant a new form of this template starts on. */
export function defaultVariantKey(seedKey: string): string | null {
  if (seedKey === "dmit-epp-tsd") return "tsd";
  if (seedKey === "dmit-epp-dmit") return "dmit";
  const seed = TEMPLATE_SEEDS.find((entry) => entry.key === seedKey);
  return seed?.variants[0]?.key ?? null;
}
