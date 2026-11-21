/**
 * QA's f077 (20 Nov 2026; #1139 live, draft cd69d389): on a termination, Details never says the employee gave notice,
 * resigned or quit. Reads the drafting MODEL's sentences (never the manager's words): such a sentence is taken out, and the
 * notice date the manager gave, if any, is said in the form's own terms. Everything else is kept as written.
 */
const RESIGNATION_WORDS = /\b(?:gave (?:her |his |their |a |two weeks'? |2 weeks'? )?notice|resign(?:ed|s|ing)?|quit)\b/i;

/** "2026-11-17" → "11/17". */
function shortDate(iso: string): string {
  const match = /^\d{4}-(\d{2})-(\d{2})$/.exec(iso);
  return match ? `${Number(match[1])}/${Number(match[2])}` : iso;
}

export function terminationDetails(details: string, noticeGiven: string | null): string {
  const sentences = details.split(/(?<=[.!?])\s+/).map((sentence) => sentence.trim()).filter(Boolean);
  const kept = sentences.filter((sentence) => !RESIGNATION_WORDS.test(sentence));
  if (kept.length === sentences.length) return details;
  const notice = noticeGiven ? `Notice date recorded: ${shortDate(noticeGiven)}.` : null;
  return [...kept, ...(notice && !kept.some((sentence) => sentence.includes(shortDate(noticeGiven!))) ? [notice] : [])].join(" ").trim();
}
