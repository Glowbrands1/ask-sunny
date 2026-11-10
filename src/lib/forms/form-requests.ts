import "server-only";

import { signedStepNotARequestEnabled } from "@/lib/config/chat-quality-flags";

import { extractEmployeeNames, samePerson } from "./proposal";
import { detectTemplateIntent } from "./template-intent";

/*
 * Ported from the sibling app (`forms/form-requests.ts`, with its two helpers
 * from `forms/message-parts.ts` inline) for TWO_FORMS_OWN_PERSON_ENABLED
 * (QA, 6 Nov 2026, row 6). This app still makes one card per message; the
 * reading tells `ai/two-forms-own-person.ts` which person that card's own
 * clause names, and which other requests to name back.
 */

/** Words that open a clause without being part of what it says. */
const LEAD_IN = /^(?:and|also|plus|oh|ok|okay|btw|then|so)\b[,\s]*/i;

/** Each sentence of `text`, as typed; a point inside an amount ("$3.25") does not end one. */
function sentencesOf(text: string): string[] {
  return [...text.matchAll(/(?:[^.!?\n]|\.(?=\d))+[.!?]*/g)].map((match) => match[0].trim()).filter(Boolean);
}

/**
 * ============================================================================
 * "COACHING FORM FOR AVERY AND A CA FOR JORDAN" — SEVERAL FORMS, ONE MESSAGE
 * ============================================================================
 *
 * Signed-in QA, 8 Oct 2026: that message produced ONE Coaching card asking
 * "Avery or Jordan?", and the Corrective Action was never mentioned again.
 * The form path answered one request per turn (in the sibling app), and a message with two people
 * in it read as a single request whose person was unclear.
 *
 * A manager who asks for two forms has asked for two forms. This reads the
 * message into its separate requests — each with its own form, its own person
 * and its own words — so each becomes its own proposal, its own card and its
 * own draft. What one clause says is never read into the other's form.
 *
 * WHAT COUNTS AS A SEPARATE REQUEST
 *
 *   - a clause that names a form AND asks for it with a verb or names the
 *     person it is for: "coaching form for Avery", "and a CA for Jordan";
 *   - a bare form clause beside another request: "a coaching form and a CA
 *     for Jordan" — both for Jordan, the one person named;
 *   - a further person for the form just named: "coaching forms for Avery
 *     and Jordan" — one Coaching Form each.
 *
 * WHAT DOES NOT
 *
 *   - a form REPLACED: "coaching form for Avery, actually make it a CA" is one
 *     form, corrected (`REPLACES_IT`), and the single-form path reads it;
 *   - a form DECLINED: "a coaching form for Avery but no CA for Jordan";
 *   - a form only CONDITIONAL: "and if Jordan is late again, a CA" — nothing
 *     has happened yet to write up (`conditionalRequests` reports these);
 *   - a topic: "coaching - policy review" names no second request.
 *
 * Fewer than two requests is null: the single-form path is unchanged.
 */

export interface FormRequest {
  /** The form, as `detectTemplateIntent` reads the clause. Still validated against the library. */
  templateKey: string;
  /** The person this request is for, when the message settles it; null when it does not. */
  employeeName: string | null;
  /** The manager's own words for this request — what its draft is written from. */
  clause: string;
}

const ASKS_FOR_IT =
  /\b(?:create|make|start|draft|do|file|write|need|needs|pull\s+up|open|prepare|get\s+me|fill\s+out|give|issue)\b/i;
const REPLACES_IT =
  /\b(?:actually|instead|rather|switch|change\s+it|make\s+it|swap)\b|\bnot\s+(?:a|an|the)\s+(?:\S+\s+){0,2}?(?:form|ca|c\/a|corrective)/i;
/** A form the manager said NOT to do, in its own clause. */
const DECLINED =
  /\b(?:no|not|don'?t|do\s+not|without|skip|never\s*mind|hold\s+off\s+on|forget)\b(?:\s+\S+){0,3}?\s+(?:form|forms|ca|c\/a|corrective|coaching|write[- ]?up|warning|paperwork|review|interview|exit|transfer|demotion)\b/i;
/** A request that waits on something that has not happened. */
const CONDITIONAL =
  /^(?:(?:and|but|also|then|so)\s+)?(?:if|unless|in\s+case|next\s+time|should\s+(?:she|he|they))\b(?!\s+(?:you|u|possible|needed|necessary|it'?s\s+(?:ok|okay|possible)|that'?s\s+(?:ok|okay)|you\s+can)\b)/i;
const NEGATION = /\b(?:no|not|don'?t|do\s+not|without|skip|never\s*mind|hold\s+off\s+on|forget)\b/gi;
/** One form per person: a plural form, or "each" / "both" / "one for each". */
const ONE_EACH = /\b(?:forms|cas|c\/as|write[- ]?ups|warnings|reviews|each|both|separate|one\s+for\s+each)\b/i;
const BARE_FORM = /\b(?:form|forms|ca|c\/a|write[- ]?up)\b/i;
/*
 * SIGNED_STEP_NOT_A_REQUEST_ENABLED (ported from the sibling app: QA's live tester there, round 4, 8 Nov 2026): "Can you draw me up a CA for <A>
 * for being late on 10/23/26. <A> has signed a coaching document for being late on 10/14/26. …" gave a CA card AND a
 * Coaching Form card: the second sentence names a form and a person, so it read as a second request. It tells a step
 * already given, signed or received (the reading `step-sentence-dates.ts` and `prior-actions.ts` give it), and asks for
 * nothing, so with the flag on it is history: the Corrective Action's Prior actions, never a second card.
 */
const STEP_GIVEN = /\b(?:was|were|been|got|received|had)\s+(?:already\s+|previously\s+|also\s+)?(?:issued|given|signed)\b|\b(?:has|have|had)\s+(?:already\s+|previously\s+|also\s+)?(?:signed|received|been\s+given|been\s+issued)\b/i;

/** Clause boundaries: sentences, commas, semicolons, and the joining words. */
const CLAUSE_SPLIT = /\s*(?:[.;!?]+\s+|,\s*|\s+(?:and|&|also|then|plus|but)\s+)/i;

function keyFor(clause: string): string | null {
  const intent = detectTemplateIntent(clause);
  if (intent.kind === "explicit") return intent.templateKey;
  if (intent.kind === "corrective_action") return "dpoa";
  return null;
}

function clausesIn(text: string): string[] {
  return text
    .split(CLAUSE_SPLIT)
    .map((clause) => clause.replace(LEAD_IN, "").replace(/[.!]+$/, "").trim())
    .filter(Boolean);
}

/** The clause is a name and nothing else: the "Jordan" of "coaching forms for Avery and Jordan". */
function onlyAName(clause: string): string | null {
  const names = extractEmployeeNames(clause);
  if (names.length !== 1) return null;
  const rest = clause.toLowerCase().replace(names[0]!.toLowerCase(), "").replace(/\b(?:for|to|with)\b/g, "").trim();
  return rest === "" ? names[0]! : null;
}

export interface FormRequestReading {
  /** The forms asked for now, in the order asked. */
  requests: FormRequest[];
  /** Forms that wait on something that has not happened: "if she's late again, a CA". */
  conditional: FormRequest[];
  /** Forms the manager said not to do: "but no CA for Jordan". */
  declined: FormRequest[];
}

/**
 * Every form request in the message, each with its own person and words.
 *
 * Null when the message is a single request, or a correction of one
 * (`REPLACES_IT`) — the single-form path reads those, unchanged. A message
 * with one live request beside a declined or conditional one is returned, so
 * the live one is proposed from its own words and the others are named back
 * rather than read as a second person on the first form.
 */
export function readFormRequests(text: string): FormRequestReading | null {
  if (REPLACES_IT.test(text)) return null;
  const everyone = extractEmployeeNames(text);
  const reading: FormRequestReading = { requests: [], conditional: [], declined: [] };

  for (const sentence of sentencesOf(text)) {
    const clauses = clausesIn(sentence);
    let conditional = false;
    let last: FormRequest | null = null;
    let lastAt = -2;
    for (const [at, clause] of clauses.entries()) {
      if (CONDITIONAL.test(clause)) conditional = true;
      const declinedKey = DECLINED.test(clause) ? keyFor(clause.replace(NEGATION, " ")) : null;
      const key = keyFor(clause) ?? declinedKey;
      if (!key) {
        // "…for Avery and Jordan": one more person for the form just named.
        /*
         * Only right after it, and only where the manager asked for one EACH:
         * "coaching FORMS for Avery and Jordan", "a CA each for…". A single
         * "coaching form for Avery and Jordan" is one form whose person is
         * unclear, and the single-form path asks which (QA F18).
         */
        const name = onlyAName(clause);
        if (name && last && !conditional && at === lastAt + 1 && ONE_EACH.test(sentence)) {
          const more: FormRequest = {
            templateKey: last.templateKey,
            employeeName: name,
            clause: last.employeeName ? last.clause.replace(last.employeeName, name) : `${last.clause} for ${name}`,
          };
          reading.requests.push(more);
          last = more;
          lastAt = at;
        }
        continue;
      }
      const people = extractEmployeeNames(clause);
      const request: FormRequest = { templateKey: key, employeeName: people.length === 1 ? people[0]! : null, clause };
      if (conditional) {
        reading.conditional.push(request);
        continue;
      }
      if (declinedKey || DECLINED.test(clause)) {
        reading.declined.push(request);
        continue;
      }
      // SIGNED_STEP_NOT_A_REQUEST_ENABLED: "<A> has signed a coaching document for …" is history, not a request.
      if (signedStepNotARequestEnabled() && STEP_GIVEN.test(clause) && !ASKS_FOR_IT.test(clause)) continue;
      const asks = ASKS_FOR_IT.test(clause) || people.length > 0;
      if (!asks && !(BARE_FORM.test(clause) && clauses.length > 1)) continue;
      reading.requests.push(request);
      last = request;
      lastAt = at;
    }
  }

  /* A bare "coaching form and a CA for Jordan": the one person named is the person for both. */
  if (everyone.length === 1) {
    for (const request of reading.requests) request.employeeName ??= everyone[0]!;
  }

  reading.requests = reading.requests.filter(
    (request, index, all) =>
      all.findIndex(
        (other) =>
          other.templateKey === request.templateKey &&
          (other.employeeName === request.employeeName ||
            (other.employeeName !== null && request.employeeName !== null && samePerson(other.employeeName, request.employeeName))),
      ) === index,
  );

  if (reading.requests.length >= 2) return reading;
  if (reading.requests.length <= 1 && reading.conditional.length + reading.declined.length > 0) return reading;
  return null;
}
