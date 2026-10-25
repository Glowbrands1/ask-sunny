/**
 * ============================================================================
 * OTHER CONVERSATIONS STAY OUT OF THE REPLY TEXT
 * ============================================================================
 *
 * QA found replies that told a manager what they had said somewhere else:
 *
 *   "You raised this same situation with me on October 23, …"
 *   "(You sent the same thing back on August 26, …)"
 *
 * Neither was in the conversation on screen. Both came from the person-memory
 * block (`person-memory-store.ts`), which quotes the manager's own earlier
 * chats about a person this turn names, and whose prompt rules invited "Last
 * time you mentioned that…". The second one was not even about a person: the
 * manager typed "asdasd", the name reader took the lone word as a name given
 * on purpose, and the same keystrokes in an August chat were recalled.
 *
 * Behind CROSS_CHAT_REPLY_GUARD_ENABLED, three pieces, source first:
 *
 *   WHEN ANOTHER CHAT IS RECALLED only when the manager refers back to one in
 *                                 this conversation (`refersBack`) — its words
 *                                 and the forms listed with it. The FORMS ON
 *                                 FILE register block is read only for a
 *                                 question about records (`asksAboutRecords`)
 *                                 or a refer-back, and marks who created each
 *                                 row.
 *   WHO COUNTS AS A PERSON        a name read from a turn that is nothing but
 *                                 that name (`isBareNameTurn`) must be on the
 *                                 roster.
 *   THE REPLY                     a sentence that still says the manager
 *                                 raised, sent or asked something in another
 *                                 chat or on another date is taken out
 *                                 (`withoutCrossChatClaims`). Only that
 *                                 sentence: every other word stays.
 *
 * Pure: no I/O.
 */

interface Turn {
  readonly role: string;
  readonly content: string;
}

/*
 * The manager pointing back at an earlier chat. "again", "last time", "like
 * before", "same as …", "the other conversation", "I told you …".
 */
const REFERS_BACK = new RegExp(
  [
    String.raw`\bagain\b`,
    String.raw`\blast\s+time\b`,
    String.raw`\b(?:like|as)\s+(?:i\s+(?:said|told\s+you|mentioned)\s+)?before\b`,
    String.raw`\bsame\s+(?:\w+\s+)?as\b`,
    String.raw`\b(?:previous|earlier|last|other|another|old|prior)\s+(?:chat|conversation|convo|thread|session)s?\b`,
    String.raw`\bpreviously\b`,
    String.raw`\b(?:i|we)\s+(?:already\s+|previously\s+)?(?:told\s+you|mentioned|talked\s+about|discussed|went\s+over|spoke\s+about)\b`,
    String.raw`\bremember\b`,
    String.raw`\bremind\s+me\b`,
    // "the one I did yesterday", "the one we wrote up"
    String.raw`\bthe\s+one\s+(?:i|we)\s+(?:did|wrote|made|created|filed|started|sent|issued|gave|did\s+yesterday)\b`,
    // "her earlier CA", "his last write-up", "the previous coaching form"
    String.raw`\b(?:her|his|their|the)\s+(?:earlier|previous|prior|last|old|other|first)\s+(?:ca|cas|caf|corrective\s+action|coaching|form|write-?up|warning|verbal)s?\b`,
  ].join("|"),
  "i",
);

/*
 * A question ABOUT records: "does Dana have previous coachings?", "show me her
 * write-ups", "any open follow-ups?". Not a form request that mentions history
 * ("do verbal for team member … previous coaching jba manual 11-1-26").
 */
const ASKS_ABOUT_RECORDS =
  /\?\s*$|^\s*(?:does|did|has|have|had|is|are|was|were|any|what|which|how|when|who|whose|show|list|check|look\s+up|pull\s+up|find|tell\s+me|can\s+you|could\s+you|do\s+(?:i|we|you|they|she|he)\b)/i;

/**
 * Whether the turn is a question about forms on file rather than a request
 * that only mentions history. The caller has already checked that the turn is
 * about forms on file at all.
 */
export function asksAboutRecords(question: string): boolean {
  return ASKS_ABOUT_RECORDS.test(question.trim());
}

/** Whether the manager, in this conversation, refers back to an earlier one. */
export function refersBack(question: string, history: readonly Turn[]): boolean {
  if (REFERS_BACK.test(question)) return true;
  return history.some((turn) => turn.role === "user" && REFERS_BACK.test(turn.content));
}

function bare(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9'’\s-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Whether a turn is nothing but this name — "asdasd", "Avery Holt." — or a
 * single word. A name read from a sentence ("a coaching form for Avery Holt")
 * is given on purpose; a turn that is only a word could be anything.
 */
export function isBareNameTurn(turn: string, name: string): boolean {
  const text = bare(turn);
  if (!text) return false;
  return !text.includes(" ") || text === bare(name);
}

/* --------------------------------------------------------------- reply -- */

const MONTHS = [
  "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec",
] as const;

const MONTH_WORD = String.raw`(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?`;

/* The manager as the one who said, sent or asked. */
const MANAGER_SAID = new RegExp(
  String.raw`\byou(?:'ve|’ve|\s+have|\s+had)?\s+(?:already\s+|also\s+|previously\s+|first\s+)?` +
    String.raw`(?:raised|sent|mentioned|told\s+me|asked|brought\s+(?:this|it|that|her|him|them)\s+up|described|reported|flagged|said|wrote|typed|shared|came\s+to\s+me|created|filed|did|wrote\s+(?:her|him|them)\s+up|documented|issued)\b`,
  "i",
);

/* A date: "on October 23", "back on Aug 26", "on 10/23". */
const ON_A_DATE = new RegExp(
  String.raw`\b(?:on|back\s+on|since)\s+(?:(?:mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?|sun)(?:day)?,?\s+)?(${MONTH_WORD})\s+(\d{1,2})(?:st|nd|rd|th)?\b` +
    String.raw`|\b(?:on|back\s+on|since)\s+(\d{1,2})[/-](\d{1,2})(?:[/-]\d{2,4})?\b`,
  "i",
);

/* Another chat, without a date. */
const ANOTHER_CHAT = new RegExp(
  [
    String.raw`\blast\s+time\b`,
    String.raw`\bpreviously\b`,
    // "you've mentioned Test Employee before in two different contexts" — any
    // word after "before" except one that makes it a time ("before the shift").
    String.raw`\bbefore\b(?!\s+(?:the|her|his|their|a|an|it|she|he|they|we|you|i|then|that|this|work|shift|close|closing|open|opening|noon|lunch|clocking|\d)\b)`,
    String.raw`\bwhat\s+you\s+(?:did|told\s+me|said|wrote|sent)\s+earlier\b`,
    String.raw`\bin\s+(?:another|an\s+earlier|a\s+previous|a\s+different|an\s+other|that|those|your\s+(?:earlier|previous|last|other))\s+(?:chat|conversation)s?\b`,
    String.raw`\b(?:earlier|previous|other|last|prior|past)\s+(?:chat|conversation)s?\b`,
    String.raw`\bearlier\s+today\b`,
  ].join("|"),
  "i",
);

/*
 * A sentence that NAMES another chat — "from your past conversations", "in an
 * earlier conversation", "earlier today" — is about another chat whether or
 * not it says "you said".
 */
const NAMES_ANOTHER_CHAT = new RegExp(
  [
    String.raw`\bin\s+(?:another|an\s+earlier|a\s+previous|a\s+different|an\s+other|your\s+(?:earlier|previous|last|other|past))\s+(?:chat|conversation)s?\b`,
    String.raw`\b(?:earlier|previous|other|prior|past)\s+(?:chat|conversation)s?\b`,
    String.raw`\bearlier\s+today\b`,
  ].join("|"),
  "i",
);

/*
 * The manager's words attributed to another chat without a verb: "your other
 * notes on Test Employee are…", "one of your earlier notes had her at…".
 */
const YOUR_OTHER_NOTES =
  /\byour\s+(?:other|earlier|past|previous|prior|last)\s+(?:notes?|conversations?|chats?|messages?|requests?|mentions?)\b/i;

/*
 * On the first turn of a conversation the manager has said nothing else here
 * and created nothing here, so "you told me earlier", "you mentioned her
 * before" and "the one you created today" can only be another chat. Bare
 * "today", "already" and "again" stay: the manager may have said them in this
 * very turn ("she was late again today").
 */
const SAID_BEFORE_THIS = /\b(?:before|earlier|previously)\b/i;
const YOU_CREATED =
  /\byou(?:'ve|’ve|\s+have|\s+had)?\s+(?:already\s+|also\s+|previously\s+)?(?:created|filed|issued|documented|wrote\s+(?:her|him|them)\s+up)\b/i;

/* "the same thing", "this same situation" — true only if it repeats in this chat. */
const SAME_AGAIN = /\b(?:the|this|that)\s+same\s+(?:thing|situation|question|issue|message|story|request)\b/i;

function monthIndex(word: string): number {
  return MONTHS.indexOf(word.toLowerCase().slice(0, 3) as (typeof MONTHS)[number]);
}

/** The month (0–11) and day a date phrase names, or null. */
function dateNamed(match: RegExpExecArray): { month: number; day: number } | null {
  if (match[1] && match[2]) {
    const month = monthIndex(match[1]);
    return month === -1 ? null : { month, day: Number(match[2]) };
  }
  if (match[3] && match[4]) return { month: Number(match[3]) - 1, day: Number(match[4]) };
  return null;
}

/** Whether this conversation's own text, or today, carries that date. */
function dateInConversation(
  date: { month: number; day: number },
  conversationText: string,
  todayIso: string | null,
): boolean {
  if (todayIso) {
    const today = /^(\d{4})-(\d{2})-(\d{2})/.exec(todayIso);
    if (today && Number(today[2]) - 1 === date.month && Number(today[3]) === date.day) return true;
  }
  const scan = new RegExp(
    String.raw`\b(${MONTH_WORD})\s+(\d{1,2})(?:st|nd|rd|th)?\b|\b(\d{1,2})[/-](\d{1,2})(?:[/-]\d{2,4})?\b`,
    "gi",
  );
  for (const found of conversationText.matchAll(scan)) {
    const month = found[1] ? monthIndex(found[1]) : Number(found[3]) - 1;
    const day = Number(found[1] ? found[2] : found[4]);
    if (month === date.month && day === date.day) return true;
  }
  return false;
}

/** Whether the manager repeated a turn inside this conversation. */
function repeatedHere(question: string, history: readonly Turn[]): boolean {
  const said = [question, ...history.filter((turn) => turn.role === "user").map((turn) => turn.content)]
    .map(bare)
    .filter(Boolean);
  return new Set(said).size < said.length;
}

/**
 * Whether one sentence says the manager raised, sent or asked something in
 * another chat or on another date that this conversation does not show.
 */
export function claimsAnotherChat(
  sentence: string,
  input: { question: string; history: readonly Turn[]; todayIso?: string | null },
): boolean {
  if (YOUR_OTHER_NOTES.test(sentence) || NAMES_ANOTHER_CHAT.test(sentence)) return true;
  if (!MANAGER_SAID.test(sentence)) return false;
  const conversationText = [input.question, ...input.history.map((turn) => turn.content)].join("\n");

  const dated = ON_A_DATE.exec(sentence);
  if (dated) {
    const date = dateNamed(dated);
    return !(date && dateInConversation(date, conversationText, input.todayIso ?? null));
  }
  if (ANOTHER_CHAT.test(sentence)) return true;
  const firstTurn = !input.history.some((turn) => turn.role === "user");
  if (firstTurn && SAID_BEFORE_THIS.test(sentence)) return true;
  // "a Corrective Action you created" when nothing was created in this chat.
  const createdHere = input.history.some((turn) => /\b(?:created|finalized|saved)\b/i.test(turn.content));
  if (!createdHere && YOU_CREATED.test(sentence)) return true;
  if (SAME_AGAIN.test(sentence)) return !repeatedHere(input.question, input.history);
  return false;
}

/* A sentence, with any closing quote or bracket, and the space after it. */
const SENTENCE = /[^.!?\n]+(?:[.!?]+["'”’)\]]*|$)\s*/g;

export interface CrossChatCheck {
  readonly content: string;
  /** The sentences taken out, for the log. Empty when nothing changed. */
  readonly removed: readonly string[];
}

/**
 * The reply without the sentences that claim the manager said or sent
 * something in another chat. Every other word is kept as written; a reply
 * that would be left empty is returned unchanged.
 *
 * Only for a conversation where the manager did not refer back — the caller
 * checks `refersBack` — because then nothing from another chat is theirs to
 * have brought up.
 */
export function withoutCrossChatClaims(
  content: string,
  input: { question: string; history: readonly Turn[]; todayIso?: string | null },
): CrossChatCheck {
  const removed: string[] = [];
  const lines = content.split("\n").map((line) => {
    if (!MANAGER_SAID.test(line) && !YOUR_OTHER_NOTES.test(line) && !NAMES_ANOTHER_CHAT.test(line)) return line;
    const sentences = line.match(SENTENCE) ?? [line];
    const kept = sentences.filter((sentence) => {
      if (!claimsAnotherChat(sentence, input)) return true;
      removed.push(sentence.trim());
      return false;
    });
    if (kept.length === sentences.length) return line;
    const lead = /^\s*(?:[-*]\s+|\d+\.\s+)?/.exec(line)?.[0] ?? "";
    const rest = kept.join("").trim();
    if (!rest) return null;
    return rest.startsWith(lead.trim()) ? rest : `${lead}${rest}`;
  });

  if (removed.length === 0) return { content, removed };
  const joined = lines
    .filter((line): line is string => line !== null)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!joined) return { content, removed: [] };
  return { content: joined, removed };
}

/**
 * The prompt rule that travels with the guard, memory or not: nothing from
 * another conversation is the manager's to have said in this one.
 */
export const CROSS_CHAT_REPLY_RULE =
  "- Never tell the manager they raised, said, sent, asked or mentioned something in another conversation or on another date unless it appears in this conversation's own messages. Anything from an earlier conversation or a form on file is a record: list it as a record (for example \"On file: Coaching Form for Avery Holt, dated 2026-10-01\"), never as \"you raised this\" or \"you sent this before\".";

/** The line the memory block opens with when the guard is on. */
export const CROSS_CHAT_RECORDS_NOTE =
  "These are records from OTHER conversations and forms on file, not part of this conversation, included because the manager referred back to an earlier conversation. Use only what that reference is about. A form was created only if it is listed below under forms the manager created; a form discussed, requested or proposed in an earlier conversation was not created. List forms as records on file.";
