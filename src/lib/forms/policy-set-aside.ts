import { policyLineCoversEverySectionEnabled } from "@/lib/config/chat-quality-flags";

import { policyPhrase } from "./ca-action-plan";
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

/*
 * A REMARK ABOUT WHICH POLICY TO CITE IS NO ACCOUNT EITHER (QA, 8 Nov 2026; the sibling app's live chat 1cc79ee9, 6 Nov,
 * and again that night): "In the past we have quoted the standards of conduct for creating a ca due to
 * underperformance" settles the policy; it says nothing that happened. A sentence that names a policy and says to
 * quote, cite, reference, use or list it, or what it falls under, is a policy ask: the policy readers read it, the
 * account never holds it.
 */
const CITING = /\b(?:quot(?:e|ed|es|ing)|cit(?:e|ed|es|ing)|referenc(?:e|ed|es|ing)|us(?:e|ed|es|ing)|list(?:ed|s|ing)?|go(?:es)?\s+under|falls?\s+under|put\s+(?:it\s+|this\s+)?under)\b/;

/** A sentence that only says which policy to cite. */
export function remarksOnPolicy(sentence: string): boolean {
  const text = (sentence ?? "").toLowerCase().replace(/[‘’]/g, "'");
  return policiesNamedIn(text).length > 0 && CITING.test(text);
}

/** A sentence that is a policy ask, never account: a take-off, or a remark about which policy to cite. */
export function asksAboutPolicy(sentence: string): boolean {
  return takesPolicyOff(sentence) || remarksOnPolicy(sentence);
}

/** The turns without their policy asks (take-offs and remarks): what is left is account. For the card's account. */
export function withoutPolicyAsks(turns: readonly string[]): string[] {
  return turns.map((turn) =>
    turn
      .split("\n")
      .map((line) =>
        line
          .split(/(?<=[.!?])\s+/)
          .filter((sentence) => !asksAboutPolicy(sentence))
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
  const otherKept = policyLineCoversEverySectionEnabled() ? withOtherPolicyKept(content, setAside) : null;
  if (otherKept !== null) return otherKept;
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
      /*
       * POLICY_LINE_COVERS_EVERY_SECTION_ENABLED (ported from Ask Bubbles): the policy left after one was taken off keeps
       * its quoted section, which may mention the other: Direct policy follows Policy Violated, which names only the
       * policy left.
       */
      const violated = (values.policy_violated ?? "").trim();
      const keepsLeft = policyLineCoversEverySectionEnabled() && key === "policy_language" && violated !== "" && !citesSetAside(violated, setAside);
      out[key] = !keepsLeft && citesSetAside(value, setAside) ? "" : value;
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

/*
 * POLICY_LINE_COVERS_EVERY_SECTION_ENABLED (ported from Ask Bubbles: Gate-Bubbles-4's NO-GO probe, 14 Nov 2026): on a
 * card citing two policies ("Attendance and Standards of Conduct"), "take the attendance policy off the form" said
 * "Policy: none — you took the Attendance policy off" with a generic plan. One taken off, the other stays: the Policy
 * line names it, its citation lines stay, and the plan reviews it (the card's plan step then shows the plan Create
 * saves; Create reads the account without the offense taken off, `ca-policy.ts` withoutSetAsideOffense). Null when the
 * card does not cite a policy that stays, so the line says "none" as before.
 */
function withOtherPolicyKept(content: string, setAside: PolicySetAside): string | null {
  if (setAside.any) return null;
  const lines = content.split("\n");
  const at = lines.findIndex((line) => POLICY_ROW.test(line.trim()));
  if (at < 0) return null;
  const cited = [...new Set(policiesNamedIn(lines[at]!.toLowerCase()).map((found) => found.name))];
  const left = cited.filter((name) => !setAside.names.has(name));
  if (left.length === 0 || left.length === cited.length) return null;
  const leftLabels = left.map((name) => CA_POLICY_LABEL[name]);
  const gone = labelsOf(setAside);
  const joined = leftLabels.length === 1 ? leftLabels[0]! : `${leftLabels.slice(0, -1).join(", ")} and ${leftLabels.at(-1)}`;
  lines[at] = `**Policy:** ${joined} — you took the ${gone.join(" and ")} policy off, so I'll cite only ${joined} on the draft. Tell me if a different policy applies.`;
  return lines
    .map((line) => {
      const plan = /^(\*\*Action plan:\*\*)\s*(.*)$/i.exec(line.trim());
      if (!plan) return line;
      const first = /\bwith ([A-Z][\w'-]*)\./.exec(plan[2]!)?.[1] ?? "the employee";
      const closing = /Future policy violations[^\n]*$/.exec(plan[2]!)?.[0] ?? "";
      return `${plan[1]} Management will review ${policyPhrase(leftLabels)} with ${first}.${closing ? ` ${closing}` : ""}`;
    })
    .filter((line, index) => index === at || !(CITATION_LINE.test(line.trim()) && !line.trim().startsWith("**") && citesSetAside(line.trim(), setAside)))
    .join("\n");
}
