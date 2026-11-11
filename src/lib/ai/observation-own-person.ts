/*
 * ============================================================================
 * THE OBSERVATION IS THE ACCOUNT, NEVER OTHER PEOPLE'S NAMES OR THE MANAGER'S COMMAND (OBSERVATION_OWN_PERSON_ONLY_ENABLED)
 * ============================================================================
 *
 * QA's P7, Sunny live on the 13b chat code (10 Nov 2026; the people invented): "Make me a coaching form for <A>, <B>,
 * and <C> for not closing duties correctly", then "create draft for failure to do closing duties and staying over hours",
 * gave a card whose Observation was "<B>, and <C> for not closing duties correctly create draft for failure to do closing
 * duties and staying over hours": the request's other people stayed in, and so did the manager's command to the app.
 *
 * With the flag on, each sentence of the Observation line loses a lead that is only names ("<B>, and <C> for …") and a
 * lead that only asks for the form ("create draft for …"); what follows — the reason — is kept. Pure.
 */

const NAME = String.raw`\p{Lu}[\p{L}'’-]+(?:\s+\p{Lu}[\p{L}'’-]+)?`;
/** "<B>, and <C> for …", "<B> and <C> for …": a lead that is only a list of names, before "for" (one capitalised phrase is not). */
const NAMES_LEAD = new RegExp(String.raw`^(?:(?:and\s+)?${NAME}(?:\s*,\s*|\s+and\s+))+(?:and\s+)?${NAME}\s+for\s+`, "u");
/** "create draft for …", "please make the form about …", "can you create a coaching form for …". */
const COMMAND_LEAD =
  /^(?:(?:ok(?:ay)?|yes|so|now)[,\s]+)?(?:(?:can|could|would|will)\s+you\s+)?(?:please\s+)?(?:go\s+ahead\s+(?:and\s+)?)?(?:create|make|start|do|draft|generate|prepare|write(?:\s+up)?)\s+(?:me\s+)?(?:(?:a|an|the|this|that)\s+)?(?:new\s+)?(?:draft|form|coaching(?:\s+form)?|ca|corrective\s+action(?:\s+form)?)\s+(?:for|about|on|regarding)(?:\s+|$)/i;

/** The sentence's account without a lead of other people's names or of the manager's command; null when nothing is left. */
export function ownPersonAccount(sentence: string): string | null {
  let text = sentence.trim();
  for (let pass = 0; pass < 2; pass += 1) text = text.replace(COMMAND_LEAD, "").replace(NAMES_LEAD, "").trim();
  if (text.length < 3) return null;
  return text === sentence.trim() ? text : `${text[0]!.toUpperCase()}${text.slice(1)}`;
}
