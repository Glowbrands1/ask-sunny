import { PRODUCTION_SALONS } from "@/data/salons";
import { describesIncident } from "@/lib/forms/corrective-action-intake";
import { readSalonMentions } from "@/lib/forms/salon-mention";

/**
 * The question the proposal readers see.
 *
 * A pasted rule that starts with "When" is a statement. The advice reader
 * treats that first word as a question, and the open card is dropped.
 * A salon at the end of a sentence is lost once the next word is not one
 * the place cue allows ("at lawrence as a tanning consultant", "at
 * lawrence. use todays date"). The roster's own name needs no cue.
 */

const NOT_A_PLACE_NEXT = new Set(["to", "time", "times", "high", "from", "for"]);

export function prepareProposalQuestion(question: string): string {
  const stated = policyPasteAsStatement(question);
  if (stated !== question) return stated;
  if (readSalonMentions(question).length > 0) return question;
  const visible = makeSalonsVisible(question);
  return readSalonMentions(visible).length > 0 ? visible : question;
}

/** The one salon the manager named, once a turn break or a period is a clause. */
export function oneSalonVisibleIn(text: string): string | null {
  const visible = makeSalonsVisible(text);
  const source = readSalonMentions(visible).length > 0 ? visible : text;
  const ids = [...new Set(readSalonMentions(source).flatMap((mention) => mention.salonIds))];
  return ids.length === 1 ? ids[0]! : null;
}

function policyPasteAsStatement(question: string): string {
  const text = question.trim();
  if (!text || text.endsWith("?") || text.split(/\s+/).length < 40) return question;
  if (!/^(?:when|where)\b/i.test(text)) return question;
  if (!describesIncident(text)) return question;
  return `The account continues. ${text}`;
}

function makeSalonsVisible(text: string): string {
  const clauses = text.replace(/[.!]+/g, " ; ").replace(/[\n\r]+/g, " ; ");
  if (readSalonMentions(clauses).length > 0) return clauses;
  const expanded = expandUniqueAtSalon(clauses);
  if (readSalonMentions(expanded).length > 0) return expanded;
  const expandedOnly = expandUniqueAtSalon(text);
  if (readSalonMentions(expandedOnly).length > 0) return expandedOnly;
  return text;
}

function expandUniqueAtSalon(text: string): string {
  return text.replace(/\b(at|in)\s+([a-z][a-z'’-]+)\b/gi, (full, prep: string, word: string, offset: number) => {
    const next = text.slice(offset + full.length).trim().split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, "") ?? "";
    if (NOT_A_PLACE_NEXT.has(next)) return full;
    const hits = PRODUCTION_SALONS.filter((salon) => salon.name.slice(3).trim().toLowerCase() === word.toLowerCase());
    if (hits.length !== 1) return full;
    return `${prep} ${hits[0]!.name}`;
  });
}
