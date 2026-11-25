import { withoutMessageIdTags } from "./evidence";

/*
 * ============================================================================
 * A FORM THE LIBRARY DOES NOT HAVE: THE REPLY SAYS WHICH FORMS IT DOES HAVE
 * ============================================================================
 *
 * QA, live on the agent loop, 24 Nov 2026: "Draft a vacation request form" was answered honestly ("There's no
 * \"Vacation Request Form\" in the forms library — PTO requests … run through <the staff app> directly …") but never said
 * which forms the manager can create. #1282 (board f099) lists them only when the model calls propose_form with
 * form_asked_evidence whose quote holds the library's title word ("form"): a request without that word ("draft a PTO
 * request") or a reply in text with no tool call never got the list.
 *
 * Read by code from the manager's words and the library's own template names, never a list of form kinds: a create verb
 * with an object that ends in a document word ("… form", "… request", "… letter", …) and has words of its own before it
 * ("vacation request", not "a request"), when no library form answers to any such object (`quoteNamesForm`). A turn
 * that asks for a library form anywhere ("create a coaching form, she missed her vacation request") is left alone.
 */

/** A verb that asks for a document to be made. */
const CREATE = String.raw`(?:create|make|draft|write|start|prepare|generate|fill\s+out|fill|do|open|need|want|get|give|send|draw\s+up|put\s+together)`;
/** The word a document's name ends with. */
const DOCUMENT_WORD = String.raw`(?:forms?|requests?|documents?|docs?|letters?|notices?|templates?|applications?|slips?|waivers?|agreements?)`;
/** Words that say nothing about which document: articles, pronouns, "new". */
const EMPTY_WORDS = new Set(["a", "an", "the", "another", "new", "me", "us", "my", "our", "her", "his", "their", "him", "them", "this", "that", "one", "some", "blank"]);

/** Where an ask to make it starts: a clause's head, or after "you", "I", "please", "help me", "need to". */
const LEAD = String.raw`(?:^|[.!?,;:\n]\s*|\b(?:you|u|i|we|please|pls|me|us|let'?s|(?:need|want|have|like)\s+to)\s+)`;

const ASKED = new RegExp(String.raw`${LEAD}${CREATE}\s+((?:[\p{L}\p{N}'/-]+\s+){0,6}?${DOCUMENT_WORD}(?:\s+${DOCUMENT_WORD})?)\b`, "giu");

/** The document the manager asked for, without its leading articles ("vacation request form"); null when none has a name of its own. */
function namedDocuments(question: string): string[] {
  const said = withoutMessageIdTags(question);
  const found: string[] = [];
  for (const match of said.matchAll(ASKED)) {
    const words = match[1]!.trim().split(/\s+/);
    while (words.length > 1 && EMPTY_WORDS.has(words[0]!.toLowerCase())) words.shift();
    if (words.length < 2) continue;
    found.push(words.join(" "));
  }
  return found;
}

/**
 * The document the manager asked for this turn that no library form answers to, or null. `namesForm` is the loop's
 * `quoteNamesForm`, so a form's name, short name or initials count ("coaching document" is the Coaching Form).
 */
export function formAskedOutsideLibrary<T>(question: string, templates: readonly T[], namesForm: (text: string, template: T) => boolean): string | null {
  const asked = namedDocuments(question);
  if (asked.length === 0 || templates.length === 0) return null;
  if (asked.some((phrase) => templates.some((template) => namesForm(phrase, template)))) return null;
  return asked[0]!;
}

/** "The forms you can create are A, B and C." */
export function formsYouCanCreate(names: readonly string[]): string {
  return `The forms you can create are ${names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0]}.`;
}

/** The reply already says there is no such form ("There's no … form", "isn't in the forms library", "not a form …"). */
const SAYS_NO_SUCH_FORM = /\b(?:there'?s|there\s+is|we\s+have|i\s+have)\s+no\b[^.!?\n]{0,80}\b(?:forms?|library)\b|\b(?:isn'?t|is\s+not|not)\s+(?:a\s+form|in\s+the\s+forms?\s+library|one\s+of\s+the\s+forms)|\b(?:don'?t|do\s+not|doesn'?t|does\s+not)\s+have\s+(?:a|an|any)\b[^.!?\n]{0,60}\bforms?\b|\bno\s+such\s+form\b/i;

/** Whether the reply says there is no such form. */
export function saysNoSuchForm(reply: string): boolean {
  return SAYS_NO_SUCH_FORM.test(reply);
}

/**
 * The reply with the library's forms named, when it does not name them already: "The forms you can create are …" after
 * the reply's own "no such form" line, else one short line that says there is no such form and lists them.
 */
export function withLibraryForms(reply: string, asked: string, names: readonly string[]): string {
  if (names.length === 0) return reply;
  const flat = reply.toLowerCase();
  const listed = names.filter((name) => flat.includes(name.toLowerCase())).length;
  if (/the forms you can create are/i.test(reply) || listed * 2 > names.length) return reply;
  const named = /\bforms?$/i.test(asked) ? asked : `${asked} form`;
  const line = SAYS_NO_SUCH_FORM.test(reply) ? formsYouCanCreate(names) : `There's no ${named} in the forms library. ${formsYouCanCreate(names)}`;
  return reply.trim() ? `${reply.trim()}\n\n${line}` : line;
}
