/**
 * ============================================================================
 * KNOWLEDGE TAXONOMY — PRODUCTION CONFIGURATION, NOT SEEDED CONTENT
 * ============================================================================
 *
 * The categories a document can be filed under, and the statuses it can be in.
 * Vocabulary describing the product's own structure: it states nothing about a
 * salon, a person or a figure, and it is as true of a live corpus as of a
 * seeded one.
 *
 * WHY IT MOVED OUT OF `data/demo/knowledge.ts`. It was defined at the top of
 * that file, above 700 lines of seeded documents and chunks. Five
 * production modules imported a label from there — the upload route, global
 * search, the source card, the document detail and the upload dialog — and an
 * ES import is all-or-nothing: importing `KNOWLEDGE_CATEGORY_LABEL` pulled
 * `DEMO_KNOWLEDGE_DOCUMENTS` and `DEMO_KNOWLEDGE_CHUNKS` into the same client
 * chunk with it.
 *
 * So the runtime gates were doing their job and the BYTES shipped anyway.
 * Splitting the file is what actually keeps seeded records out of a production
 * bundle; `data/demo/knowledge.ts` re-exports from here so demo code is
 * unchanged.
 */

import type {
  DocumentStatus,
  KnowledgeCategory,
} from "@/types";

export interface KnowledgeCategoryMeta {
  id: KnowledgeCategory;
  label: string;
  description: string;
}

export const KNOWLEDGE_CATEGORIES: KnowledgeCategoryMeta[] = [
  {
    id: "policies_compliance",
    label: "Policies & Compliance",
    description:
      "Company policy manuals, employment standards, and compliance references Sunny cites when answering policy questions.",
  },
  {
    id: "operations",
    label: "Operations",
    description:
      "Opening and closing standards, staffing, scheduling, inventory, and the day-to-day running of a salon.",
  },
  {
    id: "training",
    label: "Training",
    description:
      "Onboarding paths, certification material, and role-specific training guides for every position.",
  },
  {
    id: "leadership_coaching",
    label: "Leadership & Coaching",
    description:
      "Coaching frameworks, performance conversation guides, and the leadership development track.",
  },
  {
    id: "sales_client_experience",
    label: "Sales & Client Experience",
    description:
      "Membership presentation, upgrade paths, objection handling, and client experience standards.",
  },
  {
    id: "reports_analytics",
    label: "Reports & Analytics",
    description:
      "How to read Daily Stats and the reporting suite, and what each metric is telling you.",
  },
  {
    id: "bonuses_compensation",
    label: "Bonuses & Compensation",
    description:
      "Bonus structures, commission mechanics, and payroll reference material.",
  },
  {
    id: "safety",
    label: "Safety",
    description:
      "Incident response, emergency procedures, and salon safety standards.",
  },
  {
    id: "equipment_procedures",
    label: "Equipment & Procedures",
    description:
      "Equipment operation, cleaning protocols, and step-by-step maintenance procedures.",
  },
  {
    id: "other",
    label: "Other",
    description: "Reference material that does not belong to another library yet.",
  },
];

export const KNOWLEDGE_CATEGORY_LABEL = KNOWLEDGE_CATEGORIES.reduce(
  (acc, category) => {
    acc[category.id] = category.label;
    return acc;
  },
  {} as Record<KnowledgeCategory, string>,
);

export const DOCUMENT_STATUS_LABEL: Record<DocumentStatus, string> = {
  ready: "Ready",
  processing: "Processing",
  needs_review: "Needs review",
  failed: "Failed",
};
