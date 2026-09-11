import type { KnowledgeCategory } from "@/types";

/**
 * WHAT LEADERS USE ASK SUNNY FOR, in the business's own words.
 *
 * Client-safe: keys, labels and pure functions. No database client, no secret.
 * The enums mirror `public.activity_feature` and `public.activity_category`
 * exactly, and `analytics.test.ts` asserts they still do by reading the
 * migrations — a category added on one side only would silently count as
 * nothing.
 *
 * ===========================================================================
 * THE TAXONOMY IS DERIVED FROM THE PRODUCT, NOT INVENTED FOR THE DASHBOARD
 * ===========================================================================
 *
 * Every category below traces to something the application already ships:
 *
 *   the form library's template keys   coaching, follow-up-coaching, dpoa,
 *                                      policy-review, the *-epp family, and
 *                                      the `hiring` template category
 *   the knowledge categories           the ten values of `KnowledgeCategory`,
 *                                      which every indexed document carries
 *                                      and every citation reports
 *   the reporting families             sales_totals_*, comp_sales_*,
 *                                      bed_usage_*, spa_*
 *   the training video library
 *
 * That is why there is no "Membership & sales" invented out of nowhere: it is
 * `sales_client_experience`, a real knowledge category holding real documents.
 * And why "Maintenance" is `equipment_maintenance`: the corresponding knowledge
 * category is `equipment_procedures`.
 *
 * ===========================================================================
 * NO QUESTION TEXT IS EVER STORED
 * ===========================================================================
 *
 * `activity_events` has no column for a prompt, an answer, an excerpt or a hash
 * of any of them. The question is used ON THE SERVER, IN MEMORY, FOR THE
 * DURATION OF ONE REQUEST, to pick one value from the enum below — and then the
 * enum value alone is written. The structure enforces it: there is nowhere for
 * text to go.
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
  /* --- The form families, from the library's own template keys ----------- */
  "coaching_form",
  "corrective_action",
  "epp",
  "policy_review",
  "hiring_form",
  /* --- Business topics, from the knowledge categories -------------------- */
  "coaching_guidance",
  "policy_question",
  "salon_operations",
  "equipment_maintenance",
  "training",
  "membership_sales",
  "pay_bonus",
  "safety_hr",
  "hiring_onboarding",
  /* --- Reporting --------------------------------------------------------- */
  "daily_stats",
  "report_analysis",
  "report_upload",
  /* --- Knowledge --------------------------------------------------------- */
  "document_upload",
  "document_search",
  /* --- Videos ------------------------------------------------------------ */
  "training_video",
  /* --- The residuals, and they are deliberately two ---------------------- */
  "general_guidance",
  "form_request",
  "unclassified",
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
  coaching_form: "Coaching Forms",
  corrective_action: "Corrective Action Forms",
  epp: "EPPs",
  policy_review: "Policy Reviews",
  hiring_form: "Hiring & Interview Forms",
  coaching_guidance: "Coaching & performance guidance",
  policy_question: "Policy & compliance questions",
  salon_operations: "Salon operations",
  equipment_maintenance: "Equipment & maintenance",
  training: "Training",
  membership_sales: "Membership, sales & client experience",
  pay_bonus: "Pay, bonus & compensation",
  safety_hr: "Safety & compliance",
  hiring_onboarding: "Hiring & onboarding",
  daily_stats: "Daily Stats & reporting",
  report_analysis: "Report analysis",
  report_upload: "Report ingestions",
  document_upload: "Document uploads",
  document_search: "Knowledge searches",
  training_video: "Training videos",
  general_guidance: "General guidance",
  form_request: "Form requests (family unknown)",
  unclassified: "Unclassified",
};

/** Which part of the app a category belongs to, for the feature-usage split. */
export const CATEGORY_FEATURE: Record<ActivityCategory, ActivityFeature> = {
  coaching_form: "forms",
  corrective_action: "forms",
  epp: "forms",
  policy_review: "forms",
  hiring_form: "forms",
  coaching_guidance: "chat",
  policy_question: "chat",
  salon_operations: "chat",
  equipment_maintenance: "chat",
  training: "chat",
  membership_sales: "chat",
  pay_bonus: "chat",
  safety_hr: "chat",
  hiring_onboarding: "chat",
  daily_stats: "chat",
  report_analysis: "reports",
  report_upload: "reports",
  document_upload: "knowledge",
  document_search: "knowledge",
  training_video: "videos",
  general_guidance: "chat",
  form_request: "chat",
  unclassified: "chat",
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
 * Returns the raw key rather than "Other". A category added by a later
 * migration and not yet named here should read as the thing it is, so the gap is
 * obvious and fixable; folding it into "Other" would hide a whole class of usage
 * behind a word that looks deliberate — and "Other" already means something
 * specific here.
 */
export function categoryLabel(key: string): string {
  return isActivityCategory(key) ? CATEGORY_LABEL[key] : key;
}

export function featureLabel(key: string): string {
  return isActivityFeature(key) ? FEATURE_LABEL[key] : key;
}

/* ==========================================================================
 * STEP 1 OF THE LADDER — the form library's own template keys
 * ========================================================================== */

/**
 * The form family a template key belongs to.
 *
 * MATCHED ON THE KEY, which is the library's identity for a template and the
 * same string `activity_unified` branches on in SQL. Deliberately not matched on
 * the template NAME: "DPOA" was renamed to "Corrective Action Form" and the key
 * `dpoa` did not change, so a name match would have split one family in two on
 * the day of the rename.
 *
 * Returns null for a key this build does not recognise — a template added later
 * counts as a form request of unknown family rather than being silently filed
 * under whichever branch happened to match first.
 */
export function categoryForTemplateKey(
  key: string | null | undefined,
  templateCategory?: string | null,
): ActivityCategory | null {
  if (!key) return null;
  const normalised = key.trim().toLowerCase();
  if (normalised === "coaching" || normalised === "follow-up-coaching") {
    return "coaching_form";
  }
  if (normalised === "dpoa") return "corrective_action";
  if (normalised === "policy-review") return "policy_review";
  if (normalised.includes("epp")) return "epp";
  if (templateCategory === "hiring") return "hiring_form";
  return null;
}

/* ==========================================================================
 * STEP 3 OF THE LADDER — the knowledge category a citation reports
 * ========================================================================== */

/**
 * The business topic a knowledge category represents.
 *
 * THIS IS AUTHORITATIVE METADATA, not a guess. Every indexed document carries a
 * `KnowledgeCategory` chosen when it was uploaded, and every citation on an
 * answer reports the category of the document it came from. So when an answer
 * is grounded in company documents, the topic of the turn is a fact the system
 * already knows — no reading of the question required.
 *
 * `other` maps to null rather than to a topic: a document filed as "other" says
 * nothing about what the question was about, and six of the forty documents in
 * this corpus are filed that way. Claiming a topic from it would be inventing
 * one.
 */
export function categoryForKnowledgeCategory(
  category: KnowledgeCategory,
): ActivityCategory | null {
  switch (category) {
    case "leadership_coaching":
      return "coaching_guidance";
    case "policies_compliance":
      return "policy_question";
    case "operations":
      return "salon_operations";
    case "equipment_procedures":
      return "equipment_maintenance";
    case "training":
      return "training";
    case "sales_client_experience":
      return "membership_sales";
    case "bonuses_compensation":
      return "pay_bonus";
    case "safety":
      return "safety_hr";
    case "reports_analytics":
      return "daily_stats";
    case "other":
      return null;
  }
}

/* ==========================================================================
 * STEP 4 OF THE LADDER — the transient read of the question
 * ========================================================================== */

/**
 * THE TERMS, and the discipline behind them.
 *
 * Each entry is the vocabulary of ONE business topic that already exists in this
 * product. They were taken from the form library's names, the knowledge
 * categories, and the words this company actually uses — "DPOA" and "write-up"
 * sit beside "corrective action" because managers say all three for one thing.
 *
 * THIS IS A LOOKUP, NOT A MODEL. It runs in microseconds, costs nothing, sends
 * nothing anywhere, and is auditable by reading it. Handing the question to a
 * language model to be labelled would mean transmitting the text of an HR
 * question about a named employee to a vendor for the benefit of a usage chart,
 * which is a bad trade at any accuracy.
 *
 * MATCHED ON WORD BOUNDARIES. Substring matching put "epp" inside "pepper" and
 * "stepped"; every term here has to be a whole word or a whole phrase.
 */
const TOPIC_TERMS: Record<string, ActivityCategory> = {};

function addTerms(category: ActivityCategory, terms: string[]) {
  for (const term of terms) TOPIC_TERMS[term] = category;
}

addTerms("corrective_action", [
  "dpoa",
  "corrective action",
  "write up",
  "write-up",
  "writeup",
  "written up",
  "writing up",
  "write someone up",
  "write him up",
  "write her up",
  "write them up",
  "written warning",
  "final warning",
  "disciplinary",
  "discipline",
  "termination",
  "terminate",
  "attendance policy",
  "no call no show",
]);

addTerms("coaching_form", ["coaching form", "follow-up coaching", "follow up coaching"]);

addTerms("coaching_guidance", [
  "coaching",
  "coach",
  "performance",
  "one on one",
  "1:1",
  "feedback",
  "improvement plan",
  "development plan",
  "goal setting",
]);

addTerms("epp", ["epp", "epps", "performance plan", "tsd review", "dmit", "sdit", "fttc"]);

addTerms("policy_review", ["policy review"]);

addTerms("policy_question", [
  "policy",
  "policies",
  "handbook",
  "manual",
  "compliance",
  "rule",
  "allowed",
  "permitted",
  "violation",
]);

addTerms("daily_stats", [
  "daily stats",
  "daily report",
  "upta",
  "club close",
  "sales totals",
  "comp sales",
  "revenue",
  "kpi",
  "numbers",
  "metrics",
]);

addTerms("report_analysis", [
  "report",
  "analyze",
  "analyse",
  "analysis",
  "bed usage",
  "spa engagement",
  "spa wellness",
  "trend",
]);

addTerms("membership_sales", [
  "membership",
  "memberships",
  "upgrade",
  "package",
  "promotion",
  "promo",
  "discount",
  "client experience",
  "customer",
  "sales goal",
]);

addTerms("equipment_maintenance", [
  "maintenance",
  "equipment",
  "bed",
  "beds",
  "lamp",
  "lamps",
  "bulb",
  "bulbs",
  "repair",
  "broken",
  "cleaning",
  "sanitize",
  "sanitise",
]);

addTerms("training", [
  "training",
  "train",
  "onboard training",
  "certification",
  "tutorial",
  "how do i learn",
]);

addTerms("hiring_onboarding", [
  "hiring",
  "hire",
  "interview",
  "candidate",
  "applicant",
  "prescreen",
  "onboarding",
  "new hire",
  "job posting",
]);

addTerms("pay_bonus", [
  "pay",
  "payroll",
  "bonus",
  "commission",
  "wage",
  "wages",
  "raise",
  "compensation",
  "overtime",
  "pto",
]);

addTerms("safety_hr", [
  "safety",
  "injury",
  "accident",
  "incident",
  "hazard",
  "osha",
  "harassment",
  "minor",
  "minors",
]);

addTerms("salon_operations", [
  "open the salon",
  "closing",
  "opening",
  "schedule",
  "scheduling",
  "shift",
  "staffing",
  "inventory",
  "supplies",
  "operations",
]);

/**
 * The longest terms first, so a specific phrase beats the general word inside
 * it: "coaching form" must not be decided by "coaching", and "attendance
 * policy" must not be decided by "policy".
 */
const TOPIC_TERMS_BY_LENGTH = Object.entries(TOPIC_TERMS).sort(
  (a, b) => b[0].length - a[0].length,
);

/**
 * Classify a question in memory, and return one category.
 *
 * THE TEXT DOES NOT LEAVE THIS FUNCTION. It is a parameter, it is lowercased
 * into a local, it is matched against the table above, and it is discarded when
 * the call returns. Nothing here writes, logs, hashes or transmits it.
 *
 * Returns null when no term matches, which the caller turns into
 * `general_guidance` — an honest "somebody asked something ordinary" rather
 * than a topic nobody can justify.
 */
export function classifyQuestionText(question: string): ActivityCategory | null {
  const haystack = ` ${question.toLowerCase().replace(/[^a-z0-9:]+/g, " ").trim()} `;
  if (haystack.trim().length === 0) return null;

  for (const [term, category] of TOPIC_TERMS_BY_LENGTH) {
    if (haystack.includes(` ${term} `)) return category;
  }
  return null;
}

/* ==========================================================================
 * THE LADDER ITSELF
 * ========================================================================== */

export interface ChatTurnEvidence {
  /** The template key the answer proposed, when it proposed one. */
  proposedTemplateKey?: string | null;
  /** True when the answer offered form CHOICES rather than naming one. */
  offeredFormChoices?: boolean;
  /** The request arrived with a report attached. */
  hadReportContext: boolean;
  /** The knowledge categories of the documents the answer cited. */
  citedCategories: KnowledgeCategory[];
  /**
   * The question, USED TRANSIENTLY AND NEVER STORED.
   *
   * Optional so a caller that has no text — or chooses not to pass it — still
   * gets a category from the deterministic steps above.
   */
  question?: string | null;
}

/**
 * ONE CATEGORY PER CHAT TURN, decided by evidence in descending order of
 * certainty.
 *
 *   1. THE FORM IT PROPOSED. The answer named a template key, so the family is
 *      a fact. Strongest signal there is.
 *   2. AN ATTACHED REPORT. The manager sent their figures with the question;
 *      the turn is Daily Stats work whatever words came with it.
 *   3. THE DOCUMENTS IT CITED. Every citation reports the knowledge category of
 *      the document it came from — metadata the system already holds, chosen by
 *      whoever uploaded it. The most-cited category wins.
 *   4. THE QUESTION, READ IN MEMORY. Only now, and only because steps 1-3 found
 *      nothing. One lookup against a fixed term table; the text is discarded
 *      when the function returns.
 *   5. GENERAL GUIDANCE. Nothing matched, and that is a real answer: somebody
 *      asked something ordinary.
 *
 * WHY THE ORDER MATTERS. An answer about the attendance policy that ends in a
 * Corrective Action Form is filed under the form, because producing the form is
 * what the manager came for. Reading the question first would file half of those
 * turns under "policy" and make the form work invisible.
 *
 * `unclassified` is reserved for the one case none of the above covers: no
 * deterministic evidence AND no question to read. It is kept separate from
 * `general_guidance` on purpose — if the evidence pipeline ever breaks, it
 * should show up as its own bar on the chart rather than quietly inflating a
 * category that means something specific.
 */
export function classifyChatTurn(evidence: ChatTurnEvidence): ActivityCategory {
  const fromTemplate = categoryForTemplateKey(evidence.proposedTemplateKey);
  if (fromTemplate) return fromTemplate;

  /* A named template beats this; an unnamed form turn is still a form turn. */
  if (evidence.proposedTemplateKey || evidence.offeredFormChoices) {
    return "form_request";
  }

  if (evidence.hadReportContext) return "daily_stats";

  const fromCitations = dominantCitationCategory(evidence.citedCategories);
  if (fromCitations) return fromCitations;

  const question = evidence.question?.trim() ?? "";
  if (question.length > 0) {
    return classifyQuestionText(question) ?? "general_guidance";
  }

  /*
   * No action, no citation, no text. Not "general guidance" — that is a claim
   * about what was asked, and nothing here saw anything.
   */
  return "unclassified";
}

/**
 * The most frequently cited knowledge category, mapped to a business topic.
 *
 * Ties break toward the FIRST citation, which is the highest-relevance one —
 * the retriever already ranked them, so the leading source is the better
 * tie-breaker than alphabetical order.
 *
 * Categories that map to null (`other`) are skipped rather than counted, so a
 * turn citing four "other" documents and one policy document is a policy
 * question rather than an unclassified one.
 */
function dominantCitationCategory(
  categories: KnowledgeCategory[],
): ActivityCategory | null {
  const counts = new Map<ActivityCategory, number>();
  let best: ActivityCategory | null = null;
  let bestCount = 0;

  for (const knowledge of categories) {
    const mapped = categoryForKnowledgeCategory(knowledge);
    if (!mapped) continue;
    const next = (counts.get(mapped) ?? 0) + 1;
    counts.set(mapped, next);
    if (next > bestCount) {
      best = mapped;
      bestCount = next;
    }
  }

  return best;
}
