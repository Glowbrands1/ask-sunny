import { detectTemplateIntent } from "./template-intent";

/**
 * ============================================================================
 * "DELETE THAT DRAFT", "SAME INCIDENT" — TWO ANSWERS ABOUT A DRAFT
 * ============================================================================
 *
 * QA, 21–22 Oct 2026 (F8). Two short turns about a draft were not read:
 *
 *   "delete that draft", right after a finalized Corrective Action Form was
 *   opened as a new draft, was sent to the revision path and answered "I
 *   haven't changed the Corrective Action Form…".
 *
 *   "same incideny" (sic), answering "is this the same incident or a new
 *   one?" about a draft already on file, was answered with a phrase to type
 *   ("say 'edit the corrective action form for …'") instead of the draft.
 *
 * PURE: no I/O, no identity. These only say what the manager asked for; the
 * form is found, authorized and changed by `chat-draft-actions.ts`. Used only
 * when DRAFT_ACTIONS_ENABLED is on.
 */

const LEAD =
  String.raw`^(?:(?:ok(?:ay)?|actually|never\s*mind|nvm|no|nope|yes|yeah|so|then|hmm+|um+|well)[\s,.!-]+)*` +
  String.raw`(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?|please\s+|pls\s+|just\s+|go\s+ahead\s+and\s+|i\s+(?:want|need)\s+(?:you\s+)?to\s+|let'?s\s+)*`;
const TAIL = String.raw`(?:\s+(?:please|pls|then|now|instead|for\s+me|too|thanks|thank\s+you))*\s*[.!]*\s*$`;
const VERB = String.raw`(?:delete|discard|scrap|trash|erase|toss|remove|cancel|get\s+rid\s+of)`;
const NOUN = String.raw`(?:(?:that|the|this|my|her|his|their|your|new)\s+)*(?:new\s+)?(?:draft|revision|form|one|copy)`;
const PRONOUN = String.raw`(?:it|that|this)`;

const VERB_NOUN = new RegExp(`${LEAD}${VERB}\\s+${NOUN}${TAIL}`, "i");
const THROW_NOUN = new RegExp(`${LEAD}throw\\s+${NOUN}\\s+(?:away|out)${TAIL}`, "i");
/* A bare pronoun only with verbs that cannot mean "take this text off the form". */
const VERB_PRONOUN = new RegExp(`${LEAD}(?:delete|discard|scrap|trash|toss|get\\s+rid\\s+of)\\s+${PRONOUN}${TAIL}`, "i");
const THROW_PRONOUN = new RegExp(`${LEAD}throw\\s+${PRONOUN}\\s+(?:away|out)${TAIL}`, "i");

/**
 * "delete that draft", "delete the draft", "discard it": the whole message
 * asks for the form on screen to be thrown away. A pronoun ("discard it")
 * counts only when the previous answer was about a draft, so "delete it"
 * after a question about a sentence on the form is not read as this.
 */
export function readDraftDelete(question: string, previousAnswer: string | null | undefined): boolean {
  const text = (question ?? "").replace(/\s+/g, " ").trim();
  if (text === "" || text.length > 120) return false;
  if (VERB_NOUN.test(text) || THROW_NOUN.test(text)) return true;
  if (VERB_PRONOUN.test(text) || THROW_PRONOUN.test(text)) return /\bdraft\b/i.test(previousAnswer ?? "");
  return false;
}

/* "incident", and how it is mistyped: "incideny", "incidnet", "incedent". */
const INCIDENT = String.raw`(?:in[cs]i?d\w*|inc[ie]d\w*|insid\w*|incd\w*)`;
const ONE = String.raw`(?:${INCIDENT}|one|thing|issue|event|day|time|situation|occurrence)`;
const SAME = new RegExp(
  String.raw`^(?:(?:yes|yeah|yep|yup|correct|right)[\s,.!-]+)?(?:(?:it'?s|it\s+is|this\s+is|that'?s|its)\s+)?(?:the\s+)?same(?:\s+${ONE})?(?:\s+as\s+(?:before|the\s+draft|that\s+one))?\s*[.!]*\s*$`,
  "i",
);
const DIFFERENT = new RegExp(
  String.raw`^(?:(?:no|nope|nah)[\s,.!-]+)?(?:(?:it'?s|it\s+is|this\s+is|that'?s|its)\s+)?(?:a\s+)?(?:different|new|separate|another|second)(?:\s+${ONE})\s*[.!]*\s*$`,
  "i",
);

/** "same incident" / "same incideny" → same; "different incident" / "a new one" → different. */
export function readIncidentAnswer(question: string): "same" | "different" | null {
  const text = (question ?? "").replace(/\s+/g, " ").trim();
  if (text === "" || text.length > 80) return null;
  if (SAME.test(text)) return "same";
  if (DIFFERENT.test(text)) return "different";
  return null;
}

export interface IncidentQuestion {
  /** The form as the answer named it, shortest wording the form reader still knows. */
  formPhrase: string;
  templateKey: string;
  employeeName: string;
}

const ASKED_SAME_INCIDENT = /\bsame\s+incident\b/i;
const OFFERED_OTHER = /\b(?:new|different|separate|another)\s+(?:incident|one)\b|\?/i;
const FORM_FOR =
  /((?:[A-Za-z][\w/'’-]*\s+){0,4}(?:[Ff]orm|[Ww]arning|[Pp]lan|[Rr]eview|CA|EPP))\s+for\s+([A-Z][A-Za-z'’-]+(?:\s+[A-Z][A-Za-z'’-]+){1,2})/g;

/**
 * Whether the previous answer asked "is this the same incident as the
 * <form> for <name>, or a new one?", and which form and person it named.
 * The first form-for-a-person the answer names is the one on file it asked
 * about. Null when it asked no such thing.
 */
export function incidentQuestionAsked(previousAnswer: string | null | undefined): IncidentQuestion | null {
  const text = (previousAnswer ?? "").replace(/\*\*|__|[“”"]/g, "").replace(/\s+/g, " ");
  if (!ASKED_SAME_INCIDENT.test(text) || !OFFERED_OTHER.test(text)) return null;
  for (const match of text.matchAll(FORM_FOR)) {
    const words = match[1]!.trim().split(/\s+/);
    for (let start = words.length - 1; start >= 0; start -= 1) {
      const phrase = words.slice(start).join(" ");
      const intent = detectTemplateIntent(`the ${phrase}`);
      if (intent.kind === "explicit") {
        return { formPhrase: phrase, templateKey: intent.templateKey, employeeName: match[2]!.trim() };
      }
    }
  }
  return null;
}

/**
 * Any manager turn in a create payload that answered "a different incident"
 * to that question. The create route then files a new draft rather than
 * reopening the open one for the same person and form.
 */
export function historySaysDifferentIncident(conversation: unknown): boolean {
  if (!Array.isArray(conversation)) return false;
  let asked = false;
  for (const turn of conversation) {
    if (!turn || typeof turn !== "object") continue;
    const row = turn as { role?: unknown; content?: unknown };
    const content = typeof row.content === "string" ? row.content : "";
    if (row.role === "assistant") asked = incidentQuestionAsked(content) !== null;
    else if (row.role === "user" && asked && readIncidentAnswer(content) === "different") return true;
  }
  return false;
}
