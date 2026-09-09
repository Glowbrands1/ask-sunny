/**
 * ============================================================================
 * ASKING ABOUT THE LIBRARY IS NOT ASKING FOR A FORM
 * ============================================================================
 *
 * "Do we have a coaching form?" and "Create a coaching form for Sarah" both name
 * the Coaching Form, and only one of them should put a document in somebody's
 * file. Before this module the first one produced a PROPOSAL — a card offering to
 * create a coaching record for an employee nobody had named — because
 * `detectTemplateIntent` reads the template out of the sentence and does not care
 * what mood the sentence is in.
 *
 * So this runs FIRST, and a question about the library wins. It is pure and
 * browser-importable for the same reason `template-intent.ts` is: preview mode
 * has to read a sentence the way the server does, or the two disagree about what
 * the manager asked.
 *
 * ============================================================================
 * BIASED TOWARDS LETTING THE QUESTION THROUGH TO RETRIEVAL
 * ============================================================================
 *
 * The failure to avoid is not "an inventory question reached the knowledge base"
 * — the grounded path is given the same inventory block, so it answers those
 * well. It is "a knowledge question was hijacked by a list of forms". "Where is
 * the attendance policy?" is a location question about a POLICY, and a manager
 * who gets back the Forms menu has been failed.
 *
 * Every rule below therefore requires the sentence to be about forms, documents
 * or templates in so many words. A follow-up like "where is this information
 * stored" carries no such word and is deliberately NOT claimed here: it goes to
 * the grounded path, which has the inventory and the rules about where things
 * live. Answering it from a keyword would mean guessing which of the previous
 * turn's two registers — guidance or template — "this information" meant.
 */

export type InventoryQuestion =
  /** "What forms do we have?" — name the library. */
  | { kind: "list" }
  /** "Where are those forms?" — say where in Ask Sunny they are. */
  | { kind: "location" }
  /**
   * "Do we have a role-play form?" — a yes or a no about ONE thing.
   *
   * The subject is not extracted here. `detectTemplateIntent` already reads a
   * template out of a sentence, and a second reader would be a second answer to
   * the same question. Where it finds a template the answer is about that
   * template; where it finds none, the honest answer is that nothing matching is
   * published — which is exactly right for a form the business names but Ask
   * Sunny does not carry.
   */
  | { kind: "availability" }
  | { kind: "none" };

/** Words that make a sentence about the library rather than about policy. */
const LIBRARY_SUBJECT = [
  "form",
  "forms",
  "document",
  "documents",
  "template",
  "templates",
  "paperwork",
];

/**
 * ============================================================================
 * OTHER WORDS THE BUSINESS USES FOR A NAMED DOCUMENT
 * ============================================================================
 *
 * "Do we have a role-play evaluation?" is the question this list exists for, and
 * it is not hypothetical — it is how the reference platform's invented document
 * was named, so it is exactly what a manager who read that answer will type.
 * The sentence contains no "form", no "document" and no "template", so the rule
 * above would let it through to retrieval, where the best available answer is a
 * coaching excerpt rather than "no such template is published".
 *
 * ACCEPTED ONLY FOR THE AVAILABILITY BRANCH, and only when no guidance noun is
 * present. "Do we have an evaluation PROCESS?" is a question about how the
 * company works, and answering it with the forms library would be the hijack
 * this module is otherwise built to avoid. A yes-or-no about one named artifact
 * is the narrow case where a looser noun is safe.
 */
const ARTIFACT_NOUNS = ["evaluation", "evaluations", "write-up", "writeup", "write up"];

/** Nouns that make a question about GUIDANCE rather than about a template. */
const GUIDANCE_NOUNS = [
  "policy",
  "policies",
  "process",
  "procedure",
  "procedures",
  "guide",
  "guideline",
  "guidelines",
  "framework",
  "manual",
  "handbook",
  "standard",
  "standards",
  "training",
];

/**
 * Openers that ask which things exist.
 *
 * "What form should I use" is here too: it asks to be pointed at one of a known
 * set, and answering it from the real set is the whole improvement.
 */
const LIST_PHRASES = [
  "what forms",
  "which forms",
  "what documents",
  "which documents",
  "what templates",
  "which templates",
  "what form",
  "which form",
  "what other forms",
  "list the forms",
  "list of forms",
  "available forms",
  "forms available",
  "documents available",
  "forms do we have",
  "forms do you have",
  "forms exist",
  "forms are there",
  "kinds of forms",
  "types of forms",
];

/** Openers that ask where something lives in the app. */
const LOCATION_PHRASES = [
  "where is",
  "where are",
  "where do i find",
  "where can i find",
  "where would i find",
  "how do i find",
  "how do i get to",
  "where do i go",
  "find those",
  "find these",
  "find the",
  "stored",
  "kept",
  "located",
  "live",
  "under what",
  "which category",
  "what category",
  "is this under",
  "are these under",
];

/** Openers that ask whether one particular thing exists. */
const AVAILABILITY_PHRASES = [
  "do we have",
  "do you have",
  "do we use",
  "do you use",
  "is there a",
  "is there an",
  "are there any",
  "does ask sunny have",
  "do we already have",
  "have we got",
];

/**
 * Verbs that mean the manager wants a form MADE.
 *
 * Their presence takes the sentence out of this module entirely, so
 * "create a coaching form" is never answered with a description of the library.
 * The list is intentionally the same shape as `template-intent.ts`'s, and
 * intentionally not shared with it: that one decides whether a request is a
 * creation, this one only needs to stand down when it plainly is.
 */
const CREATION_VERBS = [
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
  "i need to do",
  "set up a",
];

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function mentions(haystack: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`).test(haystack);
}

/** True when the sentence is about the forms library in so many words. */
function namesTheLibrary(question: string): boolean {
  return LIBRARY_SUBJECT.some((word) => mentions(question, word));
}

export function detectInventoryQuestion(question: string): InventoryQuestion {
  const q = normalize(question);

  // A request to build one is not a question about the library, whatever else
  // the sentence contains.
  if (CREATION_VERBS.some((verb) => mentions(q, verb))) return { kind: "none" };

  const aboutTemplates = namesTheLibrary(q);

  /*
   * ==========================================================================
   * LIST FIRST, BECAUSE THE TWO OPENERS OVERLAP
   * ==========================================================================
   *
   * "What forms do we have?" contains BOTH "what forms" and "do we have", and it
   * is plainly a request for the library rather than a yes-or-no about one
   * thing. An earlier draft checked availability first and answered it with
   * "Not as a form in Ask Sunny" — a flat no to a question that asked what
   * there was.
   *
   * The reverse conflict does not exist: "do we have a follow-up coaching
   * form?" matches no list phrase, because the list phrases all lead with an
   * interrogative on the noun ("what forms", "which form", "list of forms").
   *
   * LIST BEFORE LOCATION for a related reason. "What forms are you referring
   * to?" also contains a "to"-shaped phrase, and matching it as a location
   * answered "they are in Forms" to a question that asked WHICH forms.
   */
  if (aboutTemplates && LIST_PHRASES.some((phrase) => mentions(q, phrase))) {
    return { kind: "list" };
  }

  /*
   * AVAILABILITY is the only branch that accepts the looser artifact nouns —
   * see `ARTIFACT_NOUNS`. A yes-or-no about one named thing is safe to widen; a
   * request to list everything is not.
   */
  const aboutOneArtifact =
    ARTIFACT_NOUNS.some((noun) => mentions(q, noun)) &&
    !GUIDANCE_NOUNS.some((noun) => mentions(q, noun));

  if (
    (aboutTemplates || aboutOneArtifact) &&
    AVAILABILITY_PHRASES.some((phrase) => mentions(q, phrase))
  ) {
    return { kind: "availability" };
  }

  // Every remaining branch needs the sentence to be about forms in so many
  // words. See the header: this is what keeps "where is the attendance policy?"
  // out.
  if (!aboutTemplates) return { kind: "none" };

  // "forms are you referring to" / "documents are you using" — a list question
  // phrased as a challenge to the previous answer, which is how managers ask it.
  if (/\b(forms?|documents?|templates?)\b[^.?!]{0,24}\b(referring|using|talking about|mean)\b/.test(q)) {
    return { kind: "list" };
  }
  if (/\b(referring|using|talking about|mean)\b[^.?!]{0,24}\b(forms?|documents?|templates?)\b/.test(q)) {
    return { kind: "list" };
  }

  if (LOCATION_PHRASES.some((phrase) => mentions(q, phrase))) return { kind: "location" };

  return { kind: "none" };
}
