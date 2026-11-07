/**
 * FORM_PATCH_READER_FIXES_ENABLED (coding 5; QA's live runs, 7 Nov 2026): the Step B reader read the latest
 * message as about the open form and found nothing in it to write ("add details about the towel" with no towel
 * details given; "yes, do that" after the edit was saved). The turn then goes to the old path, whose revision
 * may not write text that adds nothing new — only its instruction's own words, or what the form already says
 * ("Observed: Add details about the towel.", the same reminder twice).
 *
 * Kept per form for the turn: the old path may rewrite the message before its revision runs (a refers-back
 * reading turns "yes, do that" into "Add this to …"), so it is not matched on the text. Set by the patch turn,
 * cleared at the start of every patch turn, taken once by the one writer's revision preset (`form-write.ts`),
 * and void after TURN_MS. Pure state; no I/O.
 */
const TURN_MS = 60_000;
const found = new Map<string, { at: number; evidence: Readonly<Record<string, string>> }>();

/** `evidence`: by field, the reader's evidence for the ops it read (a refused "make it about X"); the revision keeps it. */
export function noteReaderFoundNothing(instanceId: string, evidence: Readonly<Record<string, string>> = {}): void {
  found.set(instanceId, { at: Date.now(), evidence });
}

export function clearReaderFoundNothing(instanceId: string): void {
  found.delete(instanceId);
}

/** Once, when this turn's reader handed off on this form: its evidence (empty when it read nothing to set). Null otherwise. */
export function takeReaderFoundNothing(instanceId: string): { evidence: Readonly<Record<string, string>> } | null {
  const entry = found.get(instanceId);
  found.delete(instanceId);
  return entry !== undefined && Date.now() - entry.at <= TURN_MS ? { evidence: entry.evidence } : null;
}
