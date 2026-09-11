/**
 * ============================================================================
 * WHICH FORM THE MANAGER ASKED FOR — FROM THEIR OWN WORDS
 * ============================================================================
 *
 * Deliberately NOT server-only: the same reading of a sentence has to be
 * available to the preview provider in the browser, and there is nothing
 * privileged here — no database, no identity, no secret. What it returns is an
 * INTENT, never a decision: a key named here still has to resolve against the
 * published, active template library on the server before anything uses it.
 *
 * ============================================================================
 * THE RULE THIS FILE EXISTS TO ENFORCE: NO DEFAULT TEMPLATE
 * ============================================================================
 *
 * The prototype resolved an unrecognised request to the Coaching Form, because
 * "form" was a coaching matcher and coaching was the fallback:
 *
 *     detectTemplate("create a form for Sarah")  ->  { id: "tpl-coaching" }
 *
 * A manager who asked for "a form" was handed a documented-coaching record —
 * the first step of a disciplinary sequence — chosen for them by a keyword list.
 * Here, that sentence is AMBIGUOUS and the answer is a question.
 */

export type TemplateIntent =
  /** The manager named a template. Still validated against the library. */
  | { kind: "explicit"; templateKey: string }
  /** They asked for a form without saying which. Ask; never default. */
  | { kind: "ambiguous" }
  /**
   * They said "corrective action" — the name of the whole PROGRESSION, not of
   * a document. See `CORRECTIVE_ACTION_REQUEST` below for why that is its own
   * answer rather than a synonym for the Corrective Action Form, whose own
   * name the explicit list above matches first.
   *
   * `requestedCreation` separates the two things managers mean by it: asking
   * what the corrective-action process IS, which is a knowledge question, from
   * asking for a corrective action to be STARTED for somebody, which needs the
   * document classifying before anything can be proposed.
   */
  | { kind: "corrective_action"; requestedCreation: boolean }
  /** Not a form request at all. */
  | { kind: "none" };

/**
 * Explicit namings, mapped to LIBRARY KEYS.
 *
 * Every key here is a real `TEMPLATE_SEEDS` key. `matchers` are explicit
 * namings only — the bare word "form" is absent on purpose.
 */
const TEMPLATE_INTENT: { key: string; matchers: string[] }[] = [
  {
    /*
     * ========================================================================
     * THE FORM IS NAMEABLE; THE PROGRESSION IS NOT
     * ========================================================================
     *
     * "CORRECTIVE ACTION" ALONE IS STILL NOT HERE, and that is still the
     * correction. §2 of the approved Performance Management Framework is
     * explicit that corrective action is the whole ladder — Observation,
     * Coaching, Role Play, Follow-Up Coaching, EPP, Follow-Up Review,
     * Corrective Action, Further Leadership Review — so reading the umbrella as
     * its seventh rung picks a formal warning for a manager by keyword. See
     * `CORRECTIVE_ACTION_REQUEST`.
     *
     * "CORRECTIVE ACTION FORM" IS A DIFFERENT SENTENCE. It names a document,
     * and after the rename it names THIS document by its own published name.
     * That is what makes the form selector work: a card sends
     * `formRequestPhrase("Corrective Action Form")` through the composer, and
     * if that sentence resolved to the progression the manager would land back
     * on the picker they just used. `detectTemplateIntent` therefore tests the
     * explicit namings BEFORE the progression phrase — see there.
     *
     * THE LEGACY NAMES STAY, FOREVER AS FAR AS THIS FILE IS CONCERNED. Managers
     * have been saying "DPOA" for years and old chats are full of it; a rename
     * that stops recognising the word people actually type is a rename that
     * breaks the product. They are INPUT aliases only — what Ask Sunny says
     * back is the current name, which comes off the template row.
     */
    key: "dpoa",
    matchers: [
      "corrective action form",
      "corrective action write-up",
      "corrective action write up",
      "corrective action document",
      // Legacy namings. Recognised as input; never used in a reply.
      "dpoa",
      "disciplinary plan",
      "disciplinary form",
      "disciplinary action",
      "disciplinary write-up",
      "disciplinary write up",
      "written warning",
      "verbal warning",
      "final warning",
      /*
       * "WRITE HER UP" NAMES THE ACT, AND THE ACT HAS ONE DOCUMENT.
       *
       * The bare noun "write-up" is deliberately absent and stays in
       * AMBIGUOUS_FORM_REQUEST: "let's do a write-up" could be any of the
       * records in the library. What is unambiguous is writing a PERSON up —
       * that is the formal step, and the form that records it is this one.
       */
      "write her up",
      "write him up",
      "write them up",
      "write someone up",
      "write up an employee",
      "write up a team member",
      "writing her up",
      "writing him up",
      "writing them up",
    ],
  },
  { key: "policy-review", matchers: ["policy review"] },
  {
    /*
     * BEFORE `coaching`, NECESSARILY. "Follow-up coaching form" contains
     * "coaching form" as a whole-word substring, so the coaching entry would
     * match it first and propose the wrong document — the original coaching
     * record instead of the follow-up to it.
     */
    key: "follow-up-coaching",
    matchers: [
      "follow-up coaching",
      "follow up coaching",
      "followup coaching",
      "coaching follow-up",
      "coaching follow up",
      "follow-up coaching note",
    ],
  },
  {
    key: "coaching",
    matchers: [
      "coaching form",
      "coaching document",
      "coach form",
      "documented coaching",
      "coaching write-up",
      "coaching writeup",
    ],
  },

  /*
   * ==========================================================================
   * THE REST OF THE PUBLISHED LIBRARY, NAMEABLE
   * ==========================================================================
   *
   * The three entries above were the only forms a manager could name. Every
   * other published template — the six performance plans and the four hiring
   * forms — read as `none`, so "Create a Prescreen / Phone Interview Form"
   * came back as a knowledge answer about prescreening, and the form selector
   * had no way to hand a chosen card back into this flow.
   *
   * EVERY MATCHER HERE NAMES A DOCUMENT, never a role, a person or a subject.
   * That is the same rule the coaching guard below enforces, and it is what
   * keeps "is FTTC eligible for the bonus?" and "how do I prescreen a
   * candidate?" as questions: "fttc" and "prescreen" alone are absent on
   * purpose, exactly as the bare word "form" is.
   *
   * THE FAMILY STAYS AMBIGUOUS. Naming one plan is explicit; "EPP" and
   * "performance plan" remain in AMBIGUOUS_FORM_REQUEST, because six of these
   * are performance plans and picking one of them for somebody's file is the
   * defect this whole module exists to prevent. The same holds for "DMIT EPP",
   * which is two documents until the reading is named.
   *
   * ORDER IS SIGNIFICANT: the first entry with a hit wins, so ASD-SDIT sits
   * ahead of SDIT and the DMIT readings ahead of the plain plans.
   */
  {
    key: "asd-sdit-epp",
    matchers: [
      "asd-sdit performance epp",
      "asd sdit performance epp",
      "asd-sdit performance plan",
      "asd-sdit epp",
      "asd sdit epp",
    ],
  },
  {
    key: "dmit-epp-tsd",
    matchers: [
      "dmit epp — tsd review",
      "dmit epp - tsd review",
      "dmit epp tsd review",
      "dmit tsd review",
    ],
  },
  {
    key: "dmit-epp-dmit",
    matchers: [
      "dmit epp — dmit review",
      "dmit epp - dmit review",
      "dmit epp dmit review",
      "dmit dmit review",
    ],
  },
  {
    key: "sdit-epp",
    matchers: ["sdit epp", "sdit performance plan"],
  },
  {
    key: "tsd-epp",
    matchers: ["tsd epp", "tsd performance plan"],
  },
  {
    key: "fttc-epp",
    matchers: ["fttc performance epp", "fttc epp", "fttc performance plan"],
  },
  {
    key: "prescreen-phone-interview",
    matchers: [
      "prescreen / phone interview form",
      "prescreen/phone interview form",
      "prescreen / phone interview",
      "prescreen/phone interview",
      "prescreen form",
      "pre-screen form",
      "phone interview form",
      "prescreen interview",
    ],
  },
  {
    key: "tanning-consultant-interview",
    matchers: ["tanning consultant interview"],
  },
  {
    key: "management-interview-round-1",
    matchers: [
      "first round management interview",
      "first management interview",
      "first round interview",
    ],
  },
  {
    key: "management-interview-round-2",
    matchers: [
      "second round management interview",
      "second management interview",
      "second round interview",
    ],
  },
];

/**
 * THE NAME OF THE PROGRESSION, NOT OF A DOCUMENT.
 *
 * Kept apart from both lists above because it needs a different answer from
 * either. It is not `explicit` — no single template is what the manager asked
 * for. It is not the generic `ambiguous` "which form?" either, because the
 * honest reply is not a flat list of everything published: it is that corrective
 * action is a sequence, that where somebody is in that sequence decides the
 * document, and which of the published forms records which rung.
 */
const CORRECTIVE_ACTION_REQUEST = ["corrective action", "corrective actions"];

/**
 * Verbs that mean "make me one", as opposed to "tell me about it".
 *
 * "corrective action" on its own is a manager asking how the process works.
 * "start a corrective action for Sarah" is a manager asking for a document, and
 * the document has to be settled before anything is proposed for her file.
 */
const CREATION_VERBS = [
  "create",
  "start",
  "draft",
  "make",
  "open",
  "write up",
  "write-up",
  "fill out",
  "generate",
  "prepare",
  "issue",
  "do a",
  "need a",
  "need to do",
];

/**
 * How a form is asked for by name.
 *
 * ONE PHRASE, SHARED. A card in the form selector sends this through the
 * composer, so choosing "Policy Review" from the picker and typing "Create a
 * Policy Review from this conversation" are the same sentence arriving by two
 * routes — read here, resolved against the published library on the server,
 * and put through the identical proposal flow. A card that called an API of its
 * own would be a second creation path, and only one of the two would carry the
 * permission check.
 *
 * A test asserts every published template's name round-trips through
 * `detectTemplateIntent` back to its own key. A template whose name did not
 * would land the manager back on the picker they just used.
 */
export function formRequestPhrase(templateName: string): string {
  return `Create a ${templateName} from this conversation.`;
}

/**
 * Phrases that ask for A form without saying which.
 *
 * "EPP" IS HERE RATHER THAN IN THE MAP ABOVE, and that is the whole point of
 * the distinction. The library publishes six EPPs — SDIT, TSD, ASD-SDIT, FTTC
 * and two DMIT readings — so "start an EPP" names a family, not a document.
 * Mapping it to a single key would pick one of six performance plans for
 * somebody's file; listing the family and asking is the honest answer.
 */
const AMBIGUOUS_FORM_REQUEST = [
  "create a form",
  "create form",
  "build a form",
  "build me a form",
  "make a form",
  "start a form",
  "new form",
  "draft a form",
  "fill out a form",
  "write up",
  "write-up",
  "epp",
  "performance plan",
  "performance improvement",
];

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * WHOLE WORDS ONLY, never `includes`.
 *
 * "epp" as a substring is inside "stepped", "pepper" and "shepperd"; "dpoa"
 * inside a pasted id. A substring test would turn "I stepped in on her shift"
 * into a request for a performance plan. Every matcher below is short enough
 * for that to be a live risk, so all of them go through here.
 */
function mentions(haystack: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`).test(haystack);
}

export function detectTemplateIntent(question: string): TemplateIntent {
  const q = normalize(question);

  /*
   * ==========================================================================
   * THE EXPLICIT NAMINGS COME FIRST, AND THE ORDER IS THE WHOLE POINT
   * ==========================================================================
   *
   * The progression phrase used to be tested first, which was right while the
   * seventh rung was called the Disciplinary Plan of Action: nothing a manager
   * could type contained "corrective action" AND named a document.
   *
   * The rename made that false. "Corrective Action Form" contains "corrective
   * action", so a progression-first reading turns the form's own published
   * name — the sentence the form selector's card sends, and the plainest way a
   * manager can ask for it — into a lecture about the ladder. Testing the
   * explicit list first is what keeps a NAMED DOCUMENT a named document.
   *
   * It does not weaken the rule below it. "Corrective action" on its own still
   * matches no entry in `TEMPLATE_INTENT` and still falls through to the
   * progression branch, so the umbrella is still never read as its most
   * serious rung.
   */
  for (const entry of TEMPLATE_INTENT) {
    if (entry.matchers.some((matcher) => mentions(q, matcher))) {
      return { kind: "explicit", templateKey: entry.key };
    }
  }

  /*
   * THE NAME OF THE PROGRESSION, with no document named alongside it.
   */
  if (CORRECTIVE_ACTION_REQUEST.some((phrase) => mentions(q, phrase))) {
    return {
      kind: "corrective_action",
      // Whole words, like every other match here: `includes` would read
      // "there are issues with corrective action" as a request to issue one.
      requestedCreation: CREATION_VERBS.some((verb) => mentions(q, verb)),
    };
  }

  // "coach"/"coaching" on its own, in a sentence that is plainly asking for a
  // document rather than for advice. "How do I coach someone on tardiness?" is
  // a question for the knowledge base and must stay one.
  if (/\bcoach(ing|ed)?\b/.test(q) && /\b(form|document|write up|write-up)\b/.test(q)) {
    return { kind: "explicit", templateKey: "coaching" };
  }

  if (AMBIGUOUS_FORM_REQUEST.some((phrase) => mentions(q, phrase))) {
    return { kind: "ambiguous" };
  }

  return { kind: "none" };
}

/**
 * Words that belong to the FORM LIBRARY, never to a person.
 *
 * "Coaching Form for Sarah Test, she was late today" produced TWO candidate
 * employees — "Coaching Form" and "Sarah Test" — so the request was ambiguous
 * and Ask Sunny asked who the form was about, having just been told. Capitalising
 * the form's name is the most natural way to ask for one, and it broke employee
 * resolution on every template that has two capitalised words in its name:
 * "Disciplinary Plan", "Policy Review", "Tanning Consultant Interview".
 *
 * DERIVED FROM THE MATCHERS ABOVE rather than typed out again, so a template
 * whose naming is added there is protected here without a second edit. The
 * extra list is the library's remaining display vocabulary — the words that
 * appear in template NAMES but are not matchers, because nobody needs to say
 * "Second Round" to be understood.
 *
 * Single letters are dropped: "a" carries no information and the reader's own
 * stop list already holds the pronouns.
 */
const LIBRARY_NAME_WORDS = [
  "prescreen", "phone", "interview", "tanning", "consultant", "management",
  "round", "first", "second", "performance", "epp", "sdit", "tsd", "dmit",
  "asd", "fttc", "employee", "plan", "report", "record", "template", "sunny",
  "salon", "location", "store",
];

export const FORM_VOCABULARY: ReadonlySet<string> = new Set(
  [
    ...TEMPLATE_INTENT.flatMap((entry) => entry.matchers),
    ...AMBIGUOUS_FORM_REQUEST,
    ...CORRECTIVE_ACTION_REQUEST,
    ...LIBRARY_NAME_WORDS,
  ]
    .flatMap((phrase) => phrase.split(/[\s/-]+/))
    .map((word) => word.toLowerCase())
    .filter((word) => word.length > 1),
);

/** True when a word is part of how the business names its forms. */
export function isFormVocabulary(word: string): boolean {
  return FORM_VOCABULARY.has(word.toLowerCase());
}
