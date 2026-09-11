/**
 * WHAT THE ANALYTICS COUNT, in the business's own words.
 *
 * Client-safe: labels and keys only, no database client and no secret. The
 * enums here mirror `public.activity_feature` and `public.activity_category`
 * exactly, and `analytics-taxonomy.test.ts` asserts they still do — a category
 * added to one side and not the other would silently count as nothing.
 *
 * THE VOCABULARY IS THE PRODUCT'S, NOT THE IMPLEMENTATION'S. Every label below
 * is a thing a manager would recognise from using Ask Sunny: the form library's
 * own names ("Corrective Action Form", not "dpoa"), the sections of the app they
 * click on. A dashboard that reports on table names is reporting on us.
 */

export const ACTIVITY_FEATURES = [
  "chat",
  "forms",
  "knowledge",
  "reports",
  "videos",
] as const;

export type ActivityFeature = (typeof ACTIVITY_FEATURES)[number];

export const ACTIVITY_CATEGORIES = [
  /* Chat. Classified from what the server did when answering — see below. */
  "general_guidance",
  "policy_question",
  "daily_stats",
  "form_request",
  /* Forms, from the template families the library actually ships. */
  "coaching_form",
  "corrective_action",
  "epp",
  "policy_review",
  "hiring_form",
  /* Knowledge. */
  "document_upload",
  "document_search",
  /* Reports. */
  "report_upload",
  "report_analysis",
  /* Videos. */
  "training_video",
] as const;

export type ActivityCategory = (typeof ACTIVITY_CATEGORIES)[number];

export const FEATURE_LABEL: Record<ActivityFeature, string> = {
  chat: "Ask Sunny",
  forms: "Forms",
  knowledge: "Knowledge Base",
  reports: "Reports",
  videos: "Videos",
};

export const CATEGORY_LABEL: Record<ActivityCategory, string> = {
  general_guidance: "General guidance",
  policy_question: "Policy & manual questions",
  daily_stats: "Daily Stats analysis",
  form_request: "Form requests",
  coaching_form: "Coaching Forms",
  corrective_action: "Corrective Action Forms",
  epp: "EPPs",
  policy_review: "Policy Reviews",
  hiring_form: "Hiring & Interview Forms",
  document_upload: "Document uploads",
  document_search: "Knowledge searches",
  report_upload: "Report ingestions",
  report_analysis: "Report analysis",
  training_video: "Training videos",
};

/** Which part of the app a category belongs to, for the feature-usage split. */
export const CATEGORY_FEATURE: Record<ActivityCategory, ActivityFeature> = {
  general_guidance: "chat",
  policy_question: "chat",
  daily_stats: "chat",
  form_request: "chat",
  coaching_form: "forms",
  corrective_action: "forms",
  epp: "forms",
  policy_review: "forms",
  hiring_form: "forms",
  document_upload: "knowledge",
  document_search: "knowledge",
  report_upload: "reports",
  report_analysis: "reports",
  training_video: "videos",
};

export function isActivityCategory(value: unknown): value is ActivityCategory {
  return ACTIVITY_CATEGORIES.includes(value as ActivityCategory);
}

export function isActivityFeature(value: unknown): value is ActivityFeature {
  return ACTIVITY_FEATURES.includes(value as ActivityFeature);
}

/**
 * A label for a key the database returned that this build does not know.
 *
 * Returns the raw key rather than "Other" or "Unknown". A category added by a
 * later migration and not yet named here should read as the thing it is, so the
 * gap is obvious and fixable; folding it into an "Other" bucket would hide a
 * whole category of usage behind a word that looks deliberate.
 */
export function categoryLabel(key: string): string {
  return isActivityCategory(key) ? CATEGORY_LABEL[key] : key;
}

export function featureLabel(key: string): string {
  return isActivityFeature(key) ? FEATURE_LABEL[key] : key;
}

/* ------------------------------------------------- chat classification --- */

/**
 * WHAT THE SERVER DID WHEN IT ANSWERED — which is how a chat turn gets a
 * category without the question ever being stored.
 *
 * Every input is an observable fact about the response the handler is about to
 * return, not a reading of what the manager typed. That is the whole design:
 * managers ask Ask Sunny about named employees' attendance and write-ups, so
 * the adoption dashboard is built to know THAT somebody asked and never WHAT.
 *
 * The order is a precedence, and it is deliberate. A turn that produced a form
 * proposal is a form request even if it also cited the manual, because the form
 * is what the manager came for; a turn carrying an attached report is Daily
 * Stats work even when it cites nothing. Citations are the weakest signal and
 * come last, which is why they only claim the turns nothing else explains.
 */
export function classifyChatTurn(outcome: {
  /** The answer offered to create a form, or asked which form was meant. */
  proposedForm: boolean;
  /** The request arrived with a report attached. */
  hadReportContext: boolean;
  /** The answer cited indexed company documents. */
  citedDocuments: boolean;
}): ActivityCategory {
  if (outcome.proposedForm) return "form_request";
  if (outcome.hadReportContext) return "daily_stats";
  if (outcome.citedDocuments) return "policy_question";
  return "general_guidance";
}
