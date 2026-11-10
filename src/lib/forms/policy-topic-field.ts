import { formatManualCitation } from "@/lib/ai/policy-citation-fields";

import { sectionText } from "./ca-policy";
import { namesHeading } from "./named-policy-section";
import { findManualSection, headingKey, manualSectionHeadings, type ManualChunk, type ManualSection } from "./official-policy-manual";

/*
 * ============================================================================
 * "INCLUDE OUR WOVEN POLICY ON <TOPIC>" WRITES THE POLICY, NEVER A POINTER TO IT (POLICY_TOPIC_INTO_FIELD_ENABLED)
 * ============================================================================
 *
 * ported from the sibling app (QA, a manager's 1★ rating there, 10 Nov 2026): "I asked it to write a coaching form on our policy for finding a cover and
 * the sentence it gave me was to refer to the woven policy manual for finding a cover." On a saved whole-team Coaching
 * draft, "In details of coaching inlude our woven policy on finding a cover for your shift" was answered "Updated the
 * Coaching Form for the team: Details of Coaching", and the Details told the manager to refer to the policy manual. The
 * manual has the section (Shift Replacement, printed page 37).
 *
 * With the flag on, an edit that asks for "our (Woven / company) policy on <topic>" in a field is answered from the
 * manual itself: the one section the topic names (by its heading, or by the topic's words in the heading and the
 * section's text), quoted into the field with its "Policy reference: <heading>, JBA Policy Manual p.N" line, and the
 * reply says which section was written. No section, or more than one equally close: nothing is written and the reply
 * says so and asks which policy. Never a sentence that points at the manual. The section, its heading and its page come
 * from the manual's rows (`findManualSection`, `sectionText`); nothing here holds policy wording.
 */

const VERB = String.raw`\b(?:in\w{0,3}lude[sd]?|inclu\w*|add|put|insert|write|use|quote|paste|copy|attach|list|cite|reference|bring\s+in|pull\s+in)\b`;
const ABOUT = String.raw`(?:on|about|for|regarding|around|covering|of)`;
/** "our woven policy on <topic>", "the company policy about <topic>". */
const POLICY_ON = new RegExp(
  String.raw`\b(?:our|the|company(?:'s)?|woven(?:'s)?)\s+(?:(?:woven|company|official|store|salon)\s+)*polic(?:y|ies)\s+${ABOUT}\s+([^.?!\n]+)`,
  "i",
);
/** "our woven <topic> policy", "the <topic> policy". */
const TOPIC_POLICY = new RegExp(String.raw`\b(?:our|the)\s+(?:(?:woven|company|official)\s+)*((?:[a-z][\w'/-]*\s+){0,5}?[a-z][\w'/-]*)\s+polic(?:y|ies)\b`, "i");
/** Where a topic stops: the form or a field named after it ("… in the details", "… to the form"). */
const TOPIC_END = /\s+(?:in|into|on|to|under|for)\s+(?:the\s+)?(?:form|draft|card|details?|field|section|box|observation|notes?)\b.*$/i;

/** The topic of the policy the latest message asks to be put on the form, or null. */
export function policyTopicAsked(question: string): string | null {
  for (const sentence of question.match(/[^.!?\n]+[.!?]?/g) ?? []) {
    if (/\?\s*$/.test(sentence) || !new RegExp(VERB, "i").test(sentence)) continue;
    const named = POLICY_ON.exec(sentence)?.[1] ?? TOPIC_POLICY.exec(sentence)?.[1];
    const topic = named?.replace(TOPIC_END, "").trim();
    if (topic && contentWords(topic).length > 0) return topic;
  }
  return null;
}

/** The field the message names by its label ("In details of coaching …"), or null. */
export function fieldNamedIn(question: string, labels: Readonly<Record<string, string>>): string | null {
  const said = ` ${fold(question)} `;
  const named = Object.entries(labels)
    .filter(([, label]) => fold(label).length > 0 && said.includes(` ${fold(label)} `))
    .sort((a, b) => fold(b[1]).length - fold(a[1]).length);
  return named[0]?.[0] ?? null;
}

const STOP = new Set(
  "a an the our your their my his her its this that these those to of on in for at by with and or about regarding around covering from into as is are be policy policies woven company official manual handbook rule rules procedure procedures".split(
    " ",
  ),
);

/** The same word, written the ways an HR manual and a manager each write it. Generic vocabulary, no company's wording. */
const SAME_AS: Readonly<Record<string, readonly string[]>> = {
  cover: ["replac", "trad", "swap", "cover"],
  replac: ["cover", "replac"],
  swap: ["trad", "replac", "swap"],
  trad: ["swap", "replac", "trad"],
  sub: ["replac", "cover"],
  tardi: ["late", "attend"],
  late: ["late", "tardi"],
  absenc: ["attend", "absenc"],
  absent: ["attend", "absenc"],
  phone: ["phone", "cell"],
  cell: ["cell", "phone"],
  attir: ["dress", "attir", "uniform", "appear"],
  uniform: ["dress", "uniform", "attir"],
  dress: ["dress", "attir", "uniform"],
};

function fold(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function stem(word: string): string {
  return word.replace(/(?:ing|ement|ments|ment|ies|es|ed|s|e|y)$/, "") || word;
}

function contentWords(text: string): string[] {
  return [...new Set(fold(text).split(" ").filter((word) => word.length > 1 && !STOP.has(word)).map(stem))];
}

function alike(word: string, others: ReadonlySet<string>): boolean {
  return [word, ...(SAME_AS[word] ?? [])].some((form) => others.has(form));
}

/**
 * The one manual section the topic names: a heading it names outright (`namesHeading`, one heading only), else the section whose
 * heading shares the most of the topic's words (and then its text), when exactly one does. Null when none does, or when
 * two are as close — a guess at a real manual's section is the failure this must never produce.
 */
export function sectionForTopic(topic: string, chunks: readonly ManualChunk[]): ManualSection | null {
  if (chunks.length === 0) return null;
  const namedHeadings = [...new Set(manualSectionHeadings(chunks).filter((heading) => namesHeading(topic, heading)))];
  const named = namedHeadings.length === 1 ? findManualSection(chunks, namedHeadings) : null;
  if (named) return named;
  const wanted = contentWords(topic);
  if (wanted.length === 0) return null;
  const scored = [...new Set(manualSectionHeadings(chunks).map((heading) => heading.trim()))].flatMap((heading) => {
    const section = findManualSection(chunks, [heading]);
    if (!section) return [];
    const inHeading = new Set(contentWords(heading));
    const headingHits = wanted.filter((word) => alike(word, inHeading)).length;
    if (headingHits === 0) return [];
    const inText = new Set(contentWords(sectionText(chunks, section)));
    const textHits = wanted.filter((word) => alike(word, inText)).length;
    return [{ section, score: headingHits * 2 + textHits }];
  });
  const best = Math.max(0, ...scored.map((entry) => entry.score));
  const top = scored.filter((entry) => entry.score === best);
  const distinct = new Set(top.map((entry) => headingKey(entry.section.heading)));
  return best > 0 && distinct.size === 1 ? top[0]!.section : null;
}

const MAX_QUOTE = 1800;

/** The section as the field holds it: the manual's own text (its PDF line breaks rejoined), then its citation line. */
export function policyFieldText(section: ManualSection, chunks: readonly ManualChunk[]): string {
  const raw = sectionText(chunks, section);
  const lines = raw.split("\n");
  if (lines[0] && fold(lines[0]) === fold(section.heading)) lines.shift();
  let body = lines
    .join("\n")
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean)
    .join("\n\n");
  if (body.length > MAX_QUOTE) {
    const cut = body.slice(0, MAX_QUOTE);
    const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf(".\n"));
    body = `${end > 0 ? cut.slice(0, end + 1) : cut} …`;
  }
  return `${section.heading.trim()}: ${body}\nPolicy reference: ${formatManualCitation(section.heading, section.page)}`;
}

/** "our <heading> policy" in a reply: "Shift Replacement policy", never "Cell Phone/Smart Watch Policy policy". */
export function policyNamed(heading: string): string {
  const name = heading.trim();
  return /\bpolic(?:y|ies)$/i.test(name) ? name : `${name} policy`;
}

/** A sentence that only points at the manual ("refer to the policy manual …"), never the policy itself. */
export function pointsAtManual(value: string): boolean {
  return /\b(?:refer|referring|see|consult|check|review|look)\b[^.\n]{0,40}\b(?:policy\s+manual|manual|handbook|woven\s+polic)/i.test(value);
}
