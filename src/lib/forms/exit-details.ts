import { JOIN } from "./bounded-context";
import { isQuestion } from "./employment-change";
import { EXIT_DETAIL_FIELDS, EXIT_NOTICE_GROUP, EXIT_TYPE_GROUP } from "./exit-library";
import { EXIT_DERIVED_KEYS, exitFactValues, readExitFacts, type ExitFacts } from "./exit-facts";

/**
 * ============================================================================
 * THE EXIT FORM'S DETAILS LINES, READ FROM WHAT THE MANAGER SAID
 * ============================================================================
 *
 * HR asked (28 Sep 2026) for the Details section to state how and why the
 * employee left, whether store items and the salon key came back, whether a
 * payroll deduction applies, whether they are dropped to minimum wage and
 * forfeit the bonus, and whether they may be rehired. A manager usually says
 * most of that in the conversation already — "she texted me Sunday that she
 * was quitting because she's moving, she dropped off her key but still has
 * her shirts, and I wouldn't rehire her" — and asking again is the
 * interrogation nobody wants.
 *
 * SO THIS READS THE MANAGER'S OWN WORDS, DETERMINISTICALLY, the way
 * `exit-facts.ts` reads the dates. The answers land in `manager` fields the
 * model can never write, through `applyStatedFacts` (empty fields only) or,
 * after the form exists, as the manager's own correction. Nothing here is
 * inferred from anything else: a key that was not mentioned is not "returned",
 * a bonus nobody discussed is not "kept", and a reason nobody gave is not
 * written. What is not found stays blank and is asked for.
 *
 * THE RULE IS STILL "CLEAR OR NOTHING", WITH ONE ADDITION: THE LATER TURN WINS.
 * The conversation arrives as the manager's turns joined by `JOIN`, oldest
 * first. Each turn is read on its own, and a later turn that answers the same
 * question replaces the earlier one — "actually she did bring the key back"
 * is a correction, not a contradiction. Two answers to one question in the
 * SAME turn are an ambiguity: blank, and asked.
 *
 * A QUESTION ANSWERS NOTHING. "Is she eligible for rehire?" is a sentence
 * ending in "?", and is skipped whole.
 */

export type YesNo = "yes" | "no";

/** The yes/no groups the Details section states, by stored key. */
export const EXIT_ANSWER_KEYS = [
  "store_items_returned",
  "salon_key_returned",
  "payroll_deduction_applicable",
  "dropped_to_minimum_wage",
  "forfeit_bonus",
  "eligible_for_rehire",
] as const;

export type ExitAnswerKey = (typeof EXIT_ANSWER_KEYS)[number];

export type ExitDetailAmbiguity =
  /** The same question answered both ways in one turn. */
  | { kind: "answer_conflict"; key: ExitAnswerKey };

export interface ExitDetails {
  /** From `exit-facts.ts`: a quitting date, or the date notice was given. */
  resignationDate: string | null;
  /** "Text message", "Phone call and email", "No call/no show". */
  resignationMethod: string | null;
  /** The manager's words for why, or "No reason given." when they said so. */
  resignationReason: string | null;
  answers: Partial<Record<ExitAnswerKey, YesNo>>;
  ambiguities: ExitDetailAmbiguity[];
}

/**
 * Every key this module fills. The allow-list `applyStatedFacts` and the chat
 * correction are given for the exit form — never an inference from a label.
 */
export const EXIT_STATED_KEYS: ReadonlySet<string> = new Set([
  EXIT_DETAIL_FIELDS.resignationDate,
  EXIT_DETAIL_FIELDS.resignationMethod,
  EXIT_DETAIL_FIELDS.resignationReason,
  ...EXIT_ANSWER_KEYS,
]);

/* ------------------------------------------------------------ the words -- */

function normalize(text: string): string {
  return (text ?? "").replace(/[‘’‛]/g, "'").replace(/[“”]/g, '"');
}

/** A negation close enough before a word to reverse it. */
const NEGATION = String.raw`(?:not|never|no|none|nothing|without|ineligible|did ?n[o']?t|didn't|does ?n[o']?t|doesn't|don't|do not|has ?n[o']?t|hasn't|have ?n[o']?t|haven't|is ?n[o']?t|isn't|was ?n[o']?t|wasn't|were ?n[o']?t|weren't|won't|will not|wouldn't|would not|can't|cannot|shouldn't|should not|failed to|refused to|still has|still have|kept|keeping|keeps)`;
const NEGATED_BEFORE = new RegExp(String.raw`\b${NEGATION}\s+(?:\w+\s+){0,3}$`);
const NEGATION_ANYWHERE = new RegExp(String.raw`\b${NEGATION}\b`);

/**
 * Whether the words before `index` in `clause` negate what is at `index`.
 *
 * Close negation ("didn't return her key") and negation carried across "or"
 * ("won't be dropped to minimum wage or forfeit her bonus").
 */
function negatedAt(clause: string, index: number): boolean {
  const before = clause.slice(0, index);
  if (NEGATED_BEFORE.test(before)) return true;
  /*
   * "Won't be dropped to minimum wage or forfeit her bonus": the negation
   * covers both halves. `clauses` has already cut at every "and" that starts
   * a new subject or auxiliary, so one left inside a clause shares the verb
   * before it — and so shares its negation.
   */
  const joined = Math.max(before.lastIndexOf(" or "), before.lastIndexOf(" and "));
  return joined >= 0 && NEGATION_ANYWHERE.test(before.slice(0, joined));
}

/** Sentences, with every question dropped whole. */
function statements(turn: string): string[] {
  const out: string[] = [];
  for (const match of turn.matchAll(/[^.!?\n]+[.!?]*/g)) {
    const sentence = match[0].trim();
    if (sentence === "" || /\?\s*$/.test(sentence)) continue;
    out.push(sentence.toLowerCase());
  }
  return out;
}

/**
 * A sentence cut where a new fact begins: at commas, semicolons and "but",
 * and at "and"/"so" when a new subject or fact follows. "Or" is deliberately
 * NOT a boundary — negation distributes over it.
 */
function clauses(sentence: string): string[] {
  return sentence
    .split(
      /\s*,\s*|\s*;\s*|\s+but\s+|\s+(?:and|so|also|plus)\s+(?=(?:she|he|they|her|his|their|the|i|we|payroll|no|not|is|isn't|was|wasn't|will|won't|would|wouldn't|should|shouldn't|did|didn't|has|hasn't|returned|kept|still|eligible)\b)/,
    )
    .map((part) => part.trim())
    .filter(Boolean);
}

/* -------------------------------------------------- returned, or not -- */

type Reading = YesNo | "conflict" | undefined;

/** Folds a new answer into what this turn has said so far. */
function add(current: Reading, next: YesNo | undefined): Reading {
  if (next === undefined) return current;
  if (current === undefined) return next;
  return current === next ? current : "conflict";
}

function flip(reading: Reading): YesNo | undefined {
  return reading === "yes" ? "no" : reading === "no" ? "yes" : undefined;
}

const RETURN_VERB =
  /\b(?:returned|return|returns|returning|turned in|turn in|turns in|brought back|bring back|brings back|gave back|give back|gives back|given back|handed in|handed back|hand in|hand back|dropped off|drop off|drops off)\b/g;
const KEPT_VERB =
  /\b(?:still has|still have|kept|keeping|keeps|left with|walked off with|took off with|never gave back|has yet to return|hasn't given back|has not given back)\b/g;
const ITEM = /\b(?:store items?|items?|uniforms?|shirts?|polos?|name ?tags?|badges?|aprons?)\b/;
const KEY = /\bkeys?\b/;
const EVERYTHING = /\b(?:everything|all (?:of )?(?:her|his|their|the) (?:stuff|things|property|belongings))\b/;
/** Where a verb's object stops: an exception names what was NOT covered. */
const EXCEPT = /\b(?:except|besides|other than|apart from|minus|but)\b/;

interface Returns {
  items: Reading;
  key: Reading;
}

/**
 * What a clause says came back, and what did not.
 *
 *   verb … object        "returned her key and shirts", "didn't turn in her key"
 *   noun … was returned  "the key was returned", "items weren't returned"
 *   still has / kept     "she still has the key", "kept her uniform"
 *   everything           "returned everything except the key"
 *   the form's words     "store items returned: no", "key - yes"
 */
function returnsIn(clause: string): Returns {
  let items: Reading;
  let key: Reading;

  const objects = (verb: RegExp, polarity: (at: number) => YesNo) => {
    for (const match of clause.matchAll(verb)) {
      const at = match.index ?? 0;
      let object = clause.slice(at + match[0].length, at + match[0].length + 80);
      const exception = EXCEPT.exec(object);
      const excepted = exception ? object.slice(exception.index) : "";
      if (exception) object = object.slice(0, exception.index);
      const answer = polarity(at);
      const all = EVERYTHING.test(object);
      if (ITEM.test(object) || all) items = add(items, answer);
      if (KEY.test(object) || (all && !KEY.test(excepted))) key = add(key, answer);
      if (all && KEY.test(excepted)) key = add(key, flip(answer));
    }
  };
  objects(RETURN_VERB, (at) => (negatedAt(clause, at) ? "no" : "yes"));
  objects(KEPT_VERB, () => "no");

  const passive =
    /\b(store items?|items?|uniforms?|shirts?|polos?|name ?tags?|badges?|aprons?|keys?)\b(?:\s+\w+){0,2}?\s+(?:(?:was|were|has been|have been|got|is|are|been|wasn't|weren't|hasn't been|haven't been|isn't|aren't)\s+)?(?:all\s+|also\s+)?(not\s+|never\s+)?(?:returned|turned in|brought back|given back|handed in|dropped off)\b/g;
  for (const match of clause.matchAll(passive)) {
    const negated =
      Boolean(match[2]) || /n't\b|\bnot\b|\bnever\b/.test(match[0]) || negatedAt(clause, match.index ?? 0);
    const answer: YesNo = negated ? "no" : "yes";
    if (KEY.test(match[1]!)) key = add(key, answer);
    else items = add(items, answer);
  }

  const labelled =
    /\b(store items?|items?|uniforms?|keys?|salon key)(?:\s+(?:were|was))?(?:\s+returned)?(?:\s*[:=–—-]\s*(yes|no|y|n)\b|\s+(yes|no|y|n)\s*$)/g;
  for (const match of clause.matchAll(labelled)) {
    match[2] ??= match[3];
    const answer: YesNo = match[2]!.startsWith("y") ? "yes" : "no";
    if (KEY.test(match[1]!)) key = add(key, answer);
    else items = add(items, answer);
  }

  return { items, key };
}

/**
 * "Returned her items but not her key": the elliptical half has no verb of
 * its own, so it answers the opposite of the clause before it.
 */
function elliptical(clause: string, noun: RegExp): boolean {
  return new RegExp(String.raw`^not\s+(?:the\s+|her\s+|his\s+|their\s+|any\s+)?(?:salon\s+|store\s+)?${noun.source}`).test(clause);
}

/**
 * "Returned her store items and her key": `clauses` cuts before "her key",
 * which then has no verb of its own and shares the one before it.
 */
function sharedVerb(clause: string, noun: RegExp): boolean {
  return new RegExp(
    String.raw`^(?:(?:her|his|their|the|all|any|of|also)\s+)*(?:salon\s+|store\s+|front\s+door\s+)?${noun.source}\s*(?:too|as well|also)?\s*[.!]*$`,
  ).test(clause);
}

/* -------------------------------------------------- the other answers -- */

/** "payroll deduction: yes", "rehire - no", "bonus = n". */
function labelledAnswer(clause: string, label: RegExp): YesNo | undefined {
  const match =
    new RegExp(String.raw`(?:${label.source})[^:=\-–—,;]{0,20}?\s*[:=–—-]\s*(yes|no|y|n)\b`).exec(clause) ??
    // Without a colon only as the whole clause: "rehire yes", "min wage no".
    new RegExp(String.raw`^(?:${label.source})\s+(yes|no|y|n)\s*$`).exec(clause);
  if (!match) return undefined;
  return match[match.length - 1]!.startsWith("y") ? "yes" : "no";
}

function payrollDeduction(clause: string): Reading {
  const labelled = labelledAnswer(clause, /\bpayroll(?: deduction)?|\bdeduction/);
  if (labelled) return labelled;
  if (/\bno (?:payroll )?deductions?\b|\bnothing to deduct\b/.test(clause)) return "no";
  // "payroll" alone is usually the department — "notify payroll".
  const match = /\b(?:payroll deduct(?:ed|ion|ions)?|deduct(?:ed|ing|s|ion|ions)?)\b/.exec(clause);
  if (!match) return undefined;
  if (/\b(?:not|n't)\s+(?:be\s+)?(?:appl(?:y|ies|icable)|needed|required|necessary)\b|\bn\/a\b/.test(clause)) {
    return "no";
  }
  return negatedAt(clause, match.index) ? "no" : "yes";
}

function minimumWage(clause: string): Reading {
  const labelled = labelledAnswer(clause, /\bmin(?:imum|\.)?\s*wage/);
  if (labelled) return labelled;
  const match = /\bmin(?:imum|\.)?\s*wage\b/.exec(clause);
  if (!match) return undefined;
  const before = clause.slice(0, match.index);
  // "drop her to minimum wage", "dropped to min wage", "paid minimum wage"
  const verb =
    /\b(?:drop|dropped|dropping|drops|reduce|reduced|reduces|reducing|lower|lowered|go|goes|going|paid|pay|bump|bumped|move|moved|moves)\b[^,;]{0,30}$/.exec(before);
  if (verb) return negatedAt(clause, verb.index) ? "no" : "yes";
  if (/\b(?:no|not)\s+$/.test(before)) return "no";
  const after = clause.slice(match.index + match[0].length);
  if (/^\s*(?:does ?n[o']?t|doesn't|won't|will not)\s+apply\b/.test(after)) return "no";
  if (/^\s*(?:applies|will apply|is applicable)\b/.test(after)) return "yes";
  return undefined;
}

function bonusForfeited(clause: string): Reading {
  const labelled = labelledAnswer(clause, /\bbonus(?: forfeit(?:ure)?)?|\bforfeit(?:ure)?/);
  if (labelled) return labelled;
  if (/\bno bonus forfeit(?:ure)?\b/.test(clause)) return "no";
  const match = /\bbonus(?:es)?\b/.exec(clause);
  if (!match) return undefined;
  const before = clause.slice(0, match.index);
  const filler = String.raw`(?:\s+(?:her|his|their|the|any|a|of|all|quarterly|monthly|retention|sales|last|final))*\s*$`;
  const lose = new RegExp(String.raw`\b(?:forfeit|forfeits|forfeited|forfeiting|lose|loses|losing|lost|give up|gives up|no)\b${filler}`).exec(before);
  if (lose) return negatedAt(clause, lose.index) ? "no" : "yes";
  const keep = new RegExp(String.raw`\b(?:keep|keeps|kept|keeping|get|gets|getting|receive|receives|receiving|earned|earns|still gets)\b${filler}`).exec(before);
  // "keeps her bonus" is not forfeiting it; "won't get her bonus" is.
  if (keep) return negatedAt(clause, keep.index) ? "yes" : "no";
  const passive = /^\s*(?:is|was|will be|would be)\s+(not\s+)?(forfeited|lost|paid|kept)\b/.exec(
    clause.slice(match.index + match[0].length),
  );
  if (passive) {
    const lost = passive[2] === "forfeited" || passive[2] === "lost";
    return lost !== Boolean(passive[1]) ? "yes" : "no";
  }
  return undefined;
}

function rehireEligible(clause: string): Reading {
  const labelled = labelledAnswer(clause, /\b(?:eligible for )?re-?hire(?: eligib(?:le|ility))?/);
  if (labelled) return labelled;
  let reading: Reading;
  for (const match of clause.matchAll(/\b(?:re-?hir(?:e|ed|able|ing)|hire (?:her|him|them) back)\b/g)) {
    const at = match.index ?? 0;
    const before = clause.slice(0, at);
    if (/\bineligible\b[^,;]{0,25}$/.test(before)) {
      reading = add(reading, "no");
      continue;
    }
    if (/\b(?:not|never|no|dnr|don't|won't|wouldn't|can't|shouldn't)\s+$/.test(before)) {
      reading = add(reading, "no");
      continue;
    }
    const cue = /\b(?:eligible|ok|okay|fine|good|able|can|could|would|will|may|should)\b[^,;]{0,25}$/.exec(before);
    if (cue) {
      // "would not rehire", "is eligible for rehire" / "is not eligible for rehire"
      const negated = negatedAt(clause, cue.index) || /\b(?:not|never)\b|n't\b/.test(before.slice(cue.index));
      reading = add(reading, negated ? "no" : "yes");
      continue;
    }
    // "rehirable", "not rehirable"
    if (/able$/.test(match[0])) reading = add(reading, negatedAt(clause, at) ? "no" : "yes");
  }
  return reading;
}

/* ---------------------------------------------------- how, and why -- */

const METHODS: { label: string; pattern: RegExp }[] = [
  { label: "No call/no show", pattern: /\bno[\s-]*call[\s,/&-]*(?:and\s+)?no[\s-]*show(?:ed|s)?\b|\bncns\b/g },
  { label: "Voicemail", pattern: /\bvoice ?mail\b/g },
  {
    label: "Text message",
    pattern:
      /\b(?:texted|texting|text message|text msg|via text|by text|over text|in a text|sent (?:me |us |her |him )?a text|text(?:s)? (?:me|us|her|him))\b|\bsms\b/g,
  },
  {
    label: "Phone call",
    pattern:
      /\b(?:phone call|over the phone|by phone|on the phone|phoned|called (?:me|us|the (?:salon|store|shop)|(?:her|his|their) (?:sd|asd|dm|manager|salon director))|called in to (?:quit|resign|say)|(?:then|and|also) called)\b/g,
  },
  { label: "Email", pattern: /\be-?mail(?:ed|s)?\b/g },
  { label: "In person", pattern: /\b(?:in person|face[- ]to[- ]face|to my face|came in (?:and|to) (?:quit|resign|tell))\b/g },
  { label: "Written letter", pattern: /\b(?:resignation letter|letter of resignation|in writing|written resignation|wrote a letter|handed (?:me |in )?a letter)\b/g },
  { label: "Walked out", pattern: /\bwalked\s+(?:out|off)\b/g },
];

function methodsIn(turn: string): string[] {
  const found: string[] = [];
  for (const sentence of statements(turn)) {
    for (const method of METHODS) {
      for (const match of sentence.matchAll(method.pattern)) {
        if (negatedAt(sentence, match.index ?? 0)) continue;
        // "called in sick" is not a resignation.
        if (method.label === "Phone call" && /\bsick\b/.test(sentence)) continue;
        if (!found.includes(method.label)) found.push(method.label);
      }
    }
  }
  // "Emailed her resignation letter" is one email, not an email and a letter.
  if (found.includes("Email")) return found.filter((label) => label !== "Written letter");
  return found;
}

/** "Text message and phone call", "Email, text message and phone call". */
function joinMethods(methods: string[]): string | null {
  if (methods.length === 0) return null;
  const [first, ...rest] = methods;
  const tail = rest.map((method) => method.charAt(0).toLowerCase() + method.slice(1));
  if (tail.length === 0) return first!;
  return `${[first, ...tail.slice(0, -1)].join(", ")} and ${tail[tail.length - 1]}`;
}

const NO_REASON =
  /\b(?:no reason(?: (?:was )?(?:given|provided|stated))?|did ?n[o']?t (?:give|say|tell (?:me|us)|share|provide)(?: (?:me|us))?(?: (?:a|any|the))? (?:reason|why)|didn't tell (?:me|us) why|without (?:giving )?(?:a |any )?reason|reason (?:is |was )?(?:unknown|not given)|(?:she|he|they) (?:wouldn't|would not) say why)\b/;

const LEAVING = String.raw`(?:quit|quits|quitting|resign(?:ed|s|ing)?|left|leaving|leaves|walked (?:out|off)|put in (?:her|his|their) (?:notice|two weeks)|gave (?:her |his |their )?(?:notice|two weeks(?: notice)?))`;

/** Where a reason stops: the next fact, not a comma inside the reason. */
const NEXT_FACT = String.raw`(?:she|he|they|her|his|their|last|returned|didn't|did|kept|still|payroll|no|not|is|was|we|i|please|can|the (?:key|store|items))\b`;
const REASON_END = new RegExp(
  String.raw`\s*(?:[.;!?\n]|,\s*(?:and\s+|but\s+|so\s+)?(?=${NEXT_FACT})|\s+(?:and|but|so)\s+(?=${NEXT_FACT}))`,
);

/** Each opening, and whether the words it matched belong to the reason. */
const REASON_START: { pattern: RegExp; keep: boolean }[] = [
  {
    pattern: /\breason(?:\s+(?:for|she|he|they)\s+(?:leaving|quitting|resigning|resignation|left|quit|resigned|gave))?(?:\s+given)?\s*(?:was|is|:|-|–|—)\s*/,
    keep: false,
  },
  { pattern: new RegExp(String.raw`\b${LEAVING}\b[^.;!?\n]{0,60}?\b(?:because(?: of)?|cause|cuz|bc|due to)\s+`), keep: false },
  { pattern: new RegExp(String.raw`\b${LEAVING}\s+(?=to\s+(?:go|move|attend|start|focus|take|work|care|be|pursue|return|finish)\b)`), keep: false },
  { pattern: new RegExp(String.raw`\b${LEAVING}\s+for\s+(?=(?:a|another|a new|a better|a different|personal|family|health|medical)\b)`), keep: false },
  { pattern: /\b(?:she|he|they)(?:'s|'re| is| are| was| were)\s+(?:moving|relocating|going back to school|going to school|pregnant)\b/, keep: true },
  { pattern: /\b(?:she|he|they)\s+(?:got|found|took|accepted)\s+(?:a|another|a new|a better|a different|a full[- ]time)\s+(?:job|position)\b/, keep: true },
  { pattern: /\bpersonal reasons\b/, keep: true },
];

function reasonIn(turn: string): string | null {
  const text = turn.replace(/\s+/g, " ");
  const lower = text.toLowerCase();
  if (NO_REASON.test(lower)) return "No reason given.";
  for (const { pattern, keep } of REASON_START) {
    const match = pattern.exec(lower);
    if (!match) continue;
    const from = keep ? match.index : match.index + match[0].length;
    // A question about the reason is not one.
    const close = /[.!?\n]/.exec(text.slice(from));
    if (close && text[from + close.index] === "?") continue;
    const rest = text.slice(keep ? from : from, text.length);
    const searchFrom = keep ? match[0].length : 0;
    const stop = REASON_END.exec(rest.slice(searchFrom).toLowerCase());
    const raw = rest
      .slice(0, stop ? searchFrom + stop.index : rest.length)
      .trim()
      .replace(/^(?:of|for)\s+/i, "")
      .replace(/[,\s]+$/g, "");
    if (raw.split(/\s+/).length < 2 && !/^(?:school|family|health|childcare|transportation|pay|scheduling|moving)$/i.test(raw)) {
      continue;
    }
    return sentence(raw);
  }
  return null;
}

/** "she's moving to Denver" → "She's moving to Denver." */
function sentence(text: string): string {
  const trimmed = text.trim().slice(0, 200);
  const capital = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return /[.!]$/.test(capital) ? capital : `${capital}.`;
}

/* ------------------------------------------------------------ reading -- */

function readAnswers(turn: string): Partial<Record<ExitAnswerKey, Reading>> {
  const out: Partial<Record<ExitAnswerKey, Reading>> = {};
  const put = (key: ExitAnswerKey, reading: Reading) => {
    if (reading === undefined) return;
    const current = out[key];
    out[key] = current === undefined ? reading : current === reading ? current : "conflict";
  };

  for (const sentence of statements(turn)) {
    let previous: Returns = { items: undefined, key: undefined };
    for (const clause of clauses(sentence)) {
      const found = returnsIn(clause);
      let { items, key } = found;
      if (items === undefined && elliptical(clause, ITEM)) items = flip(previous.key ?? previous.items);
      if (key === undefined && elliptical(clause, KEY)) key = flip(previous.items ?? previous.key);
      if (items === undefined && sharedVerb(clause, ITEM)) items = previous.key ?? previous.items;
      if (key === undefined && sharedVerb(clause, KEY)) key = previous.items ?? previous.key;

      put("store_items_returned", items);
      put("salon_key_returned", key);
      put("payroll_deduction_applicable", payrollDeduction(clause));
      put("dropped_to_minimum_wage", minimumWage(clause));
      put("forfeit_bonus", bonusForfeited(clause));
      put("eligible_for_rehire", rehireEligible(clause));
      previous = { items, key };
    }
  }
  return out;
}

/**
 * Everything the manager's words establish for the Details lines.
 *
 * `today` is the business day, for the dates `exit-facts.ts` reads.
 */
export function readExitDetails(rawText: string, today: string, facts?: ExitFacts): ExitDetails {
  const text = normalize(rawText);
  const turns = text.split(JOIN).map((turn) => turn.trim()).filter(Boolean);
  const exitFacts = facts ?? readExitFacts(text, today);

  const answers: Partial<Record<ExitAnswerKey, YesNo>> = {};
  const ambiguities: ExitDetailAmbiguity[] = [];
  let method: string | null = null;
  let reason: string | null = null;

  const settled: Partial<Record<ExitAnswerKey, Reading>> = {};
  for (const turn of turns) {
    // THE LATER TURN WINS: a turn that answers a question replaces the answer.
    for (const [key, reading] of Object.entries(readAnswers(turn)) as [ExitAnswerKey, Reading][]) {
      if (reading !== undefined) settled[key] = reading;
    }
    method = joinMethods(methodsIn(turn)) ?? method;
    reason = reasonIn(turn) ?? reason;
  }
  for (const key of EXIT_ANSWER_KEYS) {
    const reading = settled[key];
    if (reading === "conflict") ambiguities.push({ kind: "answer_conflict", key });
    else if (reading) answers[key] = reading;
  }

  return {
    resignationDate: exitFacts.resignationDate,
    resignationMethod: method,
    resignationReason: reason,
    answers,
    ambiguities,
  };
}

/** The Details answers as form values, keyed the way the stored version keys them. */
export function exitDetailValues(details: ExitDetails): {
  values: Record<string, string>;
  checked: Record<string, string[]>;
} {
  const values: Record<string, string> = {};
  if (details.resignationDate) values[EXIT_DETAIL_FIELDS.resignationDate] = details.resignationDate;
  if (details.resignationMethod) values[EXIT_DETAIL_FIELDS.resignationMethod] = details.resignationMethod;
  if (details.resignationReason) values[EXIT_DETAIL_FIELDS.resignationReason] = details.resignationReason;
  const checked: Record<string, string[]> = {};
  for (const [key, answer] of Object.entries(details.answers)) {
    if (answer) checked[key] = [answer];
  }
  return { values, checked };
}

/** Whether the manager's words answered anything on the Details lines. */
export function exitDetailsSupplied(details: ExitDetails): boolean {
  return (
    details.resignationMethod !== null ||
    details.resignationReason !== null ||
    Object.keys(details.answers).length > 0 ||
    details.ambiguities.length > 0
  );
}

/* ---------------------------------------------------------- corrections -- */

const INFORMATION_REQUEST =
  /^\s*(?:please\s+)?(?:tell me|explain|show me|remind me|walk me through|help me|find|look up|search|i need to know|i want to know|wondering)\b/i;

/**
 * Every exit-form key a chat correction may reach: HR's Details lines, the
 * form's own dates and Resignation Details boxes, and the employee's name.
 */
export const EXIT_CORRECTABLE_KEYS: ReadonlySet<string> = new Set([
  ...EXIT_STATED_KEYS,
  ...EXIT_DERIVED_KEYS,
  "employee_name",
]);

/**
 * ============================================================================
 * "ACTUALLY SHE DID BRING THE KEY BACK" — A CORRECTION TO THE OPEN EXIT FORM
 * ============================================================================
 *
 * Read with the same two readers the draft was filled from, over the ONE turn
 * being answered, and returned as the manager's own edit (it replaces what is
 * there, because replacing is what they asked for). A question is never a
 * correction, and a turn neither reader finds anything in returns null so the
 * conversation carries on as usual.
 *
 * A REQUEST FOR INFORMATION IS NOT A CORRECTION EITHER. "Tell me the rehire
 * policy for no call no shows" has no question mark and would otherwise tick
 * No Call No Show on somebody's record. A turn that opens like a question or
 * a request, or talks about policy, is left to the ordinary conversation —
 * the manager can still change the form by hand.
 *
 * HOW THEY LEFT REPLACES BOTH BOXES. "Actually she was a no call no show"
 * ticks No Call No Show and clears Submitted & Fulfilled Notice, rather than
 * leaving the form saying both.
 */
export function exitCorrectionValues(
  text: string,
  today: string,
): { values: Record<string, string>; checked: Record<string, string[]> } | null {
  if (isQuestion(text) || INFORMATION_REQUEST.test(text) || /\bpolic(?:y|ies)\b/i.test(text)) return null;
  const facts = readExitFacts(text, today);
  const { values, checked } = exitDetailValues(readExitDetails(text, today, facts));
  const derived = exitFactValues(facts);
  Object.assign(values, derived.values);
  if (facts.noticeOptions.length + facts.typeOptions.length > 0) {
    checked[EXIT_NOTICE_GROUP] = facts.noticeOptions;
    checked[EXIT_TYPE_GROUP] = facts.typeOptions;
  }
  return Object.keys(values).length + Object.keys(checked).length > 0 ? { values, checked } : null;
}
