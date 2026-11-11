/**
 * ============================================================================
 * RETRIEVED SOURCES ARE NOT SOMETHING THE MANAGER SHARED
 * ============================================================================
 *
 * Ported from Ask Bubbles (production, 25 Oct 2026). The manager gave the
 * employee's location; the reply said "the sources you just shared are all
 * …" about unrelated pages. The manager shared nothing. The
 * excerpts are what this app retrieved from the company knowledge base, and
 * they reach the model in the same user message as the question — so,
 * unlabelled, they read as something the manager pasted.
 *
 * Two parts:
 *
 *   THE RULE      in the system prompt and at the head of the grounding
 *                 block: retrieved sources are the app's own reference
 *                 material, never something the manager shared, sent, pasted
 *                 or provided.
 *   THE BACKSTOP  a reply that still says "the sources you shared / sent /
 *                 provided" has that clause rewritten to "the sources I
 *                 found". Only that clause; every other word is kept. Only
 *                 when the manager's turns carry no paste, so a reply about
 *                 text the manager really did paste is left alone.
 */

/** The system-prompt rule. */
export const RETRIEVED_NOT_SHARED_RULE =
  '- The sources in COMPANY KNOWLEDGE are reference material this app retrieved from the company knowledge base for this question. They are never something the manager shared, sent, pasted or provided, and the manager has not seen them. Never call them "the sources you shared", "the documents you sent" or "what you provided"; call them the company knowledge base, or the sources available to you. If they do not fit the question, say the knowledge base did not return anything on it.';

/** The line at the head of the grounding block, beside the excerpts themselves. */
export const RETRIEVED_NOT_SHARED_NOTE =
  'These excerpts were retrieved by this app from the company knowledge base. They are never something the manager shared, sent, pasted or provided, and the manager has not seen them: never call them "the sources you shared".';

const SOURCE_NOUN = String.raw`(?:sources?|documents?|docs|excerpts?|materials?|files?|pages?|passages?|results?|references?|articles?|guides?|manuals?|links?)`;
const SHARED_VERB = String.raw`(?:shared|sent|provided|gave(?:\s+me)?|given(?:\s+me)?|attached|pasted|uploaded|forwarded|supplied|showed\s+me|shown\s+me)`;

/** "the sources you just shared", "these documents you've sent me", "the excerpts that you provided" */
const SHARED_SOURCES = new RegExp(
  String.raw`\b(the|these|those|all\s+the|all\s+of\s+the)(\s+(?:\w+\s+){0,2}?)(${SOURCE_NOUN})\s+(?:that\s+|which\s+)?you(?:'ve|\s+have|\s+had)?\s+(?:just\s+|already\s+|now\s+)?${SHARED_VERB}(?:\s+(?:with\s+)?me)?\b`,
  "gi",
);

/** "the sources shared by you" */
const SHARED_BY_YOU = new RegExp(
  String.raw`\b(the|these|those)(\s+(?:\w+\s+){0,2}?)(${SOURCE_NOUN})\s+(?:just\s+)?${SHARED_VERB}\s+by\s+you\b`,
  "gi",
);

/** "your sources", "the sources from you" */
const YOUR_SOURCES = new RegExp(String.raw`\byour\s+(sources|excerpts)\b`, "gi");

export interface SharedSourceTurn {
  readonly role: string;
  readonly content: string;
}

/**
 * Whether the manager's own turns carry a paste: a long turn, a turn of
 * several lines, a quoted block, or words saying something is attached or
 * pasted. Chat has no attachment system of its own (`attachedDocumentIds` is
 * always empty), so pasted text is the one way a manager can share a source.
 */
export function managerPastedSomething(input: {
  readonly question: string;
  readonly history: readonly SharedSourceTurn[];
  readonly attachedDocumentIds?: readonly string[] | null;
}): boolean {
  if ((input.attachedDocumentIds?.length ?? 0) > 0) return true;
  const turns = [...input.history.filter((turn) => turn.role === "user").map((turn) => turn.content), input.question];
  return turns.some((text) => {
    const body = (text ?? "").trim();
    if (body.length >= 400) return true;
    if (body.split("\n").filter((line) => line.trim() !== "").length >= 3) return true;
    if (/```|^\s*>/m.test(body)) return true;
    return /\b(?:attached|attaching|pasted|pasting|copied\s+(?:in|below)|see\s+below|below\s+is|here(?:'s|\s+is)\s+(?:the|a|an|what|her|his|their)\s+(?:text|email|message|note|notes|log|policy|document|wording|screenshot|write-?up))\b/i.test(
      body,
    );
  });
}

export interface SharedSourceCheck {
  readonly content: string;
  readonly changed: boolean;
}

/**
 * The backstop. Rewrites "the sources you just shared" to "the sources I
 * found" — the same noun, so the sentence still reads — when the manager
 * pasted nothing. Leaves the reply alone otherwise.
 */
export function withoutSharedSourceClaims(
  content: string,
  input: {
    readonly question: string;
    readonly history: readonly SharedSourceTurn[];
    readonly attachedDocumentIds?: readonly string[] | null;
  },
): SharedSourceCheck {
  if (!content || managerPastedSomething(input)) return { content, changed: false };
  const rewritten = content
    .replace(SHARED_SOURCES, (_match, determiner: string, between: string, noun: string) => `${determiner}${between}${noun} I found`)
    .replace(SHARED_BY_YOU, (_match, determiner: string, between: string, noun: string) => `${determiner}${between}${noun} I found`)
    .replace(YOUR_SOURCES, (match: string, noun: string) => `${match.startsWith("Y") ? "The" : "the"} ${noun} I found`);
  return { content: rewritten, changed: rewritten !== content };
}
