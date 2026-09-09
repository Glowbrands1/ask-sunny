import { DEMO_FORM_TEMPLATES } from "@/data/demo/templates";
import { formatDate, isoDaysFromAnchor } from "@/lib/utils/date";
import type {
  ChatMessage,
  FormHandoff,
  FormSelection,
  FormTemplate,
  SourceCitation,
  TemplateField,
} from "@/types";
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

/**
 * Phrasings that mean "I want a form", whether or not one is named.
 *
 * Deliberately excludes bare role acronyms like "epp": "what is an EPP?" is a
 * knowledge question, and answering it with a form picker would be wrong.
 */
const FORM_INTENT = [
  "create a coaching form",
  "coaching form",
  "corrective action",
  "create a form",
  "draft a form",
  "make a form",
  "make me a form",
  "start a form",
  "begin a form",
  "build a form",
  "generate a form",
  "new form",
  "form from this",
  "form for this",
  "interview form",
  "prescreen form",
  "phone interview form",
  "write up",
  "write-up",
  "disciplinary",
  "dpoa",
  "policy review form",
  "performance form",
  "performance plan form",
];

/**
 * Verbs that turn a named form into a request to create it. "Create an SDIT
 * EPP" carries no generic form phrasing at all, so the verb is what separates
 * it from "what is an SDIT EPP?".
 *
 * A verb alone is not enough — see DOCUMENT_WORDS.
 */
const CREATE_VERBS = [
  "create",
  "draft",
  "make",
  "start",
  "begin",
  "generate",
  "build",
  "prepare",
  "fill out",
  "fill in",
  "open a",
  "new ",
  "i need",
  "give me",
];

/**
 * Words that mean a DOCUMENT rather than a subject.
 *
 * The guard on the verb path. "Help me prepare for a coaching conversation"
 * carries a verb and names the coaching topic, and it is a request for advice,
 * not for a form — it stays a knowledge question because it asks for no
 * document. "Create an SDIT EPP" asks for one.
 */
const DOCUMENT_WORDS = [
  "form",
  "epp",
  "dpoa",
  "plan of action",
  "policy review",
  "performance plan",
  "interview",
  "prescreen",
  "pre-screen",
  "write up",
  "write-up",
];

/** The form offered on its own before the rest of the library is expanded. */
const PRIMARY_TEMPLATE_ID = "tpl-coaching";

/**
 * NAMING A FORM.
 *
 * Every template is matched on its own name and short name from the registry,
 * so a new template is nameable the moment it is registered. This table only
 * adds the shorthand managers actually type, and it holds no names or
 * descriptions of its own — the registry is the single list of forms.
 *
 * "write up" is deliberately NOT a DPOA alias. It is used loosely for anything
 * from a coaching note to a final warning, and a written record of a
 * disciplinary step is not something to infer from a colloquialism: an
 * ambiguous request gets the picker, not a guess.
 */
const TEMPLATE_ALIASES: Record<string, string[]> = {
  "tpl-coaching": ["coaching form", "coaching"],
  "tpl-dpoa": [
    "disciplinary plan of action",
    "dpoa",
    "disciplinary",
    "corrective action",
    "written warning",
  ],
  "tpl-policy-review": ["policy review"],
  "tpl-sdit-epp": ["sdit epp", "sdit", "salon director in training"],
  "tpl-tsd-epp": ["tsd epp"],
  "tpl-asd-sdit": ["asd-sdit performance epp", "asd sdit performance epp", "asd-sdit", "asd sdit"],
  "tpl-fttc": ["fttc performance epp", "fttc"],
  "tpl-dmit-tsd": ["dmit epp - tsd review", "dmit tsd review", "dmit tsd", "tsd review"],
  "tpl-dmit-dmit": ["dmit epp - dmit review", "dmit dmit review", "dmit dmit", "dmit review"],
  "tpl-prescreen": [
    "prescreen / phone interview form",
    "prescreen",
    "pre-screen",
    "phone interview",
  ],
  "tpl-tc-interview": [
    "tanning consultant interview form",
    "tanning consultant interview",
  ],
  "tpl-management-interview-1": [
    "first round management interview",
    "first round interview",
    "first management interview",
  ],
  "tpl-management-interview-2": [
    "second round management interview",
    "second round interview",
    "second management interview",
  ],
};

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

/**
 * Normalisation for matching a form NAME.
 *
 * Unifies the dashes and slashes that appear in the registry's own names — "DMIT
 * EPP — TSD Review", "Prescreen / Phone Interview Form" — so a manager who
 * types a hyphen, an em dash or no spaces at all still names the same form.
 * Applied to both sides of every comparison.
 */
function canonicalize(value: string) {
  return value
    .toLowerCase()
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/\s*([/-])\s*/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** Active templates, in registry order. The one list of forms. */
function registryTemplates(): FormTemplate[] {
  return DEMO_FORM_TEMPLATES.filter((template) => template.active);
}

/**
 * Everything that names one template: its registry name, that name without a
 * parenthetical suffix ("Disciplinary Plan of Action (DPOA)" is rarely typed in
 * full), its short name, and the shorthand from TEMPLATE_ALIASES.
 */
function aliasesFor(template: FormTemplate): string[] {
  const fromName = [
    template.name,
    template.name.replace(/\s*\([^)]*\)\s*/g, " "),
    template.shortName,
  ];
  return [...fromName, ...(TEMPLATE_ALIASES[template.id] ?? [])]
    .map(canonicalize)
    .filter((alias) => alias.length >= 4);
}

export function isFormIntent(question: string): boolean {
  const q = normalize(question);
  return FORM_INTENT.some((intent) => q.includes(intent));
}

/**
 * "Make me this document", as opposed to "tell me about this subject".
 *
 * Needs both halves: something that asks for a thing to be made, and a word
 * that means the thing is a document.
 */
function asksForADocument(question: string): boolean {
  const q = normalize(question);
  return (
    CREATE_VERBS.some((verb) => q.includes(verb)) &&
    DOCUMENT_WORDS.some((word) => q.includes(word))
  );
}

/**
 * The template the question actually names, or null when it names none.
 *
 * The LONGEST matching alias wins, not the first one found: "DMIT EPP — TSD
 * Review" contains "tsd review" and "TSD EPP" contains "tsd epp", and only
 * comparing match length keeps those two apart regardless of registry order.
 * Returning null is a real answer — it means "the manager did not say", and the
 * caller shows the picker rather than guessing.
 */
export function namedTemplate(question: string): { id: string; name: string } | null {
  const q = canonicalize(question);
  let best: { id: string; name: string; length: number } | null = null;

  for (const template of registryTemplates()) {
    const longest = aliasesFor(template).reduce(
      (length, alias) => (q.includes(alias) && alias.length > length ? alias.length : length),
      0,
    );
    if (longest > 0 && (best === null || longest > best.length)) {
      best = { id: template.id, name: template.name, length: longest };
    }
  }

  return best === null ? null : { id: best.id, name: best.name };
}

/**
 * How a question routes into the form flow.
 *
 * `selection` is the case this exists for: the manager wants a form and has not
 * said which, so the answer is the picker. Nothing is chosen on their behalf.
 */
export type FormRoute =
  | { kind: "none" }
  | { kind: "selection" }
  | { kind: "template"; template: { id: string; name: string } };

export function routeFormIntent(question: string): FormRoute {
  const named = namedTemplate(question);
  const generic = isFormIntent(question);

  // A named form goes straight into its own flow — no picker in the way.
  if (named && (generic || asksForADocument(question))) {
    return { kind: "template", template: named };
  }
  if (generic) return { kind: "selection" };
  return { kind: "none" };
}

/**
 * Back-compatible template detection: the named form, or the everyday one.
 *
 * Prefer `routeFormIntent` at a call site that can show the picker — this
 * falls back to the Coaching Form, which is the right default once a template
 * has to be produced but the wrong answer to "which form do you need?".
 */
export function detectTemplate(question: string): { id: string; name: string } {
  return namedTemplate(question) ?? { id: PRIMARY_TEMPLATE_ID, name: templateNameFor(PRIMARY_TEMPLATE_ID) };
}

export function templateNameFor(templateId: string): string {
  return (
    DEMO_FORM_TEMPLATES.find((entry) => entry.id === templateId)?.name ?? "Coaching Form"
  );
}

/* ------------------------------------------------------- form selection -- */

/**
 * What the picker offers: the Coaching Form, then everything else collapsed.
 *
 * Built from the registry every time, so registering a template is all it takes
 * for it to appear behind "See more forms" — there is no second list to update.
 */
export function buildFormSelectionModel(): FormSelection {
  return {
    primaryTemplateId: PRIMARY_TEMPLATE_ID,
    additionalTemplateIds: registryTemplates()
      .filter((template) => template.id !== PRIMARY_TEMPLATE_ID)
      .map((template) => template.id),
  };
}

/**
 * Resolves a selection against the templates the app currently holds.
 *
 * Ids come from the message and names from the live registry, so a renamed
 * template reads correctly in an old conversation. The primary form is filtered
 * out of the expanded list structurally: it is already on screen, and showing
 * it twice was never a rendering decision to get right.
 */
export function selectableTemplates(
  templates: FormTemplate[],
  selection: FormSelection,
): { primary: FormTemplate | null; additional: FormTemplate[] } {
  const byId = new Map(
    templates.filter((template) => template.active).map((template) => [template.id, template]),
  );

  return {
    primary: byId.get(selection.primaryTemplateId) ?? null,
    additional: selection.additionalTemplateIds
      .filter((id) => id !== selection.primaryTemplateId)
      .map((id) => byId.get(id))
      .filter((template): template is FormTemplate => Boolean(template)),
  };
}

/**
 * The message a form card sends when it is clicked.
 *
 * It goes through the composer like anything the manager could have typed, so
 * clicking "Policy Review" and typing "Create a Policy Review from this
 * conversation" enter the identical flow — one code path, not two.
 */
export function formRequestPhrase(templateName: string): string {
  return `Create a ${templateName} from this conversation`;
}

/**
 * The generic answer: which form, asked as a question, with the everyday form
 * offered first and the rest behind an expander.
 *
 * Sunny does not pick. The Coaching Form is shown first because it is where
 * most conversations end up, and that is said plainly rather than implied by
 * pre-selecting it.
 */
export function buildFormSelection(): AskResponse {
  const selection = buildFormSelectionModel();
  const primaryName = templateNameFor(selection.primaryTemplateId);

  const content = `**Which form do you need?**

The **${primaryName}** is below — it is the one most conversations end in. Everything else is behind **See more forms**, and nothing is created until you choose.`;

  return {
    content,
    citations: [],
    // Choosing a form is not a knowledge question, so "the knowledge base does
    // not cover this" would be a misleading thing to show.
    coverage: "not_applicable",
    recommendedVideoIds: [],
    formSelection: selection,
  };
}

export function coachingTopicOption(topic: string): string {
  const t = normalize(topic);
  const match = COACHING_TOPIC_MAP.find((entry) =>
    entry.keywords.some((keyword) => t.includes(keyword)),
  );
  return match?.option ?? "Policy adherence";
}

/**
 * Words that are not a person, however capitalised.
 *
 * The standalone heuristic below reads the opening words of a message, which is
 * right for "Jane Kowalski was late three times" and wrong for "Create a
 * Coaching Form from this conversation" — and that second phrasing is exactly
 * what a picker card sends, so without this guard every form chosen from the
 * picker would be drafted for an employee named "Create".
 */
const NOT_A_NAME = new Set([
  "a",
  "an",
  "the",
  "my",
  "our",
  "i",
  "create",
  "draft",
  "make",
  "start",
  "begin",
  "generate",
  "build",
  "prepare",
  "open",
  "new",
  "give",
  "help",
  "need",
  "write",
  "coaching",
  "disciplinary",
  "policy",
  "prescreen",
  "tanning",
  "first",
  "second",
  "sdit",
  "tsd",
  "dmit",
  "asd",
  "fttc",
]);

function looksLikeAName(candidate: string): boolean {
  const firstWord = candidate.split(/\s+/)[0]?.toLowerCase() ?? "";
  return firstWord.length > 2 && !NOT_A_NAME.has(firstWord);
}

export function extractEmployeeName(raw: string): string | null {
  const forMatch = raw.match(/\bfor\s+([A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+)?)/);
  if (forMatch?.[1]) {
    const candidate = forMatch[1].trim();
    if (looksLikeAName(candidate)) return candidate;
  }
  const standalone = raw.match(/^([A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+)?)\b/);
  if (standalone?.[1] && looksLikeAName(standalone[1].trim())) return standalone[1].trim();
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

export function buildFormCollection(
  question: string,
  context: AskContext,
  /** Passed when the caller already resolved the named template. */
  named?: { id: string; name: string },
): AskResponse {
  const template = named ?? detectTemplate(question);
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
