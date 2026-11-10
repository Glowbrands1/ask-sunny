import { addressAsksWhoEnabled } from "@/lib/config/chat-quality-flags";
import { detectTemplateIntent } from "@/lib/forms/template-intent";

/**
 * ============================================================================
 * "CORRECTIVE ACTION FOR 123 MAIN STREET" ASKS WHO THE FORM IS FOR
 * ============================================================================
 *
 * ADDRESS_ASKS_WHO_ENABLED (QA's backlog B7; QA, 4 Nov 2026; same flag in both apps; default off). The street-address
 * guards keep the address off the card and out of the roster lookup, so the turn made no card — and was answered as a
 * policy question, never asking who the form is for. On: a form request whose "for …" is a street address, answered
 * with no card, is answered with that question instead. A turn with a card, or one that is not a form request, is
 * left as it is. Pure.
 */

const STREET =
  /\bfor\s+(?:the\s+)?(\d+[a-z]?\s+(?:[a-z0-9.'-]+\s+){0,4}(?:street|st|avenue|ave|road|rd|drive|dr|boulevard|blvd|lane|ln|way|court|ct|place|pl|highway|hwy|parkway|pkwy|circle|cir|terrace|trail|square))\b\.?/i;

const FORM_NAMES: Readonly<Record<string, string>> = { dpoa: "Corrective Action Form", coaching: "Coaching Form" };

function formName(question: string): string | null {
  const intent = detectTemplateIntent(question);
  if (intent.kind === "corrective_action") return intent.requestedCreation ? "Corrective Action Form" : null;
  if (intent.kind === "explicit" || intent.kind === "clarify") return FORM_NAMES[intent.templateKey] ?? "form";
  if (intent.kind === "ambiguous") return "form";
  return null;
}

export function addressFormAsk(question: string): string | null {
  const address = STREET.exec(question)?.[1];
  if (!address) return null;
  // "Corrective action for 123 Main Street" — the manager's words name a corrective action, created for somebody.
  const form = formName(question) ?? (/\bcorrective\s+action\b|\bca\b|\bwrite[- ]?up\b/i.test(question) ? "Corrective Action Form" : null);
  if (!form) return null;
  return `Who is this **${form}** for? "${address.trim()}" reads as a street address, not a person — tell me the employee's full name, and I'll put it on the card.`;
}

export function withAddressFormAsk<
  T extends { content: string; formProposal?: unknown; citations?: unknown[]; recommendedVideoIds?: string[]; followUpSuggestions?: string[] },
>(answer: T, question: string): T {
  if (!addressAsksWhoEnabled() || answer.formProposal) return answer;
  const ask = addressFormAsk(question);
  if (!ask) return answer;
  // The policy answer's sources go with it: the question cites nothing.
  return {
    ...answer,
    content: ask,
    ...(answer.citations ? { citations: [] } : {}),
    ...(answer.recommendedVideoIds ? { recommendedVideoIds: [] } : {}),
    ...(answer.followUpSuggestions ? { followUpSuggestions: [] } : {}),
  };
}
