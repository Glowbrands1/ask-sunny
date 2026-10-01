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
  /\b(?:re-?draft|re-?write|rewrite|revise|redo|re-?do|update|edit|change|amend|modify|fix|tweak|adjust|add|include|insert|put|mention|remove|delete|drop|take out|clear|replace|swap|correct|clean up|set|mark|tick|untick|select|unselect|reword|rephrase|shorten|lengthen|expand|tighten|soften|make (?:it|the|this|that))\b/i;

/** Asking for ANOTHER form, which is the ordinary proposal flow's job. */
const ASKS_FOR_A_FORM =
  /\b(?:create|start|open|pull up)\b|\b(?:new|another|second|separate|different)\s+(?:\w+\s+){0,2}form\b|\bdraft\s+(?:a|an|another|me)\b|\b(?:make|need|want)\s+(?:a|an|me a|another)\s+(?:\w+\s+){0,2}form\b/i;

/** A question about the form, not a request to change it. */
const ASKS_ABOUT =
  /^\s*(?:what|why|how|when|where|who|which|should|is|are|does|do|did|was|were|will|would)\b[^.!]*\?\s*$/i;

const REMOVAL =
  /\b(?:remove|delete|drop|take out|clear|get rid of|blank out|empty|leave\s+(?:\w+\s+){0,3}(?:blank|empty))\b/i;

/** Verbs that can only mean the document: "redraft it", "reword the details". */
const REDRAFT_VERB =
  /\b(?:re-?draft|re-?write|rewrite|revise|redo|re-?do|reword|rephrase)\b/i;

/**
 * What the request is ABOUT, for the ordinary verbs. "Can you mention our
 * attendance policy?" with a form open is a question for the knowledge base;
 * "mention it in the details" and "add that she was 15 minutes late" are
 * changes to the form.
 */
const POINTS_AT_THE_FORM =
  /\b(?:form|draft|it|details|field|section|wording|line|box|observation|evidence|expectation|follow[- ]?up|timeframe|topic|progress|next step|summary|write[- ]?up|other)\b|\badd\s+that\b/i;

/** Whether a turn asks to change the form that is open. */
export function isRevisionRequest(question: string): boolean {
  const text = question ?? "";
  if (!REVISE_VERB.test(text)) return false;
  if (ASKS_FOR_A_FORM.test(text)) return false;
  if (ASKS_ABOUT.test(text)) return false;
  return REDRAFT_VERB.test(text) || POINTS_AT_THE_FORM.test(text);
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
  /** Keys the model changed that the request did not name — left as they were. */
  readonly untouched: string[];
}

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().join("|") === [...b].sort().join("|");

/**
 * Turns what the model proposed into what may be written.
 *
 * `proposed` is the model's output; `current` is the stored form. Nothing that
 * is not in `proposed` can appear in the plan.
 */
export function planRevision(input: {
  question: string;
  fields: readonly RevisableField[];
  current: ReadonlyMap<string, CurrentValue>;
  proposed: { values?: Record<string, unknown>; checked?: Record<string, unknown>; clear?: unknown };
}): RevisionPlan {
  const named = fieldsNamedIn(input.question, input.fields);
  const known = new Set(input.fields.map((field) => field.key));
  const untouched: string[] = [];

  const mayChange = (key: string): boolean => {
    if (!known.has(key)) return false;
    if (named.size > 0) return named.has(key);
    // Nothing named: an overall rewrite. Sunny's own text may change; the manager's may not.
    return (input.current.get(key)?.filledBy ?? "ai") !== "manager";
  };

  const values: Record<string, string> = {};
  for (const [key, raw] of Object.entries(input.proposed.values ?? {})) {
    if (typeof raw !== "string" || raw.trim() === "") continue;
    const before = (input.current.get(key)?.value ?? "").trim();
    if (raw.trim() === before) continue;
    if (!mayChange(key)) {
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
    if (!mayChange(key)) {
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
  if (asksToRemove(input.question) && Array.isArray(input.proposed.clear)) {
    for (const key of input.proposed.clear) {
      if (typeof key !== "string" || !named.has(key)) continue;
      const before = input.current.get(key);
      const hasValue = (before?.value ?? "").trim() !== "" || (before?.checked ?? []).length > 0;
      if (hasValue && !(key in values) && !(key in checked)) cleared.push(key);
    }
  }

  return { values, checked, cleared, untouched: [...new Set(untouched)] };
}
