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
const MAKE_THAT =
  /^(?:ok(?:ay)?[,.]?\s+|yes[,.]?\s+|please\s+)?(?:make|apply|do|save|put\s+in|add)\s+(?:that|those|the|these|this)\s+(?:update|updates|change|changes|edit|edits|details)\b|^(?:ok(?:ay)?[,.]?\s+)?go\s+ahead(?:\s+and\s+(?:add|update|apply)\s+(?:it|that|them))?\s*[.!]*$/i;

/** "update the draft with these details" — any spelling of update the managers type. */
const WITH_THESE =
  /\b(?:u?p?d?ate|upate|udpate|updte|update|add|put|fill)\b[^.?!]*\b(?:draft|form|card)\b[^.?!]*\b(?:these|those|that|the\s+above)\s+details\b/i;

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

const QUESTION_START = /^(?:who|what|when|where|why|how|which|is|are|was|were|do|does|did|can|could|should|would|will|has|have)\b/i;

const CLAIM_LINE =
  /^(?:here(?:'s| is) (?:the )?(?:update|updated)\b|updated the\b|got it\b.*\bupdated\b|i(?:'ve| have) (?:updated|added|applied)\b)/i;

const PRINTED_DETAILS = /\*\*details of coaching:?\*\*/i;

/** The Details block a reply printed, or the reply itself without its claim line. */
function contentOf(answer: string): string {
  const block = /\*\*details of coaching:?\*\*:?\s*([\s\S]+)/i.exec(answer)?.[1];
  const text = block ?? answer;
  return text
    .split("\n")
    .filter((line) => !CLAIM_LINE.test(line.trim().replace(/^[*_]+/, "")))
    .join("\n")
    .trim();
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

  if (STATED.test(question)) return `${into}: ${oneLine(question)}`;

  /*
   * A BEHAVIOUR OF THE PERSON ON THE FORM, SAID AS A STATEMENT: "Marnie took
   * the next guest back before the room had been cleaned". Their first
   * name, no question, and a sentence long enough to be an account.
   */
  const first = input.employeeName.trim().split(/\s+/)[0] ?? "";
  if (
    first.length > 1 &&
    new RegExp(`\\b${first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(question) &&
    !/\?\s*$/.test(question) &&
    !QUESTION_START.test(question) &&
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

export function honestFormReply(content: string, canWrite: boolean): string | null {
  if (!CLAIM.test(content)) return null;
  const kept = content
    .split("\n")
    .filter((line) => !CLAIM.test(line))
    .join("\n")
    .replace(/^\s+/, "")
    .trimEnd();
  const how = canWrite
    ? "Say **make that update** and I'll write it into the draft, or edit the card and press **Save changes**."
    : "Edit the card and press **Save changes**, or tell me the change — for example \"add that she was 20 minutes late\".";
  return [`**Nothing on the form has changed yet.**`, kept, how].filter(Boolean).join("\n\n");
}
