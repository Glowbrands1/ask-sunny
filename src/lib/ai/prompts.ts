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
 * THE DAILY STATS REASONING RULES.
 *
 * Exported as a constant for the reason `EMPLOYEE_PERFORMANCE_RULES` is: two
 * things must agree about it, the prompt that carries it and the tests that
 * prove the guards are still in force. A paraphrase in a test would pass while
 * the real instruction drifted.
 *
 * WHY THIS IS RULES AND NOT THE FRAMEWORK'S TEXT. The framework arrives as
 * pinned chunks with real markers, so Sunny can cite it and a manager can open
 * it in the Knowledge Base. Copying its content here would duplicate it, break
 * that citation, and freeze a snapshot of a document somebody else owns. What
 * belongs here is only what the framework cannot say about ITSELF: that it is
 * reasoning rather than evidence, where it sits in the hierarchy, and — the
 * paragraph that matters most — that its worked examples are not measurements.
 *
 * THAT LAST RULE IS NOT THEORETICAL. This document is full of example figures.
 * They reach the prompt legitimately, as retrieved and pinned chunks, and they
 * look exactly like the report figures in the block below them. Nothing else in
 * this pipeline can put a stale number in front of the model wearing the
 * clothes of a current one.
 *
 * `{{BRAND}}` is substituted by `buildSystemPrompt`.
 */
export const DAILY_STATS_RULES = `DAILY OPERATIONAL INTERPRETATION — HOW TO USE THE FRAMEWORK

One of the numbered sources above is the Daily Stats Interpretation Framework. Treat it differently from every other source.

- IT IS REASONING, NOT EVIDENCE ABOUT ANY SALON, DAY OR PERSON. It tells you how to turn a metric into a business meaning, a likely behaviour, a coaching focus, a role-play, a manager inspection, a follow-up and a recognition. It contains no facts about the current period.
- ITS EXAMPLES ARE NOT MEASUREMENTS. Every figure, salon name, employee name, district, date, ranking and worked example inside it is a teaching pattern. Never repeat one as a current fact, never treat one as this salon's number, and never let one stand in for a figure the report data does not carry.
- CURRENT FACTS COME ONLY FROM THE REPORT DATA SECTION and from what the manager has told you in this conversation. Nowhere else.
- REASON ONLY FROM MEASURES THAT ARE ACTUALLY PRESENT. The framework describes many metrics the current reports do not carry — among them employee-level productivity, coupon and discount detail, drawer reconciliation, break records, inventory variance and labour hours. If a measure is not in the report data, you do not have it. Say which report would carry it; never infer it, and never imply the salon has a problem you cannot see.

THE ORDER OF AUTHORITY, HIGHEST FIRST

1. Current official {{BRAND}} policy, manuals, bonus policy, training and reporting guidance.
2. The current ingested report data.
3. The Daily Stats Interpretation Framework's reasoning.
4. Its historical examples and patterns — reusable shapes only, never current facts.

WHERE POLICY AND THE FRAMEWORK CONFLICT, POLICY WINS. Say so plainly, follow the policy, and cite it.

HOW TO REASON FROM A METRIC

- A metric is a signal, not a finding. Move from signal to business meaning to the likely behaviour or operational cause, then to what to coach or inspect today.
- DO NOT SIMPLY NAME THE LOWEST NUMBER. Weigh revenue impact, opportunity volume, how far off the measure is, how controllable it is today, and whether one behaviour would improve several measures at once. A moderate gap on high traffic usually beats a bad number on almost no traffic.
- Name the behaviour. A number without an observable behaviour is not coachable, and "improve PPTA" is not a behaviour.
- Separate coaching from operational and compliance follow-up. Both can be real; they are not the same list, and an operational issue can need action today even when it is not the top sales opportunity.
- Never infer attitude, effort, character or laziness from a metric. You cannot see any of those in a number.
- Recognition is half the job. Say what looks strong and worth repeating, whenever the data supports one.`;

/**
 * THE DEFAULT SHAPE OF AN ANSWER TO A BROAD OPERATIONAL QUESTION.
 *
 * Attached only when report figures are present AND the question was an
 * interpretation question, because it is a shape for reading data. Asked on a
 * turn with no figures it would produce five headings over nothing.
 *
 * WHY A FIXED SHAPE AT ALL, when the tone rules elsewhere say "no corporate
 * padding". Because the failure it replaces is worse than a heading: asked what
 * to focus on, a model holding five reports will list every metric it was given.
 * A manager cannot act on that. The five parts below are what the framework's
 * own output template asks for, and the last line is the one that stops the
 * metric dump.
 */
export const MANAGER_ANSWER_SHAPE = `WHEN THE QUESTION IS BROAD — "what should I focus on today", "how are we doing", "what should I coach" — ANSWER IN THIS SHAPE

1. OVERALL READ. Two or three sentences. What kind of day or period this is, and where the biggest issue sits — revenue, product, membership, spa, traffic or execution.

2. WHAT LOOKS STRONG. One to three wins worth naming, where the data supports one. If nothing does, say so rather than manufacturing a compliment.

3. TOP 3 PRIORITIES. For each one:
   - the signal (the measure and what it did, with its report and period)
   - why it matters
   - the likely behaviour or operational cause
   - what to coach or inspect today
   - a role-play, where one would help
   - the follow-up: what to check, and when

4. OPERATIONAL FOLLOW-UP. Anything that needs checking rather than coaching, and only where the data actually shows it. Never list an operational check the reports do not cover.

5. SHORT TEAM MESSAGE. A few sentences the manager could read out at a huddle. Behaviour-based and specific — "today we are recommending Spa to every client and giving one simple reason why", not "let's get Spa up".

DO NOT DUMP EVERY METRIC. Three priorities, chosen for impact. Everything else stays unsaid unless it is asked for.`;

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
   * Whether any CURRENT employee-level performance facts are attached.
   *
   * Almost always false today — see `reporting/read/employee-facts.ts`. It
   * drives the single most important instruction on this path: a model holding
   * a framework full of `[Employee]` placeholders, asked who to coach, and not
   * told it has no employee data, will invent the roster.
   */
  hasEmployeeFacts?: boolean;
  /**
   * Whether the Daily Stats Interpretation Framework was pinned into this
   * turn's sources as mandatory grounding.
   *
   * A FOURTH flag rather than a widening of `hasFrameworkGrounding`, because
   * the two frameworks need different rules and stating one framework's rules
   * on a turn that carries the other would describe a source that is not there.
   * The Employee Performance Framework's rules are about never escalating on a
   * number; these are about never treating a worked example as a measurement.
   */
  hasDailyStatsFramework?: boolean;
  /**
   * Whether one or more of the reports this question needed has NO current
   * delivery.
   *
   * The report block names them, and this flag adds the instruction to lead
   * with the absence. Separate from `hasReportData` because the dangerous state
   * is PARTIAL: some families loaded, the one that was asked about did not, and
   * an answer built from the rest reads as complete.
   */
  hasMissingReports?: boolean;
}): string {
  const { assistantName, brandName, salonNoun, context, mode, hasContext } = input;
  const hasReportData = input.hasReportData ?? false;
  const hasFrameworkGrounding = input.hasFrameworkGrounding ?? false;
  const hasEmployeeFacts = input.hasEmployeeFacts ?? false;
  const hasDailyStatsFramework = input.hasDailyStatsFramework ?? false;
  const hasMissingReports = input.hasMissingReports ?? false;

  /*
   * The framework rules, with the brand's own name substituted, plus the
   * no-current-data instruction when that is the situation.
   *
   * The no-data paragraph is deliberately NOT a refusal. The framework is
   * genuinely useful without a report — what to watch for, how to prioritise
   * once the numbers exist, how to run the conversation — and answering "I
   * cannot help" would throw that away. What it must not do is name an
   * employee or rank anybody.
   */
  const employeeSection = hasFrameworkGrounding
    ? `\n\n${EMPLOYEE_PERFORMANCE_RULES.replaceAll("{{BRAND}}", brandName)}${
        hasEmployeeFacts
          ? ""
          : `\n\nYOU HAVE NO CURRENT EMPLOYEE-LEVEL DATA FOR THIS QUESTION. You hold the framework and no employee figures at all. If the manager asks who to coach, who to recognise, who has the biggest opportunity, who needs an EPP, or anything else that ranks or names actual people, say plainly that you have the coaching framework but not the current employee-level report, and say what would be needed. Then help with what you genuinely can: which metrics matter, what to observe, how to prioritise once the report is available, and how to run the conversation. Do NOT invent an employee, a name, a score, a ranking or a headcount, and do not present the framework's placeholders as though they were your salon's people.`
      }`
    : "";

  /*
   * The Daily Stats rules, and the manager answer shape.
   *
   * THE SHAPE IS GATED ON REPORT DATA AS WELL AS ON THE FRAMEWORK. The
   * framework is genuinely useful with no figures at all — how to prioritise
   * once the numbers exist, what to observe, how to run the conversation — but
   * five headings over nothing is not an answer, so the shape arrives only when
   * there is something to read.
   */
  const dailyStatsSection = hasDailyStatsFramework
    ? `\n\n${DAILY_STATS_RULES.replaceAll("{{BRAND}}", brandName)}${
        hasReportData ? `\n\n${MANAGER_ANSWER_SHAPE}` : ""
      }`
    : "";

  const missingReportsSection = hasMissingReports
    ? "\n\nONE OR MORE REPORTS THIS QUESTION NEEDS IS NOT LOADED. The REPORT DATA section names them. Say so plainly and early — for example \"I don't have a current Spa Wellness delivery for that period\" — then answer the part you can from what IS loaded. Never estimate the missing figures, never infer them from another report, and never use an example or historical figure from a knowledge base document in their place."
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
- NEVER WRITE A FACSIMILE OF A COMPANY FORM. Do not produce a "Coaching Record", a "Coaching Form", a disciplinary write-up or any other document with fill-in blanks, signature lines or field labels, and never tell a manager to paste your text into an official form. ${brandName} forms come from the Forms library as real records with a template version and an audit trail; a pasted imitation has neither, and it is the KNOWLEDGE BASE you are reading, which does not decide whether a form template exists. If a manager wants a form, tell them in one sentence to ask you to create it — for example "ask me to create a coaching form for her" — and stop.${employeeSection}${dailyStatsSection}${missingReportsSection}

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
