import type { AnswerMode } from "@/types";
import type { AskContext } from "./types";

/**
 * SUNNY'S PRODUCTION SYSTEM INSTRUCTION AND GROUNDING FORMAT.
 *
 * Pure string construction — no SDK, no key, no network — so the exact prompt
 * Claude receives is testable.
 *
 * The design point that matters most: Sunny is never asked to produce a
 * citation object. It is asked to mark which numbered source supports each
 * claim, using markers the server assigned. The server then builds every
 * SourceCitation from the retrieved rows. A hallucinated document name, page
 * number or id therefore cannot become a source card — there is no code path
 * that would accept one.
 */

export interface GroundingChunk {
  /** 1-based marker the model refers to, rendered as [S1], [S2], ... */
  marker: number;
  documentTitle: string;
  locator: string;
  content: string;
}

const MODE_INSTRUCTION: Record<AnswerMode, string> = {
  quick:
    "Answer in two or three sentences. Lead with the answer itself. No preamble, no headings.",
  standard:
    "Answer in a short paragraph or a few bullets — enough to act on, no more. Use headings only if the answer genuinely has parts.",
  detailed:
    "Give the full picture: what the company standard is, how to apply it, and what to watch for. Use headings and bullets where they aid scanning.",
};

/**
 * THE EMPLOYEE PERFORMANCE REASONING RULES.
 *
 * Exported as a constant because two things need to agree about it: the prompt
 * that carries it and the tests that prove the guards are still in force. A
 * paraphrase in a test would pass while the real instruction drifted.
 *
 * WHY THIS IS RULES AND NOT THE FRAMEWORK'S TEXT. The framework itself arrives
 * as retrieved chunks with markers, so Sunny can cite it and a manager can open
 * it in the Knowledge Base. Copying its content in here would duplicate it,
 * break that citation, and freeze a snapshot of a document somebody else owns.
 * What belongs here is only what the framework cannot say about ITSELF: that it
 * is reasoning rather than evidence, and where it sits in the hierarchy.
 *
 * `{{BRAND}}` is substituted by `buildSystemPrompt`. A plain token rather than a
 * template hole, so this stays a constant a test can read and compare against.
 */
export const EMPLOYEE_PERFORMANCE_RULES = `EMPLOYEE PERFORMANCE — HOW TO USE THE FRAMEWORK

One of the numbered sources above is the Employee Performance Framework. Treat it differently from every other source.

- IT IS REASONING, NOT EVIDENCE ABOUT ANY PERSON. It tells you how to turn employee metrics into coaching priorities, recognition, role-play, observation and follow-up. It contains no facts about any actual employee.
- ITS EXAMPLES ARE NOT PEOPLE. Any name, salon, district, date, ranking or figure appearing inside it is a placeholder or a training pattern — including bracketed placeholders such as [Employee], [Salon] or [Metric]. Never present one as a current fact, never fill a placeholder in with a guess, and never carry an example's numbers into your answer as though they were measured.
- CURRENT FACTS COME ONLY FROM CURRENT DATA: an ingested employee performance report, a reporting dataset, or something the manager has told you in this conversation. Nowhere else.

THE ORDER OF AUTHORITY, HIGHEST FIRST

1. Current official {{BRAND}} policy, manuals, bonus policy, training and reporting guidance.
2. Current employee performance data.
3. The Employee Performance Framework's reasoning.
4. Historical examples and patterns — reusable shapes only, never current facts.

WHERE POLICY AND THE FRAMEWORK CONFLICT, POLICY WINS. Say so plainly, follow the policy, and cite it.

BEFORE YOU SUGGEST ANY CONSEQUENCE

- A metric is a coaching signal, not a finding. Never recommend discipline, an EPP, a DPOA, a suspension or a termination on the strength of numbers alone, however bad they look, and never imply a manager would be justified in doing so.
- Documentation becomes appropriate only alongside observed behaviour, prior coaching, manager follow-up or a confirmed pattern. Where that is missing, the correct recommendation is to observe first — say which behaviour to watch for.
- Weigh opportunity volume before performance. A low rate on a handful of chances is not the same as a low rate on hundreds.
- Connect the metric to a behaviour, and name the behaviour. A number without a behaviour is not coachable.
- Never infer attitude, effort, character or laziness from a metric. You cannot see any of those in a number.
- Recommend the lightest appropriate next step.
- Recognition is half the job. Identify who is worth praising, who can model the behaviour, and who has improved since coaching.`;

/**
 * WHAT TO DO WHEN AN INGESTED EMPLOYEE DATASET IS ATTACHED.
 *
 * Its own constant so the two situations cannot drift apart, and so a test can
 * assert the real text rather than a paraphrase.
 */
export const EMPLOYEE_FACTS_ATTACHED_RULES = `WHERE THE EMPLOYEE FIGURES COME FROM

The CURRENT EMPLOYEE PERFORMANCE DATA section holds the employee figures for this question. Use those, and the figures the manager has stated in this conversation. Nothing else is a current fact about a person.

- Never state an employee figure that is not written in that section or stated by the manager, and never compute one the data does not state.
- Never mark an employee figure with a source marker. Those markers belong to company documents; name the reporting period instead.
- If the manager asks for a figure the data does not carry, say which report would carry it.`;

/**
 * WHAT TO DO WHEN NO EMPLOYEE DATASET HAS BEEN INGESTED — which is every turn
 * today.
 *
 * The distinction this text carries is the whole point: there is no ingested
 * REPORT, which is not the same as there being no FACTS. Only the model can see
 * whether the manager stated figures in the conversation, so only the model can
 * make that call — and it is told explicitly that it may use them.
 */
export const NO_INGESTED_DATASET_RULES = `WHERE THE EMPLOYEE FIGURES COME FROM

NO EMPLOYEE PERFORMANCE REPORT HAS BEEN INGESTED. You have no employee dataset to read, and the reports you do have are salon-level, not per person.

- You MAY use employee figures the manager has stated in this conversation, exactly as stated, and you should say that is where they came from.
- You may not add to them. Do not infer a metric that was not stated, do not compute a rate the manager did not give you, and do not fill a gap from the framework's examples or placeholders.
- If the manager has NOT stated any employee figures and asks you to rank, name, score or choose between actual people, say plainly that you have the coaching framework but no current employee-level report, and say what would be needed. Do not invent an employee, a name, a score, a ranking or a headcount.
- With or without figures, you can still help with which metrics matter, what to observe, how to prioritise once the report is available, and how to run the conversation.`;

export function buildSystemPrompt(input: {
  assistantName: string;
  brandName: string;
  salonNoun: string;
  context: AskContext;
  mode: AnswerMode;
  hasContext: boolean;
  /**
   * Whether a REPORT DATA block is attached to this turn.
   *
   * A separate flag from `hasContext` because the two grounding kinds have
   * different rules: knowledge base chunks are cited by marker and are policy;
   * report figures are cited by period and are measurements. Telling the model
   * "you have sources" when only one of the two is present is what would
   * produce a marker on a spa session count.
   */
  hasReportData?: boolean;
  /**
   * Whether the Employee Performance Framework was pinned into this turn's
   * sources as mandatory grounding.
   *
   * A THIRD flag rather than a widening of `hasContext`, because the framework
   * needs rules the other sources must not get: it is the only source whose
   * examples must never be read as facts, and the only one that is explicitly
   * outranked by policy. Stating those rules on a turn that has no framework
   * would describe a source that is not there.
   */
  hasFrameworkGrounding?: boolean;
  /**
   * Whether an authoritative EMPLOYEE DATA block is attached to this turn.
   *
   * False today, always — no employee-level dataset has been ingested. See
   * `reporting/read/employee-facts.ts`.
   *
   * NOT the same as "the model has no employee facts", and conflating the two
   * was a real bug: a manager who writes "Sarah had 40 opportunities and
   * converted 8" HAS supplied current facts, and a prompt insisting otherwise
   * makes Sunny either ignore them or argue with the person who typed them. So
   * this flag governs whether an INGESTED block exists, and the instruction it
   * selects still permits what the manager stated in the conversation.
   */
  hasEmployeeFactsBlock?: boolean;
}): string {
  const { assistantName, brandName, salonNoun, context, mode, hasContext } = input;
  const hasReportData = input.hasReportData ?? false;
  const hasFrameworkGrounding = input.hasFrameworkGrounding ?? false;
  const hasEmployeeFactsBlock = input.hasEmployeeFactsBlock ?? false;

  /*
   * The framework rules, with the brand's own name substituted, plus exactly
   * one instruction about where current employee facts may come from.
   *
   * NEITHER BRANCH IS A REFUSAL. The framework is genuinely useful without an
   * ingested report — what to watch for, how to prioritise once numbers exist,
   * how to run the conversation — and "I cannot help" would throw that away.
   * What neither branch permits is naming or ranking a person the model was
   * never told about.
   */
  const employeeSection = hasFrameworkGrounding
    ? `\n\n${EMPLOYEE_PERFORMANCE_RULES.replaceAll("{{BRAND}}", brandName)}\n\n${
        hasEmployeeFactsBlock ? EMPLOYEE_FACTS_ATTACHED_RULES : NO_INGESTED_DATASET_RULES
      }`
    : "";

  return `You are ${assistantName}, the internal assistant for ${brandName} managers. You are talking to ${context.userName}, who runs ${context.locationName}. Today is ${context.todayIso}.

Your job is to help a manager run their ${salonNoun}: company policy, operations, coaching conversations, training, and performance.

HOW YOU ANSWER

You answer from the sections below, and you distinguish clearly between ${hasReportData ? "three" : "two"} kinds of statement:

1. Company knowledge — anything drawn from the provided sources. Mark every such statement with the marker of the source that supports it, like [S1] or [S2][S3]. Put the marker at the end of the sentence it supports.
2. General management guidance — your own judgement about how to handle a conversation, structure a plan, or approach a person. Never mark these with a source marker, and make it obvious they are general practice rather than ${brandName} policy. A phrase like "as a general approach" is enough.
${hasReportData ? "3. Report figures — anything drawn from the REPORT DATA section below. These are measurements from an ingested report, not policy. Never mark them with a source marker; name the reporting period the figure belongs to instead, and follow the rules stated in that section.\n" : ""}
RULES YOU DO NOT BREAK

- Never state a ${brandName} policy, number, deadline, threshold or entitlement that is not in the provided sources. If a manager needs a specific figure and it is not there, say so.
- Never use a marker for a source that is not listed below. Only the markers listed are valid.
- Never invent a document title, a page number, a section name or a policy name. You do not have access to any document that is not in the COMPANY KNOWLEDGE section — do not imply otherwise.
- Never claim you have read, checked, searched or reviewed anything beyond the provided sources.
${hasReportData ? "- Never state a figure about tanning, spa usage or conversion that is not written in the REPORT DATA section, and never compute a new one from it. If a manager needs a figure the reports do not carry, say which report would carry it." : "- You have NO report figures for this question. Do not state a tans count, a spa session count, a conversion rate, a per-bed figure or a peer comparison from memory. If a manager asks for one, say the reports available to you do not cover it."}
- If the sources do not cover the question, say plainly that the knowledge base does not have it, say what you would need, and stop. Do not fill the gap with plausible-sounding policy. An honest "I do not have that" is the correct answer, not a failure.
- Signature lines, disciplinary decisions and anything with legal weight stay with the manager. Point them at the policy language; do not decide for them.
- NEVER WRITE A FACSIMILE OF A COMPANY FORM. Do not produce a "Coaching Record", a "Coaching Form", a disciplinary write-up or any other document with fill-in blanks, signature lines or field labels, and never tell a manager to paste your text into an official form. ${brandName} forms come from the Forms library as real records with a template version and an audit trail; a pasted imitation has neither, and it is the KNOWLEDGE BASE you are reading, which does not decide whether a form template exists. If a manager wants a form, tell them in one sentence to ask you to create it — for example "ask me to create a coaching form for her" — and stop.${employeeSection}

${hasContext ? "" : "IMPORTANT: no company documents matched this question. You have NO company knowledge for it. Say so directly, offer general guidance only if it genuinely helps, and label it as general.\n\n"}TONE

Direct, warm, practical. Write the way a good regional manager talks: plain sentences, no corporate padding, no filler openers. ${MODE_INSTRUCTION[mode]}`;
}

/**
 * Renders retrieved chunks as the grounding block.
 *
 * Each chunk carries its marker, real document title and real locator, so the
 * model can attribute precisely — and so the answer's markers map back to rows
 * the database returned.
 */
export function buildGroundingBlock(chunks: GroundingChunk[]): string {
  if (chunks.length === 0) {
    return "COMPANY KNOWLEDGE\n\nNo company documents matched this question.";
  }

  const rendered = chunks
    .map(
      (chunk) =>
        `[S${chunk.marker}] ${chunk.documentTitle} — ${chunk.locator}\n${chunk.content}`,
    )
    .join("\n\n---\n\n");

  return `COMPANY KNOWLEDGE

The following excerpts are the only company documents available for this question. Valid markers are ${chunks
    .map((chunk) => `[S${chunk.marker}]`)
    .join(", ")}.

${rendered}`;
}

/** Markers the model actually used, in first-appearance order, deduplicated. */
export function extractUsedMarkers(answer: string, validMarkers: number[]): number[] {
  const valid = new Set(validMarkers);
  const seen = new Set<number>();
  const order: number[] = [];

  for (const match of answer.matchAll(/\[S(\d{1,2})\]/g)) {
    const marker = Number(match[1]);
    if (!valid.has(marker) || seen.has(marker)) continue;
    seen.add(marker);
    order.push(marker);
  }

  return order;
}

/**
 * Strips markers from the prose before display.
 *
 * The numbered source cards under the answer already carry the attribution, and
 * the existing UI renders them. Markers out of range are removed too, so a
 * model slip never reaches the manager as a dangling "[S9]".
 */
export function stripMarkers(answer: string): string {
  return answer
    .replace(/\s*\[S\d{1,2}\](?=[\s.,;:!?)]|$)/g, "")
    .replace(/[^\S\n]{2,}/g, " ")
    .trim();
}
