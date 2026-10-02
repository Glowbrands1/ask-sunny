/**
 * ============================================================================
 * A REDRAFT CHANGES WHAT WAS ASKED FOR, AND NOTHING ELSE
 * ============================================================================
 *
 * Production feedback: a manager asked Sunny to redraft a coaching form "with
 * changes", and fields that had been on it — Follow-Up Observation, Progress
 * Level, Specific Evidence, the agreed follow-up timeframe — were gone.
 *
 * THE ROOT CAUSE WAS THAT NO REDRAFT EXISTED. The drafting route runs once,
 * when a form is created, from the conversation's notes. A later "redraft it
 * with these changes" either went to the knowledge base and changed nothing,
 * or — if it said "coaching form" — proposed a NEW form: a new record, drafted
 * from scratch, and, when the form on screen was the Follow-Up Coaching Form,
 * a different TEMPLATE with none of those fields on it at all.
 *
 * So a revision is now a change to the form that is already open, decided
 * here:
 *
 *   THE SAME RECORD. The open instance, its template and its pinned version.
 *   A revision never creates a form.
 *
 *   THE CURRENT VALUES GO IN. The model is shown what the form says now and
 *   asked to return ONLY what the request changes.
 *
 *   EVERYTHING ELSE STAYS, BY CONSTRUCTION. Only the keys the model returns are
 *   written. A field it leaves out is not touched — not re-drafted, not
 *   cleared, not re-attributed.
 *
 *   A NAMED FIELD LIMITS THE CHANGE. "Change the follow-up to two weeks" may
 *   change Next Follow-Up and nothing else, however much else the model
 *   "improved" while it was there.
 *
 *   WHAT THE MANAGER WROTE IS THEIRS. A field the manager typed or edited is
 *   changed only when the request names it.
 *
 *   NOTHING IS CLEARED UNLESS THE REQUEST SAYS REMOVE, and names what.
 *
 * PURE: no I/O. `chat-revision.ts` loads, calls the model and saves.
 */

/** The coaching documents. A revision of any other family is not handled here. */
export const REVISABLE_LAYOUT_FAMILIES: ReadonlySet<string> = new Set(["coaching"]);

const REVISE_VERB =
  /\b(?:re-?draft|re-?write|rewrite|revise|redo|re-?do|update|edit|change|amend|modify|fix|tweak|adjust|add|include|insert|put|mention|remove|delete|drop|take out|clear|replace|swap|correct|clean up|set|mark|tick|untick|select|unselect|reword|rephrase|shorten|lengthen|expand|tighten|soften|polish|rework|tidy(?:\s+up)?|make (?:it|the|this|that))\b|\bclean\s+(?:this|it|that)\s+up\b/i;

/*
 * ASKING FOR ANOTHER FORM, which is the ordinary proposal flow's job.
 *
 * PRODUCTION QA OF PR #81: two natural edits were read as requests for a NEW
 * form and went to the knowledge base, changing nothing —
 *
 *   "Can you re-draft a cleaner version with the next follow-up as within 10
 *    days?"        "draft a" inside "re-draft a", and "a … version" of THIS form
 *   "Please open the form and change the timeframe to within 10 days."
 *                   "open" alone, where "open THE form" is the one on screen
 *
 * So "draft a" counts only as its own word and never before "version", and
 * "open" / "pull up" only with an article that introduces a different form.
 */
const ASKS_FOR_A_FORM =
  /\b(?:create|start)\b|\b(?:open|pull\s+up)\s+(?:a|an|another|new|up\s+a)\b|\b(?:new|another|second|separate|different)\s+(?:\w+\s+){0,2}form\b|(?<![\w-])draft\s+(?:a|an|another|me)\b(?!\s+(?:\w+\s+)?(?:version|copy|rewrite|revision)\b)|\b(?:make|need|want)\s+(?:a|an|me a|another)\s+(?:\w+\s+){0,2}form\b/i;

/** A question about the form, not a request to change it. */
const ASKS_ABOUT =
  /^\s*(?:what|why|how|when|where|who|which|should|is|are|does|do|did|was|were|will|would)\b[^.!]*\?\s*$/i;

const REMOVAL =
  /\b(?:remove|delete|drop|take out|clear|get rid of|blank out|empty|leave\s+(?:\w+\s+){0,3}(?:blank|empty))\b/i;

/** Verbs that can only mean the document: "redraft it", "reword the details". */
const REDRAFT_VERB =
  /\b(?:re-?draft|re-?write|rewrite|revise|redo|re-?do|reword|rephrase|polish|rework)\b|\bclean\s+(?:this|it|that)\s+up\b/i;

/**
 * What the request is ABOUT, for the ordinary verbs. "Can you mention our
 * attendance policy?" with a form open is a question for the knowledge base;
 * "mention it in the details" and "add that she was 15 minutes late" are
 * changes to the form.
 */
const POINTS_AT_THE_FORM =
  /\b(?:form|draft|it|details|field|section|wording|line|box|observation|evidence|expectation|follow[- ]?up|timeframe|topic|progress|next step|summary|write[- ]?up|other|version)\b|\badd\s+that\b|\b(?:this|that)\s+(?:cleaner|clearer|better|shorter|tighter)\b/i;

/** Whether a turn asks to change the form that is open. */
export function isRevisionRequest(question: string): boolean {
  const text = question ?? "";
  if (ASKS_FOR_A_FORM.test(text)) return false;
  if (ASKS_ABOUT.test(text)) return false;
  // "Follow up again in 10 days", "check back within two weeks": the timeframe, stated.
  if (statesFollowUpTimeframe(text)) return true;
  if (!REVISE_VERB.test(text)) return false;
  return REDRAFT_VERB.test(text) || POINTS_AT_THE_FORM.test(text);
}

/* ------------------------------------------ the timeframe, and the date --- */

/*
 * ============================================================================
 * THE AGREED TIMEFRAME IS NOT THE CALENDAR DATE
 * ============================================================================
 *
 * The Follow-Up Coaching Form's Next Follow-Up records what the manager and
 * employee AGREED ("within 2 weeks"). The form's follow-up DATE is instance
 * metadata, set through its own route and shown as its own control.
 *
 * PRODUCTION QA OF PR #81: "Change the follow-up date to 10/15" never moved
 * the date, and could put "10/15" into Next Follow-Up instead — with a reply
 * saying Next Follow-Up was updated. The two are now told apart BEFORE the
 * model is asked anything: a turn about the DATE never reaches the timeframe
 * field, and a turn about the TIMEFRAME never moves the date.
 */
const QUANTITY =
  String.raw`(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fourteen|thirty|couple(?:\s+of)?|few|\d+)\s+(?:more\s+)?(?:business\s+)?(?:days?|weeks?|months?|shifts?)`;
const TIMEFRAME_STATEMENT = new RegExp(
  [
    String.raw`\b(?:follow[- ]?up|check\s+(?:back|in|again)|revisit\s+(?:it|this))\s+(?:with\s+(?:her|him|them)\s+)?(?:again\s+)?(?:in|within|after)\s+(?:the\s+next\s+)?${QUANTITY}\b`,
    String.raw`\bnext\s+follow[- ]?up\s+(?:should\s+be|will\s+be|is|in|within)\b(?!\s+(?:on|for)\b)`,
    String.raw`\b(?:follow[- ]?up|check\s+back)\s+(?:again\s+)?(?:next\s+(?:week|month|shift)|at\s+(?:her|his|their)\s+next\s+\w+)\b`,
  ].join("|"),
  "i",
);
/** "Make the follow up 10 days instead", "push the follow-up to two weeks". */
const TIMEFRAME_INSTRUCTION = new RegExp(
  String.raw`\b(?:make|change|set|move|push|update|adjust|extend|shorten)\s+(?:the\s+|her\s+|his\s+|their\s+)?(?:next\s+)?follow[- ]?up\s+(?:timeframe\s+)?(?:to\s+|for\s+|in\s+|within\s+|be\s+|out\s+to\s+)?(?:\w+\s+)?${QUANTITY}`,
  "i",
);

const DATE_PHRASE =
  /\bfollow[- ]?up\s+date\b|\bdate\s+(?:of|for)\s+(?:the\s+|her\s+|his\s+)?(?:next\s+)?follow[- ]?up\b|\b(?:schedule|book|calendar)\s+(?:the\s+|her\s+|his\s+|their\s+|a\s+)?(?:next\s+)?follow[- ]?up\b|\bfollow[- ]?up\s+(?:on|for)\s+(?:next\s+)?(?=\d|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|mon|tue|wed|thu|fri|sat|sun)/i;

/** Whether the manager stated the agreed timeframe ("check back within two weeks"). */
export function statesFollowUpTimeframe(question: string): boolean {
  const text = question ?? "";
  if (DATE_PHRASE.test(text)) return false;
  return TIMEFRAME_STATEMENT.test(text) || TIMEFRAME_INSTRUCTION.test(text);
}

/** Whether the turn is about the follow-up's calendar DATE rather than its timeframe. */
export function asksAboutFollowUpDate(question: string): boolean {
  return DATE_PHRASE.test(question ?? "");
}

export function asksToRemove(question: string): boolean {
  return REMOVAL.test(question ?? "");
}

/* ------------------------------------------------------ which fields --- */

/**
 * The words a manager uses for each coaching field. The label is always an
 * alias; these are the shorter ways people actually say it. Longer phrases are
 * matched first and consumed, so "next follow-up" is not also read as part of
 * another field.
 *
 * DELIBERATELY NO BARE WORDS THAT ALSO DESCRIBE WHAT HAPPENED — "progress",
 * "improved", "follow-up". "She's made real progress since our talk, add that"
 * is new information for the form, not a request to touch Progress Level
 * alone, and reading it as a named field would stop the observation being
 * written.
 */
const FIELD_ALIASES: Record<string, readonly string[]> = {
  coaching_details: ["details of coaching", "details", "observed", "observation section", "expectation", "going forward", "narrative", "description", "write-up", "write up", "summary"],
  other_topic: ["other topic"],
  coaching_type: ["type of coaching", "coaching type"],
  coaching_topics: ["topic of coaching", "coaching topic", "topics", "topic"],
  original_topic: ["original coaching topic", "original topic"],
  original_expectation: ["original expectation"],
  follow_up_observation: ["follow-up observation", "follow up observation", "followup observation", "observation"],
  progress_level: ["progress level"],
  specific_evidence: ["specific evidence", "evidence"],
  additional_coaching: ["additional coaching completed", "additional coaching"],
  next_step: ["next step", "next steps", "role-play", "role play", "leadership review"],
  next_follow_up: ["next follow-up", "next follow up", "follow-up timeframe", "follow up timeframe", "timeframe", "follow up in", "follow-up in", "follow up within", "follow-up within"],
};

export interface RevisableField {
  readonly key: string;
  readonly label: string;
  /** A checkbox group's options, so "tick retraining" names the group it belongs to. */
  readonly options?: readonly { readonly key: string; readonly label: string }[];
}

function normalize(text: string): string {
  return ` ${text.toLowerCase().replace(/[’']/g, "").replace(/\s+/g, " ")} `;
}

/** The fields a request names, by label or alias, in no particular order. */
export function fieldsNamedIn(question: string, fields: readonly RevisableField[]): Set<string> {
  const phrases: { key: string; phrase: string }[] = [];
  for (const field of fields) {
    const aliases = [field.label, ...(FIELD_ALIASES[field.key] ?? [])];
    for (const alias of aliases) {
      const phrase = alias.toLowerCase().trim();
      if (phrase.length >= 4) phrases.push({ key: field.key, phrase });
    }
  }
  phrases.sort((a, b) => b.phrase.length - a.phrase.length);

  /*
   * THE FORM'S OWN NAME IS NOT A FIELD. "Redraft the follow-up coaching form"
   * names the document, and must not read as "change the follow-up".
   */
  let text = normalize(question).replace(
    /(?:follow[- ]?up\s+)?coaching\s+(?:form|note|document|record)s?|\bthe\s+form\b/g,
    " ",
  );
  const named = new Set<string>();
  for (const { key, phrase } of phrases) {
    const pattern = new RegExp(`(?<![a-z])${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/[- ]/g, "[- ]?")}(?![a-z])`, "g");
    if (pattern.test(text)) {
      named.add(key);
      text = text.replace(pattern, " ");
    }
  }
  return named;
}

/*
 * ============================================================================
 * NAMING A FIELD IS NOT THE SAME AS ASKING TO CHANGE IT
 * ============================================================================
 *
 * PRODUCTION QA OF PR #81: "Add this to the form: Kaitlyn improved and
 * followed the sanitizing procedure correctly during today's observation"
 * updated Follow-Up Observation ONLY — "observation" is that field's alias,
 * so the sentence was read as an instruction to change that one field, and
 * the evidence and the progress the manager had just described were refused.
 *
 * A field limits a revision only where the manager is INSTRUCTING a change to
 * it: an edit verb just before it ("change the timeframe", "set the progress
 * level", "remove the additional coaching", "tick retraining"), or a value
 * just after it ("the timeframe should be within 10 days", "next follow-up as
 * within 10 days"). The same word in the manager's account of what happened —
 * "during today's observation" — is evidence, not an instruction.
 *
 * "KEEP THE EVIDENCE AS IT IS" PROTECTS. A field after keep / leave / don't
 * change is never changed, whatever else the turn asks for.
 */
const INSTRUCTION_VERB =
  /\b(?:change|changes|update|edit|set|make|put|add|remove|delete|drop|clear|replace|swap|fix|correct|reword|rephrase|rewrite|re-?write|redraft|re-?draft|revise|adjust|modify|amend|mark|tick|untick|check|uncheck|select|unselect|choose|pick|shorten|lengthen|expand|tighten|soften|tidy|clean|fill|move|switch|polish|rework|empty|blank)\b/;
/** A value given straight after the field, whatever came before it. */
const VALUE_AFTER = /^\s*(?:(?:field|section|box|line|part)\s+)?(?:should\s+(?:be|say|read)|needs?\s+to\s+(?:be|say|read)|=|:|is\s+now\b|instead\b)/;
/** A value given after the field, in a clause that already carries an edit verb. */
const VALUE_AFTER_VERB = /^\s*(?:(?:field|section|box|line|part)\s+)?(?:to|as|into|with)\s+\S/;
const PROTECTED_BEFORE =
  /\b(?:keep|leave|dont\s+(?:change|touch)|do\s+not\s+(?:change|touch)|without\s+changing|not)\s+(?:the\s+|her\s+|his\s+|their\s+|my\s+|any\s+of\s+the\s+)?$/;

function clauseBefore(text: string): string {
  return text.split(/[.;!?]/).pop() ?? "";
}

interface FieldMentions {
  readonly instructed: Set<string>;
  readonly protectedKeys: Set<string>;
}

function readFieldMentions(question: string, fields: readonly RevisableField[]): FieldMentions {
  const phrases: { key: string; phrase: string }[] = [];
  for (const field of fields) {
    const aliases = [field.label, ...(FIELD_ALIASES[field.key] ?? []), ...(field.options ?? []).map((option) => option.label)];
    for (const alias of aliases) {
      const phrase = alias.toLowerCase().replace(/[’']/g, "").trim();
      if (phrase.length >= 4) phrases.push({ key: field.key, phrase });
    }
  }
  phrases.sort((a, b) => b.phrase.length - a.phrase.length);

  let text = normalize(question).replace(
    /(?:follow[- ]?up\s+)?coaching\s+(?:form|note|document|record)s?|\bthe\s+form\b/g,
    (match) => " ".repeat(match.length),
  );
  const instructed = new Set<string>();
  const protectedKeys = new Set<string>();
  for (const { key, phrase } of phrases) {
    const pattern = new RegExp(
      `(?<![a-z])${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/[- ]/g, "[- ]?")}(?![a-z])`,
      "g",
    );
    for (const match of text.matchAll(pattern)) {
      const index = match.index ?? 0;
      const before = clauseBefore(text.slice(0, index));
      const after = text.slice(index + match[0].length);
      if (PROTECTED_BEFORE.test(before)) {
        protectedKeys.add(key);
        continue;
      }
      const lastWords = before.trim().split(/\s+/).filter(Boolean).slice(-3).join(" ");
      if (
        INSTRUCTION_VERB.test(lastWords) ||
        VALUE_AFTER.test(after) ||
        (INSTRUCTION_VERB.test(before) && VALUE_AFTER_VERB.test(after))
      ) {
        instructed.add(key);
      }
    }
    // Consumed, so a shorter alias inside a longer one is not read twice.
    text = text.replace(pattern, (found) => " ".repeat(found.length));
  }
  for (const key of protectedKeys) instructed.delete(key);
  return { instructed, protectedKeys };
}

/**
 * The fields the manager is INSTRUCTING a change to — see the note above.
 * The agreed timeframe stated in passing ("check back within two weeks")
 * instructs Next Follow-Up; a turn about the follow-up DATE never does.
 */
export function instructedFieldsIn(question: string, fields: readonly RevisableField[]): Set<string> {
  const { instructed } = readFieldMentions(question, fields);
  const hasTimeframe = fields.some((field) => field.key === "next_follow_up");
  if (hasTimeframe && statesFollowUpTimeframe(question)) instructed.add("next_follow_up");
  if (asksAboutFollowUpDate(question) && !/\btimeframe\b/i.test(question)) instructed.delete("next_follow_up");
  return instructed;
}

/*
 * ============================================================================
 * HOW MUCH OF THE FORM A REQUEST MAY TOUCH
 * ============================================================================
 *
 * PRODUCTION QA OF PR #81: with no field named — "make the follow up 10 days
 * instead", "redraft it with changes" — every Sunny-written field was open, so
 * a model that rewrote Original Topic, Follow-Up Observation, Progress Level
 * and Next Step had all of it saved. Only the prompt stood in the way.
 *
 * Every request is now one of four, and the MERGE enforces it — not the prompt:
 *
 *   fields    the manager instructed a change to named fields. Those, and
 *             nothing else.
 *   findings  the manager reported a follow-up (Follow-Up Coaching Form). The
 *             findings their words support, and nothing else.
 *   additive  new information to put on the form ("add that she was 15
 *             minutes late"). Text fields only; what a field already says is
 *             kept; no checkbox changes.
 *   wording   "redraft it cleaner", "make it read better". Text that is
 *             already there, reworded — the substance kept, nothing emptied,
 *             nothing new filled in, no checkbox changes.
 *
 * In every mode the manager's own text is changed only when instructed, and
 * nothing is cleared without "remove" naming it.
 */
export type RevisionMode = "fields" | "findings" | "additive" | "wording";

export interface RevisionScope {
  readonly mode: RevisionMode;
  /** For `fields`, the instructed keys; for `findings`, the supported findings. */
  readonly keys: ReadonlySet<string>;
  /** Fields the manager said to keep as they are. */
  readonly protectedKeys: ReadonlySet<string>;
}

const ADDS_INFORMATION =
  /\b(?:add|include|insert|put|mention|note|append)\b|:\s*\S/i;

export function scopeRevision(
  question: string,
  fields: readonly RevisableField[],
  /** The findings a follow-up report in this turn supports — empty when it is not one. */
  followUpFindings: ReadonlySet<string> = new Set(),
): RevisionScope {
  const { protectedKeys } = readFieldMentions(question, fields);
  const instructed = instructedFieldsIn(question, fields);
  for (const key of protectedKeys) instructed.delete(key);
  if (instructed.size > 0) return { mode: "fields", keys: instructed, protectedKeys };
  if (followUpFindings.size > 0) return { mode: "findings", keys: followUpFindings, protectedKeys };
  if (ADDS_INFORMATION.test(question ?? "")) return { mode: "additive", keys: new Set(), protectedKeys };
  return { mode: "wording", keys: new Set(), protectedKeys };
}

/*
 * ============================================================================
 * A REWORDING KEEPS WHAT THE FIELD SAID
 * ============================================================================
 *
 * The test for "this is the same text, better written" rather than "this is
 * different text": most of the field's content words survive, and every
 * number in it survives (as a digit or as its word — "2 beds" may become
 * "two beds"). "REWRITTEN", or a different account, is refused and the field
 * keeps what it said.
 */
const SUBSTANCE_STOP = new Set([
  "that", "this", "with", "from", "have", "been", "were", "will", "would", "should", "could",
  "their", "there", "they", "them", "then", "than", "when", "what", "which", "while", "also",
  "into", "onto", "over", "very", "just", "each", "every", "after", "before", "about", "being",
]);
const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];

function contentWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[’']/g, "")
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length >= 4 && !SUBSTANCE_STOP.has(word))
      .map((word) => word.replace(/(?:ing|ed|es|s)$/, "")),
  );
}

export function keepsSubstance(before: string, after: string): boolean {
  const lowerAfter = after.toLowerCase();
  for (const number of before.match(/\d+/g) ?? []) {
    const word = NUMBER_WORDS[Number(number)];
    if (!lowerAfter.includes(number) && !(word && new RegExp(`\\b${word}\\b`).test(lowerAfter))) return false;
  }
  const original = contentWords(before);
  if (original.size === 0) return true;
  const revised = contentWords(after);
  let kept = 0;
  for (const word of original) if (revised.has(word)) kept += 1;
  return kept / original.size >= 0.6;
}

/* ---------------------------------------------------------- the merge --- */

export interface CurrentValue {
  readonly value: string | null;
  readonly checked: readonly string[];
  /** Who last wrote it: "ai", "manager", "system", … */
  readonly filledBy: string;
}

export interface RevisionPlan {
  readonly values: Record<string, string>;
  readonly checked: Record<string, string[]>;
  /** Keys to empty, on an explicit removal. */
  readonly cleared: string[];
  /** Keys the model changed that the request did not allow — left as they were. */
  readonly untouched: string[];
  /** What the request was allowed to touch. */
  readonly scope: RevisionScope;
}

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().join("|") === [...b].sort().join("|");

/**
 * Turns what the model proposed into what may be written.
 *
 * `proposed` is the model's output; `current` is the stored form. Nothing that
 * is not in `proposed` can appear in the plan, and nothing outside the
 * request's scope (see `scopeRevision`) can either.
 */
export function planRevision(input: {
  question: string;
  fields: readonly RevisableField[];
  current: ReadonlyMap<string, CurrentValue>;
  proposed: { values?: Record<string, unknown>; checked?: Record<string, unknown>; clear?: unknown };
  scope?: RevisionScope;
}): RevisionPlan {
  const scope = input.scope ?? scopeRevision(input.question, input.fields);
  const known = new Set(input.fields.map((field) => field.key));
  const untouched: string[] = [];
  const isManagers = (key: string) => (input.current.get(key)?.filledBy ?? "ai") === "manager";

  const mayChangeText = (key: string, revised: string): boolean => {
    if (!known.has(key) || scope.protectedKeys.has(key)) return false;
    const before = (input.current.get(key)?.value ?? "").trim();
    switch (scope.mode) {
      case "fields":
        return scope.keys.has(key);
      case "findings":
        return scope.keys.has(key) && !isManagers(key);
      case "additive":
        return !isManagers(key) && (before === "" || keepsSubstance(before, revised));
      case "wording":
        return !isManagers(key) && before !== "" && keepsSubstance(before, revised);
    }
  };
  const mayChangeGroup = (key: string): boolean => {
    if (!known.has(key) || scope.protectedKeys.has(key)) return false;
    if (scope.mode === "fields") return scope.keys.has(key);
    if (scope.mode === "findings") return scope.keys.has(key) && !isManagers(key);
    // Ticks are decisions. Rewording or adding a sentence never changes one.
    return false;
  };

  const values: Record<string, string> = {};
  for (const [key, raw] of Object.entries(input.proposed.values ?? {})) {
    if (typeof raw !== "string" || raw.trim() === "") continue;
    const before = (input.current.get(key)?.value ?? "").trim();
    if (raw.trim() === before) continue;
    if (!mayChangeText(key, raw.trim())) {
      if (known.has(key)) untouched.push(key);
      continue;
    }
    values[key] = raw.trim();
  }

  const checked: Record<string, string[]> = {};
  for (const [key, raw] of Object.entries(input.proposed.checked ?? {})) {
    if (!Array.isArray(raw)) continue;
    const options = raw.filter((option): option is string => typeof option === "string");
    if (options.length === 0) continue;
    if (sameList(options, input.current.get(key)?.checked ?? [])) continue;
    if (!mayChangeGroup(key)) {
      if (known.has(key)) untouched.push(key);
      continue;
    }
    checked[key] = options;
  }

  /*
   * A CLEAR NEEDS BOTH WORDS: "remove" and the field. "Rewrite it" never
   * empties anything, and neither does a model that decided a field was
   * better left blank.
   */
  const cleared: string[] = [];
  if (scope.mode === "fields" && asksToRemove(input.question) && Array.isArray(input.proposed.clear)) {
    for (const key of input.proposed.clear) {
      if (typeof key !== "string" || !scope.keys.has(key)) continue;
      const before = input.current.get(key);
      const hasValue = (before?.value ?? "").trim() !== "" || (before?.checked ?? []).length > 0;
      if (hasValue && !(key in values) && !(key in checked)) cleared.push(key);
    }
  }

  return { values, checked, cleared, untouched: [...new Set(untouched)], scope };
}
