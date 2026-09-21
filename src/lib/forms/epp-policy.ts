import {
  findManualSection,
  manualDisplayTitle,
  type ManualChunk,
  type ManualSection,
} from "./official-policy-manual";

/**
 * ============================================================================
 * WHICH PART OF THE JBA MANUAL A PERFORMANCE OBSERVATION POINTS AT
 * ============================================================================
 *
 * A Corrective Action Form says which policy was breached by having a box
 * ticked: the manager classifies the offense, and `OFFENSE_MANUAL_SECTIONS`
 * turns that classification into a section of the approved manual. An EPP has
 * no such box. What it has is a manager writing "she's great with clients but
 * she's been late several times this month" — prose, in their own words, about
 * somebody who is not in trouble.
 *
 * So the topic is READ FROM WHAT THEY WROTE, and the topic decides which
 * sections of the JB & Associates Employment Policy Manual are worth putting
 * in front of the model. That is the whole job of this file.
 *
 * ============================================================================
 * THE AUTHORITATIVE SOURCE IS THE JBA MANUAL, AND ONLY IT
 * ============================================================================
 *
 * Every heading below is one this manual actually prints, verified against the
 * indexed document rather than transcribed from another company's handbook.
 * There is no second manual in this path and no general-HR fallback: a topic
 * whose section the manual does not state resolves to NOTHING, and the draft
 * is written as ordinary coaching with no policy named. A blank policy line a
 * manager can fill is the safe failure; a confident citation of a document
 * nobody read is the dangerous one.
 *
 * ============================================================================
 * WHAT A RESOLVED SECTION IS AND IS NOT ALLOWED TO DO
 * ============================================================================
 *
 * IT IS CONTEXT, NOT A CONCLUSION. A retrieved section lets the draft say what
 * the company expects; it never lets the draft say the employee BROKE a rule,
 * and it never turns a manager's opinion into a company requirement. "She
 * doesn't have enough initiative" stays an observation, because no section of
 * this manual makes initiative a policy — `eppPolicyTopics` returns nothing for
 * it, and the caller's claim guards do the rest.
 *
 * IT NEVER WIDENS. Only the topics the manager actually raised are retrieved.
 * Handing the model the whole manual on every EPP would make every plan of
 * action a policy review.
 */

/**
 * The appendix field the resolved sections are printed on.
 *
 * NAMED HERE because two places need to agree on it and neither should own it:
 * the route derives the value, and `DERIVED_POLICY_FIELD_KEYS` holds the model
 * out of it. A literal in both is how the two come to disagree.
 */
export const EPP_POLICY_REFERENCE_KEY = "policy_references";

export type EppPolicyTopicKey =
  | "punctuality"
  | "call_off"
  | "scheduling"
  | "job_performance"
  | "client_experience"
  | "safety"
  | "conduct"
  | "bonus"
  | "corrective_history";

export interface EppPolicyTopic {
  readonly key: EppPolicyTopicKey;
  /** How the topic is named back to a manager, in their own vocabulary. */
  readonly label: string;
  /** What in the manager's words raises this topic. Whole words throughout. */
  readonly patterns: readonly RegExp[];
  /**
   * The sections to look for, spelled as the JBA manual spells them.
   *
   * ORDERED BY HOW DIRECTLY EACH GOVERNS THE TOPIC, because that is the order
   * they are cited in. Every one is a heading this manual prints on the sheet
   * it starts; a heading the manual does not state resolves to nothing rather
   * than to something near it.
   */
  readonly headings: readonly string[];
}

export const EPP_POLICY_TOPICS: readonly EppPolicyTopic[] = [
  {
    key: "punctuality",
    label: "Punctuality and attendance",
    patterns: [
      /\b(?:late|lateness|tardy|tardiness|punctual|punctuality|overslept|oversleeping)\b/,
      /\b(?:clock(?:ing)?[- ]?in|clocked in|on time|start time|shift start)\b/,
      /\b(?:left early|leaving early|clocked out early)\b/,
    ],
    headings: ["Attendance", "Time Records", "Late Opening"],
  },
  {
    key: "call_off",
    label: "Calling off and notifying the salon",
    patterns: [
      /\b(?:absent|absence|absenteeism|no[- ]call|no[- ]show|called out)\b/,
      /*
       * "CALLED OFF" IS HOW PEOPLE SAY IT. `call[- ]?off` alone matched the
       * noun and the bare infinitive and missed both past tenses, so the
       * commonest sentence a manager writes about this — "she called off on
       * Saturday" — raised no topic and retrieved no attendance policy.
       */
      /\bcall(?:ed|ing|s)?[- ]?off\b/,
      /\b(?:missed (?:her|his|their|the) shift|did not show|didn't show|failed to notify)\b/,
    ],
    headings: ["Attendance", "Shift Replacement", "Texting as General Work communications"],
  },
  {
    key: "scheduling",
    label: "Schedule requests and shift cover",
    patterns: [
      /\b(?:schedule|scheduling|availability|shift swap|swap(?:ping)? shifts|trade shifts|shift cover|covering (?:a|her|his|their) shift)\b/,
      /\b(?:time off request|requested time off|schedule conflict|scheduling conflict)\b/,
    ],
    headings: ["Schedule Requests/General availability Changes", "Shift Replacement"],
  },
  {
    key: "job_performance",
    label: "Job performance",
    patterns: [
      /\b(?:performance|underperform\w*|under[- ]performing|not meeting (?:her|his|their)? ?(?:goals|targets|expectations))\b/,
      /\b(?:job duties|closing duties|opening duties|task|tasks|follow[- ]?through|accountab\w+)\b/,
      /\b(?:evaluation|review period|raise)\b/,
    ],
    headings: ["Standards of Conduct", "Evaluations and Raises"],
  },
  {
    key: "client_experience",
    label: "Client service and salon culture",
    patterns: [
      /\b(?:client service|customer service|client experience|guest experience|clients?|customers?|greeting|greets?)\b/,
      /\b(?:friendly|welcoming|rapport|engagement strateg\w+|buy[- ]?in|atmosphere)\b/,
    ],
    headings: ["Our Culture", "Core Values"],
  },
  {
    key: "safety",
    label: "Safety in the workplace",
    patterns: [
      /\b(?:safety|unsafe|hazard|injur\w+|accident|spill|chemical|incident report\w*)\b/,
      /\b(?:sanitiz\w+|sanitis\w+|cleaning procedure|equipment safety)\b/,
    ],
    headings: [
      "Safety in the Workplace",
      "Statement of Safety in the Workplace Policy",
      "Incident Reporting",
    ],
  },
  {
    key: "conduct",
    label: "Standards of conduct",
    patterns: [
      /\b(?:conduct|unprofessional|professionalism|rude|disrespect\w*|argued|arguing|insubordinat\w+)\b/,
      /\b(?:honest\w*|dishonest\w*|integrity|ethics|policy violation|violated (?:the|our) polic)\b/,
    ],
    headings: ["Standards of Conduct", "Business Ethics"],
  },
  {
    key: "bonus",
    label: "Bonus",
    patterns: [/\bbonus(?:es)?\b/, /\bbonus viewer\b/],
    headings: ["Bonus Policy"],
  },
  {
    /*
     * DISCIPLINARY ACTION IS RETRIEVED ONLY WHEN THE MANAGER RAISES IT.
     *
     * An EPP is a development document. Putting the manual's disciplinary
     * section in front of the model on every performance plan would invite a
     * coaching conversation to be drafted as the first step of a warning,
     * which is exactly the substitution the performance-management framework
     * exists to prevent. So this topic needs the manager to have named a
     * formal step themselves.
     */
    key: "corrective_history",
    label: "Prior corrective action",
    patterns: [
      /\b(?:corrective action|written warning|verbal warning|final warning|write[- ]?up|written up|disciplin\w+)\b/,
    ],
    headings: ["Disciplinary Action", "Standards of Conduct"],
  },
];

function normalize(text: string): string {
  return (text ?? "").toLowerCase().replace(/[^\S\n]+/g, " ");
}

/**
 * The topics the manager's own words actually raise, in this file's order.
 *
 * READ FROM THE MANAGER'S TEXT AND NOTHING ELSE — never from something the
 * model produced, so the policy a draft is reasoned against cannot be steered
 * by an earlier hallucination. The same rule `groundPolicy` follows.
 *
 * NO FALLBACK TOPIC. An observation this file recognises nothing in returns an
 * empty list, and the EPP is drafted as ordinary coaching with no policy named.
 */
export function eppPolicyTopics(text: string): EppPolicyTopic[] {
  const normalized = normalize(text);
  if (normalized.trim().length < 4) return [];
  return EPP_POLICY_TOPICS.filter((topic) =>
    topic.patterns.some((pattern) => pattern.test(normalized)),
  );
}

/** A section of the manual, with the chunk text that evidenced it. */
export interface EppPolicyPassage {
  readonly topic: EppPolicyTopicKey;
  readonly section: ManualSection;
  readonly text: string;
}

/**
 * How much of a chunk travels into the prompt.
 *
 * Enough for the model to see what the section actually says, and far short of
 * the whole manual — the rule is targeted retrieval, not "paste the handbook".
 */
const PASSAGE_CHARS = 1200;

/**
 * Every JBA section the manager's observation points at, with its text.
 *
 * PURE, so the mapping can be tested against the real manual's chunks without
 * a database — which is how the headings above are kept honest about what this
 * particular document contains.
 *
 * FAILS CLOSED PER TOPIC, exactly as the corrective-action lookup does: a topic
 * whose section this manual does not state contributes nothing and does not
 * stop the topics beside it from resolving. A section already cited by an
 * earlier topic is not cited twice.
 */
export function eppPolicyPassages(input: {
  readonly chunks: readonly ManualChunk[];
  readonly topics: readonly EppPolicyTopic[];
}): EppPolicyPassage[] {
  const byIndex = new Map(input.chunks.map((chunk) => [chunk.chunkIndex, chunk]));
  const found: EppPolicyPassage[] = [];
  const seen = new Set<string>();

  for (const topic of input.topics) {
    for (const heading of topic.headings) {
      const section = findManualSection(input.chunks, [heading]);
      if (!section) continue;
      if (seen.has(section.heading)) continue;
      seen.add(section.heading);
      found.push({
        topic: topic.key,
        section,
        text: (byIndex.get(section.chunkIndex)?.content ?? "").trim().slice(0, PASSAGE_CHARS),
      });
    }
  }

  return found;
}

/**
 * The line the draft-details appendix prints.
 *
 * `JBA Policy Manual — Attendance — Page 14; Time Records — Page 36`
 *
 * THE SAME SHAPE THE CORRECTIVE FORMS USE, and for the same reason: the
 * manual, then the section, then the page, each part copied from a row rather
 * than composed. Nothing here can name a document that was not read.
 */
export function eppPolicyReference(
  documentTitle: string,
  passages: readonly EppPolicyPassage[],
): string | null {
  if (passages.length === 0) return null;
  const title = manualDisplayTitle(documentTitle);
  if (title.trim() === "") return null;

  const cited = [
    ...new Set(
      passages.map((passage) => `${passage.section.heading.trim()} — Page ${passage.section.page}`),
    ),
  ];
  return `${title} — ${cited.join("; ")}`;
}

/**
 * The rules the model is given alongside the retrieved sections.
 *
 * ============================================================================
 * FIVE THINGS THAT MUST NOT BE BLURRED TOGETHER
 * ============================================================================
 *
 * A manager's observation, the company's written policy, an expectation
 * already printed on this form, Ask Sunny's own coaching suggestion, and a
 * productivity figure the manager supplied. Each carries a different kind of
 * authority, and an EPP that presents a coaching suggestion as a company
 * requirement is a document the employee is then held to for a rule that does
 * not exist.
 *
 * THE HARDEST CASE IS THE HONEST-SOUNDING ONE. "She doesn't have enough
 * initiative" is a fair thing for a manager to think and a fair thing to coach
 * on. It is not in the manual, and "JBA policy requires employees to
 * demonstrate initiative" is a sentence nobody can defend. So the instruction
 * is not "be careful with policy" — it is that a policy claim is permitted
 * ONLY where the retrieved section in front of the model actually says it.
 */
export const EPP_POLICY_RULES: readonly string[] = [
  "This is a performance PLAN, not a warning. Write it as coaching: what the employee already does well, what they should do differently, and how it will be reviewed. Never write a disciplinary step, a warning level, a consequence, or a threat to employment.",
  "Keep five things apart and never blend them: what the MANAGER OBSERVED, what COMPANY POLICY says, an EXPECTATION already printed on this form, YOUR OWN coaching suggestion, and a PRODUCTIVITY FIGURE the manager supplied.",
  "You may state a company requirement only where the JB & Associates policy given to you actually states it. If it does not, write the expectation as ordinary coaching and attribute it to nobody.",
  "Never write that company policy, the manual or the handbook requires something you were not shown. A manager's opinion about someone — initiative, attitude, confidence — is an observation to coach on, never a policy.",
  "Never state that the employee broke, violated or failed to comply with a rule. An EPP records where somebody is and what they will work on.",
  "Never invent a productivity figure, a date, a count of incidents or an amount. Leave the field empty when the manager gave you nothing.",
  "Do not exaggerate what the manager told you, and do not invent an incident. Expand their wording into professional, neutral, fact-based language and no further.",
];

/** How the retrieved sections are put in front of the model. */
export function eppPolicyBlock(
  documentTitle: string,
  passages: readonly EppPolicyPassage[],
): string {
  if (passages.length === 0) return "";
  const title = manualDisplayTitle(documentTitle);
  return [
    "",
    `APPLICABLE COMPANY POLICY — ${title}. Reason from this. It is the ONLY source of company policy for this form; do not quote it at length and do not state a requirement it does not state:`,
    ...passages.map(
      (passage) =>
        `[${title} — ${passage.section.heading} — Page ${passage.section.page}]\n${passage.text}`,
    ),
  ].join("\n");
}
