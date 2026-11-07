import { CA_POLICY_LABEL, policiesNamedIn, type CaPolicyName } from "./ca-policy";

/**
 * ============================================================================
 * A POLICY THE MANAGER TOOK OFF STAYS OFF
 * ============================================================================
 *
 * PROPOSAL_POLICY_SET_ASIDE_ENABLED (QA, 8 Nov 2026: live in the sibling app at 00:20 and in this app's flip-7
 * tester). On a proposal card, "take the attendance policy off the form", sent after the manager had named that
 * policy, left the card's Attendance citation and "Policy: Attendance, as you said" where they were, and the
 * sentence itself was read back as more of the account. REMOVE_POLICY_NOT_NAMED only stops the take-off sentence
 * from NAMING the policy; the earlier naming, and the account itself ("30 minutes late" grounds Attendance), still
 * put it on the card.
 *
 * A TAKE-OFF SENTENCE — "take / get / pull … off / out", "remove / drop / delete / strip …", "leave … off / out",
 * "don't cite / list / include / use …" about a policy — sets aside every policy it names; one that names none ("take
 * the policy off") sets aside the policy the card is citing, whatever it is. A later sentence that names the policy
 * again, not to take it off, brings it back. A take-off sentence is an ask, never account.
 *
 * Pure: the caller decides when the flag applies.
 */

const POLICY_WORD = /\bpolic(?:y|ies)\b/;
const TAKE_OFF: readonly RegExp[] = [
  /\b(?:take|taking|get|getting|pull|pulling)\b[^.!?\n]*?\b(?:off|out)\b/,
  /\b(?:remove|removing|drop|dropping|delete|deleting|strip|stripping)\b/,
  /\b(?:leave|leaving)\b[^.!?\n]*?\b(?:off|out)\b/,
  /\b(?:don'?t|do not|no need to|shouldn'?t|should not)\s+(?:\S+\s+){0,2}?(?:cite|list|include|use|reference|quote|put)\b/,
];

export interface PolicySetAside {
  /** The policies taken off by name. */
  readonly names: ReadonlySet<CaPolicyName>;
  /** "take the policy off" with no policy named: whatever the card cites is off. */
  readonly any: boolean;
}

export const NOTHING_SET_ASIDE: PolicySetAside = { names: new Set(), any: false };

function sentencesOf(text: string): string[] {
  return (text ?? "")
    .split(/\n+|(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** A sentence that takes a policy off: named or not. */
export function takesPolicyOff(sentence: string): boolean {
  const text = (sentence ?? "").toLowerCase().replace(/[‘’]/g, "'");
  const named = policiesNamedIn(text).length > 0;
  if (!named && !POLICY_WORD.test(text)) return false;
  return TAKE_OFF.some((pattern) => pattern.test(text));
}

/** What the turns, oldest first, have taken off and not brought back. */
export function policiesSetAside(turns: readonly string[]): PolicySetAside {
  const names = new Set<CaPolicyName>();
  let any = false;
  for (const sentence of turns.flatMap(sentencesOf)) {
    const named = policiesNamedIn(sentence).map((found) => found.name);
    if (takesPolicyOff(sentence)) {
      if (named.length === 0) any = true;
      for (const name of named) names.add(name);
      continue;
    }
    for (const name of named) names.delete(name);
    if (named.length > 0) any = false;
  }
  return { names, any };
}

export function setAsideAnything(setAside: PolicySetAside): boolean {
  return setAside.any || setAside.names.size > 0;
}

/** The turns without their take-off sentences: what is left is account. */
export function withoutPolicyTakeOff(turns: readonly string[]): string[] {
  return turns.map((turn) =>
    turn
      .split("\n")
      .map((line) =>
        line
          .split(/(?<=[.!?])\s+/)
          .filter((sentence) => !takesPolicyOff(sentence))
          .join(" "),
      )
      .join("\n")
      .trim(),
  ).filter((turn) => turn !== "");
}

function labelsOf(setAside: PolicySetAside): string[] {
  return [...setAside.names].map((name) => CA_POLICY_LABEL[name]);
}

/** A line or a value that cites a policy set aside. */
export function citesSetAside(text: string, setAside: PolicySetAside): boolean {
  const lower = (text ?? "").toLowerCase();
  if (setAside.any) return true;
  if (labelsOf(setAside).some((label) => lower.includes(label.toLowerCase()))) return true;
  return policiesNamedIn(lower).some((found) => setAside.names.has(found.name));
}

const POLICY_ROW = /^\*\*Policy:\*\*/;
const CITATION_LINE = /\bJBA Policy Manual\b/i;

/** The line the card says instead. */
export function policySetAsideLine(setAside: PolicySetAside): string {
  const labels = labelsOf(setAside);
  const what = labels.length > 0 ? `the ${labels.join(" and ")} policy` : "the policy";
  return `**Policy:** none — you took ${what} off, so I won't cite it on the draft. Tell me if a different policy applies.`;
}

/**
 * The card without the policy rows and manual citations of what was set aside, and one line saying so. Unchanged
 * when nothing is set aside.
 */
export function withPolicySetAside(content: string, setAside: PolicySetAside): string {
  if (!setAsideAnything(setAside)) return content;
  const kept = content
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      if (POLICY_ROW.test(trimmed)) return !citesSetAside(trimmed, setAside) && !setAside.any;
      if (CITATION_LINE.test(trimmed) && !trimmed.startsWith("**")) return !citesSetAside(trimmed, setAside);
      return true;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return `${kept}\n\n${policySetAsideLine(setAside)}`.trim();
}

/** A source the card shows for a policy set aside. */
export function citationSetAside(citation: { excerpt?: string; locator?: string }, setAside: PolicySetAside): boolean {
  if (!setAsideAnything(setAside)) return false;
  const heading = (citation.excerpt ?? "").split(/[.\n]/)[0] ?? "";
  return citesSetAside(heading, setAside);
}

/** The policy fields a draft writes from the manual. */
const POLICY_FIELD_KEYS = new Set(["policy_violated", "policy_language"]);
const POLICY_REFERENCE_LINE = /^\s*Policy reference:/i;

/**
 * A drafted form's values with a policy set aside left off: the policy fields that cite it are emptied, and a
 * "Policy reference: …" line that cites it is taken out of any other field.
 */
export function valuesWithPolicySetAside(values: Record<string, string>, setAside: PolicySetAside): Record<string, string> {
  if (!setAsideAnything(setAside)) return values;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (POLICY_FIELD_KEYS.has(key)) {
      out[key] = citesSetAside(value, setAside) ? "" : value;
      continue;
    }
    if (typeof value !== "string" || !POLICY_REFERENCE_LINE.test(value.split("\n").find((line) => POLICY_REFERENCE_LINE.test(line)) ?? "")) {
      out[key] = value;
      continue;
    }
    out[key] = value
      .split("\n")
      .filter((line) => !(POLICY_REFERENCE_LINE.test(line) && citesSetAside(line, setAside)))
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }
  return out;
}
