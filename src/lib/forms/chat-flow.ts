import { formatDate, isoDaysFromAnchor } from "@/lib/utils/date";
import type { ChatMessage, FormHandoff, SourceCitation, TemplateField } from "@/types";
import type { AskContext, AskResponse, FormDraftRequest, FormDraftResponse } from "@/lib/ai/types";

/**
 * CHAT -> FORM FLOW.
 *
 * Lifted verbatim out of MockAIProvider so both providers share one
 * implementation. The behaviour is unchanged — this is a move, not a rewrite.
 *
 * It stays deterministic on purpose. A coaching form is a document that ends up
 * in someone's employment file: which template applies, which fields exist, and
 * which fields a model may never touch are decisions for code, not for a
 * language model. Claude drafts prose inside those fields; it does not choose
 * the frame.
 */

const FORM_INTENT = [
  "create a coaching form",
  "coaching form",
  "corrective action",
  "create a form",
  "draft a form",
  "write up",
  "write-up",
  "disciplinary",
  "dpoa",
  "policy review form",
  "performance form",
];

const TEMPLATE_INTENT: { id: string; name: string; matchers: string[] }[] = [
  {
    id: "tpl-dpoa",
    name: "Disciplinary Plan of Action (DPOA)",
    matchers: ["dpoa", "disciplinary", "corrective action", "written warning"],
  },
  { id: "tpl-policy-review", name: "Policy Review", matchers: ["policy review"] },
  {
    id: "tpl-coaching",
    name: "Coaching Form",
    matchers: ["coaching", "coach", "performance concern", "form"],
  },
];

const COACHING_TOPIC_MAP: { keywords: string[]; option: string }[] = [
  { keywords: ["tardy", "tardiness", "late", "attendance", "punctual", "call out", "no show"], option: "Attendance / punctuality" },
  { keywords: ["dress", "uniform", "badge", "footwear", "grooming"], option: "Dress code" },
  { keywords: ["sales", "conversion", "membership", "upgrade", "quota"], option: "Sales performance" },
  { keywords: ["guest", "client", "customer", "greeting", "service"], option: "Client experience" },
  { keywords: ["clean", "cleanliness", "turnover", "sanit"], option: "Cleanliness standards" },
  { keywords: ["policy", "procedure", "checklist", "closing", "opening"], option: "Policy adherence" },
  { keywords: ["team", "communication", "attitude", "conflict"], option: "Teamwork / communication" },
];

function normalize(value: string) {
  return value.toLowerCase().trim();
}

export function isFormIntent(question: string): boolean {
  const q = normalize(question);
  return FORM_INTENT.some((intent) => q.includes(intent));
}

export function detectTemplate(question: string): { id: string; name: string } {
  const q = normalize(question);
  const match = TEMPLATE_INTENT.find((template) =>
    template.matchers.some((matcher) => q.includes(matcher)),
  );
  return match ? { id: match.id, name: match.name } : { id: "tpl-coaching", name: "Coaching Form" };
}

export function templateNameFor(templateId: string): string {
  return TEMPLATE_INTENT.find((entry) => entry.id === templateId)?.name ?? "Coaching Form";
}

export function coachingTopicOption(topic: string): string {
  const t = normalize(topic);
  const match = COACHING_TOPIC_MAP.find((entry) =>
    entry.keywords.some((keyword) => t.includes(keyword)),
  );
  return match?.option ?? "Policy adherence";
}

export function extractEmployeeName(raw: string): string | null {
  const forMatch = raw.match(/\bfor\s+([A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+)?)/);
  if (forMatch?.[1]) {
    const candidate = forMatch[1].trim();
    if (!/^(a|an|the|my|our)$/i.test(candidate)) return candidate;
  }
  const standalone = raw.match(/^([A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+)?)\b/);
  if (standalone?.[1] && standalone[1].length > 2) return standalone[1].trim();
  return null;
}

export function extractTopic(raw: string): string | null {
  const match = raw.match(
    /\b(?:regarding|about|due to|because of|concerning|on)\s+(.{4,90})$/i,
  );
  if (match?.[1]) return match[1].replace(/[.?!]+$/, "").trim();
  return null;
}

/** Was the previous assistant turn a "still collecting" form message? */
export function findPendingFormTurn(
  history: ChatMessage[],
): { templateId: string; values: Record<string, string> } | null {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index]!;
    if (message.role !== "assistant") continue;
    if (message.pendingFormTemplateId) {
      return {
        templateId: message.pendingFormTemplateId,
        values: message.pendingFormValues ?? {},
      };
    }
    return null;
  }
  return null;
}

export function buildFormCollection(question: string, context: AskContext): AskResponse {
  const template = detectTemplate(question);
  const employeeName = extractEmployeeName(question);
  const topic = extractTopic(question);

  const known: string[] = [];
  const missing: string[] = [];

  if (employeeName) known.push(`**Employee** — ${employeeName}`);
  else missing.push("the team member's name");

  if (topic) known.push(`**Topic** — ${topic}`);
  else missing.push("what the conversation is about");

  known.push(`**Location** — ${context.locationName}`);
  known.push(`**Manager** — ${context.userName}`);
  known.push(`**Form date** — today`);

  missing.push("the specific dates and what was observed");
  missing.push("the expected behaviour going forward");
  missing.push("the follow-up date");

  const content = `I can draft a **${template.name}** for you.

Here is what I already have:

${known.map((entry) => `- ${entry}`).join("\n")}

To finish the draft I still need ${missing.length} things:

${missing.map((entry, index) => `${index + 1}. ${entry.charAt(0).toUpperCase()}${entry.slice(1)}`).join("\n")}

Tell me in your own words and I will write the draft — you can edit every field before you save it.`;

  return {
    content,
    citations: [],
    // Collecting form fields is not a knowledge question, so "the knowledge
    // base does not cover this" would be a misleading thing to show.
    coverage: "not_applicable",
    recommendedVideoIds: ["vid-04"],
    pendingFormTemplateId: template.id,
    pendingFormValues: {
      employee_name: employeeName ?? "",
      topic: topic ?? "",
      location: context.locationName,
      manager: context.userName,
      form_date: context.todayIso,
    },
    followUpSuggestions: employeeName
      ? [
          `Late on the 12th, 15th and 19th — between 10 and 20 minutes each time. Expect ${employeeName} ready at scheduled start. Follow up in 14 days.`,
          "Use today's date and a 14-day follow-up",
        ]
      : [
          "Jane Kowalski — late on the 12th, 15th and 19th, between 10 and 20 minutes each time. Follow up in 14 days.",
          "Use today's date and a 14-day follow-up",
        ],
  };
}

export function buildFormDraft(input: {
  reply: string;
  pending: { templateId: string; values: Record<string, string> };
  context: AskContext;
  /** Citations from real retrieval in live mode, seeded citations in demo. */
  citations: SourceCitation[];
}): AskResponse {
  const { pending, context } = input;
  const reply = input.reply.trim();

  const employeeName =
    pending.values.employee_name || extractEmployeeName(reply) || "Jane Kowalski";
  const topicRaw = pending.values.topic || extractTopic(reply) || "repeated tardiness";
  const topic = topicRaw.charAt(0).toUpperCase() + topicRaw.slice(1);

  const detailsFromReply =
    reply.length > 40
      ? reply
      : "Arrived after the start of a scheduled shift on three occasions in the past two weeks, between ten and twenty minutes late each time. Each instance was noted on the day it occurred.";

  const followUpDate = isoDaysFromAnchor(14);

  const values: Record<string, string> = {
    employee_name: employeeName,
    employee_role: "Tanning Consultant",
    location: pending.values.location || context.locationName,
    form_date: pending.values.form_date || context.todayIso,
    manager: pending.values.manager || context.userName,
    topic,
    details: detailsFromReply,
    expected_action: `Meet the expected standard for ${topicRaw.toLowerCase()} on every scheduled shift, beginning immediately. We will review progress together on the follow-up date.`,
    support_offered: "",
    follow_up_date: followUpDate,
  };

  const checkedOptions: Record<string, string[]> = {
    coaching_type: ["Documented coaching"],
    coaching_topic: [coachingTopicOption(topicRaw)],
  };

  const templateName = templateNameFor(pending.templateId);

  const handoff: FormHandoff = {
    templateId: pending.templateId,
    templateName,
    values,
    checkedOptions,
  };

  const content = `Here is the draft **${templateName}** for **${employeeName}**.

- **Topic** — ${topic}
- **Location** — ${values.location}
- **Manager** — ${values.manager}
- **Follow-up** — ${formatDate(followUpDate)}

**Details of the conversation**

${values.details}

**Expected action going forward**

${values.expected_action}

Open it in Create a Form to edit any field directly before you save — every line above is editable, including the ones I drafted.

Before the conversation, read the exact policy language from the official manual. Signature lines stay blank until they are signed in person.`;

  return {
    content,
    citations: input.citations,
    coverage: "not_applicable",
    recommendedVideoIds: ["vid-04", "vid-05"],
    formHandoff: handoff,
    followUpSuggestions: [
      "Make the expected action more specific",
      "What should I document afterwards?",
    ],
  };
}

/* -------------------------------------------------- template field guard -- */

/**
 * THE GUARD THAT SURVIVES EVERY PROVIDER.
 *
 * Only fields the template marks `ai_populate` may be written, and a signature
 * field is excluded structurally regardless of what it is marked. This runs on
 * the output of MockAIProvider and on the output of Claude alike: whatever the
 * model returns, a signature line stays blank.
 */
export function applyFillRules(
  fields: TemplateField[],
  drafted: Record<string, string>,
): Record<string, string> {
  const values: Record<string, string> = {};
  fields.forEach((field) => {
    if (field.fillRule !== "ai_populate") return;
    if (field.type === "signature") return;
    const value = drafted[field.id];
    if (typeof value === "string" && value.length > 0) values[field.id] = value;
  });
  return values;
}

/** Field ids a model is allowed to fill for a given template. */
export function writableFieldIds(fields: TemplateField[]): string[] {
  return fields
    .filter((field) => field.fillRule === "ai_populate" && field.type !== "signature")
    .map((field) => field.id);
}

/** Deterministic checkbox defaults, applied after any model output. */
export function fillCheckboxDefaults(
  request: FormDraftRequest,
  selections: Record<string, string[]>,
  topic: string,
): Record<string, string[]> {
  const checkedOptions: Record<string, string[]> = { ...selections };
  request.fields
    .filter((field) => field.type === "checkbox_group" && field.fillRule === "ai_populate")
    .forEach((field) => {
      if (checkedOptions[field.id]?.length) return;
      if (field.id === "coaching_topic" && field.options) {
        const suggestion = coachingTopicOption(topic);
        if (field.options.includes(suggestion)) checkedOptions[field.id] = [suggestion];
      }
      if (field.id === "coaching_type" && field.options) {
        checkedOptions[field.id] = [field.options[1] ?? field.options[0]!];
      }
    });
  return checkedOptions;
}

export type { FormDraftRequest, FormDraftResponse };
