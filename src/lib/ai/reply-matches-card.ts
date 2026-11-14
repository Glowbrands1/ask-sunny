import { bareNotDenialEnabled, cleaningOtherEveryWordingEnabled, closeSpellingMatchEnabled, conductIncidentCitesPageEnabled, exitDateLineAgreesEnabled, replyMatchesCardEnabled } from "@/lib/config/chat-quality-flags";
import { offeredOffRosterName } from "@/lib/forms/off-roster-confirm";
import { deniesAFault, deniesAFaultWithBareNot } from "@/lib/forms/draft-never-blank";
import { caPolicyProposalLine, readCaPolicy, removedOffenseLabels } from "@/lib/forms/ca-policy";
import { cardPolicyHeading } from "@/lib/forms/card-policy";
import { EXIT_TEMPLATE_KEY } from "@/lib/forms/exit-library";
import { exitDateInWords } from "@/lib/forms/exit-intake";
import { personRosterNames } from "@/lib/forms/person-guard";
import { requestMessage } from "@/lib/forms/request-slot";
import {
  ASK_WHO,
  ASKS_A_CHOICE,
  ASKS_FOR_THE_NAME,
  ASKS_WHO,
  CREATE_WHEN_READY,
  draftedFor,
  slotName,
  withoutUnseatedName,
} from "@/lib/forms/roster-only-names";

import { HAS_EMPLOYEE_AND_PLACE, SAYS_READY } from "./ca-what-happened";
import { withOwnBrandOnly } from "./own-brand-only";
import type { AskResponse } from "./types";

/**
 * ============================================================================
 * THE REPLY AGREES WITH THE CARD — REPLY_MATCHES_CARD_ENABLED
 * ============================================================================
 *
 * Port from the sibling app; QA for Pau, 5 Nov 2026 ("go"). Today's contradictions each came from one
 * step writing the reply and another changing the card after it: the card
 * emptied while the Action plan still named the person (R3/R5/R7), "Everything
 * I need is here … I have the employee" beside "Who is this form for?"
 * (street/ima, QA-A/B), "You haven't told me what happened yet, so I can't
 * cite the policy manual" beside the policy it cited (the kitten), a second
 * policy beside the card's (Evaluations p.34 vs Standards of Conduct).
 *
 * The LAST step of every chat turn, after every other wrapper: it reads the
 * finished card and makes the reply agree with it. Deterministic, no model
 * call, no word list:
 *
 *   1. No employee on the card: the reply names nobody as the employee (the
 *      name taken off it, the request's "for <Name>", the reply's own drafted-
 *      for name), never says it has the employee or that the draft is ready,
 *      and asks who. "I couldn't find **<name>** …", the reason, stays.
 *   2. An employee on the card: it never asks who, and the person it drafts
 *      for, or a "Name:" line, is the card's.
 *   3. One policy: a manual citation line for another section than the
 *      card's (its **Policy:** line, or else its first citation) goes.
 *   4. No removed Type of Offense label: "under **<a box no longer on the
 *      form>**" goes with its sentence.
 *   5. With an account on the card (its Issue, a filled "What happened" /
 *      "Observation of Offense" line, or a policy cited from what was
 *      described), never "You haven't told me what happened yet".
 *
 * Only a reply with a card. Off: the reply as built.
 */

const NO_ACCOUNT = /You haven['’]t told me what happened yet/;
const ACCOUNT_LINE = /^\s*\*\*(?:Issue|What happened|Observation of Offense):\*\*[ \t]*\S/m;
const FROM_DESCRIBED = /\*\*Policy:\*\*[^\n]*\bfrom what you described\b/i;
/** A manual citation line: "<Section> Policy, JBA Policy Manual p.15". */
const MANUAL_LINE = /^\s*(?:[-*]\s*)?\**([^*\n,]+?)\**(?:\s+Policy)?,\s*JBA Policy Manual\b[^\n]*$/i;
const WHO_LINE = /^\s*Who is this (?:\*\*[^*]+\*\* |form )?for\?[^\n]*$/i;

function normalHeading(text: string): string {
  return text.replace(/\s+policy$/i, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim().toLowerCase();
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tidy(content: string): string {
  return content.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Rule 1: no employee on the card. */
function withNobodyNamed(content: string, names: readonly string[], message: string | undefined): string {
  let next = content.replace(HAS_EMPLOYEE_AND_PLACE, "").replace(CREATE_WHEN_READY, "");
  next = next
    .split("\n")
    .filter((line) => !SAYS_READY.test(line.trim()))
    .join("\n");
  // The app's own words stay: one word of the name alone at a sentence start, or in another case (`ownWords`).
  next = withoutUnseatedName(next, [slotName(message, names)], names, draftedFor(next), { ownWords: true });
  // OFF_ROSTER_CONFIRM_ENABLED (the sibling app's finding C, 6 Nov 2026): the off-roster offer ("reply **use <name>**") is the question.
  const offers = offeredOffRosterName(next) !== null;
  if (!offers && !ASKS_WHO.test(next) && !ASKS_A_CHOICE.test(next) && !ASKS_FOR_THE_NAME.test(next)) next = `${next.trim()}\n\n${ASK_WHO}`;
  return next;
}

/** Rule 2: the card has an employee. */
function withTheCardsEmployee(content: string, employee: string): string {
  return content
    .split("\n")
    .filter((line) => !WHO_LINE.test(line))
    .map((line) =>
      line
        .replace(/(\b(?:draft|create|put)\b[^\n.]*?\*\*[^*]+\*\* for )\*\*([^*]+)\*\*/gi, (whole, lead: string, name: string) =>
          name.trim() === employee ? whole : `${lead}**${employee}**`,
        )
        .replace(/^(\s*\**Name:?\**:?\s*)(.+)$/i, (whole, label: string, value: string) => (value.replace(/\*/g, "").trim() === employee ? whole : `${label}${employee}`)),
    )
    .join("\n");
}

/** Rule 3: one policy, the card's. */
function withOnePolicy(content: string): string {
  // The card's policy is its **Policy:** line; a card without one (a Coaching Form) cites it on its first manual line.
  const read = cardPolicyHeading(content) ?? content.split("\n").map((line) => MANUAL_LINE.exec(line)?.[1]).find(Boolean) ?? null;
  /*
   * CONDUCT_INCIDENT_CITES_PAGE_ENABLED (QA's live tester, 8 Nov 2026): "**Policy:** this reads as **Standards of
   * Conduct** — a required deadline that was missed …" was read as the heading "this reads as Standards of Conduct",
   * so the card's own "Standards of Conduct Policy, JBA Policy Manual p.12" line was taken as another policy and
   * dropped: the card named the policy with no page. With the flag on, the policy such a line reads as is the one in
   * bold. Off, as before.
   */
  const heading = read && conductIncidentCitesPageEnabled() ? (/^this reads as \*\*([^*]+)\*\*/i.exec(read)?.[1] ?? read) : read;
  if (!heading) return content;
  const card = normalHeading(heading);
  return content
    .split("\n")
    .filter((line) => {
      if (/\*\*Policy:\*\*/.test(line)) return true;
      const cited = MANUAL_LINE.exec(line)?.[1];
      return !cited || normalHeading(cited) === card;
    })
    .join("\n");
}

/** Rule 4: no box that is no longer on the form. */
function withoutRemovedOffense(content: string): string {
  let next = content;
  for (const label of removedOffenseLabels()) {
    // "I'll quote it on the draft under **Tardiness/Leaving Early**." — the sentence goes, the citation stays.
    next = next.replace(new RegExp(String.raw`[ \t]*[^.\n]*\bunder \*\*${escape(label)}\*\*[^.\n]*\.`, "g"), (sentence) =>
      // Never the **Policy:** line's own sentence: only the sentence that files it under the removed box.
      /\*\*Policy:\*\*/.test(sentence) ? sentence : "",
    );
  }
  return next;
}

/*
 * BARE_NOT_DENIAL_ENABLED (QA's second Sunny gate, 6 Nov 2026): "not late", "she was never late"
 * deny a fault; an Issue or Observation that says only that is no account, so rule 5 keeps the ask.
 * Each clause must deny: "not late but left the bed dirty" says what happened and stays an account.
 */
function onlyDeniesAFault(text: string): boolean {
  const clauses = text.split(/[.;,]+|\s+(?:but|and|also)\s+/i).map((clause) => clause.trim()).filter(Boolean);
  return clauses.length > 0 && clauses.every((clause) => deniesAFault(clause) || deniesAFaultWithBareNot(clause));
}

/** The "What happened" / "Observation of Offense" lines' text, for the denial check above. */
function accountLineTexts(content: string): string[] {
  return [...content.matchAll(/^\s*\*\*(?:Issue|What happened|Observation of Offense):\*\*[ \t]*(\S[^\n]*)$/gm)].map((match) => match[1]!.trim());
}

/** Rule 5: an account on the card is never "not told". */
function withoutNotToldWhenTold(content: string, issue: string | null | undefined): string {
  const told = bareNotDenialEnabled()
    ? (Boolean(issue?.trim()) && !onlyDeniesAFault(issue!)) ||
      accountLineTexts(content).some((text) => !onlyDeniesAFault(text)) ||
      FROM_DESCRIBED.test(content)
    : Boolean(issue?.trim()) || ACCOUNT_LINE.test(content) || FROM_DESCRIBED.test(content);
  if (!told || !NO_ACCOUNT.test(content)) return content;
  return content
    .split("\n")
    .filter((line) => !NO_ACCOUNT.test(line))
    .join("\n");
}

/**
 * CLEANING_OTHER_EVERY_WORDING_ENABLED (QA's live eval, 6 Nov 2026: the live model's reply said the Standards of
 * Conduct for "he did not complete daily cleaning duties"). On a Corrective Action card whose account reads as
 * cleaning left undone (`readCaPolicy`'s `other`, from the manager's message and the card's Issue), the
 * **Policy:** line is the Other line, and a Standards of Conduct citation line goes. Pau: cleaning is Other.
 */
const CORRECTIVE_ACTION_KEY = "dpoa";
/** The Policy line of a policy the manager named that the manual answers (`ca-policy.ts` namedPolicyLine, "found"). */
const NAMED_FOUND_LINE = /\*\*Policy:\*\* [^\n]+, as you said — the policy manual's section on page \d+/;
const SOC_CITATION = /^\s*(?:[-*]\s*)?\**Standards of Conduct\**(?:\s+Policy)?,\s*JBA Policy Manual\b/i;

export function withCleaningOtherPolicy(response: AskResponse, message?: string): AskResponse {
  const card = response.formProposal;
  if (!cleaningOtherEveryWordingEnabled() || !card || card.templateKey !== CORRECTIVE_ACTION_KEY) return response;
  const reading = readCaPolicy([message ?? "", card.issue ?? ""].filter(Boolean).join("\n"));
  if (reading.other !== "cleaning") return response;
  // CLOSE_SPELLING_MATCH_ENABLED (QA, 13 Nov 2026): a policy the manager named and the manual answers, already on the
  // card's Policy line, wins over cleaning-is-Other (`caPolicyProposalLine`). Off, as before.
  if (closeSpellingMatchEnabled() && NAMED_FOUND_LINE.test(response.content)) return response;
  const other = caPolicyProposalLine(reading);
  if (!other) return response;
  let placed = false;
  const lines = response.content.split("\n").flatMap((line) => {
    if (SOC_CITATION.test(line)) return [];
    if (!/\*\*Policy:?\*\*/.test(line)) return [line];
    if (placed) return [];
    placed = true;
    return [other];
  });
  const content = tidy(lines.join("\n"));
  return content === response.content ? response : { ...response, content };
}

/*
 * EXIT_DATE_LINE_AGREES_ENABLED (QA round 5, 8 Nov 2026; same flag in both apps; default off). "exit form for <name>,
 * last day 11/05, gave no notice": the reply's list said "- **Date:** the day the draft is created" while the card
 * under it said "**Date:** 11/5/2026", and the form was created dated 11/5. On: an exit card that carries a date has
 * that date on the list's Date line. A card with no date keeps "the day the draft is created". Off, as before.
 */
const EXIT_DATE_BULLET = /^- \*\*Date:\*\* the day the draft is created$/m;

function withTheCardsExitDate(content: string, card: NonNullable<AskResponse["formProposal"]>): string {
  if (!exitDateLineAgreesEnabled() || card.templateKey !== EXIT_TEMPLATE_KEY || !card.formDate) return content;
  return content.replace(EXIT_DATE_BULLET, `- **Date:** ${exitDateInWords(card.formDate)}`);
}

/** The reply made to agree with its card. Pure; see `withReplyMatchesCard`. */
export function replyMatchesCard(response: AskResponse, names: readonly string[], message?: string): AskResponse {
  const card = response.formProposal;
  if (!card) return response;
  let content = response.content;
  if (card.subject !== "team") {
    const employee = card.employeeName?.trim();
    content = employee ? withTheCardsEmployee(content, employee) : withNobodyNamed(content, names, message);
  }
  content = withoutNotToldWhenTold(withoutRemovedOffense(withOnePolicy(content)), card.issue);
  content = withTheCardsExitDate(content, card);
  content = tidy(content);
  return content === response.content ? response : { ...response, content };
}

/** REPLY_MATCHES_CARD_ENABLED, the last step of the turn: `replyMatchesCard` with the actor's roster read this turn. Off: as built. */
export function withReplyMatchesCard(response: AskResponse): AskResponse {
  const cleaned = withCleaningOtherPolicy(response, requestMessage());
  // OWN_BRAND_ONLY_ENABLED, gated on its own: only this company's brand is named (`ai/own-brand-only.ts`).
  const branded = withOwnBrandOnly(cleaned);
  if (!replyMatchesCardEnabled()) return branded;
  return replyMatchesCard(branded, personRosterNames() ?? [], requestMessage());
}
