/**
 * ============================================================================
 * THE WRITE-UP NEVER ADDS A PLACE THE MANAGER DID NOT SAY
 * ============================================================================
 *
 * QA's live check (20 Nov 2026, item 17; the Test Testy draft): the saved write-up read "… wearing a mini skirt at the
 * salon", and the manager never said "salon". The drafting rules' own example ("was observed wearing a mini skirt at the
 * salon", `policy-claim-guard.ts`) is the likely source.
 *
 * On a loop card's Create, "at / in the <location noun>" (the app's own noun for a location, "salon" here) is taken out
 * of the saved text when the manager's words never use that noun. It reads the saved text and checks the noun against
 * what the manager typed: no word list over their messages. Pure.
 */
export function withoutUnsaidPlace(
  values: Record<string, string>,
  keys: ReadonlySet<string>,
  managerWords: string,
  locationNoun: string,
): { values: Record<string, string>; changed: string[] } {
  const noun = locationNoun.trim().toLowerCase();
  if (!noun || new RegExp(`\\b${noun}s?\\b`, "i").test(managerWords)) return { values, changed: [] };
  const phrase = new RegExp(`[ \\t]*,?[ \\t]*\\b(?:at|in|inside)\\s+(?:the|her|his|their|our|this|that)\\s+${noun}\\b`, "gi");
  const changed: string[] = [];
  const out = { ...values };
  for (const [key, value] of Object.entries(values)) {
    if (!keys.has(key) || typeof value !== "string" || !phrase.test(value)) continue;
    phrase.lastIndex = 0;
    out[key] = value.replace(phrase, "").replace(/[ \t]+([.,;!?])/g, "$1");
    changed.push(key);
  }
  return changed.length > 0 ? { values: out, changed } : { values, changed };
}
