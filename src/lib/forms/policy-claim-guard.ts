/**
 * ============================================================================
 * AN OBSERVATION SAYS WHAT HAPPENED. IT DOES NOT SAY WHAT RULE IT BROKE.
 * ============================================================================
 *
 * QA caught this on a real Corrective Action Form. Told "she was wearing a mini
 * skirt today", the assistant wrote into Observation of Offense:
 *
 *   "On September 10, Sarah Test was observed wearing a mini skirt at the
 *    Kearny salon location, WHICH IS NOT IN COMPLIANCE WITH THE SUN TAN CITY
 *    DRESS CODE POLICY."
 *
 * The first clause is a fact a manager reported. The second is a legal-shaped
 * conclusion about a document nobody retrieved — and on that same form, the
 * Policy Violated and Direct policy fields were BLANK, because retrieval had
 * found nothing to put in them. So the record simultaneously asserted a policy
 * breach and declined to name the policy, which is the worst of both: it reads
 * as established, and there is nothing behind it to defend.
 *
 * ============================================================================
 * WHY THE EXISTING GUARDS DID NOT CATCH IT
 * ============================================================================
 *
 * `policy-grounding.ts` protects the two fields MARKED `policyGrounded`, and it
 * protects them completely — an unverified policy value is refused at the
 * write. Observation of Offense is not one of those fields and must not become
 * one: it is the manager's account, it is required, and withholding it because
 * a manual could not be searched would empty the form.
 *
 * `narrative-draft.ts` does hold a policy-citation rule, and it is the right
 * one — but it runs only on fields whose stored version marks them with the
 * Observed/Expectation shape. The Corrective Action Form's Observation is plain
 * long text, so nothing ran on it at all.
 *
 * This is the missing third rule, and it is scoped to the gap: on a form whose
 * policy fields could not be verified, a drafted value may state WHAT WAS SEEN
 * and may not state THAT IT BROKE A RULE.
 *
 * ============================================================================
 * A CLAUSE, NOT A SENTENCE, WHEREVER A CLAUSE IS ENOUGH
 * ============================================================================
 *
 * `drafted-text.ts` removes a whole sentence for a placeholder, and it argues
 * that case well: "I will check in with Sarah on" is broken prose that still
 * asserts a commitment. The opposite is true here. The offending text is almost
 * always a trailing subordinate clause bolted onto a sound observation, and
 * dropping the sentence would delete the one fact the manager actually
 * supplied — leaving Observation of Offense empty on a corrective action
 * record, which is a worse document than the one being fixed.
 *
 * So a clause is cut where the sentence survives it, and the sentence goes only
 * when what is left is no longer a statement of anything.
 *
 * ============================================================================
 * IT RUNS ONLY WHEN THE POLICY IS UNVERIFIED
 * ============================================================================
 *
 * With approved policy retrieved, the claim is supportable and the form is
 * meant to make it: that is what Policy Violated and the direct quotation are
 * for, and an observation that reads alongside them is the document working as
 * designed. The guard exists for the case where the manual could not be
 * searched, could not be matched, or does not contain what the manager assumed
 * it contains.
 */

/**
 * Trailing clauses that convert an observation into a finding.
 *
 * Each pattern eats to the end of its clause — the next `.`, `;` or `—` — so
 * "…wearing a mini skirt at the Kearny salon, which is not in compliance with
 * the dress code policy." loses exactly the part after the comma.
 */
const CLAIM_CLAUSE: readonly RegExp[] = [
  /\s*,?\s*(?:and\s+)?(?:which|that|this)\s+(?:is|was|are|were)\s+(?:a\s+|an\s+|in\s+)?(?:direct\s+)?(?:violation|breach|infraction|non-?compliance)\b[^.;—]*/gi,
  /\s*,?\s*(?:and\s+)?(?:which|that|this)\s+(?:is|was|are|were)\s+not\s+in\s+(?:compliance|line|keeping|accordance)\b[^.;—]*/gi,
  /\s*,?\s*(?:and\s+)?(?:which|that|this)\s+(?:is|was|are|were)\s+(?:prohibited|forbidden|not\s+permitted|not\s+allowed|against\s+polic\w+|contrary\s+to\b)[^.;—]*/gi,
  /\s*,?\s*(?:and\s+)?(?:which|that|this)\s+(?:violates?|violated|breach(?:es|ed)?|contravenes?|contravened|fails?\s+to\s+(?:comply|meet)|failed\s+to\s+(?:comply|meet)|does\s+not\s+(?:comply|meet)|did\s+not\s+(?:comply|meet)|do\s+not\s+(?:comply|meet))\b[^.;—]*/gi,
  /\s*,?\s*in\s+(?:direct\s+)?(?:violation|breach|contravention)\s+of\b[^.;—]*/gi,
  /\s*,?\s*contrary\s+to\s+(?:the\s+|our\s+|company\s+)?(?:polic\w+|dress\s+code|standards?|handbook|manual|rules?)\b[^.;—]*/gi,
  /\s*,?\s*(?:which\s+)?is\s+not\s+compliant\s+with\b[^.;—]*/gi,
];

/**
 * Whole sentences that exist only to assert a breach.
 *
 * Checked AFTER the clause cuts, on what is left, so a sentence that merely
 * lost a trailing clause is never caught by this as well. Both halves are
 * required — a rule word AND a breach word — because "the dress code was
 * discussed with her" is a fact about a conversation and stays.
 */
const RULE_WORD =
  /\b(?:polic\w+|handbook|manual|dress\s+code|standards?\s+of\s+conduct|code\s+of\s+conduct|company\s+standards?|uniform\s+standards?|rules?)\b/i;

const BREACH_WORD =
  /\b(?:violat\w+|breach\w*|infraction|non-?compliance|non-?compliant|not\s+in\s+compliance|prohibited|forbidden|not\s+permitted|not\s+allowed|impermissible|unacceptable\s+under)\b/i;

/**
 * What survives as a statement.
 *
 * A clause cut can leave "On September 10, Sarah Test was observed wearing a
 * mini skirt at the Kearny salon location." — which is the whole point — or it
 * can leave a stub like "This was." A stub is dropped: a fragment on an HR
 * record is worse than a shorter paragraph.
 */
const MINIMUM_SENTENCE_WORDS = 4;

/** Sentence-ish spans, kept with their trailing punctuation. */
function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/);
}

function words(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Tidies the punctuation a clause cut leaves behind. */
function repair(sentence: string): string {
  return sentence
    .replace(/\s+([.,;!?])/g, "$1")
    .replace(/,\s*([.!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .replace(/,\s*$/, "")
    .trim();
}

export interface PolicyClaimResult {
  /** The drafted values, with unsupported findings removed. */
  values: Record<string, string>;
  /** Field keys a claim was cut out of, the text still standing. */
  adjusted: string[];
  /** Field keys left empty because nothing survived. */
  emptied: string[];
}

/**
 * Removes unsupported policy findings from drafted text.
 *
 * `skipKeys` are the fields `policy-grounding.ts` already owns. They are not
 * cleaned here and they are not left alone either — they are refused outright
 * by that module when the grounding is unverified, which is a stronger rule
 * than this one. Running both over the same field would only risk this guard
 * making an unverified value look tidy enough to keep.
 */
export function stripUnsupportedPolicyClaims(
  values: Record<string, string>,
  skipKeys: ReadonlySet<string>,
): PolicyClaimResult {
  const kept: Record<string, string> = {};
  const adjusted: string[] = [];
  const emptied: string[] = [];

  for (const [key, value] of Object.entries(values)) {
    if (skipKeys.has(key) || typeof value !== "string" || value.trim() === "") {
      kept[key] = value;
      continue;
    }

    let changed = false;
    const surviving: string[] = [];

    for (const line of value.split("\n")) {
      const rebuilt: string[] = [];

      for (const sentence of sentences(line)) {
        let text = sentence;
        for (const pattern of CLAIM_CLAUSE) {
          pattern.lastIndex = 0;
          const next = text.replace(pattern, "");
          if (next !== text) changed = true;
          text = next;
        }
        text = repair(text);

        if (text === "") continue;
        if (RULE_WORD.test(text) && BREACH_WORD.test(text)) {
          changed = true;
          continue;
        }
        if (words(text) < MINIMUM_SENTENCE_WORDS && text !== sentence.trim()) {
          changed = true;
          continue;
        }
        rebuilt.push(text);
      }

      surviving.push(rebuilt.join(" "));
    }

    const result = surviving.join("\n").replace(/\n{3,}/g, "\n\n").trim();

    if (!changed) {
      kept[key] = value;
      continue;
    }
    if (result === "") {
      emptied.push(key);
      continue;
    }
    kept[key] = result;
    adjusted.push(key);
  }

  return { values: kept, adjusted, emptied };
}

/**
 * The sentence the fill screen shows when a finding was removed.
 *
 * SAID OUT LOUD, because a silently shortened observation is a change to an HR
 * record that nobody signed off. The manager may well be right that a policy
 * was broken — what is missing is the approved source that says so, and that is
 * a thing they can go and check.
 */
export const POLICY_CLAIM_REMOVED_NOTICE =
  "Ask Sunny kept the observation to what was seen. It removed the statement that a policy was breached, because no approved policy was retrieved to support it — confirm the exact policy in the official manual, then add the finding yourself.";

/**
 * ============================================================================
 * THE SAME SEPARATION, SAID TO THE MODEL
 * ============================================================================
 *
 * The guard above is what HOLDS — a prompt instruction is a request and this is
 * a finding on somebody's employment record. These lines are what stops the
 * model producing the text in the first place, which is worth having for its
 * own sake: a draft that arrives clean reads better than one a regex has cut a
 * clause out of, and the manager is not shown a notice about something that
 * never happened.
 *
 * SENT ONLY TO FORMS THAT QUOTE POLICY. Every one of these lines is about the
 * relationship between an observation, an offense category and a policy field,
 * and thirteen of the templates have no policy field at all.
 */
export const POLICY_SEPARATION_RULES: readonly string[] = [
  "An observation states WHAT WAS SEEN OR HEARD and never whether it broke a rule. Write 'was observed wearing a mini skirt at the salon', never 'which is not in compliance with the dress code policy'.",
  "Never write that something violates, breaches, contravenes or is not in compliance with a policy, a dress code, a handbook or a standard. Whether a rule was broken is settled by the policy fields, from the approved manual, and nowhere else on this form.",
  "The Type of Offense boxes are CATEGORIES you may tick. They are not policies. Never copy an offense category — 'Dress Code Violation', 'Standards of Conduct', 'Absenteeism' — into a policy field: a policy field takes the policy's own title or section from the approved manual, and nothing else.",
  "Never state a specific rule the approved policy in front of you does not state. Without a retrieved requirement, write the expectation generally — that the employee is expected to meet the current company requirement and that management will review it with them — rather than inventing what the requirement is.",
];
