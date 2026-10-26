import { twoFormsAskEnabled } from "@/lib/config/chat-quality-flags";
import { detectTemplateIntent } from "@/lib/forms/template-intent";

import type { AskRequest, AskResponse } from "./types";

/**
 * TWO_FORMS_ASK_ENABLED: two forms asked for at once are never silently one.
 *
 * QA, 26 Oct 2026 (Bubbles tester batch B4; the same reader in the sibling
 * app): "Can you create a coaching form and a policy review? I'd like to see
 * both" gave only a Policy Review card; the Coaching Form was dropped without
 * a word.
 *
 * When the manager's turn names two different forms and the reply carries a
 * card for one of them, the reply says which one was started and how to start
 * the other: say "now the coaching form". The card and its fields are not
 * changed. One form, or no card, leaves the reply as it is. Off, the reply is
 * as it is.
 *
 * The same file in the sibling app.
 */

/** QA-4, 26 Oct 2026: also before a form word with no article ("a coaching form and policy review", "coaching and ca"). */
const BETWEEN =
  /\s+(?:and|&|plus|then|also)(?:\s+then)?\s+(?=(?:a|an|the|one)\b|(?:coaching|coach|ca|c\/a|dpoa|corrective|policy|exit|write)\b)|[,;?]+/i;
const REQUEST_WORDS = /^(?:(?:can|could|would)\s+you\s+|please\s+|i\s+(?:need|want)\s+|create\s+|make\s+|start\s+|do\s+)+/i;
const FORM_PHRASE = /\b(?:a|an|the)\s+([a-z][a-z/ -]*?)\s*[.!]*$/i;

interface Asked {
  readonly templateKey: string;
  readonly phrase: string;
}

/** The distinct forms one turn asks for, in order, with the manager's own words for each. */
/** QA-2, 26 Oct 2026: "don't create …", "I already did …", "never create …" ask for nothing … */
const NEGATED = /\b(?:not|never|no|don'?t|do\s+not|already|without|instead\s+of|rather\s+than)\b/i;
/** … until "just", "but", "instead", "now" or "only" turns it around. */
const TURNED = /^(?:just|but|instead|now|only|then)\b|\b(?:just|instead|only)\b/i;

export function formsAskedFor(question: string): Asked[] {
  const asked: Asked[] = [];
  let negated = false;
  for (const segment of question.split(BETWEEN)) {
    const part = segment.trim().replace(/\s+(?:and|also|plus|then|&)$/i, "");
    if (!part) continue;
    if (TURNED.test(part)) negated = false;
    // "no call no show" is an incident, not a negation.
    if (NEGATED.test(part.replace(/\bno[\s-]*call[\s,/-]*no[\s-]*show\b/gi, ""))) negated = true;
    if (negated) continue;
    const intent = detectTemplateIntent(part);
    if (intent.kind !== "explicit" || asked.some((form) => form.templateKey === intent.templateKey)) continue;
    // "a coaching form" → "coaching form"; terse "coaching form" as typed.
    const phrase = (FORM_PHRASE.exec(part)?.[1] ?? part.replace(REQUEST_WORDS, "")).trim().replace(/[.!]+$/, "");
    if (phrase) asked.push({ templateKey: intent.templateKey, phrase });
  }
  return asked;
}

export function withTwoFormsAsk(response: AskResponse, request: AskRequest): AskResponse {
  if (!twoFormsAskEnabled()) return response;
  const card = response.formProposal;
  if (!card) return response;
  const asked = formsAskedFor(request.question);
  if (asked.length < 2 || !asked.some((form) => form.templateKey === card.templateKey)) return response;
  const other = asked.find((form) => form.templateKey !== card.templateKey)!;
  const line = `You asked for two forms. I've started the **${card.templateName}** here. When you're ready, say **"now the ${other.phrase}"** and I'll start that one too.`;
  if (response.content.includes(line)) return response;
  return { ...response, content: `${response.content.trim()}\n\n${line}` };
}
