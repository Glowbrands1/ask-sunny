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

import { NOT_A_NAME, NOT_A_TYPED_NAME, TYPED_NAME_WORD } from "./name-words";
import { asksForTeamCoaching } from "./team-subject";

export type TemplateIntent =
  /** The manager named a template. Still validated against the library. */
  | { kind: "explicit"; templateKey: string }
  /**
   * They asked for a form without saying which. Ask; never default.
   *
   * `family` names the GROUP they asked for when they named one. "Create a
   * form" names no group and carries none; "employee performance plan" names
   * the EPPs, of which the library publishes six — still ambiguous on its own,
   * but a caller that can see the conversation may be able to settle it from
   * the role the manager already stated. See `eppTemplateForRole`.
   *
   * IT IS STILL NOT A DEFAULT. Absent a role, an `epp` family request is the
   * form selector, exactly as a bare "create a form" is.
   */
  | { kind: "ambiguous"; family?: "epp" }
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
  /**
   * "Coach Avery", "Avery needs coaching": a person and a verb that means
   * advice as often as it means a document. Neither is guessed — the answer is
   * one short question. See `coachingRequest`.
   */
  | { kind: "clarify"; templateKey: string }
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
     * ========================================================================
     * THE RESIGNATION/EXIT FORM, BY EVERY NAME MANAGERS GIVE IT
     * ========================================================================
     *
     * Its printed title is "Resignation/Exit Form"; the business files it as
     * "STC Exit"; managers call it the exit form, the resignation paperwork or
     * the termination paperwork. All of them name THIS document — there is no
     * other exit form in the library — so each is an explicit naming.
     *
     * EVERY MATCHER NAMES PAPERWORK, never the act. "Termination" alone stays
     * out: "what's the termination policy?" and "should Sarah be terminated?"
     * are questions the grounded path answers under the Performance Management
     * Framework, and a termination is a leadership decision this file must not
     * turn into a form by keyword. "Exit interview" stays out too — an exit
     * interview is a conversation, and "do you have an exit interview
     * document?" has to be answered honestly rather than with this form.
     */
    key: "stc-exit",
    matchers: [
      "resignation/exit form",
      "resignation / exit form",
      "stc exit form",
      "stc exit",
      "exit form",
      "exit forms",
      "exit paperwork",
      "exit document",
      "resignation form",
      "resignation paperwork",
      "resignation document",
      "termination form",
      "termination paperwork",
      "separation form",
      "separation paperwork",
      "offboarding form",
      "offboarding paperwork",
    ],
  },
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
    /*
     * ========================================================================
     * THE TSD PLAN ANSWERS TO ITS PRINTED TITLE AS WELL AS ITS ROLE
     * ========================================================================
     *
     * "MANAGEMENT PERFORMANCE PLAN" IS WHAT IS PRINTED ACROSS THE TOP of this
     * document, and it is what a District Manager holding a copy of it calls
     * it. It named no template at all: "performance plan" is an EPP_FAMILY
     * phrase, so a manager typing the form's own title got the picker back and
     * had to choose the document they had just named.
     *
     * IT IS THIS DOCUMENT AND NOT A FAMILY. Only one published template prints
     * that title. The other five plans print "Employee Performance Plan", so
     * nothing is being picked out of a set here — the title resolves the same
     * way "Corrective Action Form" does, by naming one document.
     *
     * IT DOES NOT TOUCH THE MANAGEMENT INTERVIEWS. Those match on "first round
     * management interview" / "second round management interview"; a sentence
     * has to contain "performance plan" to land here, and an interview form is
     * not a performance plan.
     *
     * "TRAINING SALON DIRECTOR" spelled out is the same naming as "TSD" — the
     * role in full, which is how the title line of the form itself reads and
     * how a DM writes it when they are being careful.
     */
    key: "tsd-epp",
    matchers: [
      "tsd epp",
      "tsd performance plan",
      "training salon director epp",
      "training salon director performance plan",
      "management performance plan",
    ],
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

  /*
   * ==========================================================================
   * THE EMPLOYMENT CHANGE FORMS, BY THE NAMES MANAGERS USE FOR THEM
   * ==========================================================================
   *
   * DOCUMENT NAMINGS ONLY, the rule this list has always kept: every matcher
   * contains "form", "paperwork" or the document's own title. The SUBJECT
   * words — "demote", "transferring", "quit", "last day" — are read further
   * down, by `employmentChangeIntent`, and only where the sentence is a
   * request or a statement of the change rather than a question about it.
   *
   * LAST IN THE LIST, so a sentence that also names an existing form ("a
   * corrective action form for a demotion") resolves exactly as it did before.
   *
   * The Resignation/Exit Form is not among them: it is `stc-exit`, named by its
   * own entry above (main #44), and its wording is its own.
   */
  {
    key: "demotion",
    matchers: [
      "demotion form",
      "demotion forms",
      "demotion paperwork",
      "demotion document",
      "demotion write-up",
      "demotion write up",
      "demote form",
      "step down form",
      "step-down form",
    ],
  },
  {
    key: "position-transfer",
    matchers: [
      "position transfer form",
      "position transfer",
      "transfer form",
      "transfer forms",
      "transfer paperwork",
      "transfer document",
      "salon transfer form",
      "location transfer form",
      "store transfer form",
    ],
  },
];

/**
 * ============================================================================
 * "DEMOTE PAULYNE FROM MANAGER TO TC" NAMES THE DEMOTION FORM
 * ============================================================================
 *
 * The subject of the change is how managers actually ask for these: "Jane is
 * transferring from salon 12 to salon 18", "demote paulyne ... effective
 * october 5". Neither says "form", and
 * answering them with a knowledge search is the assistant not listening.
 *
 * A SUBJECT WORD ALONE IS NOT A REQUEST, and that is what keeps "what is our
 * transfer policy?" and "what happens to PTO when someone goes part time?"
 * questions. A subject counts only when the sentence
 *
 *   - asks for something to be made (a creation verb: create, make, start,
 *     pull up, fill out, need, do ...), or
 *   - opens with the change as an instruction ("demote paulyne ...",
 *     "transfer jane ..."), or
 *   - STATES the change with its particulars and is not a question — a
 *     "from ... to", an arrow, an "effective" date, a last day, or a
 *     destination salon.
 *
 * "Corrective action" keeps its own branch and is tested first, so "create a
 * corrective action for sarah, we are demoting her" is answered exactly as it
 * was before these forms existed.
 */
const EMPLOYMENT_CHANGE_SUBJECTS: { key: string; subjects: RegExp }[] = [
  {
    key: "demotion",
    subjects:
      /\b(?:demot(?:e|ed|es|ing|ion|ions)|step(?:ping|s)?[\s-]+down|stepped\s+down|move\s+down\s+from\s+(?:manager|management)|moving\s+down\s+from\s+(?:manager|management)|step\s+back\s+from\s+management)\b/,
  },
  {
    key: "position-transfer",
    subjects:
      /\b(?:transfer(?:s|red|ring)?|transfering|salon\s+transfer|location\s+transfer|store\s+transfer|moving\s+(?:locations|salons|stores)|switching\s+(?:locations|salons|stores))\b/,
  },
];

const CHANGE_REQUEST_VERBS =
  /\b(?:create|make|start|draft|open|fill\s+out|fill\s+in|generate|prepare|pull\s+up|bring\s+up|get\s+me|need|needs|do\s+(?:a|an|the)|process|document|write\s+up|handle)\b/;

const CHANGE_INSTRUCTION = /^(?:please\s+)?(?:demote|transfer|move)\s+[^\s.,!?;:]+/;

const CHANGE_PARTICULARS =
  /\bfrom\b[^.?!\n]*\bto\b|→|->|\beffective\b|\blast\s+day\b|\bto\s+(?:salon|store|stc|sun\s+tan\s+city|location|#\s?\d)|\b\d{1,2}[/-]\d{1,2}\b|\b(?:yesterday|today|this\s+morning|last\s+night|this\s+week)\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b/;

const QUESTION_START =
  /^(?:what|how|when|where|why|who|which|does|do|did|is|are|can|could|should|would|will|may|has|have)\b/;

/** The employment change form a sentence asks for, or null. */
function employmentChangeIntent(q: string): string | null {
  const matched = EMPLOYMENT_CHANGE_SUBJECTS.filter((entry) => entry.subjects.test(q));
  // Two different changes in one sentence is a question for the manager.
  if (matched.length !== 1) return null;
  const key = matched[0]!.key;
  if (q.endsWith("?") || QUESTION_START.test(q)) {
    // "Can you pull up a transfer for Jane?" is a request phrased politely;
    // "do I need to do anything when someone resigns?" is a question.
    return /^(?:can|could|would|will)\s+you\b/.test(q) && CHANGE_REQUEST_VERBS.test(q) ? key : null;
  }
  // "transfer jane …" is an instruction; "transfer policy" is a topic.
  const instructed = CHANGE_INSTRUCTION.exec(q);
  const instruction =
    instructed !== null && !NOT_A_TYPED_NAME.has(q.slice(instructed[0].lastIndexOf(" ") + 1, instructed[0].length));
  if (CHANGE_REQUEST_VERBS.test(q) || instruction || CHANGE_PARTICULARS.test(q)) {
    return key;
  }
  return null;
}

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
 * ============================================================================
 * "CA" AND EVERY OTHER WAY MANAGERS TYPE IT
 * ============================================================================
 *
 * Operations asked (29 September 2026) that the shorthand managers actually use
 * — "CA", "ca form", "corrective-action", "Corective Action" — open the
 * Corrective Action Form directly. They are rewritten to the canonical words
 * BEFORE any matcher runs, so every rule below — the explicit namings, the
 * creation verbs, the §7 metric check downstream — applies to "CA" exactly as
 * it applies to "corrective action". There is still one form; these are
 * spellings of its name, not a second template.
 *
 *   "ca", "c.a."            whole words only, so "cash", "can" and "call" are
 *                           untouched. Sun Tan City has no California salons,
 *                           so the state abbreviation is not a live reading.
 *   "corrective-action"     the hyphen people put in.
 *   misspellings            a word that starts "cor" and is within two edits
 *                           of "corrective", followed by a word within one
 *                           edit of "action(s)". "cor" is required so that
 *                           "collective action" — two edits away — is not.
 */
const CA_SHORTHAND = /(?<![\w.])(?:c\.a\.?|ca)(?![\w])/gi;

/** Edits between two words, a swapped pair of letters ("actoin") counting as one. */
function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
      }
    }
  }
  return d[a.length]![b.length]!;
}

/*
 * ============================================================================
 * "PLS MAKE A COAHCING FRM" IS A COACHING FORM
 * ============================================================================
 *
 * Production QA, 30 September 2026: "pls make a coaching frm for Avery",
 * "can u do coaching for avery pls" and "coahcing form for Avery" all came
 * back as advice telling the manager which exact sentence to type. The words
 * are how people type on a phone between clients, and none of them is ever
 * somebody's name — so they are rewritten to the canonical spelling BEFORE any
 * matcher runs, exactly as "CA" is below, and every rule after this applies to
 * them unchanged.
 *
 * NARROW ON PURPOSE. Only the courtesy shorthand, the form noun's own typos,
 * and a word one edit (or one swapped pair) from "coaching" that starts with
 * "c" — so "catching" and "coaches", two edits away, are left alone. None of
 * these words is ever part of a name, so the rewrite cannot change who a form
 * is for.
 */
const COURTESY_SHORTHAND: [RegExp, string][] = [
  [/\b(?:pls|plz|plse|pleez)\b/gi, "please"],
  // Lower case only: a capital "U" can be a surname initial.
  [/\bu\b/g, "you"],
  [/\b(?:frm|fom|fomr|forn)\b/gi, "form"],
  [/\b(?:frms|froms|fomrs)\b/gi, "forms"],
];

/** Shorthand and near-miss spellings of the form's own words; everything else unchanged. */
export function canonicalShorthand(text: string): string {
  let out = text;
  for (const [pattern, replacement] of COURTESY_SHORTHAND) out = out.replace(pattern, replacement);
  return out.replace(/\bc[a-z]{5,9}\b/gi, (word) => {
    const lower = word.toLowerCase();
    if (lower === "coaching" || lower === "couching") return word;
    return editDistance(lower, "coaching") === 1 ? "coaching" : word;
  });
}

/** Every rewrite a form request goes through before it is read. */
export function canonicalFormWording(text: string): string {
  return canonicalCorrectiveAction(canonicalShorthand(text));
}

/** "corrective action" however it was typed; everything else unchanged. */
export function canonicalCorrectiveAction(text: string): string {
  return text
    .replace(/\bcorrective-actions?\b/gi, (match) => match.replace("-", " "))
    .replace(/\b(cor[a-z]{4,10})[\s-]+([a-z]{4,8})\b/gi, (match, first: string, second: string) => {
      const a = first.toLowerCase();
      const b = second.toLowerCase();
      if (a === "corrective" && (b === "action" || b === "actions")) return match;
      return editDistance(a, "corrective") <= 2 &&
        (editDistance(b, "action") <= 1 || editDistance(b, "actions") <= 1)
        ? b.endsWith("s") ? "corrective actions" : "corrective action"
        : match;
    })
    .replace(CA_SHORTHAND, "corrective action");
}

/**
 * ============================================================================
 * THE FORM'S NAME ON ITS OWN IS A REQUEST FOR THE FORM
 * ============================================================================
 *
 * A manager who types "CA", "Corrective Action" or "new corrective action" and
 * nothing else is reaching for the document — Operations asked for exactly
 * this, and answering with a lecture about the ladder is the friction they
 * reported. So a message that is ONLY the name (a courtesy word or an article
 * either side is fine) names the form.
 *
 * WHAT IS STILL A QUESTION STAYS ONE. "What is corrective action?", "how does
 * corrective action work", "is this corrective action?" carry more than the
 * name and fall through to the progression branch below, which sends them to
 * the knowledge base exactly as before.
 */
const NAME_ONLY =
  /^(?:please\s+)?(?:(?:a|an|the|new|a new)\s+)?corrective actions?(?:\s+(?:form|please))?(?:\s+please)?$/;

function namesOnlyTheForm(q: string): boolean {
  return NAME_ONLY.test(q.replace(/[.!,;:]+/g, " ").replace(/\s+/g, " ").trim());
}

/**
 * THE NAME, THEN THE DETAILS — "CA, she was late today", "Corrective Action:
 * Dana Moss", "CA for Dana Moss". A manager leading with the form's name and
 * going straight into particulars is asking for the form, the same way "Create
 * a CA" is. A question is still a question, and "corrective action for
 * repeated lateness" — a topic, lower-case — is still read as one.
 */
function leadsWithTheForm(q: string, original: string): boolean {
  if (q.endsWith("?")) return false;
  if (/^(?:please\s+)?(?:a\s+|new\s+)?corrective actions?(?:\s+form)?\s*(?:[,:;]|\s[-–—]\s)\s*\S/.test(q)) return true;
  /*
   * "CA for Dana Moss" / "ca for dana moss": a word that can be a name after
   * "for". Judged by `couldBeName`, never by capitals — lower-case typing is
   * how most managers write, and it means the same thing.
   */
  const named = /^\s*(?:please\s+)?(?:c\.?a\.?|corrective[\s-]+actions?)(?:\s+form)?\s+for\s+(\S+)/i.exec(original);
  return named !== null && couldBeName(named[1]);
}

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
  /*
   * How the request is phrased when it is not an imperative: "pull up a CA
   * for Dana", "I need a CA", "get me the corrective action".
   */
  "pull up",
  "bring up",
  "get me",
  "fill in",
  "begin",
  "set up",
  "put together",
  "i need",
  "we need",
  "need an",
  "give her a",
  "give him a",
  "give them a",
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
 * WHAT A HIT HERE BUYS: the form selector, listing the forms this manager may
 * actually create, with nothing chosen. Never a template. The rule this file
 * exists to enforce — no default form — is untouched by every phrase added
 * here, because `ambiguous` IS the question.
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
  "create me a form",
  "build a form",
  "build me a form",
  "make a form",
  "make me a form",
  "start a form",
  "new form",
  "draft a form",
  "draft me a form",
  "fill out a form",
  /*
   * ======================================================================
   * "I NEED A FORM" IS HOW PEOPLE ACTUALLY ASK
   * ======================================================================
   *
   * REPORTED FROM THE DEMO: typing "I need a form" mid-conversation did not
   * enter the Forms flow at all. Every phrase above is an imperative —
   * "create", "build", "make", "draft" — and a manager describing an
   * attendance problem does not switch into imperative mood to ask for the
   * document. They say they need one. The sentence read as `none`, went to
   * retrieval, and came back as a knowledge answer about forms.
   *
   * THESE ARE STILL AMBIGUOUS, NOT EXPLICIT. "I need a form" names no
   * document, so the answer is the form selector — never a default. A
   * sentence that DOES name one ("I need a corrective action form") is
   * matched by `TEMPLATE_INTENT` above, which is tested first.
   *
   * WHOLE WORDS AND ADJACENT WORDS, through `mentions`: "need a form"
   * matches "I need a form for this employee issue" and does not match "I
   * need to know which form she signed" — the words have to be together.
   *
   * "WANT A FORM" IS DELIBERATELY ABSENT, and so is the bare "open a form".
   * The first is the phrase people negate — "I don't want a form, I want
   * advice" — and the second is as likely to be a question about where the
   * Forms tab is as a request for one. Every phrase here is one whose
   * negation nobody types.
   */
  "need a form",
  "need a new form",
  "need a blank form",
  "need to fill out a form",
  "need a form for",
  "looking for a form",
  "get me a form",
  "send me a form",
  "pull up a form",
  "write up",
  "write-up",
];

/**
 * ============================================================================
 * PHRASES THAT NAME THE PERFORMANCE-PLAN FAMILY, WHICH IS SIX DOCUMENTS
 * ============================================================================
 *
 * Kept apart from the generic list above because a caller can do something
 * with the distinction. "Create a form" tells us nothing; "create an employee
 * performance plan" tells us the manager wants an EPP, and if their own turns
 * have already said the employee is an SDIT then which EPP is settled — by the
 * manager, in their own words, not by this file picking one.
 *
 * ON THEIR OWN THEY ARE STILL AMBIGUOUS. `detectTemplateIntent` is pure and
 * sees one sentence; it returns the family and nothing more. Resolving it needs
 * the conversation, which is `eppTemplateForRole`'s job, and where the role was
 * never stated the answer is still the form selector.
 *
 * "EMPLOYEE PERFORMANCE PLAN" IS THE ONE PEOPLE ACTUALLY TYPE. It was absent
 * entirely: "performance plan" matched it as a substring of the whole phrase,
 * which was right, but nothing distinguished it from "I need a form" and so a
 * manager who had just described an SDIT's punctuality was handed the full
 * library to choose from.
 */
const EPP_FAMILY_REQUEST = [
  "employee performance plan",
  "employee performance plans",
  "performance plan",
  "performance plans",
  "performance improvement",
  "epp",
  "epps",
];

/**
 * ============================================================================
 * THE FORM'S NAME IS THE REQUEST — FOR EVERY FORM, NO VERB REQUIRED
 * ============================================================================
 *
 * "CA for Dana Moss", "Coaching for paulyne co", "Demotion jane smith", "Exit
 * for John Doe", "Transfer for Mary Cruz": a manager who leads with a form's
 * name and then names the person is asking for that form, exactly as "create
 * a …" would. Requested by Operations, 29 September 2026.
 *
 * ONE RULE FOR THE WHOLE LIBRARY, not a rule per form. The names are DERIVED
 * from `TEMPLATE_INTENT` — every configured naming, plus the same naming with
 * its trailing noun dropped ("coaching form" -> "coaching", "exit form" ->
 * "exit", "resignation form" -> "resignation", "transfer form" -> "transfer")
 * — so a form whose naming is added there is covered here without a second
 * edit. "CA" arrives already rewritten to "corrective action".
 *
 * A LEADING NAME COUNTS, A MENTION DOES NOT. The message must OPEN with the
 * name (after an optional "please", "create a", "I need the" …), and what
 * follows must be one of:
 *
 *   nothing                  "CA", "coaching", "demotion form"
 *   a separator + details    "CA, she was late today", "Exit: John Doe"
 *   for/about/regarding + a  "Coaching for paulyne co", "Exit for John Doe
 *   word that can be a name  effective 10/2" — but not "corrective action for
 *                            repeated lateness", which is about a topic
 *   a name, directly         "coaching Dana Moss", "Demotion jane smith" —
 *                            written with capitals, or the whole rest of the
 *                            message and nothing but name-shaped words, so
 *                            "coaching went well" and "exit process" are not
 *
 * AND A QUESTION IS STILL A QUESTION — see `askedAbout`. A message that
 * opens with "what", "how" … never leads with a form's name to begin with.
 *
 * TWO NAMES ARE DELIBERATELY NOT LEADING NAMES. "Termination" and
 * "separation" are escalation words (see `pm-governance.ts`) and "termination
 * for Jane" must not open a record on its own; "coach" is advice as often as
 * it is a form. They still work inside their full namings ("termination
 * form", "coach form").
 */
const HEAD_NOUN = /\s+(?:forms?|paperwork|documents?|write[- ]?ups?|writeup|note)$/;
const NOT_A_LEADING_NAME = new Set(["termination", "separation", "coach", "demote", "step down", "step-down"]);

const FORM_HEADS: readonly { key: string; phrase: string }[] = (() => {
  const seen = new Set<string>();
  const heads: { key: string; phrase: string }[] = [];
  for (const entry of TEMPLATE_INTENT) {
    for (const matcher of entry.matchers) {
      for (const phrase of [matcher, matcher.replace(HEAD_NOUN, "")]) {
        if (seen.has(phrase) || NOT_A_LEADING_NAME.has(phrase)) continue;
        seen.add(phrase);
        heads.push({ key: entry.key, phrase });
      }
    }
  }
  // The name of the Corrective Action Form on its own: see `NAME_ONLY`.
  for (const phrase of CORRECTIVE_ACTION_REQUEST) {
    if (!seen.has(phrase)) heads.push({ key: "dpoa", phrase });
  }
  // Longest first, so "follow-up coaching" is never read as "coaching".
  return heads.sort((a, b) => b.phrase.length - a.phrase.length);
})();

/** Every form name a request can lead with, as a regex alternation (longest first). */
export const FORM_NAME_PATTERN = FORM_HEADS.map((head) =>
  head.phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+"),
).join("|");

/** "please", "can you", a creation verb, an article — whatever precedes the name. */
const LEADING_PREFIX =
  /^(?:please\s+)?(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?)?(?:(?:create|make|start|draft|open|do|fill\s+out|fill\s+in|generate|prepare|pull\s+up|bring\s+up|get\s+me|give\s+me|send\s+me|i\s+need|we\s+need|need|begin|new)\s+)?(?:(?:a|an|the|another|new|a\s+new)\s+)?/;

const WRAPPING = /^[(\[{"“‘'«]+|[)\]}"”’'»,.;:!?]+$/g;

/** Whether one typed word could be part of somebody's name. */
function couldBeName(raw: string | undefined): boolean {
  if (raw === undefined) return false;
  const word = raw.replace(WRAPPING, "");
  const lower = word.toLowerCase();
  return (
    TYPED_NAME_WORD.test(word) &&
    word.length > 1 &&
    !NOT_A_NAME.has(lower) &&
    !NOT_A_TYPED_NAME.has(lower) &&
    !FORM_VOCABULARY.has(lower)
  );
}

export interface LeadingFormRequest {
  templateKey: string;
  /**
   * The words after the form's name (and after "for"/"about"), AS TYPED —
   * where the employee's name is, when one was given. Empty for the name on
   * its own or a name followed by a separator.
   */
  subject: string[];
}

/**
 * The form a message LEADS with, and the words that follow it, or null.
 * Case is kept in `subject`; matching ignores it. See the note above.
 */
export function leadingFormRequest(text: string): LeadingFormRequest | null {
  const typed = canonicalFormWording((text ?? "").replace(/\s+/g, " ").trim());
  const lower = typed.toLowerCase();
  const prefix = LEADING_PREFIX.exec(lower)?.[0] ?? "";
  const afterPrefix = lower.slice(prefix.length);
  const head = FORM_HEADS.find(
    (entry) =>
      afterPrefix.startsWith(entry.phrase) && !/[a-z0-9]/.test(afterPrefix.charAt(entry.phrase.length)),
  );
  if (!head) return null;

  let rest = typed.slice(prefix.length + head.phrase.length);
  rest = rest.replace(/^\s+(?:forms?|paperwork|documents?)\b/i, "").trim();

  const found = (subject: string[]): LeadingFormRequest => ({ templateKey: head.key, subject });
  if (rest === "" || /^[.!]+$/.test(rest)) return found([]);
  if (/^(?:[,:;]|[-–—]\s)/.test(rest)) {
    // "CA, how does it work?" asks about it; "CA — what do you need from me?" asks for it.
    const after = rest.replace(/^[,:;\s–—-]+/, "");
    const lowered = after.toLowerCase();
    const question = lowered.endsWith("?") && WH_QUESTION.test(lowered);
    if (question && !/\bwhat (?:do|would) you need\b/.test(lowered)) return null;
    return found(nameAfterSeparator(after));
  }

  const introduced = /^(?:for|about|regarding)\s+(.+)$/i.exec(rest);
  if (introduced) {
    const words = introduced[1]!.split(" ");
    return couldBeName(words[0]) ? found(words) : null;
  }

  /*
   * A NAME, DIRECTLY — "coaching dana moss", "Coaching Dana Moss, she was
   * late". Read the same whatever the capitals: the words up to the first
   * break (a comma, colon, semicolon or dash), one to three of them, each able
   * to be a name. "coaching went well" names nobody, in any case.
   */
  const beforeBreak = rest.split(/\s*(?:[,;:]|\s[-–—]\s)/)[0]!.replace(/[.!]+$/, "");
  const named = beforeBreak.split(" ").filter(Boolean);
  if (named.length >= 1 && named.length <= 3 && named.every((word) => couldBeName(word))) return found(named);

  /*
   * A NAME, THEN WHAT THE FORM IS ABOUT — "coaching Avery Testperson about
   * attendance". Found in production QA: the trailing topic made the words
   * after the form's name more than a name, so the request read as advice.
   * The name is the one or two name-shaped words the message opens with, and
   * it counts only where a word that introduces the rest of the sentence ends
   * it ("about", "for", "because", "she" …). Read the same in any case, like
   * everything here: "coaching guidance for new hires" opens with a word that
   * is never a name, and names nobody.
   */
  const words = rest.split(" ").map((word) => word.replace(WRAPPING, ""));
  const run: string[] = [];
  while (run.length < 2 && couldBeName(words[run.length])) run.push(words[run.length]!);
  const next = words[run.length]?.toLowerCase();
  if (run.length > 0 && next !== undefined && NAME_RUN_ENDS.has(next)) return found(run);
  return null;
}

/**
 * ============================================================================
 * "COACHING - AVERY TESTPERSON": THE NAME AFTER THE SEPARATOR
 * ============================================================================
 *
 * Found in production after the 30 September fixes: "coaching - avery
 * testperson" opened the Coaching Form and asked for the employee, while
 * "coaching - Avery Testperson" did not — the separator branch returned no
 * subject at all, so only the capitalised-pair reader downstream ever saw the
 * name. Case was deciding, which is the one thing it may not do here.
 *
 * The separator is still where DETAILS start — "CA, she was late today",
 * "coaching - attendance" — so a name is read there only when the first clause
 * after it is nothing but a name: two or three name-shaped words, judged by
 * `couldBeName` exactly as every other position is, and not opening with an
 * "-ing" word ("coaching - wearing slippers" is what happened). A single word
 * after the separator is left alone: "coaching - footwear" and "coaching -
 * avery" look identical without capitals, and the second is asked for rather
 * than risk the first becoming somebody's employee.
 */
function nameAfterSeparator(after: string): string[] {
  const clause = after.split(/\s*(?:[,;:.!?]|\s[-–—]\s)/)[0] ?? "";
  const words = clause.split(" ").filter(Boolean).map((word) => word.replace(WRAPPING, ""));
  if (words.length < 2 || words.length > 3) return [];
  if (/ing$/i.test(words[0]!)) return [];
  return words.every((word) => couldBeName(word)) ? words : [];
}

/** Words that end a name and start what the sentence says about the person. */
const NAME_RUN_ENDS = new Set([
  "about", "regarding", "re", "on", "for", "because", "since", "who", "she", "he", "they",
  "today", "yesterday", "was", "is", "has", "had", "did", "and", "but", "at", "in", "with",
  "from", "to", "after", "before", "please",
]);

/**
 * ============================================================================
 * A QUESTION ABOUT A FORM IS NOT A REQUEST FOR ONE
 * ============================================================================
 *
 * "What is a coaching form?", "when should I use a demotion form?", "what
 * information is needed for a transfer form?", "how does a demotion work?"
 * name a form and ask ABOUT it; they belong to the knowledge base, for every
 * form. The test is a WH-question — what, how, when, why, which, who — in the
 * sentence that names the form.
 *
 * DELIBERATELY NARROW. "Where's the exit form?" is somebody looking for the
 * form and stays a request. "Do we have a coaching form?" and "is there a
 * transfer form?" are inventory questions, answered from the library before
 * this is consulted, and keep naming their template for that answer. "Should
 * we terminate Dan? Pull up the exit form for him." names the form in an
 * instruction, not in the question. And "Corrective action form — what do you
 * need from me?" LEADS with the form, so the question is about the intake.
 */
const WH_QUESTION = /^(?:so\s+|ok\s+|okay\s+|and\s+|but\s+)?(?:what|what's|whats|how|how's|when|why|which|who|whom|whose)\b/;

function askedAbout(q: string, phrase: string): boolean {
  const sentence = q.split(/(?<=[.!?])\s+|\n+/).find((part) => mentions(part, phrase));
  return sentence !== undefined && WH_QUESTION.test(sentence.trim());
}

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

/** Every whole-word occurrence of a phrase, as [start, end) offsets. */
function occurrences(haystack: string, phrase: string): [number, number][] {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...haystack.matchAll(new RegExp(`\\b${escaped}\\b`, "g"))].map((match) => [
    match.index!,
    match.index! + match[0].length,
  ]);
}

/** "not a", "instead of", "rather than" directly before a naming: the form NOT wanted. */
const NEGATED_BEFORE = /(?:\bnot|\bno|\binstead\s+of|\brather\s+than|\bisn'?t|\bnor)\s+(?:(?:a|an|the)\s+)?$/;

/** A naming in the position of what a form is ABOUT: "topic is policy review". */
const TOPIC_BEFORE =
  /(?:\btopics?(?:\s+(?:is|was|=))?\s*:?|\bsubject(?:\s+(?:is|was))?\s*:?|\breason(?:\s+(?:is|was))?\s*:?|\babout|\bregarding|\bre:?|\bconcerning|\bover)\s+(?:(?:a|an|the|her|his|their|our)\s+)?$/;

/** "Make it a …", "switch to …", "change it to …": the manager changing which form. */
const SWITCH_BEFORE =
  /(?:\bmake\s+(?:it|this|that)|\bswitch(?:\s+(?:it|this|that))?\s+to|\bchange\s+(?:it|this|that)\s+to|\binstead(?:\s+do)?|\bactually(?:\s+(?:do|use|want))?)\s+(?:(?:a|an|the)\s+)?$/;

/** A phrase mentioned at least once other than as the thing not wanted. */
function mentionsUnnegated(haystack: string, phrase: string): boolean {
  return occurrences(haystack, phrase).some(([start]) => !NEGATED_BEFORE.test(haystack.slice(0, start)));
}

/**
 * ============================================================================
 * WHICH FORM WAS ASKED FOR, AND WHICH ONE IS ONLY WHAT IT IS ABOUT
 * ============================================================================
 *
 * VERIFIED IN PRODUCTION QA, 30 September 2026:
 *
 *     "coaching form for Avery Testperson; topic is policy review"
 *          → a Policy Review, because the Policy Review entry sits above the
 *            Coaching entry and the first entry with any hit won.
 *
 * A sentence can name two forms and ask for one. So every naming is found
 * with its position, and the one ASKED FOR is settled before the rest of the
 * sentence is read as detail:
 *
 *   1. overlapping namings are one naming — "follow-up coaching form" is the
 *      follow-up form, never also "coaching form" (the list's order decides,
 *      as it always did);
 *   2. a naming the manager negated is not wanted — "coaching, not a policy
 *      review";
 *   3. a naming in a topic position is the topic — "topic is policy review",
 *      "about a policy review";
 *   4. a naming that modifies the word "coaching" is the coaching's topic —
 *      "a policy review coaching for Avery" is a Coaching Form;
 *   5. the form the message LEADS with is the request;
 *   6. otherwise the list's order, exactly as before.
 *
 * "Policy Review for Avery Testperson" names one form in a request position,
 * so it is still the standalone Policy Review.
 */
function requestedNaming(q: string, original: string): { key: string; phrase: string } | null {
  type Naming = { key: string; phrase: string; start: number; end: number; order: number };
  const found: Naming[] = [];
  TEMPLATE_INTENT.forEach((entry, order) => {
    for (const phrase of entry.matchers) {
      for (const [start, end] of occurrences(q, phrase)) found.push({ key: entry.key, phrase, start, end, order });
    }
  });
  if (found.length === 0) return null;

  // 1. Overlaps: the earlier list entry keeps the span.
  const spans = found
    .sort((a, b) => a.order - b.order || b.end - b.start - (a.end - a.start))
    .filter((naming, index, all) =>
      !all.slice(0, index).some((kept) => kept.order < naming.order && kept.start < naming.end && naming.start < kept.end),
    );

  // 2 and 3. Not wanted, and only the topic.
  const wanted = spans.filter((naming) => {
    const before = q.slice(0, naming.start);
    return !NEGATED_BEFORE.test(before) && !TOPIC_BEFORE.test(before);
  });
  if (wanted.length === 0) return null;

  // 4. "<form> coaching": the head noun is the coaching.
  for (const naming of wanted) {
    if (naming.key !== "coaching" && /^\s+coaching\b/.test(q.slice(naming.end)) && !/^\s+coaching\s+(?:follow[- ]?up)/.test(q.slice(naming.end))) {
      const coaching = wanted.find((other) => other.key === "coaching");
      return coaching ?? { key: "coaching", phrase: "coaching" };
    }
  }

  /*
   * 5. The form the message leads with — and a form named only in ITS details
   * is that form's topic: "coaching - policy review" is a Coaching Form about
   * a policy review, found in production beside "coaching - avery testperson".
   * A switch said out loud ("…, actually make it a policy review") still wins.
   */
  const leading = leadingFormRequest(original);
  if (leading) {
    const switched = wanted.find((naming) => SWITCH_BEFORE.test(q.slice(0, naming.start)));
    if (switched) return switched;
    const led = wanted.find((naming) => naming.key === leading.templateKey);
    if (led) return led;
    const head = FORM_HEADS.find((entry) => entry.key === leading.templateKey && mentions(q, entry.phrase));
    const headEnd = head ? (occurrences(q, head.phrase)[0]?.[1] ?? 0) : 0;
    if (head && wanted.every((naming) => naming.start >= headEnd)) {
      return { key: leading.templateKey, phrase: head.phrase };
    }
  }
  // 6. The list's order.
  return [...wanted].sort((a, b) => a.order - b.order || a.start - b.start)[0]!;
}

/**
 * The manager said they do NOT want a form: "I don't want an actual form yet",
 * "no form", "not a form yet", "never mind the form". Whole clause only — "not
 * a corrective action" names the form not wanted and is read by
 * `requestedNaming`.
 */
const DECLINES_FORM =
  /\b(?:(?:don'?t|do\s+not|doesn'?t|does\s+not|didn'?t)\s+(?:want|need)|not\s+(?:ready\s+for|looking\s+for)|no\s+need\s+for)\s+(?:(?:a|an|the|any)\s+)?(?:actual\s+|real\s+|official\s+)?(?:[a-z-]+\s+){0,2}?(?:form|forms|document|paperwork|write[- ]?up)\b|\bno\s+(?:actual\s+)?(?:form|forms|paperwork)\b|\bnot\s+(?:a|an)\s+(?:actual\s+)?form\b|\b(?:never\s*mind|forget)\s+(?:the|this|that)\s+form\b|\b(?:form|forms|paperwork)\s+not\s+yet\b/;

function declinesForm(q: string): boolean {
  return DECLINES_FORM.test(q);
}

/**
 * ============================================================================
 * "NEED A COACHING ON AVERY" — AND "COACH AVERY", WHICH IS NOT THE SAME
 * ============================================================================
 *
 * Production QA, 30 September 2026. Managers ask for the Coaching Form in the
 * words they use for the conversation itself, and every one of these came
 * back as advice ending "ask me to create a coaching form for …":
 *
 *   FORM       "need a coaching on Avery", "can you do coaching for Avery",
 *              "please document this as coaching", "I need a coaching on
 *              attendance". "A coaching" — the noun, with an article — is the
 *              record; "document this as coaching" says so outright.
 *
 *   ASK        "coach Avery", "I need to coach Avery", "Avery needs coaching".
 *              The verb means the conversation as often as the document, and a
 *              form on somebody's file is not a coin toss: Sunny asks one short
 *              question instead of choosing either.
 *
 *   ADVICE     a question, "coach me …", "how should I …", "tips", "guidance".
 *              Never a form, never a question back.
 */
const ADVICE_CUE =
  /\b(?:coach\s+(?:me|us)|how\s+(?:do|should|can|would|could)\s+(?:i|we)|what\s+should\s+(?:i|we)|tips?|advice|guidance|ideas?|help\s+me\s+(?:coach|figure|understand|prepare|plan|think|with))\b/;

const COACHING_NOUN_REQUEST =
  /\b(?:need|needs|want|wants|do|doing|make|start|create|write|write\s+up|document|file|log|record|get|pull\s+up|open|begin|put\s+together|fill\s+out|draft|prepare|set\s+up)\s+(?:me\s+)?(?:a|an|another|new|the)\s+(?:new\s+)?coaching\b(?!\s+(?:session|sessions|conversation|conversations|tips?|advice|guidance|ideas?|style|approach|techniques?|questions?|call|meeting|class|course|training|plan|skills?)\b)/;

/** "do coaching for Avery": the verb, the bare noun, and somebody it is for. */
const COACHING_FOR_PERSON = /\b(?:do|make|start|create|document|log|record|file|write\s+up|write)\s+coaching\s+(?:for|on|with)\s+(\S+)/;

/** "document this as coaching", "keep this as coaching". */
const AS_COACHING =
  /\b(?:document|documenting|log|record|file|write|put|keep|mark|treat|save|make)\s+(?:this|it|that|this\s+one)\s+(?:down\s+|up\s+)?as\s+(?:a\s+)?coaching\b/;

const COACH_A_PERSON =
  /^(?:(?:ok(?:ay)?|so|well|hey|hi)[,\s]+)?(?:i\s+|we\s+)?(?:(?:need|have|got|want|am\s+going|going|plan)\s+to\s+|gotta\s+|gonna\s+|should\s+|will\s+|must\s+|let'?s\s+)?coach\s+(\S+)/;

const PERSON_NEEDS_COACHING = /^(\S+)(?:\s+(\S+))?(?:\s+(\S+))?\s+(?:needs|need|requires|could\s+use|should\s+get)\s+(?:some\s+|more\s+)?coaching\b(?!\s+(?:form|document))/;

function coachingRequest(q: string): "form" | "clarify" | null {
  if (!/\bcoach(?:ing)?\b/.test(q)) return null;
  // "Can you do a coaching on Avery?" is a request phrased politely, as in `employmentChangeIntent`.
  const polite = /^(?:please\s+)?(?:can|could|would|will)\s+you\b/.test(q);
  if (((QUESTION_START.test(q) || /\?\s*$/.test(q)) && !polite) || ADVICE_CUE.test(q)) return null;
  if (COACHING_NOUN_REQUEST.test(q) || AS_COACHING.test(q)) return "form";
  const forPerson = COACHING_FOR_PERSON.exec(q);
  if (forPerson && couldBeName(forPerson[1])) return "form";
  const coached = COACH_A_PERSON.exec(q);
  if (coached && couldBeName(coached[1])) return "clarify";
  const needs = PERSON_NEEDS_COACHING.exec(q);
  if (needs && [needs[1], needs[2], needs[3]].filter(Boolean).every((word) => couldBeName(word))) return "clarify";
  return null;
}

/**
 * ============================================================================
 * ASKING ABOUT FORMS IS NOT ASKING FOR ONE — WHETHER OR NOT IT SAYS "WHAT"
 * ============================================================================
 *
 * LIVE, 29 September 2026: "what's the difference between corrective action
 * and coaching form" was answered, and "difference between corrective action
 * and coaching form" opened a Coaching Form. The only question test was
 * `askedAbout`, which needs the sentence to OPEN with what/how/when/why…, so
 * dropping the "what" turned a comparison into a request — for whichever form
 * happened to be written out in full.
 *
 * WHAT MARKS A MESSAGE AS A QUESTION ABOUT FORMS, read as a manager means it:
 *
 *   comparing them       difference(s) between, differ, vs, versus, compare,
 *                        compared to/with, instead of, rather than, or — when
 *                        two forms are named
 *   asking for an        explain, describe, define, clarify, tell me about,
 *   explanation          help me understand, what's/what is, meaning/purpose
 *   asking when/which    when do/should/would/can I use, which form/one, used
 *                        for — and what/when/why/which/how ANYWHERE in the
 *                        sentence naming the form, not only at its start
 *   a question mark      with no person named
 *
 * AND WHAT STILL MAKES IT A REQUEST, whatever else it says: somebody it is
 * for ("CA for Paulyne Test", "coaching form for Jane"), or a message that
 * opens with making one ("create…", "make…", "start…", "open…", "draft…").
 * Shorthand creation therefore keeps working — it names a person — and no
 * request needs a verb.
 */
const COMPARISON_CUE = /\b(?:differences?\s+between|difference|differ(?:s|ent|ence)?|vs\.?|versus|compare[sd]?|comparing|comparison|compared\s+(?:to|with)|instead\s+of|rather\s+than)\b/;
const EXPLANATION_CUE = /^(?:please\s+)?(?:(?:can|could|would)\s+you\s+)?(?:explain|describe|define|clarify|tell\s+me\s+(?:about|more\s+about|what|when|why|how|which)|help\s+me\s+understand|what(?:'s|s|\s+is|\s+are)|meaning\s+of|purpose\s+of|overview\s+of)\b/;
const USAGE_CUE = /\b(?:when\s+(?:do|should|would|can|could|to|is|are)\b|which\s+(?:form|forms|one|document)\b|used?\s+for\b|use\s+(?:it|one|them)\b)/;
const WH_ANYWHERE = /\b(?:what|what's|whats|how|when|why|which)\b/;
const OPENS_WITH_MAKING = /^(?:please\s+)?(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?)?(?:create|make|start|draft|open|begin|prepare|generate|fill\s+out|fill\s+in|write\s+(?:up|her\s+up|him\s+up|them\s+up)|do\s+(?:a|an)|i\s+need\s+(?:a|an|to\s+(?:do|write|create|make|start))|we\s+need\s+(?:a|an|to))\b/;

/** How many different forms a sentence names: comparing needs two. */
function formsNamed(q: string): number {
  const keys = new Set<string>();
  for (const entry of TEMPLATE_INTENT) if (entry.matchers.some((phrase) => mentions(q, phrase))) keys.add(entry.key);
  if (CORRECTIVE_ACTION_REQUEST.some((phrase) => mentions(q, phrase))) keys.add("dpoa");
  if (/\bcoach(?:ing)?\b/.test(q)) keys.add("coaching");
  if (/\bexit\b/.test(q)) keys.add("stc-exit");
  return keys.size;
}

/** Somebody the form is for, or a message that opens with making one. */
function requestsCreation(q: string, original: string): boolean {
  if (OPENS_WITH_MAKING.test(q)) return true;
  /*
   * "General training for staff about bed sanitizing — can you write up a
   * coaching form?" has the team as its subject and asks for the form; the
   * closing question mark is politeness. See `asksForTeamCoaching`.
   */
  if (asksForTeamCoaching(original)) return true;
  const leading = leadingFormRequest(original);
  if (leading && leading.subject.length > 0) return true;
  /*
   * "…for paulyne test" / "…for Paulyne Test": somebody the form is for — a
   * word after "for" that can be a name (see `couldBeName`), judged the same
   * in any case. "for attendance", "for policy violations" are what a form is
   * ABOUT and are not names.
   */
  return [...q.matchAll(/\bfor\s+(\S+)/g)].some((match) => couldBeName(match[1]));
}

/**
 * True when a message asks ABOUT forms — see the note above. Exported for the
 * routing tests; `detectTemplateIntent` is its only production caller.
 */
export function asksAboutForms(question: string): boolean {
  const original = canonicalShorthand((question ?? "").replace(/\s+/g, " ").trim());
  const q = canonicalCorrectiveAction(normalize(original));
  if (requestsCreation(q, original)) return false;
  // "CA — what do you need from me?" asks for the intake, not about the form.
  if (/\bwhat\s+(?:do|would)\s+you\s+need\b/.test(q)) return false;
  if (COMPARISON_CUE.test(q)) return true;
  if (/\bor\b/.test(q) && formsNamed(q) >= 2) return true;
  if (EXPLANATION_CUE.test(q) || USAGE_CUE.test(q)) return true;
  const naming = q.split(/(?<=[.!?])\s+|\n+/).find((part) => formsNamed(part) > 0) ?? q;
  if (WH_ANYWHERE.test(naming)) return true;
  /*
   * "Do we have a coaching form?" / "is there an exit form?" are INVENTORY
   * questions: the library answers them, and it needs the form they name to
   * say "yes, here it is". They keep naming it.
   */
  if (EXISTENCE_QUESTION.test(q)) return false;
  /* A question with nobody named: `requestsCreation` above has already ruled a person out. */
  return /\?\s*$/.test(q);
}

const EXISTENCE_QUESTION = /^(?:so\s+|and\s+)?(?:(?:do|does|did)\s+(?:we|you|i|they|ask sunny)\s+(?:have|offer|keep|use)|(?:is|are)\s+there|have\s+(?:we|you)\s+got|(?:can|could)\s+(?:i|we)\s+(?:find|get))\b/;

export function detectTemplateIntent(question: string): TemplateIntent {
  const q = canonicalFormWording(normalize(question));
  /* A question about forms — compared, explained, or when to use one — is answered, never opened. */
  const informational = asksAboutForms(question);

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
  /*
   * A QUESTION ABOUT A NAMED FORM goes to the knowledge base, for every form —
   * see `askedAbout`. The Corrective Action Form's keeps its own answer: a
   * question about the progression.
   */
  /*
   * "I DON'T WANT A FORM YET" IS NOT A REQUEST FOR ONE, whichever form it names.
   * Found in production QA beside the advice controls: "I don't want a
   * coaching form yet" opened a Coaching Form, because the naming was read and
   * the negation around it was not.
   */
  if (declinesForm(q)) return { kind: "none" };

  const requested = requestedNaming(q, question);
  if (requested) {
    if (informational || askedAbout(q, requested.phrase)) {
      return requested.key === "dpoa"
        ? { kind: "corrective_action", requestedCreation: false }
        : { kind: "none" };
    }
    return { kind: "explicit", templateKey: requested.key };
  }

  /*
   * THE FORM'S NAME, LEADING THE MESSAGE — "Coaching for paulyne co", "Exit
   * John Doe", "CA". See `leadingFormRequest`.
   */
  const leading = informational ? null : leadingFormRequest(question);
  if (leading) return { kind: "explicit", templateKey: leading.templateKey };

  /*
   * "CA", "Corrective Action", "new corrective action" — the form's name and
   * nothing else. See `NAME_ONLY`.
   */
  if (!informational && namesOnlyTheForm(q)) return { kind: "explicit", templateKey: "dpoa" };

  /*
   * THE NAME OF THE PROGRESSION, with no document named alongside it — and not
   * negated: "document this as coaching, not CA, for Avery" names what the
   * manager does NOT want, and is read by the coaching rules below.
   */
  if (CORRECTIVE_ACTION_REQUEST.some((phrase) => mentionsUnnegated(q, phrase))) {
    return {
      kind: "corrective_action",
      // Whole words, like every other match here: `includes` would read
      // "there are issues with corrective action" as a request to issue one.
      requestedCreation:
        !informational &&
        (CREATION_VERBS.some((verb) => mentions(q, verb)) ||
          leadsWithTheForm(q, question) ||
          /*
           * "corrective action for employee test for attendance": a subject, then
           * a reason. A topic alone ("corrective action for repeated lateness")
           * has no second clause and stays a question.
           */
          /^(?:please\s+)?(?:a\s+|new\s+)?corrective actions?(?:\s+form)?\s+for\s+\S+(?:\s+\S+){0,3}?\s+(?:for|about|regarding|because)\s+\S/.test(q)),
    };
  }
  if (informational) return { kind: "none" };

  /*
   * THE CHANGE ITSELF, where the sentence asks for it or states it. See
   * `employmentChangeIntent` for why a subject word alone is not enough.
   */
  const change = employmentChangeIntent(q);
  if (change) return { kind: "explicit", templateKey: change };

  // "coach"/"coaching" on its own, in a sentence that is plainly asking for a
  // document rather than for advice. "How do I coach someone on tardiness?" is
  // a question for the knowledge base and must stay one.
  if (/\bcoach(ing|ed)?\b/.test(q) && /\b(form|document|write up|write-up)\b/.test(q)) {
    return { kind: "explicit", templateKey: "coaching" };
  }

  /* "Need a coaching on Avery", "document this as coaching", "coach Avery". */
  const coaching = coachingRequest(q);
  if (coaching === "form") return { kind: "explicit", templateKey: "coaching" };
  if (coaching === "clarify") return { kind: "clarify", templateKey: "coaching" };

  /*
   * "I need team-wide coaching about bed sanitizing", "Coaching for everyone
   * at the salon about …": coaching whose subject is the team, asked for. The
   * proposal then reads the team as the subject. See `asksForTeamCoaching`.
   */
  if (asksForTeamCoaching(question)) return { kind: "explicit", templateKey: "coaching" };

  /*
   * THE FAMILY, BEFORE THE GENERIC LIST. "I need a form for an employee
   * performance plan" hits both, and the family is the more specific reading —
   * it is the one a caller can actually resolve.
   */
  if (EPP_FAMILY_REQUEST.some((phrase) => mentions(q, phrase))) {
    return { kind: "ambiguous", family: "epp" };
  }

  if (AMBIGUOUS_FORM_REQUEST.some((phrase) => mentions(q, phrase))) {
    return { kind: "ambiguous" };
  }

  return { kind: "none" };
}

/**
 * ============================================================================
 * WHICH PERFORMANCE PLAN, FROM THE ROLE THE MANAGER ALREADY STATED
 * ============================================================================
 *
 * "Jessica is an SDIT at Lincoln South... make an EPP for her" names the
 * document as precisely as "SDIT EPP" does — it just spreads the naming over
 * two sentences. Answering it with a picker is the assistant forgetting a
 * sentence the manager can still see on screen.
 *
 * THIS IS NOT THE FORBIDDEN DEFAULT, and the difference is total: nothing is
 * guessed. The role comes from the MANAGER'S OWN WORDS, each token maps to
 * exactly one published plan, and a conversation that names no role — or names
 * two — resolves to nothing and the manager is asked. The key it returns is
 * still revalidated against the published library and the actor's permission
 * like any other.
 *
 * ============================================================================
 * THE TOKENS THAT ARE DELIBERATELY ABSENT
 * ============================================================================
 *
 *   DMIT   is TWO documents — the TSD reading and the DMIT reading of one
 *          plan — so the role does not settle the form and asking is the
 *          honest answer.
 *
 *   ASD    appears as the SUBJECT of both the SDIT EPP and the ASD-SDIT
 *          Performance EPP. A manager saying "she's an ASD" has not chosen
 *          between them.
 *
 *   TC     could be the FTTC plan or a part-time consultant with no plan of
 *          their own. "FTTC" is unambiguous and is here; "TC" is not and
 *          is not.
 */
const EPP_ROLE_TEMPLATES: { key: string; roles: string[] }[] = [
  {
    key: "sdit-epp",
    roles: ["sdit", "salon director in training", "salon director-in-training"],
  },
  { key: "tsd-epp", roles: ["tsd", "training salon director"] },
  { key: "fttc-epp", roles: ["fttc", "full time tanning consultant", "full-time tanning consultant"] },
];

/**
 * The performance plan the stated role names, or null.
 *
 * AMBIGUITY IS REFUSED RATHER THAN BROKEN. A conversation that mentions an
 * SDIT and a TSD has named two plans, and picking the first would put the
 * wrong document on somebody's file — so it returns null and the manager
 * chooses, which is one click.
 */
export function eppTemplateForRole(text: string): string | null {
  const q = normalize(text);
  const matched = EPP_ROLE_TEMPLATES.filter((entry) =>
    entry.roles.some((role) => mentions(q, role)),
  );
  return matched.length === 1 ? matched[0]!.key : null;
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
  /*
   * THE EXIT FORM'S OWN WORDING, which managers capitalise when they quote it:
   * "she was a No Call No Show", "Submitted & Fulfilled Notice", "Immediate
   * Voluntary Resignation". Read as a capitalised pair, each of those was a
   * second "employee" beside the real one.
   */
  "immediate", "voluntary", "involuntary", "notice", "fulfilled", "call", "show",
  "ncns", "rehire", "payroll", "worked",
  // The employment change forms' names, which are never anybody's name.
  "demotion", "transfer", "position", "resignation", "exit", "separation",
  "termination", "paperwork", "salons", "locations", "stores",
  /*
   * Titles and statuses as managers abbreviate them. "She's a FT SD at $18/hr"
   * put "FT SD" forward as a second employee, because two capitals read as a
   * first name and a surname.
   */
  "ft", "pt", "sd", "tc", "dm", "stc", "rm",
  // "I need a CA for Dana Moss": the shorthand for the Corrective Action Form.
  "ca",
];

export const FORM_VOCABULARY: ReadonlySet<string> = new Set(
  [
    ...TEMPLATE_INTENT.flatMap((entry) => entry.matchers),
    ...AMBIGUOUS_FORM_REQUEST,
    ...EPP_FAMILY_REQUEST,
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
