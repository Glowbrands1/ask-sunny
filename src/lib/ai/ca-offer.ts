import { caOfferKeepsAccountEnabled, caSalesPolicyEnabled } from "@/lib/config/chat-quality-flags";
import { CA_POLICY_LABEL, isSalesPolicyReading, readCaPolicy } from "@/lib/forms/ca-policy";
import { AFFIRMATIVE, type RosterEmployee } from "@/lib/forms/employee-match";
import { managerContext, resolveEmployee } from "@/lib/forms/proposal";

/**
 * ============================================================================
 * AN ANSWER ABOUT A POLICY AND AN EMPLOYEE ENDS WITH ONE OFFER
 * (CA_SALES_POLICY_ENABLED, default off; Pau, 4 Nov 2026, message #5)
 * ============================================================================
 *
 * "<name> did not follow must see behaviors which violates standards of
 * conduct policy" asks for nothing, so it stays a policy answer — no routing
 * change. With the flag on, when the manager's words read as a policy (the
 * existing reader, `readCaPolicy`: named, or one clear suggestion) and name an
 * employee the roster recognises (`resolveEmployee`, matched against the
 * manager's scoped roster), the answer ends with ONE offer to start a
 * Corrective Action for that employee, citing that policy — asked ONCE, in
 * Pau's words: "Do you want a Corrective Action for <name>?". Nothing is made:
 * the card opens only when the manager answers yes (`acceptedCaOffer`), and
 * the yes is read as the request the manager would have typed.
 *
 * No phrase lists: the policy, the employee and the yes are all existing
 * readers. Off, nothing is offered and nothing is read.
 */

/** The offer's opening, which also marks it for the next turn. */
export const CA_OFFER_LEAD = "**Do you want a Corrective Action for";

/** The Corrective Action Form's template key. */
const CORRECTIVE_ACTION_KEY = "dpoa";

const OFFER = /\*\*Do you want a Corrective Action for ([^*?]+)\?\*\* Say \*\*yes\*\* and I'll start it, citing the \*\*([^*]+)\*\*\./;

function fold(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/** The roster entry the name is, by full name (first or preferred first name, and last name), or null. */
function onRoster(name: string, roster: readonly RosterEmployee[]): RosterEmployee | null {
  const wanted = fold(name);
  return (
    roster.find((entry) =>
      [entry.firstName, entry.preferredFirstName ?? null]
        .filter((first): first is string => Boolean(first))
        .some((first) => fold(`${first} ${entry.lastName}`) === wanted),
    ) ?? null
  );
}

/**
 * The offer line, or null. Null with the flag off, when the manager's words
 * read as no single policy, or name nobody the roster recognises.
 */
export function caOfferLine(input: {
  readonly history: Parameters<typeof managerContext>[0];
  readonly question: string;
  readonly questionMessageId?: string;
  readonly roster: readonly RosterEmployee[];
}): string | null {
  if (!caSalesPolicyEnabled()) return null;
  const context = managerContext(input.history, { id: input.questionMessageId, content: input.question });
  const reading = readCaPolicy(context.text);
  /*
   * A POLICY THE MANAGER NAMED, or the sales / MSB reading this flag adds —
   * never the general conduct suggestion ("did not complete daily cleaning
   * duties" reads as unfinished work, and a cleaning CA does not cite the
   * Standards of Conduct by default: Pau, 4 Nov 2026; replay sf-s15).
   */
  const policyKey = reading.stated ?? (isSalesPolicyReading(reading) ? reading.suggestion : null);
  if (!policyKey) return null;
  /*
   * THE EMPLOYEE THIS MESSAGE NAMES, never one an earlier request in the chat
   * named (with a draft open for another employee, the offer named that one).
   */
  const resolution = resolveEmployee(managerContext([], { id: input.questionMessageId, content: input.question }));
  if (resolution.kind !== "resolved") return null;
  const employee = onRoster(resolution.employeeName, input.roster);
  if (!employee) return null;
  const name = `${employee.preferredFirstName || employee.firstName} ${employee.lastName}`;
  return `**Do you want a Corrective Action for ${name}?** Say **yes** and I'll start it, citing the **${CA_POLICY_LABEL[policyKey]}**.`;
}

/**
 * The manager's "yes" to the offer, as the request it accepts — "Create a
 * Corrective Action Form for <name>. The policy is <policy>." — or null. Only
 * the offer in the assistant's LAST message counts, and only a plain yes
 * (`AFFIRMATIVE`, the reader the name confirmation uses). Off, null.
 */
export function acceptedCaOffer(input: {
  readonly question: string;
  readonly history: readonly { role: string; content: unknown }[];
}): string | null {
  if (!caSalesPolicyEnabled() || !AFFIRMATIVE.test(input.question)) return null;
  const last = [...input.history].reverse().find((turn) => turn.role === "assistant");
  const match = typeof last?.content === "string" ? OFFER.exec(last.content) : null;
  if (!match) return null;
  return `Create a Corrective Action Form for ${match[1]}. The policy is ${match[2]}.`;
}

/**
 * ============================================================================
 * "YES" KEEPS THE ACCOUNT THE OFFER ANSWERED
 * (CA_OFFER_KEEPS_ACCOUNT_ENABLED, default off; QA's MSB case M5, 5 Nov 2026)
 * ============================================================================
 *
 * "<name> did not follow must see behaviors which violates standards of
 * conduct policy" → the offer → "yes": the card read "What happened: The
 * policy is Standards of Conduct". `acceptedCaOffer`'s request is the app's
 * sentence, not the manager's, and every reader of the card's account read it
 * as hers.
 *
 * With the flag on, the accepted yes is the manager turn the offer answered —
 * her own words, unchanged — asked for as a Corrective Action Form (the
 * template key the offer names; the continuation the card readers already
 * take), with the conversation as it stood when she said it. The offer and
 * the "yes" are dropped from that turn's history, so nothing the app wrote is
 * read as her account. The employee and the policy are read from her words by
 * the same readers that made the offer. `employee` is the name the offer
 * named, for the caller's fallback when her turn makes no card (it held no
 * account). Null with either flag off, with no accepted offer, or with no
 * manager turn before the offer.
 *
 * By structure (which turn is read), never by matching words.
 */
export function acceptedCaOfferTurn<Turn extends { readonly role: string; readonly content: unknown; readonly id?: string }>(input: {
  readonly question: string;
  readonly history: readonly Turn[];
}): { readonly account: Turn & { readonly content: string }; readonly history: Turn[]; readonly templateKey: string; readonly employee: string } | null {
  if (!caOfferKeepsAccountEnabled() || !acceptedCaOffer(input)) return null;
  const offerAt = input.history.findLastIndex((turn) => turn.role === "assistant");
  const offered = input.history[offerAt]!.content as string;
  const accountAt = input.history.findLastIndex((turn, index) => index < offerAt && turn.role === "user");
  const account = accountAt < 0 ? null : input.history[accountAt]!;
  if (!account || typeof account.content !== "string" || account.content.trim() === "") return null;
  return {
    account: account as Turn & { readonly content: string },
    history: input.history.slice(0, accountAt),
    templateKey: CORRECTIVE_ACTION_KEY,
    employee: OFFER.exec(offered)![1]!,
  };
}

/**
 * THE OFFER AT THE TURN'S ONE EXIT (Pau, 4 Nov 2026; QA, live: production
 * answered "<name> did not follow must see behaviors which violates standards
 * of conduct policy" without the offer, once with a Coaching / Corrective
 * Action menu, on paths that return before the policy answer's end). Every
 * reply that ends without a card, an edit or a form opened gets the one
 * offer; a form menu that offers the Corrective Action Form is replaced by it
 * (ask once, card after yes). A menu without that form, a reply that already
 * carries the offer, or no offer line, is left as it is. Off, unchanged.
 */
export function withCaOffer<R extends {
  readonly content: string;
  readonly formProposal?: unknown;
  readonly formProposals?: readonly unknown[];
  readonly formUpdate?: unknown;
  readonly formOpened?: unknown;
  readonly formSelection?: { readonly primary: { readonly templateKey: string }; readonly additional: readonly { readonly templateKey: string }[] };
}>(response: R, offer: string | null): R {
  if (!caSalesPolicyEnabled() || !offer) return response;
  if (response.formProposal || (response.formProposals?.length ?? 0) > 0 || response.formUpdate || response.formOpened) return response;
  if (response.content.includes(CA_OFFER_LEAD)) return response;
  const selection = response.formSelection;
  if (selection && ![selection.primary, ...selection.additional].some((choice) => choice.templateKey === CORRECTIVE_ACTION_KEY)) return response;
  if (!selection) return { ...response, content: `${response.content.trim()}\n\n${offer}`.trim() };
  // The menu's own question is the reply's last paragraph ("Which form do you need?", or the suggestion's lead): it goes with the menu.
  const paragraphs = response.content.trim().split(/\n{2,}/);
  const kept = paragraphs.slice(0, -1).join("\n\n").trim();
  return { ...response, content: kept ? `${kept}\n\n${offer}` : offer, formSelection: undefined };
}
