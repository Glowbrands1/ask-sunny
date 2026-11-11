import { storeChoicesNamedEnabled } from "@/lib/config/chat-quality-flags";
import { salonById } from "@/data/salons";
import type { ChatFormProposal } from "@/types";

/**
 * ============================================================================
 * THE SALON QUESTION NAMES THE SALONS (ported from Ask Bubbles: Problem 20, production there, 10 Nov 2026;
 * STORE_CHOICES_NAMED_ENABLED)
 * ============================================================================
 *
 * In the sibling app a manager covering two locations named a person, was asked "I won't choose which store this
 * belongs to. Which store is this about?", sent the request again and got the same question back under "I still need to
 * know which location this is about…" with no location named, and no card was made. This app asks the same bare
 * question ("Which salon is this about?") behind the same repeat guard. On: a card waiting for its salon asks with the
 * manager's salons named (up to six), so a request sent again is answered with what is missing, in words. The card and
 * its picker are unchanged. Off, as before. (The sibling app also names the person's own stores from Woven; this app's
 * card carries no Woven verification, so it names the manager's salons.)
 */
export const SALON_QUESTION = "I won't choose which salon this belongs to. Which salon is this about?";

/** The most salons named in words; more than this and the picker below is the clearer way to choose. */
const MOST_NAMED = 6;

interface Answer {
  content: string;
  formProposal?: ChatFormProposal | null;
}

function listed(salons: readonly string[]): string {
  const bold = salons.map((salon) => `**${salon}**`);
  return bold.length <= 2 ? bold.join(" or ") : `${bold.slice(0, -1).join(", ")} or ${bold[bold.length - 1]}`;
}

/** The salon question with the choices named, or null when there are none to name. */
export function namedSalonQuestion(card: ChatFormProposal): string | null {
  const authorized = card.authorizedLocationIds ?? [];
  if (authorized.length < 2 || authorized.length > MOST_NAMED) return null;
  const salons = authorized.map((id) => salonById(id)?.name).filter((name): name is string => Boolean(name));
  if (salons.length !== authorized.length) return null;
  return `I won't choose which salon this belongs to. Is it ${listed(salons)}?`;
}

/** STORE_CHOICES_NAMED_ENABLED: a card waiting for its salon asks with the choices named. Off, the answer as given. */
export function withStoreChoicesNamed<T extends Answer>(answer: T): T {
  const card = answer.formProposal;
  if (!storeChoicesNamedEnabled() || !card || card.locationResolution !== "needs_selection" || card.namedLocationOutOfScope) return answer;
  if (!answer.content.includes(SALON_QUESTION)) return answer;
  const named = namedSalonQuestion(card);
  return named ? { ...answer, content: answer.content.replace(SALON_QUESTION, named) } : answer;
}
