/**
 * A typed name is enough. Woven is not a gate.
 *
 * The repair model and the directory check both used to answer with their
 * own instructions ("I cannot repair this reply", "does not appear on the
 * employee roster"). That text is the validator talking, and it never goes
 * out. A missing directory row is not said as an error.
 */

const VALIDATOR =
  /I cannot repair|does not appear on the employee roster|I cannot create this form|couldn'?t find \*\*[^*]+\*\* in the Woven roster|didn'?t find \*\*[^*]+\*\* in the employee list|employee list for your salons|not found in (?:the )?(?:woven )?roster|confirmation of the employee'?s name from the roster|check the spelling before you file|verify (?:the )?name and resubmit/i;

/** Drop validator sentences. A missing section or a missing form stays. */
export function scrubRosterBlock(content: string): string {
  const lines = content.split("\n").map((line) => {
    if (!VALIDATOR.test(line)) return line;
    const kept = line
      .split(/(?<=[.!?])\s+/)
      .filter((sentence) => sentence.trim() && !VALIDATOR.test(sentence));
    return kept.join(" ");
  });
  return lines
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The name as it is printed when the directory has no spelling of its own. */
export function displayTypedName(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((word) => {
      if (/[A-Z]/.test(word) && /[a-z]/.test(word)) return word;
      const lower = word.toLowerCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

export function repairSpeaksAsValidator(content: string): boolean {
  return /I cannot repair|does not appear on the employee roster|I cannot create this form|couldn'?t find \*\*|in the Woven roster|not found in the roster/i.test(content);
}
