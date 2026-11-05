import { replyMatchesCardEnabled } from "@/lib/config/chat-quality-flags";
import { removedOffenseLabels } from "@/lib/forms/ca-policy";
import { cardPolicyHeading } from "@/lib/forms/card-policy";
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
  if (!ASKS_WHO.test(next) && !ASKS_A_CHOICE.test(next) && !ASKS_FOR_THE_NAME.test(next)) next = `${next.trim()}\n\n${ASK_WHO}`;
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
  const heading = cardPolicyHeading(content) ?? content.split("\n").map((line) => MANUAL_LINE.exec(line)?.[1]).find(Boolean) ?? null;
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

/** Rule 5: an account on the card is never "not told". */
function withoutNotToldWhenTold(content: string, issue: string | null | undefined): string {
  const told = Boolean(issue?.trim()) || ACCOUNT_LINE.test(content) || FROM_DESCRIBED.test(content);
  if (!told || !NO_ACCOUNT.test(content)) return content;
  return content
    .split("\n")
    .filter((line) => !NO_ACCOUNT.test(line))
    .join("\n");
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
  content = tidy(content);
  return content === response.content ? response : { ...response, content };
}

/** REPLY_MATCHES_CARD_ENABLED, the last step of the turn: `replyMatchesCard` with the actor's roster read this turn. Off: as built. */
export function withReplyMatchesCard(response: AskResponse): AskResponse {
  if (!replyMatchesCardEnabled()) return response;
  return replyMatchesCard(response, personRosterNames() ?? [], requestMessage());
}
