/*
 * ============================================================================
 * "WRITE UP <EMPLOYEE> FOR …" IS THE REQUEST, NOT THE ACCOUNT (WRITE_UP_LEAD_NOT_ACCOUNT_ENABLED)
 * ============================================================================
 *
 * QA's October triage of #167 (10 Nov 2026; the person invented): "write up <employee> for cell phone use" gave a
 * Corrective Action card whose Observation of Offense was the whole message, "write up <employee> for cell phone use".
 * The request readers know "create a CA for <employee> for …" but not the bare verb "write up", which asks for the form
 * with no form word in it.
 *
 * With the flag on, an Observation sentence that opens "write up <employee> for …" (or "write <employee> up for …",
 * with "please", "can you", "I need to" in front) keeps only what follows "for": the account. The name must be the
 * card's employee (whole, or one of its words, in any case), so a sentence that only mentions writing something up
 * stays as the manager wrote it. Pure.
 */

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const POLITE = String.raw`(?:(?:ok(?:ay)?|so|now|also|and|then)[,\s]+)?(?:please\s+)?(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?)?(?:(?:i\s+)?(?:need|want|have|would\s+like)\s+to\s+)?(?:please\s+)?`;
const REASON_WORD = String.raw`(?:for|about|over|because\s+of|due\s+to)`;

/** The account after a "write up <employee> for" lead; the sentence unchanged when it has no such lead, null when nothing is left. */
export function withoutWriteUpLead(sentence: string, employeeName: string | null): string | null {
  const words = (employeeName ?? "").trim().split(/\s+/).filter((word) => word.length > 1);
  if (words.length === 0) return sentence;
  // The whole name first, then any one of its words ("write up marnie for …").
  const safe = words.map(escape);
  const name = `(?:${[safe.join(String.raw`\s+`), ...safe].join("|")})(?:['’]s)?`;
  const lead = new RegExp(
    String.raw`^\s*${POLITE}(?:write\s+up\s+${name}|write\s+${name}\s+up)\s+${REASON_WORD}\s+`,
    "iu",
  );
  const trimmed = sentence.trim();
  const match = lead.exec(trimmed);
  if (!match) return sentence;
  const rest = trimmed.slice(match[0].length).trim();
  if (!/\p{L}{3,}/u.test(rest)) return null;
  return `${rest[0]!.toUpperCase()}${rest.slice(1)}`;
}
