import type {
  DocumentFileType,
  DocumentStatus,
  KnowledgeCategory,
  KnowledgeChunk,
  KnowledgeDocument,
} from "@/types";
import { estimateCharacterCount } from "@/lib/utils/format";

/**
 * Seeded knowledge corpus — DEMO CONTENT.
 *
 * Scale and shape mirror the corpus JBA runs today (~56 focused documents
 * across ~11 categories), NOT the full Woven library (600+ documents, much of
 * it maintenance and SDS material they explicitly do not want ingested).
 *
 * IMPORTANT: no real company policy language appears anywhere in this file.
 * Every excerpt is deliberately generic placeholder prose and is labelled
 * "Demo content" in the UI. Real documents arrive via upload or, later, a
 * SharePoint / Woven sync.
 */

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

interface Seed {
  id: string;
  title: string;
  description: string;
  category: KnowledgeCategory;
  fileType?: DocumentFileType;
  sizeKb: number;
  status?: DocumentStatus;
  uploadedBy?: string;
  uploadedAt: string;
  version?: number;
  tags: string[];
  priorVersions?: { version: number; uploadedAt: string; uploadedBy: string; sizeKb: number }[];
}

const EXTENSION: Record<DocumentFileType, string> = {
  pdf: "pdf",
  docx: "docx",
  xlsx: "xlsx",
  txt: "txt",
  md: "md",
  pptx: "pptx",
  image: "png",
  other: "dat",
};

function slug(title: string) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function expand(seed: Seed): KnowledgeDocument {
  const fileType = seed.fileType ?? "pdf";
  const sizeBytes = Math.round(seed.sizeKb * 1024);
  const status = seed.status ?? "ready";
  return {
    id: seed.id,
    title: seed.title,
    description: seed.description,
    category: seed.category,
    fileName: `${slug(seed.title)}.${EXTENSION[fileType]}`,
    fileType,
    sizeBytes,
    characterCount: estimateCharacterCount(sizeBytes),
    status,
    source: "system",
    version: seed.version ?? 1,
    previousVersions: (seed.priorVersions ?? []).map((prior) => ({
      version: prior.version,
      uploadedAt: prior.uploadedAt,
      uploadedBy: prior.uploadedBy,
      sizeBytes: Math.round(prior.sizeKb * 1024),
      note: "Superseded by a newer upload",
    })),
    uploadedBy: seed.uploadedBy ?? "Priya Raghunathan",
    uploadedAt: seed.uploadedAt,
    updatedAt: seed.uploadedAt,
    indexed: status === "ready",
    tags: seed.tags,
  };
}

const SEEDS: Seed[] = [
  /* ------------------------------------------- Policies & Compliance (9) -- */
  {
    id: "kb-001",
    title: "Attendance & Dress Code Policy",
    description:
      "Attendance expectations, call-out procedure, punctuality standards, and the salon dress code.",
    category: "policies_compliance",
    sizeKb: 486,
    uploadedAt: "2026-07-14T14:02:00.000Z",
    uploadedBy: "Alicia Moreno",
    version: 3,
    tags: ["attendance", "dress code", "punctuality", "call-out"],
    priorVersions: [
      { version: 1, uploadedAt: "2026-01-08T10:00:00.000Z", uploadedBy: "Priya Raghunathan", sizeKb: 441 },
      { version: 2, uploadedAt: "2026-04-22T16:30:00.000Z", uploadedBy: "Alicia Moreno", sizeKb: 470 },
    ],
  },
  {
    id: "kb-002",
    title: "Employee Handbook",
    description: "The complete employee handbook covering conduct, benefits, and employment terms.",
    category: "policies_compliance",
    sizeKb: 2380,
    uploadedAt: "2026-06-02T11:45:00.000Z",
    tags: ["handbook", "conduct", "benefits"],
  },
  {
    id: "kb-003",
    title: "Progressive Discipline Guidelines",
    description: "How verbal, written, and final corrective steps are applied, documented, and reviewed.",
    category: "policies_compliance",
    sizeKb: 318,
    uploadedAt: "2026-05-19T09:20:00.000Z",
    uploadedBy: "Dana Whitfield",
    tags: ["discipline", "corrective action", "documentation"],
  },
  {
    id: "kb-004",
    title: "Time & Attendance Recording Standards",
    description: "Clock-in expectations, break recording, and how timecard corrections are approved.",
    category: "policies_compliance",
    sizeKb: 204,
    uploadedAt: "2026-05-19T09:34:00.000Z",
    tags: ["timecard", "payroll", "breaks"],
  },
  {
    id: "kb-005",
    title: "Harassment & Respectful Workplace Standards",
    description: "Reporting channels and the expectations every team member is held to.",
    category: "policies_compliance",
    sizeKb: 276,
    uploadedAt: "2026-03-11T13:10:00.000Z",
    tags: ["hr", "reporting", "conduct"],
  },
  {
    id: "kb-006",
    title: "Loss Prevention Standards",
    description: "Cash handling, register variance, and the escalation path for suspected loss.",
    category: "policies_compliance",
    sizeKb: 341,
    uploadedAt: "2026-04-07T15:55:00.000Z",
    tags: ["loss prevention", "cash", "escalation"],
  },
  {
    id: "kb-007",
    title: "Minor Consent & Age Verification Policy",
    description: "Identification requirements and consent documentation for guests under the age threshold.",
    category: "policies_compliance",
    sizeKb: 158,
    uploadedAt: "2026-02-26T10:05:00.000Z",
    tags: ["compliance", "age verification", "consent"],
  },
  {
    id: "kb-008",
    title: "Social Media & Brand Voice Policy",
    description: "What salons may post, how to represent the brand, and who approves local content.",
    category: "policies_compliance",
    fileType: "docx",
    sizeKb: 122,
    uploadedAt: "2026-01-30T17:40:00.000Z",
    tags: ["social media", "brand", "marketing"],
  },
  {
    id: "kb-009",
    title: "Leave of Absence & Time Off Reference",
    description: "Request windows, approval routing, and coverage planning for approved time off.",
    category: "policies_compliance",
    sizeKb: 189,
    uploadedAt: "2026-07-30T12:15:00.000Z",
    status: "needs_review",
    uploadedBy: "Alicia Moreno",
    tags: ["time off", "scheduling", "hr"],
  },

  /* ------------------------------------------------------ Operations (8) -- */
  {
    id: "kb-010",
    title: "Salon Operations Guide",
    description:
      "The core operating standard: opening, mid-day, and closing routines plus daily accountability checks.",
    category: "operations",
    sizeKb: 1240,
    uploadedAt: "2026-07-22T08:30:00.000Z",
    uploadedBy: "Dana Whitfield",
    version: 2,
    tags: ["opening", "closing", "standards", "daily routine"],
    priorVersions: [
      { version: 1, uploadedAt: "2026-02-14T08:30:00.000Z", uploadedBy: "Dana Whitfield", sizeKb: 1104 },
    ],
  },
  {
    id: "kb-011",
    title: "Opening & Closing Checklist",
    description: "The printable checklist teams work through at open and close.",
    category: "operations",
    fileType: "xlsx",
    sizeKb: 96,
    uploadedAt: "2026-06-14T07:50:00.000Z",
    tags: ["checklist", "opening", "closing"],
  },
  {
    id: "kb-012",
    title: "Scheduling & Labor Standards",
    description: "Building a schedule to traffic, labor guardrails, and how to handle coverage gaps.",
    category: "operations",
    sizeKb: 402,
    uploadedAt: "2026-06-09T14:22:00.000Z",
    uploadedBy: "Terrence Boyd",
    tags: ["scheduling", "labor", "coverage"],
  },
  {
    id: "kb-013",
    title: "Inventory & Ordering Procedures",
    description: "Count cadence, par levels, ordering windows, and what to do when a product runs short.",
    category: "operations",
    sizeKb: 288,
    uploadedAt: "2026-05-05T11:12:00.000Z",
    tags: ["inventory", "ordering", "product"],
  },
  {
    id: "kb-014",
    title: "Cash Handling & Deposit Procedure",
    description: "Drawer counts, deposit preparation, and variance documentation.",
    category: "operations",
    sizeKb: 176,
    uploadedAt: "2026-04-18T16:03:00.000Z",
    tags: ["cash", "deposit", "register"],
  },
  {
    id: "kb-015",
    title: "Salon Cleanliness Standards",
    description: "Room turnover expectations, front-of-house standards, and the weekly deep clean rotation.",
    category: "operations",
    sizeKb: 244,
    uploadedAt: "2026-03-28T09:47:00.000Z",
    tags: ["cleaning", "standards", "turnover"],
  },
  {
    id: "kb-016",
    title: "New Salon Opening Playbook",
    description: "The sequence for opening a new location, from build-out sign-off to first week staffing.",
    category: "operations",
    sizeKb: 812,
    uploadedAt: "2026-02-11T10:30:00.000Z",
    tags: ["new store", "playbook", "launch"],
  },
  {
    id: "kb-017",
    title: "Guest Flow & Front Desk Standards",
    description: "Greeting standards, wait management, and handing a guest off between team members.",
    category: "operations",
    sizeKb: 210,
    uploadedAt: "2026-08-04T13:20:00.000Z",
    status: "processing",
    uploadedBy: "Corey Vandenberg",
    tags: ["front desk", "guest flow", "service"],
  },

  /* -------------------------------------------------------- Training (7) -- */
  {
    id: "kb-018",
    title: "New Hire Onboarding Path",
    description: "Week-one through week-four onboarding milestones for every new team member.",
    category: "training",
    sizeKb: 528,
    uploadedAt: "2026-06-25T10:00:00.000Z",
    tags: ["onboarding", "new hire", "milestones"],
  },
  {
    id: "kb-019",
    title: "Tanning Consultant Certification Guide",
    description: "What a Tanning Consultant must demonstrate before working the floor independently.",
    category: "training",
    sizeKb: 466,
    uploadedAt: "2026-06-25T10:06:00.000Z",
    tags: ["tanning consultant", "certification", "training"],
  },
  {
    id: "kb-020",
    title: "Salon Director Manual",
    description:
      "The Salon Director role manual: accountability standards, coaching cadence, and weekly rhythm.",
    category: "training",
    sizeKb: 1580,
    uploadedAt: "2026-07-08T09:15:00.000Z",
    uploadedBy: "Dana Whitfield",
    tags: ["salon director", "manual", "coaching standards"],
  },
  {
    id: "kb-021",
    title: "Assistant Salon Director Development Track",
    description: "How an ASD builds toward Salon Director, with the checkpoints along the way.",
    category: "training",
    sizeKb: 384,
    uploadedAt: "2026-05-30T15:30:00.000Z",
    tags: ["asd", "development", "promotion"],
  },
  {
    id: "kb-022",
    title: "Product Knowledge Reference",
    description: "Lotion families, skin type guidance, and how to match a product to a guest.",
    category: "training",
    sizeKb: 622,
    uploadedAt: "2026-04-29T12:44:00.000Z",
    tags: ["product", "lotion", "skin type"],
  },
  {
    id: "kb-023",
    title: "Equipment Training Basics",
    description: "Orientation to every bed and booth type a consultant will operate.",
    category: "training",
    fileType: "pptx",
    sizeKb: 3140,
    uploadedAt: "2026-03-19T11:00:00.000Z",
    tags: ["equipment", "training", "orientation"],
  },
  {
    id: "kb-024",
    title: "Training Completion Tracker",
    description: "The workbook districts use to track certification completion by team member.",
    category: "training",
    fileType: "xlsx",
    sizeKb: 148,
    uploadedAt: "2026-02-05T14:50:00.000Z",
    tags: ["tracker", "certification", "compliance"],
  },

  /* --------------------------------------------- Leadership & Coaching (7) - */
  {
    id: "kb-025",
    title: "Coaching Conversation Guide",
    description:
      "How to plan, open, and close a coaching conversation, and what to document afterwards.",
    category: "leadership_coaching",
    sizeKb: 392,
    uploadedAt: "2026-07-18T13:25:00.000Z",
    uploadedBy: "Dana Whitfield",
    version: 2,
    tags: ["coaching", "conversation", "documentation", "follow-up"],
    priorVersions: [
      { version: 1, uploadedAt: "2026-03-02T13:25:00.000Z", uploadedBy: "Dana Whitfield", sizeKb: 351 },
    ],
  },
  {
    id: "kb-026",
    title: "Employee Performance Plan (EPP) Overview",
    description: "What an EPP is for, when to open one, and how progress is reviewed.",
    category: "leadership_coaching",
    sizeKb: 298,
    uploadedAt: "2026-06-16T10:40:00.000Z",
    tags: ["epp", "performance", "review"],
  },
  {
    id: "kb-027",
    title: "Documentation Standards for People Conversations",
    description: "What belongs in a written record, what does not, and who reviews it.",
    category: "leadership_coaching",
    sizeKb: 186,
    uploadedAt: "2026-06-16T10:46:00.000Z",
    tags: ["documentation", "hr", "records"],
  },
  {
    id: "kb-028",
    title: "Weekly One-on-One Framework",
    description: "A repeatable structure for a fifteen-minute weekly check-in with each team member.",
    category: "leadership_coaching",
    sizeKb: 142,
    uploadedAt: "2026-05-12T09:05:00.000Z",
    tags: ["one-on-one", "cadence", "check-in"],
  },
  {
    id: "kb-029",
    title: "Recognition & Retention Playbook",
    description: "Practical recognition moves that hold onto strong team members.",
    category: "leadership_coaching",
    sizeKb: 224,
    uploadedAt: "2026-04-14T16:20:00.000Z",
    tags: ["recognition", "retention", "culture"],
  },
  {
    id: "kb-030",
    title: "Interviewing & Selection Guide",
    description: "Structured interview questions and the scoring approach for salon roles.",
    category: "leadership_coaching",
    sizeKb: 268,
    uploadedAt: "2026-03-24T11:35:00.000Z",
    tags: ["hiring", "interview", "selection"],
  },
  {
    id: "kb-031",
    title: "L10 Meeting Facilitation Guide",
    description: "Running the weekly leadership meeting: agenda, scorecard review, and issue resolution.",
    category: "leadership_coaching",
    sizeKb: 176,
    uploadedAt: "2026-08-11T08:55:00.000Z",
    uploadedBy: "Marguerite Ellis",
    tags: ["l10", "meetings", "leadership"],
  },

  /* ------------------------------------- Sales & Client Experience (6) ----- */
  {
    id: "kb-032",
    title: "Membership Sales Guide",
    description:
      "Presenting membership levels, matching a guest to the right tier, and handling common objections.",
    category: "sales_client_experience",
    sizeKb: 512,
    uploadedAt: "2026-07-02T14:10:00.000Z",
    uploadedBy: "Terrence Boyd",
    tags: ["membership", "sales", "objections", "upgrade"],
  },
  {
    id: "kb-033",
    title: "Objection Handling Reference",
    description: "The objections teams hear most often and a straightforward response to each.",
    category: "sales_client_experience",
    sizeKb: 198,
    uploadedAt: "2026-07-02T14:16:00.000Z",
    tags: ["objections", "sales", "scripts"],
  },
  {
    id: "kb-034",
    title: "Upgrade & Add-On Conversation Guide",
    description: "How to introduce an upgrade without pressure, and when it is the right recommendation.",
    category: "sales_client_experience",
    sizeKb: 164,
    uploadedAt: "2026-05-27T13:00:00.000Z",
    tags: ["upgrade", "add-on", "sales"],
  },
  {
    id: "kb-035",
    title: "Client Experience Standards",
    description: "The service standard from greeting to walk-out, and what a great visit looks like.",
    category: "sales_client_experience",
    sizeKb: 232,
    uploadedAt: "2026-04-23T10:25:00.000Z",
    tags: ["client experience", "service", "standards"],
  },
  {
    id: "kb-036",
    title: "Cancellation & Save Playbook",
    description: "Understanding why a member is leaving and the saves that genuinely work.",
    category: "sales_client_experience",
    sizeKb: 186,
    uploadedAt: "2026-03-16T15:45:00.000Z",
    tags: ["cancellation", "retention", "membership"],
  },
  {
    id: "kb-037",
    title: "Google Review Request Guide",
    description: "When and how to ask a happy guest for a review, and how to respond to one.",
    category: "sales_client_experience",
    sizeKb: 128,
    uploadedAt: "2026-08-06T09:30:00.000Z",
    uploadedBy: "Alicia Moreno",
    tags: ["google reviews", "reputation", "guest"],
  },

  /* ------------------------------------------- Reports & Analytics (4) ---- */
  {
    id: "kb-038",
    title: "Daily Stats Interpretation Guide",
    description:
      "What every column on the Daily Stats report means and which numbers to act on first.",
    category: "reports_analytics",
    sizeKb: 356,
    uploadedAt: "2026-07-25T08:45:00.000Z",
    uploadedBy: "Marguerite Ellis",
    version: 2,
    tags: ["daily stats", "metrics", "reporting", "conversion"],
    priorVersions: [
      { version: 1, uploadedAt: "2026-01-20T08:45:00.000Z", uploadedBy: "Marguerite Ellis", sizeKb: 302 },
    ],
  },
  {
    id: "kb-039",
    title: "Weekly Scorecard Definitions",
    description: "Each scorecard measure, how it is calculated, and the target it is held to.",
    category: "reports_analytics",
    fileType: "xlsx",
    sizeKb: 118,
    uploadedAt: "2026-06-11T09:55:00.000Z",
    tags: ["scorecard", "definitions", "targets"],
  },
  {
    id: "kb-040",
    title: "Reading a Membership Mix Report",
    description: "How to spot a mix problem early and what usually causes it.",
    category: "reports_analytics",
    sizeKb: 172,
    uploadedAt: "2026-05-08T12:30:00.000Z",
    tags: ["membership mix", "reporting", "analysis"],
  },
  {
    id: "kb-041",
    title: "Power BI Report Directory",
    description: "Which report answers which question, and who owns each dashboard.",
    category: "reports_analytics",
    fileType: "docx",
    sizeKb: 94,
    uploadedAt: "2026-08-13T11:20:00.000Z",
    status: "needs_review",
    uploadedBy: "Priya Raghunathan",
    tags: ["power bi", "reporting", "directory"],
  },

  /* --------------------------------------- Bonuses & Compensation (4) ----- */
  {
    id: "kb-042",
    title: "Salon Director Bonus Structure",
    description: "How the Salon Director bonus is calculated and when it is paid.",
    category: "bonuses_compensation",
    sizeKb: 214,
    uploadedAt: "2026-07-09T14:35:00.000Z",
    uploadedBy: "Marguerite Ellis",
    tags: ["bonus", "salon director", "compensation"],
  },
  {
    id: "kb-043",
    title: "Consultant Commission Reference",
    description: "Commission tiers, qualifying sales, and common calculation questions.",
    category: "bonuses_compensation",
    sizeKb: 168,
    uploadedAt: "2026-07-09T14:41:00.000Z",
    tags: ["commission", "consultant", "payroll"],
  },
  {
    id: "kb-044",
    title: "District Manager Incentive Overview",
    description: "District-level incentive measures and the payout schedule.",
    category: "bonuses_compensation",
    sizeKb: 152,
    uploadedAt: "2026-05-21T10:15:00.000Z",
    tags: ["incentive", "district manager", "compensation"],
  },
  {
    id: "kb-045",
    title: "Payroll Calendar & Cutoffs",
    description: "Pay period boundaries, approval cutoffs, and correction windows.",
    category: "bonuses_compensation",
    fileType: "xlsx",
    sizeKb: 78,
    uploadedAt: "2026-01-15T09:00:00.000Z",
    tags: ["payroll", "calendar", "cutoff"],
  },

  /* ---------------------------------------------------------- Safety (5) -- */
  {
    id: "kb-046",
    title: "Safety Procedures",
    description:
      "Incident response, injury documentation, and the escalation path for anything unsafe in a salon.",
    category: "safety",
    sizeKb: 428,
    uploadedAt: "2026-07-16T10:50:00.000Z",
    uploadedBy: "Dana Whitfield",
    tags: ["safety", "incident", "escalation", "emergency"],
  },
  {
    id: "kb-047",
    title: "Emergency Action Plan",
    description: "Severe weather, power loss, and evacuation procedures by salon layout.",
    category: "safety",
    sizeKb: 246,
    uploadedAt: "2026-06-04T13:40:00.000Z",
    tags: ["emergency", "evacuation", "weather"],
  },
  {
    id: "kb-048",
    title: "Injury & Incident Reporting Procedure",
    description: "What to capture, who to notify, and how quickly a report must be filed.",
    category: "safety",
    sizeKb: 158,
    uploadedAt: "2026-06-04T13:46:00.000Z",
    tags: ["injury", "incident report", "notification"],
  },
  {
    id: "kb-049",
    title: "Chemical Handling & Storage Basics",
    description: "Safe handling and storage of cleaning chemicals used in salons.",
    category: "safety",
    sizeKb: 194,
    uploadedAt: "2026-03-07T11:25:00.000Z",
    tags: ["chemicals", "storage", "handling"],
  },
  {
    id: "kb-050",
    title: "Guest Incident Response Guide",
    description: "Responding calmly when a guest reports discomfort or an adverse reaction.",
    category: "safety",
    sizeKb: 136,
    uploadedAt: "2026-02-19T15:10:00.000Z",
    tags: ["guest", "incident", "response"],
  },

  /* --------------------------------------- Equipment & Procedures (5) ----- */
  {
    id: "kb-051",
    title: "Bed & Booth Cleaning Protocol",
    description: "The step-by-step clean between every guest, by equipment type.",
    category: "equipment_procedures",
    sizeKb: 288,
    uploadedAt: "2026-07-11T08:20:00.000Z",
    tags: ["cleaning", "beds", "booths", "protocol"],
  },
  {
    id: "kb-052",
    title: "Lamp Replacement Procedure",
    description: "Replacement intervals, ordering, and the log every salon keeps.",
    category: "equipment_procedures",
    sizeKb: 204,
    uploadedAt: "2026-06-20T14:00:00.000Z",
    tags: ["lamps", "maintenance", "replacement"],
  },
  {
    id: "kb-053",
    title: "Spray Booth Troubleshooting Reference",
    description: "The most common spray booth faults and the checks to run before calling service.",
    category: "equipment_procedures",
    sizeKb: 256,
    uploadedAt: "2026-05-14T13:15:00.000Z",
    tags: ["spray booth", "troubleshooting", "service"],
  },
  {
    id: "kb-054",
    title: "Preventive Maintenance Schedule",
    description: "The monthly and quarterly maintenance rotation for every equipment class.",
    category: "equipment_procedures",
    fileType: "xlsx",
    sizeKb: 112,
    uploadedAt: "2026-04-02T09:35:00.000Z",
    tags: ["maintenance", "schedule", "preventive"],
  },
  {
    id: "kb-055",
    title: "Service Request & Escalation Guide",
    description: "How to log a service request and when to escalate an equipment issue.",
    category: "equipment_procedures",
    sizeKb: 148,
    uploadedAt: "2026-08-18T10:10:00.000Z",
    status: "failed",
    uploadedBy: "Corey Vandenberg",
    tags: ["service", "escalation", "equipment"],
  },

  /* ----------------------------------------------------------- Other (3) -- */
  {
    id: "kb-056",
    title: "Manager Acronym & Terminology Reference",
    description: "Plain-language definitions for the acronyms used across reports and forms.",
    category: "other",
    fileType: "md",
    sizeKb: 42,
    uploadedAt: "2026-08-02T16:05:00.000Z",
    tags: ["glossary", "acronyms", "reference"],
  },
  {
    id: "kb-057",
    title: "Vendor & Support Contact List",
    description: "Who to call for equipment, IT, facilities, and supply issues.",
    category: "other",
    fileType: "xlsx",
    sizeKb: 66,
    uploadedAt: "2026-07-27T12:40:00.000Z",
    tags: ["contacts", "vendors", "support"],
  },
  {
    id: "kb-058",
    title: "Ask Sunny Quick Start for Managers",
    description: "A one-page orientation to the platform for a manager using it for the first time.",
    category: "other",
    fileType: "md",
    sizeKb: 28,
    uploadedAt: "2026-08-20T09:00:00.000Z",
    uploadedBy: "Priya Raghunathan",
    tags: ["ask sunny", "getting started", "orientation"],
  },
];

export const DEMO_KNOWLEDGE_DOCUMENTS: KnowledgeDocument[] = SEEDS.map(expand);

/**
 * Retrievable chunks for the six grounding documents used by the chat demo.
 *
 * DEMO CONTENT — every excerpt below is generic placeholder prose written for
 * this prototype. None of it is real company policy language, and the UI labels
 * it as demo content wherever it is shown.
 *
 * FUTURE: these chunks are produced by the ingestion pipeline
 * (extract -> chunk -> embed -> vector store), not hand-written here.
 */
export const DEMO_KNOWLEDGE_CHUNKS: KnowledgeChunk[] = [
  {
    id: "chunk-001",
    documentId: "kb-001",
    locator: "Page 14",
    content:
      "Demo content. Team members are expected to be ready to work at the start of their scheduled shift. A shift that begins late is recorded as an occurrence. Repeated occurrences within a rolling period are addressed through the standard coaching sequence, beginning with a documented conversation before any formal step is taken.",
  },
  {
    id: "chunk-002",
    documentId: "kb-001",
    locator: "Page 15",
    content:
      "Demo content. Call-outs should reach the Salon Director directly, by phone, as far ahead of the shift as possible. Text-only notice is not considered sufficient notice. The Salon Director records the call-out the same day so the pattern is visible before it becomes a performance issue.",
  },
  {
    id: "chunk-003",
    documentId: "kb-001",
    locator: "Page 22",
    content:
      "Demo content. Dress code expectations cover approved tops, name badge placement, closed-toe footwear, and grooming standards. A team member sent home to correct a dress code issue is coached in private, and the conversation is documented the same day.",
  },
  {
    id: "chunk-004",
    documentId: "kb-025",
    locator: "Coaching Standards",
    content:
      "Demo content. Prepare before the conversation: know the specific behaviour, the dates it occurred, and the standard it falls short of. Open by naming the gap plainly, ask an open question so the team member can explain, then agree a single expected behaviour going forward and a date to review it.",
  },
  {
    id: "chunk-005",
    documentId: "kb-025",
    locator: "Follow-Up",
    content:
      "Demo content. Every coaching conversation gets a follow-up date. The follow-up is a real conversation, not a box to tick — you either confirm the change has held or you escalate to the next step. Move the date rather than let it lapse if circumstances genuinely changed.",
  },
  {
    id: "chunk-006",
    documentId: "kb-020",
    locator: "Coaching Standards",
    content:
      "Demo content. Salon Directors are expected to hold a short weekly one-on-one with each team member, and to document any conversation that addresses a performance gap. Documentation protects the team member as much as the business: it shows exactly what was asked for and when.",
  },
  {
    id: "chunk-007",
    documentId: "kb-038",
    locator: "Section 2 — Conversion",
    content:
      "Demo content. Conversion is the share of guests who leave with a membership or an upgrade. Read it alongside traffic: a strong conversion rate on low traffic is a marketing problem, while high traffic with weak conversion is a coaching problem on the floor.",
  },
  {
    id: "chunk-008",
    documentId: "kb-038",
    locator: "Section 3 — What to act on first",
    content:
      "Demo content. Work the report in this order: yesterday's traffic against the same weekday last week, then conversion, then average ticket, then membership mix. Pick the single largest gap and coach one behaviour against it — not four.",
  },
  {
    id: "chunk-009",
    documentId: "kb-032",
    locator: "Page 8",
    content:
      "Demo content. Match the membership tier to how the guest actually plans to use the salon rather than to the highest price point. A tier the guest can sustain produces better retention than an upgrade that lapses in month two.",
  },
  {
    id: "chunk-010",
    documentId: "kb-032",
    locator: "Page 12 — Objections",
    content:
      "Demo content. When a guest says the price is too high, acknowledge it directly, then reframe around cost per visit at their expected frequency. If the objection is really about commitment length, move the conversation to the shorter tier instead of defending the price.",
  },
  {
    id: "chunk-011",
    documentId: "kb-010",
    locator: "Section 1 — Opening",
    content:
      "Demo content. The opening routine covers equipment checks, cleanliness walk, product levels, and a two-minute team huddle on the day's focus. The Salon Director confirms the checklist is complete before the first guest is served.",
  },
  {
    id: "chunk-012",
    documentId: "kb-010",
    locator: "Section 4 — Daily accountability",
    content:
      "Demo content. Close the day by reviewing results against the day's focus with whoever is on shift. Name one thing that went well and one thing to adjust tomorrow. Keep it under five minutes.",
  },
  {
    id: "chunk-013",
    documentId: "kb-046",
    locator: "Section 2 — Incident response",
    content:
      "Demo content. If a guest or team member is injured, make the area safe first, then provide or summon appropriate care. Document what happened while it is fresh and notify your District Manager the same day. Do not speculate about cause in the written record — record only what was observed.",
  },
  {
    id: "chunk-014",
    documentId: "kb-046",
    locator: "Section 5 — Equipment risk",
    content:
      "Demo content. Any equipment suspected of being unsafe is taken out of service immediately and tagged, before any further guest use. Equipment risk is escalated the same day through the service request path — it is never held for the next scheduled maintenance visit.",
  },
  {
    id: "chunk-015",
    documentId: "kb-035",
    locator: "Page 4",
    content:
      "Demo content. Greet every guest within fifteen seconds of arrival, by name where you know it. A guest who is acknowledged quickly waits more patiently than one who is served quickly but ignored on arrival.",
  },
  {
    id: "chunk-016",
    documentId: "kb-033",
    locator: "Page 3",
    content:
      "Demo content. Listen to the whole objection before answering. Most objections are one of four things: price, commitment, time, or a past experience. Name which one you are hearing and address that one — answering the wrong objection reads as not listening.",
  },
];

export function chunksForDocument(documentId: string): KnowledgeChunk[] {
  return DEMO_KNOWLEDGE_CHUNKS.filter((chunk) => chunk.documentId === documentId);
}
