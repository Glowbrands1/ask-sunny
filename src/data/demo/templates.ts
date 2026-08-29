import type { FormTemplate, TemplateField } from "@/types";

/**
 * Form templates.
 *
 * The nine names below are the templates in production use — kept verbatim.
 * Role acronyms (SDIT, TSD, DMIT, FTTC, ASD) are intentionally left unexpanded.
 * EPP = Employee Performance Plan. DPOA = Disciplinary Plan of Action.
 *
 * Two layers, exactly as in production:
 *   1. Document templates  — the field configuration below, edited in-app.
 *   2. Uploaded PDF templates — the official fillable PDF each form prints into.
 * A saved document template takes priority over the uploaded PDF.
 *
 * Signature fields are `fillRule: "signature_never_ai"`, which the template
 * editor refuses to change. Sunny never fills a signature.
 */

const ACKNOWLEDGEMENT =
  "My signature acknowledges that this conversation took place and that the expectations above were reviewed with me. It does not necessarily indicate agreement. I understand a follow-up conversation will take place on the date noted.";

function signatureFields(section = "Acknowledgement"): TemplateField[] {
  return [
    {
      id: "employee_signature",
      label: "Employee signature",
      type: "signature",
      fillRule: "signature_never_ai",
      required: true,
      section,
      helpText: "Never populated by Sunny. Signed in person on the printed form.",
    },
    {
      id: "manager_signature",
      label: "Manager signature",
      type: "signature",
      fillRule: "signature_never_ai",
      required: true,
      section,
      helpText: "Never populated by Sunny. Signed in person on the printed form.",
    },
  ];
}

const CORE_DETAIL_FIELDS: TemplateField[] = [
  {
    id: "employee_name",
    label: "Employee name",
    type: "text",
    fillRule: "ai_populate",
    required: true,
    section: "Employee details",
  },
  {
    id: "employee_role",
    label: "Position",
    type: "text",
    fillRule: "ai_populate",
    required: false,
    section: "Employee details",
  },
  {
    id: "location",
    label: "Location",
    type: "text",
    fillRule: "ai_populate",
    required: true,
    section: "Employee details",
  },
  {
    id: "form_date",
    label: "Date",
    type: "date",
    fillRule: "ai_populate",
    required: true,
    section: "Employee details",
  },
  {
    id: "manager",
    label: "Manager",
    type: "text",
    fillRule: "ai_populate",
    required: true,
    section: "Employee details",
  },
];

const COACHING_FIELDS: TemplateField[] = [
  ...CORE_DETAIL_FIELDS,
  {
    id: "coaching_type",
    label: "Type of coaching",
    type: "checkbox_group",
    fillRule: "ai_populate",
    required: true,
    section: "Coaching",
    options: [
      "Verbal coaching",
      "Documented coaching",
      "Follow-up to prior coaching",
      "Performance check-in",
    ],
  },
  {
    id: "coaching_topic",
    label: "Topic of coaching",
    type: "checkbox_group",
    fillRule: "ai_populate",
    required: true,
    section: "Coaching",
    options: [
      "Attendance / punctuality",
      "Dress code",
      "Sales performance",
      "Client experience",
      "Cleanliness standards",
      "Policy adherence",
      "Teamwork / communication",
    ],
  },
  {
    id: "topic",
    label: "Topic summary",
    type: "text",
    fillRule: "ai_populate",
    required: true,
    section: "Coaching",
    helpText: "One line naming the gap being addressed.",
  },
  {
    id: "details",
    label: "Details of the conversation",
    type: "long_text",
    fillRule: "ai_populate",
    required: true,
    section: "Coaching",
    helpText: "Specific, observed behaviour with dates. No speculation about cause.",
  },
  {
    id: "expected_action",
    label: "Expected action going forward",
    type: "long_text",
    fillRule: "ai_populate",
    required: true,
    section: "Expectations",
    helpText: "A single, measurable expected behaviour.",
  },
  {
    id: "support_offered",
    label: "Support offered",
    type: "long_text",
    fillRule: "manager_completes",
    required: false,
    section: "Expectations",
    helpText: "Training, shadowing, or schedule support the manager will provide.",
  },
  {
    id: "follow_up_date",
    label: "Follow-up date",
    type: "date",
    fillRule: "ai_populate",
    required: true,
    section: "Expectations",
  },
  ...signatureFields(),
];

const DPOA_FIELDS: TemplateField[] = [
  ...CORE_DETAIL_FIELDS,
  {
    id: "step_level",
    label: "Step",
    type: "select",
    fillRule: "manager_completes",
    required: true,
    section: "Disciplinary step",
    options: ["Documented verbal", "Written warning", "Final written warning"],
  },
  {
    id: "coaching_topic",
    label: "Policy area",
    type: "checkbox_group",
    fillRule: "ai_populate",
    required: true,
    section: "Disciplinary step",
    options: [
      "Attendance / punctuality",
      "Dress code",
      "Policy adherence",
      "Cash handling",
      "Client experience",
      "Conduct",
    ],
  },
  {
    id: "prior_conversations",
    label: "Prior conversations on this topic",
    type: "long_text",
    fillRule: "manager_completes",
    required: true,
    section: "Disciplinary step",
    helpText: "Dates and outcomes of earlier documented conversations.",
  },
  {
    id: "details",
    label: "Description of the issue",
    type: "long_text",
    fillRule: "ai_populate",
    required: true,
    section: "Disciplinary step",
  },
  {
    id: "expected_action",
    label: "Plan of action",
    type: "long_text",
    fillRule: "ai_populate",
    required: true,
    section: "Plan of action",
  },
  {
    id: "consequence",
    label: "Consequence if expectations are not met",
    type: "long_text",
    fillRule: "manager_completes",
    required: true,
    section: "Plan of action",
    helpText: "Verify the exact wording against the official manual before use.",
  },
  {
    id: "follow_up_date",
    label: "Follow-up date",
    type: "date",
    fillRule: "ai_populate",
    required: true,
    section: "Plan of action",
  },
  ...signatureFields(),
];

function eppFields(reviewLabel: string): TemplateField[] {
  return [
    ...CORE_DETAIL_FIELDS,
    {
      id: "plan_period",
      label: "Plan period",
      type: "text",
      fillRule: "manager_completes",
      required: true,
      section: "Plan",
      helpText: "e.g. 30 / 60 / 90 days.",
    },
    {
      id: "topic",
      label: "Focus area",
      type: "text",
      fillRule: "ai_populate",
      required: true,
      section: "Plan",
    },
    {
      id: "competencies",
      label: "Competencies under review",
      type: "checkbox_group",
      fillRule: "ai_populate",
      required: true,
      section: "Plan",
      options: [
        "Sales performance",
        "Team leadership",
        "Operational standards",
        "Client experience",
        "Scheduling & labor",
        "Coaching & documentation",
        "Reporting accuracy",
      ],
    },
    {
      id: "details",
      label: "Current performance summary",
      type: "long_text",
      fillRule: "ai_populate",
      required: true,
      section: "Plan",
    },
    {
      id: "expected_action",
      label: "Measurable objectives",
      type: "long_text",
      fillRule: "ai_populate",
      required: true,
      section: "Objectives",
    },
    {
      id: "support_offered",
      label: "Development support",
      type: "long_text",
      fillRule: "manager_completes",
      required: false,
      section: "Objectives",
    },
    {
      id: "review_notes",
      label: reviewLabel,
      type: "long_text",
      fillRule: "manager_completes",
      required: false,
      section: "Review",
    },
    {
      id: "follow_up_date",
      label: "Review date",
      type: "date",
      fillRule: "ai_populate",
      required: true,
      section: "Review",
    },
    ...signatureFields(),
  ];
}

const POLICY_REVIEW_FIELDS: TemplateField[] = [
  ...CORE_DETAIL_FIELDS,
  {
    id: "policy_name",
    label: "Policy reviewed",
    type: "text",
    fillRule: "ai_populate",
    required: true,
    section: "Policy",
  },
  {
    id: "policy_reason",
    label: "Reason for review",
    type: "select",
    fillRule: "manager_completes",
    required: true,
    section: "Policy",
    options: [
      "New hire onboarding",
      "Annual review",
      "Policy update",
      "Following an incident",
      "Requested by leadership",
    ],
  },
  {
    id: "details",
    label: "Points covered in the review",
    type: "long_text",
    fillRule: "ai_populate",
    required: true,
    section: "Policy",
    helpText:
      "Summarise what was discussed. Always read the exact policy language from the official manual.",
  },
  {
    id: "expected_action",
    label: "Employee acknowledgement of expectations",
    type: "long_text",
    fillRule: "ai_populate",
    required: true,
    section: "Acknowledgement",
  },
  {
    id: "follow_up_date",
    label: "Follow-up date",
    type: "date",
    fillRule: "manager_completes",
    required: false,
    section: "Acknowledgement",
  },
  ...signatureFields(),
];

interface TemplateSeed {
  id: string;
  name: string;
  shortName: string;
  description: string;
  permission: FormTemplate["permission"];
  fields: TemplateField[];
  hasDocumentTemplate: boolean;
  updatedAt: string;
  updatedBy: string;
  pdfSizeKb: number;
}

const TEMPLATE_SEEDS: TemplateSeed[] = [
  {
    id: "tpl-coaching",
    name: "Coaching Form",
    shortName: "Coaching",
    description:
      "The everyday documented coaching conversation. Names the gap, the expectation, and the follow-up date.",
    permission: "create_coaching_form",
    fields: COACHING_FIELDS,
    hasDocumentTemplate: true,
    updatedAt: "2026-08-12T14:20:00.000Z",
    updatedBy: "Dana Whitfield",
    pdfSizeKb: 186,
  },
  {
    id: "tpl-dpoa",
    name: "Disciplinary Plan of Action (DPOA)",
    shortName: "DPOA",
    description:
      "The formal corrective step after coaching. Records prior conversations, the plan, and the consequence.",
    permission: "create_corrective_action",
    fields: DPOA_FIELDS,
    hasDocumentTemplate: true,
    updatedAt: "2026-07-30T11:05:00.000Z",
    updatedBy: "Dana Whitfield",
    pdfSizeKb: 214,
  },
  {
    id: "tpl-sdit-epp",
    name: "SDIT EPP",
    shortName: "SDIT EPP",
    description: "Employee Performance Plan for a Salon Director in training.",
    permission: "create_epp",
    fields: eppFields("Reviewer notes"),
    hasDocumentTemplate: false,
    updatedAt: "2026-06-24T09:40:00.000Z",
    updatedBy: "Priya Raghunathan",
    pdfSizeKb: 242,
  },
  {
    id: "tpl-tsd-epp",
    name: "TSD EPP",
    shortName: "TSD EPP",
    description: "Employee Performance Plan for a TSD.",
    permission: "create_epp",
    fields: eppFields("Reviewer notes"),
    hasDocumentTemplate: false,
    updatedAt: "2026-06-24T09:46:00.000Z",
    updatedBy: "Priya Raghunathan",
    pdfSizeKb: 238,
  },
  {
    id: "tpl-dmit-tsd",
    name: "DMIT EPP — TSD Review",
    shortName: "DMIT / TSD",
    description: "The TSD review stage of the DMIT Employee Performance Plan.",
    permission: "create_epp",
    fields: eppFields("TSD review notes"),
    hasDocumentTemplate: false,
    updatedAt: "2026-06-24T09:52:00.000Z",
    updatedBy: "Priya Raghunathan",
    pdfSizeKb: 256,
  },
  {
    id: "tpl-dmit-dmit",
    name: "DMIT EPP — DMIT Review",
    shortName: "DMIT / DMIT",
    description: "The DMIT review stage of the DMIT Employee Performance Plan.",
    permission: "create_epp",
    fields: eppFields("DMIT review notes"),
    hasDocumentTemplate: false,
    updatedAt: "2026-06-24T09:58:00.000Z",
    updatedBy: "Priya Raghunathan",
    pdfSizeKb: 251,
  },
  {
    id: "tpl-asd-sdit",
    name: "ASD-SDIT Performance EPP",
    shortName: "ASD-SDIT",
    description:
      "Performance plan covering the ASD to SDIT development track.",
    permission: "create_epp",
    fields: eppFields("Development review notes"),
    hasDocumentTemplate: false,
    updatedAt: "2026-05-19T15:12:00.000Z",
    updatedBy: "Dana Whitfield",
    pdfSizeKb: 229,
  },
  {
    id: "tpl-fttc",
    name: "FTTC Performance EPP",
    shortName: "FTTC",
    description: "Performance plan for the FTTC role.",
    permission: "create_epp",
    fields: eppFields("Reviewer notes"),
    hasDocumentTemplate: false,
    updatedAt: "2026-05-19T15:18:00.000Z",
    updatedBy: "Dana Whitfield",
    pdfSizeKb: 233,
  },
  {
    id: "tpl-policy-review",
    name: "Policy Review",
    shortName: "Policy Review",
    description:
      "Records that a specific policy was reviewed with a team member and acknowledged.",
    permission: "create_policy_review",
    fields: POLICY_REVIEW_FIELDS,
    hasDocumentTemplate: true,
    updatedAt: "2026-08-05T10:35:00.000Z",
    updatedBy: "Alicia Moreno",
    pdfSizeKb: 164,
  },
];

export const DEMO_FORM_TEMPLATES: FormTemplate[] = TEMPLATE_SEEDS.map((seed) => ({
  id: seed.id,
  name: seed.name,
  shortName: seed.shortName,
  description: seed.description,
  permission: seed.permission,
  active: true,
  updatedAt: seed.updatedAt,
  updatedBy: seed.updatedBy,
  fields: seed.fields,
  acknowledgement: ACKNOWLEDGEMENT,
  hasDocumentTemplate: seed.hasDocumentTemplate,
  pdf: {
    id: `${seed.id}-pdf`,
    templateId: seed.id,
    fileName: `${seed.name.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase()}-fillable.pdf`,
    isBundledDefault: true,
    sizeBytes: Math.round(seed.pdfSizeKb * 1024),
  },
}));

/**
 * The standing caution Sunny attaches to every generated form. Mirrors the
 * caution the reference platform appends, reworded for Ask Sunny.
 */
export const FORM_CAUTION =
  "Sunny drafts from the knowledge base, not from the signed original. Read the exact policy language from the official manual before the conversation, edit anything that does not match your situation, and leave the signature lines blank until they are signed in person.";

export function templateById(id: string): FormTemplate | undefined {
  return DEMO_FORM_TEMPLATES.find((template) => template.id === id);
}

export const FILL_RULE_LABEL: Record<string, string> = {
  ai_populate: "Sunny can populate",
  manager_completes: "Manager completes",
  signature_never_ai: "Signature — never filled by Sunny",
};
