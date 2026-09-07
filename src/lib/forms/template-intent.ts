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
    key: "dpoa",
    matchers: [
      "dpoa",
      "disciplinary plan",
      "disciplinary form",
      "disciplinary action",
      "corrective action",
      "written warning",
    ],
  },
  { key: "policy-review", matchers: ["policy review"] },
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
];

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

  for (const entry of TEMPLATE_INTENT) {
    if (entry.matchers.some((matcher) => mentions(q, matcher))) {
      return { kind: "explicit", templateKey: entry.key };
    }
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
