import { extractEmployeeNames, samePerson } from "@/lib/forms/proposal";
import type { ChatMessage } from "@/types";

/**
 * ============================================================================
 * WHAT THE MANAGER SAID FOR THE OPEN COACHING FORM, IN PLAIN WORDS
 * ============================================================================
 *
 * FORM_EDIT_PLAIN_WORDS_ENABLED (QA, 30 Oct 2026; same flag in both apps). With
 * a Coaching Form draft open, managers gave its details in plain words ("this
 * is what i am wanting to coach on: …"), said "make that update" after a reply
 * that printed the Details, or asked to "upate the draft with these details of
 * coaching" — the bot's own previous answer. None of those reads as a revision
 * (an edit verb and a word pointing at the form), so nothing was written while
 * the answer said it was.
 *
 * Each of these is turned into the sentence the revision does read — "Add this
 * to the Details of Coaching: <the words>" — so the open draft is revised by
 * the same path, with the same rules, as "add that she was late". A question
 * stays a question. Null for anything else.
 */

/** The manager hands over what the coaching is about. */
const STATED =
  /\b(?:what\s+i(?:'m|\s+am)?\s+(?:want(?:ing)?|trying|going|need(?:ing)?)\s+to\s+coach\s+(?:on|about)|i\s+(?:want|need)\s+to\s+coach\s+(?:on|about)|here\s+(?:are|is)\s+the\s+details|the\s+details\s+of\s+the\s+process)\b/i;

/** "make that update", "apply those changes", "go ahead and add it". */
/*
 * The WHOLE turn, anchored at both ends (independent review, 31 Oct 2026): "Add
 * the details that she clocked out early on 10/20" gives its own details and
 * is not "make that update" about the previous answer.
 */
const MAKE_THAT =
  /^(?:ok(?:ay)?[,.]?\s+|yes[,.]?\s+|please\s+)?(?:make|apply|do|save|put\s+in|add)\s+(?:that|those|the|these|this)\s+(?:update|updates|change|changes|edit|edits|details)(?:\s+(?:to|on|in(?:to)?)\s+(?:the\s+)?(?:draft|form|card))?(?:\s+please)?\s*[.!]*$|^(?:ok(?:ay)?[,.]?\s+)?go\s+ahead(?:\s+and\s+(?:add|update|apply)\s+(?:it|that|them))?\s*[.!]*$/i;

/** "update the draft with these details" — any spelling of update the managers type. */
/*
 * Real verbs only (independent review, 31 Oct 2026): the optional letters of
 * "u?p?d?ate" also matched "date" and "ate", so "What's the date on the form
 * for these details?" became an edit with the previous answer.
 */
const WITH_THESE =
  /\b(?:update|upate|udpate|updte|updat|add|put|fill)\b[^.?!]*\b(?:draft|form|card)\b[^.?!]*\b(?:these|those|that|the\s+above)\s+details\b/i;

const NOT_A_REQUEST: Readonly<Record<string, string>> = {
  start: "begin",
  starts: "begins",
  started: "began",
  starting: "beginning",
  create: "make",
  creates: "makes",
  created: "made",
  creating: "making",
};

/*
 * A STATEMENT OF WHAT THE EMPLOYEE DID — NOT A QUESTION OR AN ERRAND
 * (independent review, 31 Oct 2026): "Marnie was late 3 times this week what
 * should I put for the policy" and "Marnie needs to sign this before Friday,
 * remind me" were written into the Details. A question word or an ask anywhere
 * keeps it a question; an account says what happened, in the past tense.
 */
const ASKS_SOMETHING =
  /\b(?:what|how|why|which|should|could|would|can\s+you|could\s+you|will\s+you|remind\s+me|let\s+me\s+know|tell\s+me|do\s+i|do\s+we|needs?\s+to|has\s+to|have\s+to)\b/i;
/** A question asked after the coaching topic ("…, what does the manual say?"). */
const ASKS_ABOUT = /\b(?:what|how|why|which)\s+(?:does|do|is|are|should|would|can|did)\b|\b(?:can|could|will)\s+you\b|\bremind\s+me\b/i;

/*
 * CONDUCT, NOT ANY SENTENCE WITH THEIR NAME (review, 31 Oct 2026): "Marnie
 * asked me to move her shift on Saturday" is not something to coach. Written
 * only when it reads as conduct or performance, or the manager says to note it.
 */
const CONDUCT =
  /\b(?:late|tardy|absent|no[- ]?(?:call|show)|rude|yell(?:ed|ing)?|argu(?:ed|ing)|refus(?:ed|ing)|ignor(?:ed|ing)|forgot|missed|skipped|failed|didn't|did\s+not|wasn't|weren't|hadn't|left\s+(?:early|the|her|his|their|without)|clocked|walked\s+(?:out|off)|phone|curs(?:ed|ing)|swore|lied|incorrect(?:ly)?|wrong(?:ly)?|without|before|instead\s+of|marked|mis\w+)\b/i;
const ADD_CUE = /^\s*(?:please\s+)?(?:add|note|put|include|write\s+down)\b/i;

const PAST_ACCOUNT =
  /\b(?:\w{3,}ed|was|were|did|didn't|took|left|came|went|told|said|made|gave|got|forgot|brought|ran|wore|threw|broke|sent|spent|kept|hit|quit|wasn't|weren't|hadn't)\b/i;

const QUESTION_START = /^(?:who|what|when|where|why|how|which|is|are|was|were|do|does|did|can|could|should|would|will|has|have)\b/i;

const CLAIM_LINE =
  /^(?:here(?:'s| is) (?:the )?(?:update|updated)\b|updated the\b|got it\b.*\bupdated\b|i(?:'ve| have) (?:updated|added|applied)\b)/i;

const PRINTED_DETAILS = /\*\*details of coaching:?\*\*/i;

/** The Details block a reply printed, or the reply itself without its claim line. */
/*
 * THIS MODULE'S OWN LINES ARE NEVER CONTENT (independent review, 31 Oct 2026):
 * the honest reply ends "Say make that update and I'll write it into the
 * draft…", and after "make that update" that sentence was written into the
 * Details. Its lines, and `notWrittenReply`'s, are dropped like a claim line.
 */
const OWN_LINE =
  /^(?:\*\*nothing on the form has changed yet\.\*\*|say \*\*make that update\*\*|edit the card and press \*\*save changes\*\*|tell me in your own words what to add)/i;

/** At most this much of an earlier answer goes to the revision as content (review item 8). */
const MAX_CONTENT = 2_000;

function contentOf(answer: string): string {
  const block = /\*\*details of coaching:?\*\*:?\s*([\s\S]+)/i.exec(answer)?.[1];
  const text = block ?? answer;
  return text
    .split("\n")
    .map((line) => line.replace(/^\*\*nothing on the form has changed yet\.\*\*\s*/i, ""))
    .filter((line) => {
      const bare = line.trim().replace(/^[*_]+/, "");
      return !CLAIM_LINE.test(bare) && !OWN_LINE.test(line.trim());
    })
    .join("\n")
    .trim()
    .slice(0, MAX_CONTENT);
}

function previousAnswer(history: readonly Pick<ChatMessage, "role" | "content">[]): string | null {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const turn = history[index]!;
    if (turn.role === "assistant") return turn.content?.trim() ? turn.content : null;
  }
  return null;
}

export function formContentQuestion(input: {
  question: string;
  history: readonly Pick<ChatMessage, "role" | "content">[];
  templateName: string;
  employeeName: string;
}): string | null {
  if (!/\bcoaching\b/i.test(input.templateName)) return null;
  const question = input.question.trim();
  if (!question) return null;
  const into = "Add this to the Details of Coaching";

  /*
   * On one line: the revision reads a request across one line, not a pasted
   * block. And "start" / "create" inside the account ("start the music") is not
   * a request for another form, which is how the revision reads those two words
   * anywhere in a turn; they go to the revision as "begin" / "make".
   */
  const oneLine = (text: string) =>
    text
      .replace(/\s*\n+\s*/g, " ")
      .replace(/\b(?:start|create)(?:s|d|ed|ing)?\b/gi, (word) => NOT_A_REQUEST[word.toLowerCase()] ?? word)
      .trim();

  if (MAKE_THAT.test(question) || WITH_THESE.test(question)) {
    const earlier = previousAnswer(input.history);
    /*
     * "MAKE THAT UPDATE" NEEDS AN UPDATE TO MAKE. In the sibling app's live check (31 Oct 2026) it followed
     * "It should update automatically — no copy-and-paste needed…", which is
     * not coaching content. So it takes the previous reply only when that reply
     * printed the Details or offered an update; "these details" takes the
     * previous answer whatever it was about.
     */
    const offered = earlier ? PRINTED_DETAILS.test(earlier) || earlier.split("\n").some((line) => CLAIM_LINE.test(line.trim().replace(/^[*_]+/, ""))) : false;
    if (!WITH_THESE.test(question) && !offered) return null;
    const content = earlier ? oneLine(contentOf(earlier)) : "";
    return content ? `${into}: ${content}` : null;
  }

  /*
   * A question after the coaching topic keeps it a question (review, 31 Oct
   * 2026): "I want to coach on the new dress code, what does the manual say?"
   */
  if (STATED.test(question) && !/\?/.test(question) && !ASKS_ABOUT.test(question.replace(STATED, ""))) {
    return `${into}: ${oneLine(question)}`;
  }

  /*
   * A BEHAVIOUR OF THE PERSON ON THE FORM, SAID AS A STATEMENT: "Marnie took
   * the next guest back before the room had been cleaned". Their first
   * name, no question, and a sentence long enough to be an account.
   */
  const first = input.employeeName.trim().split(/\s+/)[0] ?? "";
  if (
    first.length > 1 &&
    new RegExp(`\\b${first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(question) &&
    !/\?/.test(question) &&
    !QUESTION_START.test(question) &&
    !ASKS_SOMETHING.test(question) &&
    PAST_ACCOUNT.test(question) &&
    (CONDUCT.test(question) || ADD_CUE.test(question)) &&
    question.split(/\s+/).length >= 6
  ) {
    return `${into}: ${oneLine(question)}`;
  }
  return null;
}

type Turn = Pick<ChatMessage, "id" | "role" | "content" | "error">;

/**
 * ============================================================================
 * "THESE DETAILS" ARE THE BOT'S OWN WORDS — NOT SOMEBODY ELSE'S NAME
 * ============================================================================
 *
 * Ported from Ask Bubbles (live check, 31 Oct 2026; same code here): after a
 * how-to answer, "can you upate the draft with these details of coaching?"
 * wrote nothing. The turn was rewritten, but the open-form revision drops any
 * request that names a person other than the form's employee — and the
 * answer's capitalised terms (a product, a system, "that's a separate process
 * — <step>") read as people. The ordinary answer then ran instead.
 *
 * So when the content is the bot's previous answer and it reads as naming
 * somebody else, it goes to the revision as the manager's latest turn (which
 * is what the revision drafts from) and the request itself names nobody. The
 * manager's own words are never handled this way: "add that Jordan was late"
 * on Marnie's form is still a request about somebody else.
 */
const FROM_ANSWER = "Add the details in my last message to the Details of Coaching.";

export function formContentRevision(input: {
  question: string;
  history: readonly Turn[];
  templateName: string;
  employeeName: string;
}): { question: string; history: Turn[] } | null {
  const rewritten = formContentQuestion(input);
  if (!rewritten) return null;
  const history = [...input.history];
  const fromAnswer = MAKE_THAT.test(input.question.trim()) || WITH_THESE.test(input.question.trim());
  const somebodyElse = extractEmployeeNames(rewritten).some((name) => !samePerson(name, input.employeeName));
  if (!fromAnswer || !somebodyElse) return { question: rewritten, history };
  const content = rewritten.slice(rewritten.indexOf(":") + 1).trim();
  return { question: FROM_ANSWER, history: [...history, { id: "form-content-answer", role: "user", content }] };
}

/**
 * The reply when a turn was read as content for the form and the revision
 * still wrote nothing: said plainly, never the unrelated ordinary answer.
 */
export function notWrittenReply(templateName: string, employeeName: string): string {
  return [
    `**Nothing on the form has changed yet.** I couldn't add that to the Details of Coaching on the ${templateName} for ${employeeName}.`,
    `Tell me in your own words what to add — for example "add that the room is checked before every guest" — or edit the card and press **Save changes**.`,
  ].join("\n\n");
}

/**
 * ============================================================================
 * AN ANSWER THAT WROTE NOTHING NEVER SAYS IT UPDATED THE FORM
 * ============================================================================
 *
 * FORM_EDIT_HONEST_REPLY_ENABLED (QA, 30 Oct 2026; same flag in both apps). The
 * ordinary answer, with a form open and no change made, said "Here's the
 * updated Coaching Form" and "Here's the update applied to the draft", and the
 * card was unchanged. The claim lines are dropped and the reply says plainly
 * that nothing on the form changed; what it drafted stays, so the manager can
 * have it written. Null when the answer claims nothing.
 */
const CLAIM =
  /\b(?:here(?:'s| is) the updated\b|updated the\b|i(?:'ve| have) (?:updated|added|applied|changed|made the (?:update|change))|update (?:has been )?applied|applied to the draft|(?:draft|form|card) (?:is|has been) updated|no copy[- ]paste needed)/i;

/*
 * A CLAIM ABOUT THE FORM, NOT ANY "UPDATED" (independent review, 31 Oct 2026):
 * a policy answer's "the manual was last updated the first quarter" lost its
 * line. Only a line that also speaks of the form, draft, card or Details is a
 * claim to drop.
 */
const ABOUT_THE_FORM = /\b(?:form|draft|card|details\s+of\s+coaching)\b/i;
const claims = (line: string) => CLAIM.test(line) && (ABOUT_THE_FORM.test(line) || /no copy[- ]paste needed/i.test(line));

export function honestFormReply(content: string, canWrite: boolean): string | null {
  if (!content.split("\n").some(claims)) return null;
  const kept = content
    .split("\n")
    .filter((line) => !claims(line))
    .join("\n")
    .replace(/^\s+/, "")
    .trimEnd();
  const how = canWrite
    ? "Say **make that update** and I'll write it into the draft, or edit the card and press **Save changes**."
    : "Edit the card and press **Save changes**, or tell me the change — for example \"add that she was 20 minutes late\".";
  return [`**Nothing on the form has changed yet.**`, kept, how].filter(Boolean).join("\n\n");
}
