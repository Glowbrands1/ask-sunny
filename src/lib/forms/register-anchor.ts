/**
 * ============================================================================
 * "I NEED TO FIND THOSE DOCUMENTS" - WHICH DOCUMENTS?
 * ============================================================================
 *
 * Ask Sunny holds two registers, and the business calls both of them
 * "documents":
 *
 *   A KNOWLEDGE DOCUMENT is guidance. The Performance Management Framework, the
 *   policy manual, the employee handbook. It is indexed, retrieved and cited,
 *   and it lives in the Knowledge Base.
 *
 *   A FORM TEMPLATE is paperwork. The Coaching Form, the DPOA, the Policy
 *   Review. It is a stored version somebody opens and fills in, and it lives in
 *   Forms.
 *
 * A manager who has just been shown two frameworks and types "I need to find
 * those documents" is asking where the FRAMEWORKS are. The same sentence, typed
 * after a list of templates, is asking where the FORMS are. The sentence is
 * identical; only the antecedent differs.
 *
 * Before this module the sentence went to Forms every time, because it contains
 * the word "documents" and `LIBRARY_SUBJECT` counts that word as naming the
 * library. Half the time that is the wrong register, and it is wrong in the
 * expensive direction: a manager looking for the escalation framework is handed
 * a menu of blank paperwork.
 *
 * ============================================================================
 * NEAREST ANCHOR, NOT STICKY MEMORY
 * ============================================================================
 *
 * The same architecture as the performance-management continuation walk, and for
 * the same reason. Walking back to the nearest turn that NAMES a register
 * resolves the pronoun; remembering "this conversation is about forms" would
 * make the register survive a change of subject, so that a question about the
 * refund policy three turns later still answered from the forms menu.
 *
 * So the walk is bounded, it stops at the FIRST turn that names either register,
 * and it holds nothing between turns.
 *
 * ============================================================================
 * AND WHERE THE ANSWER IS GENUINELY UNKNOWABLE, IT ASKS
 * ============================================================================
 *
 * A turn that names one template and one framework has named both registers, and
 * there is no honest way to pick. One short clarifying question is a better
 * answer than a confident wrong menu - and it is the only place in this file
 * where Ask Sunny declines to resolve rather than guessing.
 */

/** The two registers a reference can land in. */
export type Register = "forms" | "knowledge";

export interface RegisterResolution {
  /** The register the nearest anchor named, or null when nothing did. */
  readonly register: Register | null;
  /** True when the nearest anchor named BOTH and neither dominated. */
  readonly ambiguous: boolean;
  /** How many turns back the anchor was, for tests and for the trail. */
  readonly hops: number;
  /**
   * What the anchor actually named, deduped - "performance management
   * framework", "coaching form". Reported so a decision can be explained
   * rather than only asserted.
   */
  readonly named: readonly string[];
}

/**
 * How far back the walk goes.
 *
 * The acceptance conversation needs five: "I need to find those documents" is
 * turn six, and the turn that last named a register is turn three, with two
 * question-and-answer pairs of elliptical follow-ups in between. Eight leaves
 * room for one more such pair without letting a reference reach back into a
 * different subject entirely.
 */
export const MAX_ANCHOR_HOPS = 8;

/* --------------------------------------------------------- the sentence -- */

/**
 * Location shapes - asking WHERE something is, or asking to be taken to it.
 *
 * Deliberately the same vocabulary `inventory-question.ts` uses for its location
 * branch, because the two are answering the same kind of question; this module
 * only decides which register it is about.
 */
const LOCATION_SHAPES: readonly RegExp[] = [
  /\bwhere\s+(?:is|are|do|can|would|should|might)\b/,
  /\bhow\s+do\s+i\s+(?:find|get\s+to|open|see)\b/,
  /\b(?:find|locate|open|pull\s+up|get\s+to)\s+(?:those|these|them|it|this|that|the\s+ones)\b/,
  /\b(?:stored|kept|located|filed|saved)\b/,
  /\b(?:under\s+what|which\s+category|what\s+category|which\s+section|what\s+section)\b/,
  /\b(?:is|are)\s+(?:this|that|these|those|they|it)\s+(?:under|in|inside|filed|stored|kept)\b/,
];

/** Nouns that could mean either register, so on their own they settle nothing. */
const AMBIGUOUS_NOUNS: readonly string[] = [
  "document",
  "documents",
  "doc",
  "docs",
  "paperwork",
  "information",
  "info",
  "material",
  "materials",
  "resource",
  "resources",
  "file",
  "files",
  "thing",
  "things",
  "stuff",
];

/** Nouns that name the FORMS register outright, so no walk is needed. */
const FORM_REGISTER_NOUNS: readonly string[] = ["form", "forms", "template", "templates"];

/** Nouns that name the KNOWLEDGE register outright, likewise. */
const KNOWLEDGE_REGISTER_NOUNS: readonly string[] = [
  "policy",
  "policies",
  "process",
  "procedure",
  "procedures",
  "guide",
  "guideline",
  "guidelines",
  "framework",
  "frameworks",
  "manual",
  "manuals",
  "handbook",
  "standard",
  "standards",
  "training",
];

/** Pronouns that are ALWAYS bare - there is no noun for them to be bound to. */
const BARE_PRONOUN = /\b(?:them|they|it|the\s+ones)\b/;

/** A demonstrative, with whatever word follows it. */
const DEMONSTRATIVE = /\b(?:those|these|this|that)\b(?:\s+([a-z][a-z'-]*))?/g;

/**
 * Words that, following a demonstrative, mean the demonstrative was the whole
 * subject.
 *
 * "Is this UNDER Operations?" and "where is this STORED?" both point at
 * something unnamed; "is this FORM under Operations?" names it. The difference
 * is whether the next word is a noun or the start of the predicate, and this is
 * that test at the resolution it needs: a small list of the function words and
 * location verbs that actually follow a demonstrative subject.
 */
const BARE_FOLLOWERS: ReadonlySet<string> = new Set([
  "is",
  "are",
  "was",
  "were",
  "in",
  "on",
  "at",
  "under",
  "inside",
  "within",
  "to",
  "from",
  "for",
  "and",
  "or",
  "all",
  "one",
  "stored",
  "kept",
  "located",
  "filed",
  "saved",
  "live",
  "lives",
  "sit",
  "sits",
  "go",
  "goes",
]);

/**
 * Whether the sentence points at something it does not NAME.
 *
 * A bare pronoun always does. A demonstrative does when it is the whole subject
 * ("is this under Operations?") or when the noun it binds names neither
 * register ("those documents", "this information") - which is exactly the case
 * that needs an antecedent, because the business uses those words for both.
 *
 * "Where is that COACHING FORM?" is excluded by the register-noun check above,
 * and "where is it in the report?" resolves to nothing because a report
 * conversation names no register - so the walk finds no anchor and the caller
 * keeps what it would have done.
 */
function pointsAtSomethingUnnamed(q: string): boolean {
  if (BARE_PRONOUN.test(q)) return true;

  const matches = [...q.matchAll(DEMONSTRATIVE)];
  return matches.some((match) => {
    const bound = match[1];
    if (bound === undefined) return true;
    return AMBIGUOUS_NOUNS.includes(bound) || BARE_FOLLOWERS.has(bound);
  });
}

/**
 * Verbs that mean the manager wants something MADE.
 *
 * Mirrors `inventory-question.ts`: a creation request is not a reference to be
 * resolved, whatever pronouns it contains.
 */
const CREATION_VERBS: readonly string[] = [
  "create",
  "start",
  "draft",
  "make me",
  "make a",
  "open a",
  "fill out",
  "fill in",
  "generate",
  "prepare",
  "write up",
  "write-up",
  "i need a",
  "set up a",
];

function normalize(value: string): string {
  return (value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function escape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mentions(haystack: string, phrase: string): boolean {
  return new RegExp(`\\b${escape(phrase)}\\b`).test(haystack);
}

/**
 * Whether the sentence points at something it does not name.
 *
 * BOTH HALVES ARE REQUIRED. A location shape alone is "where is the attendance
 * policy?", which names its subject and needs no antecedent. A bare pronoun
 * alone is "what does it say?", which is a question about content rather than
 * about where something lives.
 *
 * AND A NAMED REGISTER DISQUALIFIES IT. "Where do I find those forms?" contains
 * a pronoun, but "forms" has already settled the register - walking back could
 * only agree with it or, worse, overrule the manager's own word.
 */
export function isEllipticalRegisterReference(question: string): boolean {
  const q = normalize(question);
  if (q === "") return false;
  if (CREATION_VERBS.some((verb) => mentions(q, verb))) return false;

  if (!LOCATION_SHAPES.some((shape) => shape.test(q))) return false;

  if (FORM_REGISTER_NOUNS.some((noun) => mentions(q, noun))) return false;
  if (KNOWLEDGE_REGISTER_NOUNS.some((noun) => mentions(q, noun))) return false;

  return pointsAtSomethingUnnamed(q);
}

/* ----------------------------------------------------------- the anchor -- */

/**
 * Phrases that mean a turn was talking about the FORMS register structurally,
 * rather than by naming a template.
 *
 * Multi-word on purpose: "form" on its own appears in "performance", in
 * "information" and in ordinary prose about how to inform somebody.
 */
const FORM_STRUCTURE_MARKERS: readonly string[] = [
  "create a form",
  "forms library",
  "form template",
  "form templates",
  "forms section",
  "forms page",
  "blank form",
  "fill in the form",
  "hr & performance forms",
  "hiring & interview forms",
];

/**
 * ============================================================================
 * A NAMED KNOWLEDGE DOCUMENT, READ BACKWARDS FROM ITS KIND WORD
 * ============================================================================
 *
 * A title ends in what kind of document it is - Framework, Manual, Handbook,
 * Policy - and begins wherever the surrounding sentence stops. So the scan
 * finds the kind word and walks BACKWARDS until it hits a word that cannot be
 * part of a name.
 *
 * A FORWARD PATTERN GOT THIS WRONG, and a test caught it. `(\w+\s+){1,5}policy`
 * is greedy in the wrong direction: over "Coaching Form and Policy Review" it
 * happily returns "form and policy" as the name of a document, and over
 * "records a policy violation" it returns "records a policy". Neither is a
 * title. Walking backwards from the kind word and stopping at "and" or "a"
 * rejects both, and returns "performance management framework" from "and the
 * Performance Management Framework" without a separate trim.
 *
 * AT LEAST ONE WORD BEFORE THE KIND WORD IS REQUIRED. A bare "policy" is
 * ordinary prose - "our policy is to follow up" names no document - and
 * counting it would make almost any HR answer read as a knowledge anchor.
 */
const DOCUMENT_KINDS: ReadonlySet<string> = new Set([
  "framework",
  "frameworks",
  "manual",
  "manuals",
  "handbook",
  "handbooks",
  "policy",
  "policies",
  "guideline",
  "guidelines",
  "standard",
  "standards",
  "procedure",
  "procedures",
  "sop",
]);

/**
 * Words a document's name cannot contain, so the backward walk stops at them.
 *
 * Articles and determiners, conjunctions, prepositions, and the handful of
 * verbs that put a document into a sentence. Everything else is allowed,
 * because a real title can contain almost any word.
 */
const TITLE_BOUNDARY: ReadonlySet<string> = new Set([
  "the",
  "a",
  "an",
  "our",
  "your",
  "their",
  "its",
  "his",
  "her",
  "this",
  "that",
  "these",
  "those",
  "and",
  "or",
  "but",
  "nor",
  "in",
  "on",
  "at",
  "of",
  "for",
  "with",
  "to",
  "from",
  "by",
  "under",
  "about",
  "per",
  "into",
  "via",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "says",
  "said",
  "sets",
  "explains",
  "covers",
  "records",
  "see",
  "read",
  "check",
  "cites",
  "citing",
  "cited",
  "tell",
  "me",
  "i",
  "you",
  "we",
  "it",
  "they",
  "use",
  "using",
  "open",
  "than",
  "then",
  "which",
  "what",
  "where",
  "when",
  "how",
  "why",
  /* The marker a redacted template name leaves behind - see `REDACTED`. */
  "redactedtemplatename",
]);

/** The corpus itself, named directly. */
const KNOWLEDGE_STRUCTURE_MARKERS: readonly string[] = [
  "knowledge base",
  "source card",
  "source cards",
  "knowledge document",
  "knowledge documents",
];

/**
 * What a redacted template name leaves behind.
 *
 * A WORD RATHER THAN WHITESPACE, and a word that is a `TITLE_BOUNDARY`, so
 * removing "Coaching Form" from "the Coaching Form policy" cannot leave "the
 * policy" reading as one phrase - the redaction has to break the sentence, not
 * close over the gap.
 */
const REDACTED = " redactedtemplatename ";

/** Every distinct named knowledge document the text mentions. */
function namedKnowledgeDocuments(text: string): Set<string> {
  const words = text.split(/[^a-z0-9&'-]+/).filter((word) => word !== "");
  const found = new Set<string>();

  for (let index = 0; index < words.length; index += 1) {
    if (!DOCUMENT_KINDS.has(words[index])) continue;

    /*
     * "JBA Policy Manual" holds two kind words, and it is ONE document. The
     * inner one is skipped so the title is not counted twice, once as "jba
     * policy" and again as "jba policy manual".
     */
    if (index + 1 < words.length && DOCUMENT_KINDS.has(words[index + 1])) continue;

    const title: string[] = [];
    for (let back = index - 1; back >= 0 && title.length < 5; back -= 1) {
      if (TITLE_BOUNDARY.has(words[back])) break;
      title.unshift(words[back]);
    }

    if (title.length === 0) continue;
    found.add([...title, words[index]].join(" "));
  }

  return found;
}

interface TurnScore {
  readonly forms: number;
  readonly knowledge: number;
  readonly named: readonly string[];
}

/**
 * Scores one turn by how many DISTINCT things of each register it names.
 *
 * DISTINCT, not total: an answer that says "Coaching Form" six times has named
 * one template, and counting the repeats would let emphasis outvote substance.
 *
 * TEMPLATE NAMES ARE REDACTED BEFORE THE KNOWLEDGE SCAN, so a template whose
 * own name ends in a document kind - or whose stored description mentions a
 * policy - cannot be counted on both sides of the comparison. A template name
 * is definitionally the forms register.
 */
function scoreTurn(content: string, templateNames: readonly string[]): TurnScore {
  const text = normalize(content);
  if (text === "") return { forms: 0, knowledge: 0, named: [] };

  const named = new Set<string>();
  let redacted = text;
  let forms = 0;

  for (const name of templateNames) {
    const normalized = normalize(name);
    if (normalized === "") continue;
    if (!new RegExp(`\\b${escape(normalized)}\\b`).test(redacted)) continue;
    forms += 1;
    named.add(normalized);
    redacted = redacted.replace(new RegExp(`\\b${escape(normalized)}\\b`, "g"), REDACTED);
  }

  for (const marker of FORM_STRUCTURE_MARKERS) {
    if (mentions(text, marker) && !named.has(marker)) {
      forms += 1;
      named.add(marker);
    }
  }

  const knowledgeNames = namedKnowledgeDocuments(redacted);
  for (const marker of KNOWLEDGE_STRUCTURE_MARKERS) {
    if (mentions(redacted, marker)) knowledgeNames.add(marker);
  }

  for (const name of knowledgeNames) named.add(name);

  return { forms, knowledge: knowledgeNames.size, named: [...named] };
}

/**
 * Walks back to the nearest turn that named a register.
 *
 * @param templateNames The published templates' names, from the library. Passed
 *   in rather than listed here for the same reason `form-answers.ts` contains no
 *   template name as a literal: a prose list drifts, and a template renamed or
 *   retired would go on resolving references forever.
 */
export function resolveRegisterAnchor(input: {
  readonly history: readonly { readonly role: string; readonly content: string }[];
  readonly templateNames: readonly string[];
  readonly maxHops?: number;
}): RegisterResolution {
  const maxHops = input.maxHops ?? MAX_ANCHOR_HOPS;
  const turns = [...input.history].reverse();

  for (let hop = 0; hop < Math.min(turns.length, maxHops); hop += 1) {
    const score = scoreTurn(turns[hop].content, input.templateNames);
    if (score.forms === 0 && score.knowledge === 0) continue;

    if (score.forms > score.knowledge) {
      return { register: "forms", ambiguous: false, hops: hop + 1, named: score.named };
    }
    if (score.knowledge > score.forms) {
      return { register: "knowledge", ambiguous: false, hops: hop + 1, named: score.named };
    }
    /*
     * NAMED BOTH, EQUALLY. The one case where guessing is worse than asking:
     * a turn that mentioned the Coaching Form and the Performance Management
     * Framework has given no reason to prefer either.
     */
    return { register: null, ambiguous: true, hops: hop + 1, named: score.named };
  }

  /*
   * NOTHING NAMED A REGISTER inside the window - usually a cold open, where
   * "I need to find those documents" is the first thing said. Reported as
   * unresolved rather than ambiguous, so the caller can keep whatever it would
   * have done without this module. There is no antecedent to have got wrong.
   */
  return { register: null, ambiguous: false, hops: 0, named: [] };
}
