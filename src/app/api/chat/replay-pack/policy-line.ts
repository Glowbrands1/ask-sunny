/**
 * The policy a card's "**Policy:**" line CITES (QA, 7 Nov 2026, the sibling app's gate A): the name the line opens with
 * ("**Policy:** Other — … not the Standards of Conduct." cites Other), or the one it "reads as". A check on the
 * words alone failed on that Other line, which names the Standards of Conduct only to say it is not cited.
 */
export function citedPolicy(line: string): string {
  const rest = line.replace(/^.*?\*\*Policy:?\*\*\s*/i, "");
  const readsAs = /^this reads as \*\*([^*]+)\*\*/i.exec(rest);
  if (readsAs) return readsAs[1]!.trim();
  return rest.split(/\s+[—–-]\s+|[,.;(]/)[0]!.replace(/\*\*/g, "").trim();
}
