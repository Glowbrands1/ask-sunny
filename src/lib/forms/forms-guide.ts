import type { FormBlock, FormDocument, FormVariant } from "./document";
import { FORM_CATEGORIES } from "./catalog";

/**
 * "WHAT IS A CA?", "DIFFERENCE BETWEEN COACHING AND CA", "WHICH FORMS CAN I
 * CREATE HERE?" — answered from the app's own form templates.
 *
 * The owner's words: "guide managers on the differences of each form, like
 * what is a CA, what is coaching and so on. Read the forms and that should be
 * the answer." So nothing here describes a form from memory. Every sentence
 * about a form is the template's own description, its own section headings
 * and option lists, and the role matrix's own answer to who may create it.
 * A template with no description is described by its sections and fields
 * only; nothing is guessed in its place.
 *
 * TWO HALVES. `readFormsGuideQuestion` decides, from the sentence alone,
 * whether this is a question ABOUT forms — whole-sentence shapes only, so
 * "ca for Dana Quill" or "what is the ca for california sales tax" are not.
 * `buildFormsGuideAnswer` resolves the words against the templates and
 * returns null when they name none of them, so the turn goes down the usual
 * path rather than being told a form does not exist.
 *
 * Behind FORMS_GUIDE_ENABLED. See `forms-guide-answer.ts` for the server side.
 */

export interface GuideTemplate {
  key: string;
  name: string;
  shortName: string;
  description: string;
  category: string;
  layoutFamily: string;
  requiredPermission: string;
  /** The published version's document. Null when it could not be read. */
  document: FormDocument | null;
  variants: FormVariant[];
}

export type FormsGuideReading =
  | { kind: "explain"; phrases: string[] }
  | { kind: "compare"; phrases: string[] }
  | { kind: "situation"; group: SituationGroup }
  | { kind: "list" }
  /** "can you make a generic policy review form that works for any employee" */
  | { kind: "generic"; phrase: string };

type SituationGroup = "separation" | "transfer" | "demotion" | "hiring";

/* ------------------------------------------------------------- reading --- */

/** Lowercase, "c/a" and "c.a." as "ca", apostrophes dropped, punctuation as spaces. */
export function normalizeGuideText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’ʼ`']/g, "")
    .replace(/\bc\s*[/.]\s*a\b\.?/g, "ca")
    .replace(/\bvs\.(?=\s)/g, "vs")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The words a manager uses for a form family, mapped to what identifies it in
 * the library: a template key, a category, or a layout family. Mechanism, not
 * company content — the forms each one resolves to, and everything said about
 * them, come from the templates. Template names and short names are read from
 * the templates on top of these.
 */
type FamilyRef = { key: string } | { category: string } | { layoutFamilies: string[] };

const FAMILY_ALIASES: readonly { words: readonly string[]; ref: FamilyRef }[] = [
  { words: ["coaching", "coaching form", "coaching forms", "coach", "cf"], ref: { key: "coaching" } },
  {
    words: ["follow up coaching", "followup coaching", "follow up coaching form", "follow up"],
    ref: { key: "follow-up-coaching" },
  },
  {
    words: [
      "ca",
      "cas",
      "ca form",
      "corrective action",
      "corrective actions",
      "corrective",
      "corrective action form",
      "dpoa",
      "write up",
      "writeup",
    ],
    ref: { key: "dpoa" },
  },
  { words: ["policy review", "policy review form", "policy reviews"], ref: { key: "policy-review" } },
  {
    words: ["epp", "epps", "epp form", "performance plan", "employee performance plan", "performance plans"],
    ref: { layoutFamilies: ["epp", "dmit_epp"] },
  },
  {
    words: ["exit", "exit form", "exit paperwork", "resignation", "resignation form", "separation form"],
    ref: { category: "separation" },
  },
  { words: ["demotion", "demotion form"], ref: { key: "demotion" } },
  { words: ["transfer", "transfer form", "position transfer", "position transfer form"], ref: { key: "position-transfer" } },
  {
    words: ["interview form", "interview forms", "hiring form", "hiring forms", "prescreen", "phone interview"],
    ref: { category: "hiring" },
  },
];

const STATIC_ALIASES = new Set(FAMILY_ALIASES.flatMap((family) => family.words));

/** Long family words that tolerate a typo ("coacing", "corective action"). */
const FUZZY_WORDS = ["coaching", "corrective action", "corrective", "policy review", "resignation", "demotion"];

/** Edit distance counting a swap of two neighbouring letters as one edit ("caoching"). */
function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}

/** The family word a typo was meant to be, or the phrase unchanged. */
function correctTypo(phrase: string): string {
  if (STATIC_ALIASES.has(phrase)) return phrase;
  const bare = phrase.replace(/ forms?$/, "");
  for (const word of FUZZY_WORDS) {
    const allowed = word.length >= 12 ? 2 : 1;
    if (editDistance(bare, word) <= allowed) return word;
  }
  return phrase;
}

const ARTICLE = /^(?:a|an|the|our|my|this|that)\s+/;
const TAIL = /\s+(?:form|forms|for|used for|about|mean|means|exactly|again|here|please|then)$/;

/** "a coaching form" -> "coaching form"; "a ca used for" -> "ca". */
function trimPhrase(raw: string): string {
  let phrase = raw.trim().replace(ARTICLE, "");
  for (let guard = 0; guard < 3; guard += 1) {
    const next = phrase.replace(TAIL, "");
    if (next === phrase) break;
    phrase = next;
  }
  return correctTypo(phrase);
}

/**
 * Could these words name a form? A family word, or anything said with the
 * word "form" ("what is a demotion form", "what is the tsd epp form"). The
 * templates decide later whether it really names one.
 */
function plausibleFormPhrase(raw: string, phrase: string): boolean {
  if (!phrase || phrase.split(" ").length > 5) return false;
  if (STATIC_ALIASES.has(phrase)) return true;
  return /\bforms?\b/.test(raw) || /\bepps?\b/.test(phrase);
}

const EXPLAIN_PREFIX =
  /^(?:so\s+|ok\s+|okay\s+|hey\s+|hi\s+)?(?:what\s+(?:is|are|s|does|do)|whats|wat\s+is|wht\s+is|what\s+exactly\s+is|explain|define|describe|tell\s+me\s+about|what\s+do\s+you\s+mean\s+by|what\s+is\s+meant\s+by|can\s+you\s+explain|could\s+you\s+explain|help\s+me\s+understand|what\s+is\s+the\s+purpose\s+of|whats\s+the\s+purpose\s+of|when\s+do\s+i\s+use|when\s+should\s+i\s+use|when\s+do\s+we\s+use)\s+(.+)$/;

/** With a "difference between" / "when do I use" / "what is" lead, "and" and "or" separate two forms too. */
const COMPARE_SPLIT = /\s+(?:vs|versus|or|and|compared\s+to|instead\s+of)\s+/;
/** With no lead at all ("ca vs coaching"), only an explicit "vs" does. */
const BARE_COMPARE_SPLIT = /\s+(?:vs|versus|compared\s+to)\s+/;

const COMPARE_PREFIX =
  /^(?:(?:so\s+)?(?:whats|what\s+is|what\s+s|wat\s+is|explain|tell\s+me)\s+the\s+)?(?:difference|differences|diff)\s+(?:between|of|btwn|b\/w)\s+(.+)$/;

const WHEN_PREFIX =
  /^(?:when|how)\s+(?:do|should|would|can)\s+(?:i|we)\s+(?:use|do|give|write|pick|choose|fill\s+out)\s+(.+)$/;

const SITUATION =
  /^(?:what|which)\s+(?:form|forms|paperwork)\s+(?:do|should|would|can|must)?\s*(?:i|we)?\s*(?:use|need|do|fill\s+out|file|create|start)?\s*(?:for|when|if)\s+(.+)$/;

const SITUATION_GROUPS: readonly { group: SituationGroup; pattern: RegExp }[] = [
  {
    group: "separation",
    pattern:
      /\b(?:quit|quits|quitting|quitted|resign|resigns|resigned|resigning|resignation|leaving|left\s+the\s+company|walked\s+out|two\s+weeks|2\s+weeks|notice|last\s+day)\b/,
  },
  { group: "transfer", pattern: /\b(?:transfer|transfers|transferring|transferred)\b/ },
  { group: "demotion", pattern: /\b(?:demote|demoted|demoting|demotion|step\s+down|stepping\s+down)\b/ },
  { group: "hiring", pattern: /\b(?:interview|interviewing|candidate|applicant|prescreen|hiring|new\s+hire)\b/ },
];

const LIST_PATTERNS: readonly RegExp[] = [
  /^(?:which|what)\s+(?:forms|form\s+types|types\s+of\s+forms|kinds\s+of\s+forms|form)\s+(?:can|could|do|may|am)\s+(?:i|we)\s+(?:able\s+to\s+)?(?:create|make|fill\s+out|fill|use|do|start|submit|have|access|file)(?:\s+(?:here|in\s+here|in\s+ask\s+\w+|in\s+the\s+app|on\s+here|now))?$/,
  /^(?:which|what)\s+forms\s+(?:are|r)\s+(?:there|available|in\s+here|in\s+the\s+app)(?:\s+(?:here|to\s+me|for\s+me))?$/,
  /^(?:what|which)\s+forms\s+do\s+(?:you|we)\s+have$/,
  /^(?:list|show\s+me|show)\s+(?:all\s+)?(?:of\s+)?(?:the\s+|my\s+)?forms(?:\s+(?:i\s+can\s+create|available|here))?$/,
  /^(?:what|which)\s+forms\s+(?:can|do)\s+(?:i|we)\s+(?:create|make|use)\s+(?:here|in\s+here)$/,
];

/*
 * A REQUEST FOR A FORM THAT IS NOT ABOUT ANYONE — "can you make a generic
 * policy review form that works for any employee" (Sunny tester replay S27,
 * 26 Oct 2026). Read only with a make/create lead AND a generic cue, and only
 * when what is left names a form; "create a policy review for Avery Holt"
 * leaves a person's name behind and is never read here.
 */
const GENERIC_LEAD =
  /^(?:(?:can|could|would|will)\s+(?:you|u|i|we)\s+)?(?:please\s+)?(?:make|create|build|draft|design|set\s+up|give\s+me|get\s+me|send\s+me|do|have)\s+(?:me\s+|us\s+)?(.+)$/;
const GENERIC_CUE =
  /\b(?:generic|reusable|universal|general\s+purpose|fill\s+in\s+the\s+blank|template|any\s+employee|every\s+employee|all\s+employees|any\s+team\s+member|anyone|everyone|anybody|any\s+one)\b/;
const GENERIC_WORDS = /\b(?:generic|reusable|universal|general\s+purpose|template)\b/g;
const GENERIC_TAIL =
  /\s+(?:that|which|i\s+can|we\s+can)?\s*(?:works?|can\s+be\s+used|use|i\s+can\s+use|we\s+can\s+use|to\s+use)?\s*(?:for|with|on)\s+(?:any|every|all|anyone|everyone|anybody)(?:\s+(?:employee|employees|team\s+members?|one|body|person|people))?$/;

function readGeneric(text: string): { kind: "generic"; phrase: string } | null {
  if (!GENERIC_CUE.test(text)) return null;
  const lead = GENERIC_LEAD.exec(text);
  if (!lead) return null;
  let rest = lead[1].replace(GENERIC_TAIL, "").replace(/\s+(?:that|which)\s+(?:works|anyone\s+can\s+use)$/, "");
  rest = rest.replace(GENERIC_WORDS, " ").replace(/\s+/g, " ").trim();
  const phrase = trimPhrase(rest);
  if (!phrase) return null;
  // Anything still said about someone ("for Avery Holt", "about her") is a real request.
  if (/\b(?:for|about|regarding|re|to|with|on)\b/.test(phrase)) return null;
  if (phrase === "form" || phrase === "forms") return { kind: "generic", phrase };
  return plausibleFormPhrase(rest, phrase) ? { kind: "generic", phrase } : null;
}

/**
 * A question about the forms themselves, or null.
 *
 * Whole-sentence shapes on purpose. "ca for <name>" and "create a coaching
 * form for <name>" do not start as a question and are never read here; "what
 * is the ca for california sales tax" has words after the form that are not
 * one of the few tails allowed ("form", "for", "used for", "mean"), so it is
 * not read either.
 */
export function readFormsGuideQuestion(question: string): FormsGuideReading | null {
  const text = normalizeGuideText(question);
  if (!text || text.length > 160) return null;

  if (LIST_PATTERNS.some((pattern) => pattern.test(text))) return { kind: "list" };

  const generic = readGeneric(text);
  if (generic) return generic;

  const situation = SITUATION.exec(text);
  if (situation) {
    const found = SITUATION_GROUPS.find((entry) => entry.pattern.test(situation[1]));
    return found ? { kind: "situation", group: found.group } : null;
  }

  const compare = COMPARE_PREFIX.exec(text);
  const when = compare ? null : WHEN_PREFIX.exec(text);
  const explain = compare || when ? null : EXPLAIN_PREFIX.exec(text);
  const lead = compare?.[1] ?? when?.[1] ?? explain?.[1] ?? null;
  const parts = (lead ?? text).split(lead === null ? BARE_COMPARE_SPLIT : COMPARE_SPLIT);
  if (parts.length >= 2 && parts.length <= 3) {
    const phrases = parts.map(trimPhrase);
    if (phrases.every((phrase, index) => plausibleFormPhrase(parts[index], phrase))) {
      return { kind: "compare", phrases };
    }
  }
  if (compare) return null;

  // "what is a ca?", "when do i use a coaching form" — one form, nothing after it.
  const single = when ?? explain;
  if (single) {
    const phrase = trimPhrase(single[1]);
    if (plausibleFormPhrase(single[1], phrase)) return { kind: "explain", phrases: [phrase] };
  }
  // A bare "ca" or "coaching" is not a question about the form.
  return null;
}

/* ----------------------------------------------------------- resolving --- */

function nameWords(name: string): string {
  return normalizeGuideText(name).replace(/\s+forms?$/, "").trim();
}

function matchesRef(template: GuideTemplate, ref: FamilyRef): boolean {
  if ("key" in ref) return template.key === ref.key;
  if ("category" in ref) return template.category === ref.category;
  return ref.layoutFamilies.includes(template.layoutFamily);
}

/** The templates a phrase names, in library order. Empty when it names none. */
export function resolveGuidePhrase(phrase: string, templates: readonly GuideTemplate[]): GuideTemplate[] {
  const bare = phrase.replace(/\s+forms?$/, "");
  const byName = templates.filter(
    (template) =>
      nameWords(template.name) === bare ||
      nameWords(template.shortName) === bare ||
      normalizeGuideText(template.name) === phrase,
  );
  if (byName.length > 0) return byName;
  const family = FAMILY_ALIASES.find((entry) => entry.words.includes(phrase) || entry.words.includes(bare));
  if (!family) return [];
  return templates.filter((template) => matchesRef(template, family.ref));
}

const SITUATION_REFS: Record<SituationGroup, FamilyRef> = {
  separation: { category: "separation" },
  transfer: { key: "position-transfer" },
  demotion: { key: "demotion" },
  hiring: { category: "hiring" },
};

/* ------------------------------------------------------------- answering --- */

export interface GuideAccess<Role extends string> {
  /** The asker's role. Null for an account without one — they can create nothing. */
  role: Role | null;
  /** Every role, in the order the app lists them. */
  roles: readonly Role[];
  /** The role's label, as the app shows it. */
  roleLabel: (role: Role) => string;
  /** The app's own role matrix: may this role hold this permission? */
  may: (role: Role, permission: string) => boolean;
  /** Roles left out of "who can create it" — build and support accounts. */
  hiddenRoles?: readonly Role[];
}

export interface GuideAnswerInput<Role extends string> {
  reading: FormsGuideReading;
  /** Active templates with a published current version, in library order. */
  templates: readonly GuideTemplate[];
  access: GuideAccess<Role>;
  /** The product name, from the brand config. */
  productName: string;
}

function variantText(text: string, variants: readonly FormVariant[]): string | null {
  if (!text.includes("{{")) return text;
  const variant = variants[0];
  if (!variant) return null;
  return text.replace(/\{\{role\}\}/g, variant.role ?? "").replace(/\{\{roleAbbr\}\}/g, variant.roleAbbr ?? "");
}

function blocksForDefaultVariant(template: GuideTemplate): FormBlock[] {
  const blocks = template.document?.blocks ?? [];
  const first = template.variants[0]?.key;
  return blocks.filter((block) => !block.variantKey || block.variantKey === first);
}

/**
 * What the form records, read off the document: its section headings, with
 * the choices of a short option list printed right under one ("Type of
 * Warning: Verbal Warning, Written Warning, ..."). A document with no
 * sections is described by its field labels instead.
 */
export function describeRecords(template: GuideTemplate): string | null {
  const blocks = blocksForDefaultVariant(template);
  const sections: string[] = [];
  let pendingSection: string | null = null;
  for (const block of blocks) {
    if (block.kind === "section") {
      const label = variantText(block.label, template.variants);
      pendingSection = label?.trim() || null;
      if (pendingSection && !sections.some((entry) => entry.startsWith(pendingSection as string))) {
        sections.push(pendingSection);
      } else {
        pendingSection = null;
      }
      continue;
    }
    if (block.kind === "checkbox_group" && pendingSection && block.options.length > 1 && block.options.length <= 6) {
      const index = sections.indexOf(pendingSection);
      if (index >= 0) {
        sections[index] = `${pendingSection} (${block.options.map((option) => option.label).join(", ")})`;
      }
      pendingSection = null;
    } else if (block.kind !== "letterhead") {
      pendingSection = null;
    }
  }
  if (sections.length > 0) return sections.slice(0, 7).join("; ");

  const labels: string[] = [];
  for (const block of blocks) {
    if (block.kind === "field") labels.push(block.field.label);
    if (block.kind === "field_row") labels.push(...block.fields.map((field) => field.label));
    if (block.kind === "checkbox_group" && block.label) labels.push(block.label);
  }
  const named = [...new Set(labels.map((label) => label.trim()).filter(Boolean))];
  return named.length > 0 ? named.slice(0, 8).join(", ") : null;
}

function creators<Role extends string>(template: GuideTemplate, access: GuideAccess<Role>): Role[] {
  const hidden = new Set(access.hiddenRoles ?? []);
  return access.roles.filter((role) => !hidden.has(role) && access.may(role, template.requiredPermission));
}

function canCreate<Role extends string>(template: GuideTemplate, access: GuideAccess<Role>): boolean {
  return access.role !== null && access.may(access.role, template.requiredPermission);
}

function article(name: string): string {
  const first = name.split(/\s+/)[0] ?? "";
  if (/^[A-Z]{2,}$/.test(first)) return /^[AEFHILMNORSX]/.test(first) ? "an" : "a";
  return /^[aeiou]/i.test(name) ? "an" : "a";
}

/** "Corrective Action Form" -> "corrective action form"; "SDIT EPP" stays as written. */
function spoken(name: string): string {
  return name
    .split(/\s+/)
    .map((word) => (/^[A-Z][a-z]/.test(word) ? word.toLowerCase() : word))
    .join(" ");
}

function startLine(template: GuideTemplate): string {
  const name = spoken(template.name);
  return `say "create ${article(name)} ${name} for <name>" to start it.`;
}

function firstSentence(text: string): string {
  const trimmed = text.trim();
  const match = /^(.+?[.!?])(?:\s|$)/.exec(trimmed);
  return match ? match[1] : trimmed;
}

function explainOne<Role extends string>(
  template: GuideTemplate,
  access: GuideAccess<Role>,
  options: { full: boolean },
): string {
  const description = template.description.trim();
  const head = description
    ? `**${template.name}** — ${options.full ? description : firstSentence(description)}`
    : `**${template.name}**`;
  const lines: string[] = [];
  const records = options.full || !description ? describeRecords(template) : null;
  if (records) lines.push(`${description ? "What it records" : "What its fields show"}: ${records}.`);
  if (!description && !records) lines.push("The template has no description or sections to read from.");
  const who = creators(template, access);
  lines.push(
    who.length > 0
      ? `Who can create it: ${who.map(access.roleLabel).join(", ")}.`
      : "No role can create it at the moment.",
  );
  if (access.role !== null) {
    lines.push(
      canCreate(template, access)
        ? `You can create it — ${startLine(template)}`
        : who.length > 0
          ? `Your role (${access.roleLabel(access.role)}) can't create this one; your ${access.roleLabel(who[0])} can.`
          : `Your role (${access.roleLabel(access.role)}) can't create this one.`,
    );
  } else {
    lines.push("Your account can't create it.");
  }
  return [head, ...lines.map((line) => `- ${line}`)].join("\n");
}

function explainGroup<Role extends string>(
  phrase: string,
  group: readonly GuideTemplate[],
  access: GuideAccess<Role>,
  options: { full: boolean },
): string {
  if (group.length === 1) return explainOne(group[0], access, options);
  const shown = phrase.length <= 4 ? phrase.toUpperCase() : phrase;
  const head = `There are ${group.length} ${shown.replace(/ forms?$/i, "")} forms:`;
  return [head, ...group.map((template) => explainOne(template, access, { full: false }))].join("\n\n");
}

function listCreatable<Role extends string>(input: GuideAnswerInput<Role>): string {
  const { access, templates, productName } = input;
  const mine = templates.filter((template) => canCreate(template, access));
  const label = access.role !== null ? access.roleLabel(access.role) : null;
  if (mine.length === 0) {
    return [
      label
        ? `Your role (${label}) can't create forms in ${productName}.`
        : `Your account can't create forms in ${productName}.`,
      `I can still explain any form — ask "what is a corrective action?" or "difference between coaching and ca".`,
    ].join("\n\n");
  }
  const sections: string[] = [];
  const known = new Set<string>(FORM_CATEGORIES.map((category) => category.key));
  for (const category of FORM_CATEGORIES) {
    const inCategory = mine.filter(
      (template) => template.category === category.key || (!known.has(template.category) && category === FORM_CATEGORIES[FORM_CATEGORIES.length - 1]),
    );
    if (inCategory.length === 0) continue;
    sections.push(
      [
        `**${category.label}**`,
        ...inCategory.map((template) =>
          template.description.trim() ? `- ${template.name} — ${firstSentence(template.description)}` : `- ${template.name}`,
        ),
      ].join("\n"),
    );
  }
  return [
    `${label ? `As ${article(label)} ${label}` : "With your account"} you can create ${mine.length === 1 ? "this form" : `these ${mine.length} forms`} in ${productName}:`,
    ...sections,
    `Ask "what is a <form>?" for what any of them records, or say "create a coaching form for <name>" to start one.`,
  ].join("\n\n");
}

/**
 * Forms are filled in for one person, so a "generic" one is explained rather
 * than drafted: the form's own description and sections, how to start it for
 * someone, and — only for a role that manages templates — where the blank
 * template prints from.
 */
function genericAnswer<Role extends string>(phrase: string, input: GuideAnswerInput<Role>): string | null {
  const { access, templates, productName } = input;
  const lead = `Forms in ${productName} are filled in for one employee at a time, so there isn't a generic copy to fill once and reuse.`;
  const blank =
    access.role !== null && access.may(access.role, "manage_form_templates")
      ? `To see the blank template as it prints, open Form Templates and press Preview PDF.`
      : null;
  if (phrase === "form" || phrase === "forms") {
    return [lead, `Ask "which forms can I create here?" to see the forms you can start, then say "create a <form> for <name>".`, blank]
      .filter(Boolean)
      .join("\n\n");
  }
  const group = resolveGuidePhrase(phrase, templates);
  if (group.length === 0) return null;
  return [lead, explainGroup(phrase, group, access, { full: group.length === 1 }), blank].filter(Boolean).join("\n\n");
}

/**
 * The answer, or null when the words name no published template — the turn
 * then goes down the usual path, so a guess about a form never replaces it.
 */
export function buildFormsGuideAnswer<Role extends string>(input: GuideAnswerInput<Role>): string | null {
  const { reading, templates, access } = input;
  if (reading.kind === "list") return listCreatable(input);
  if (reading.kind === "generic") return genericAnswer(reading.phrase, input);

  if (reading.kind === "situation") {
    const ref = SITUATION_REFS[reading.group];
    const group = templates.filter((template) => matchesRef(template, ref));
    if (group.length === 0) return null;
    const lead =
      group.length === 1 ? `The form for this is the ${group[0].name}.` : `These are the forms for this:`;
    return [lead, explainGroup(reading.group, group, access, { full: group.length === 1 })].join("\n\n");
  }

  const groups = reading.phrases.map((phrase) => ({ phrase, group: resolveGuidePhrase(phrase, templates) }));
  if (groups.some((entry) => entry.group.length === 0)) return null;
  const distinct = new Set(groups.flatMap((entry) => entry.group.map((template) => template.key)));

  if (reading.kind === "compare" && groups.length >= 2 && distinct.size >= 2) {
    const blocks = groups.map((entry) => explainGroup(entry.phrase, entry.group, access, { full: entry.group.length === 1 }));
    return [`Here are the ${groups.length} forms side by side, from the templates themselves:`, ...blocks].join("\n\n");
  }
  const only = groups[0];
  return explainGroup(only.phrase, only.group, access, { full: true });
}
