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

/**
 * The heading of the employee figures context block.
 *
 * Duplicated deliberately rather than imported from
 * `reporting/read/employee-facts.ts`: that module is `server-only`, and this one
 * is pure string construction that the test suite loads directly. A test
 * asserts the two agree, so the duplication cannot drift silently.
 */
export const EMPLOYEE_DATA_SECTION = "CURRENT EMPLOYEE PERFORMANCE DATA";

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

/**
 * THE DAILY STATS REASONING CONTRACT.
 *
 * SPLIT IN TWO, AND THE SPLIT IS THE POINT.
 *
 * `DAILY_STATS_SOURCE_RULES` can only be said when the framework DOCUMENT was
 * pinned, because it talks about one of the numbered sources. A prompt claiming
 * "one of the sources above is the Daily Stats Interpretation Framework" when
 * none is pinned makes the model pick the nearest thing and follow rules for a
 * source that is not there.
 *
 * `DAILY_STATS_REASONING` needs no document to be true. Weigh impact rather
 * than lowness, name the behaviour, separate coaching from compliance,
 * recognition is half the job. So it travels on any interpretation question,
 * pinned or not — otherwise a corpus that simply has not had the document
 * uploaded yet would answer "what should I focus on today?" with a sorted list
 * of the lowest numbers, which is the exact failure the framework exists to
 * prevent.
 *
 * Exported as constants for the reason `EMPLOYEE_PERFORMANCE_RULES` is: two
 * things must agree about them, the prompt that carries them and the tests that
 * prove the guards are still in force. A paraphrase in a test would pass while
 * the real instruction drifted.
 *
 * WHY THESE ARE RULES AND NOT THE FRAMEWORK'S TEXT. The framework arrives as
 * pinned chunks with real markers, so Sunny can cite it and a manager can open
 * it. Copying its content here would duplicate it, break that citation, and
 * freeze a snapshot of a document somebody else owns. What belongs here is only
 * what the framework cannot say about ITSELF.
 *
 * `{{BRAND}}` is substituted by `buildSystemPrompt`.
 */
export const DAILY_STATS_SOURCE_RULES = `DAILY OPERATIONAL INTERPRETATION — HOW TO USE THE FRAMEWORK

One of the numbered sources above is the Daily Stats Interpretation Framework. Treat it differently from every other source.

- IT IS REASONING, NOT EVIDENCE ABOUT ANY SALON, DAY OR PERSON. It tells you how to turn a metric into a business meaning, a likely behaviour, a coaching focus, a role-play, a manager inspection, a follow-up and a recognition. It contains no facts about the current period.
- ITS EXAMPLES ARE NOT MEASUREMENTS. Every figure, salon name, employee name, district, date, ranking and worked example inside it is a teaching pattern. Never repeat one as a current fact, never treat one as this salon's number, and never let one stand in for a figure the report data does not carry.

THE ORDER OF AUTHORITY, HIGHEST FIRST

1. Current official {{BRAND}} policy, manuals, bonus policy, training and reporting guidance.
2. The current ingested report data.
3. The Daily Stats Interpretation Framework's reasoning.
4. Its historical examples and patterns — reusable shapes only, never current facts.

WHERE POLICY AND THE FRAMEWORK CONFLICT, POLICY WINS. Say so plainly, follow the policy, and cite it.`;

/**
 * The reasoning contract itself, true with or without the document.
 *
 * The paragraph that matters most is REASON ONLY FROM MEASURES THAT ARE
 * ACTUALLY PRESENT, and it is not theoretical: the framework describes
 * employee-level productivity, coupon detail, drawer reconciliation, breaks,
 * inventory variance and labour hours at length, and the five ingested reports
 * carry none of them. That gap is where a confident wrong answer comes from.
 *
 * ============================================================================
 * IT NAMES NO METRIC, NO BAND AND NO FORMULA, ON PURPOSE
 * ============================================================================
 *
 * This block applies to all five report families, and three of them — Bed
 * Usage, Spa Wellness, Spa Engagement — carry approved business rules that a
 * confident generic reasoner would break every one of: a shortfall that is a
 * deliberate capacity decision rather than a failure, a zero that means the
 * equipment was never installed, a comparison that is only valid like-for-like,
 * and an estate ratio that must be summed rather than averaged.
 *
 * The temptation is to restate those rules here so the model cannot get them
 * wrong. That is the wrong fix and it would make things worse: two statements
 * of one rule is two authorities, and the looser one wins the moment they
 * disagree — which they will, because a paraphrase drifts and a threshold
 * changes.
 *
 * So this block is written to be USEFUL WITHOUT KNOWING ANY OF THEM. It says
 * the sections' own classifications are final, that a withheld conclusion is
 * itself the finding, and that what the model adds is the action. Each report
 * family's rules travel with its own figures, stated once, where they are
 * computed. `read/bed-spa-authority.test.ts` asserts structurally that no band,
 * threshold, formula or metric name has crept in here.
 */
export const DAILY_STATS_REASONING = `HOW TO READ THE DAY

- CURRENT FACTS COME ONLY FROM THE REPORT DATA SECTION and from what the manager has told you in this conversation. Nowhere else. Never use an example, sample or historical figure from any document as though it were a current measurement.
- REASON ONLY FROM MEASURES THAT ARE ACTUALLY PRESENT. The reports do not carry employee-level productivity, coupon and discount detail, drawer reconciliation, break records, inventory variance or labour hours. If a measure is not in the report data, you do not have it. Say which report would carry it; never infer it, and never imply the salon has a problem you cannot see.
- THE REPORT SECTIONS' OWN CLASSIFICATIONS ARE FINAL. Where a section states a band, a classification, a rate, a comparison or an advisory note, that is the approved reading of that measure. Quote it as it stands. Do not re-derive it, re-band it, average it, soften it, or substitute your own judgement of what the number "really" means — your job on those figures is the ACTION, not the arithmetic.
- A SECTION THAT HAS ALREADY WITHHELD A CONCLUSION HAS DECIDED THAT. Where a figure is marked advisory, not comparable, not classified, not installed or not reported, treat that marking as the finding. Never turn one into a shortfall to coach, and never describe it as underperformance.
- WHAT YOU ADD TO A CLASSIFIED FIGURE is what it means operationally, what behaviour or process the manager should inspect, what to coach, what to role-play where that helps, what to follow up, and what is worth recognising. That applies to every report equally.
- A metric is a signal, not a finding. Move from signal to business meaning to the likely behaviour or operational cause, then to what to coach or inspect today.
- DO NOT SIMPLY NAME THE LOWEST NUMBER. Weigh revenue impact, opportunity volume, how far off the measure is, how controllable it is today, and whether one behaviour would improve several measures at once. A moderate gap on high traffic usually beats a bad number on almost no traffic.
- Name the behaviour. A number without an observable behaviour is not coachable, and "improve PPTA" is not a behaviour.
- Separate coaching from operational and compliance follow-up. Both can be real; they are not the same list, and an operational issue can need action today even when it is not the top sales opportunity.
- Never infer attitude, effort, character or laziness from a metric. You cannot see any of those in a number.
- Recognition is half the job. Say what looks strong and worth repeating, whenever the data supports one.`;

/**
 * THE DEFAULT SHAPE OF AN ANSWER TO A BROAD OPERATIONAL QUESTION.
 *
 * Attached only when report figures are present, because it is a shape for
 * reading data. Asked on a turn with no figures it would produce five headings
 * over nothing.
 *
 * WHY A FIXED SHAPE AT ALL, when the tone rules elsewhere say "no corporate
 * padding". Because the failure it replaces is worse than a heading: asked what
 * to focus on, a model holding five reports will list every metric it was
 * given. A manager cannot act on that. The five parts below are what the
 * framework's own output template asks for, and the last line is the one that
 * stops the metric dump.
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
  /**
   * Whether the Daily Stats Interpretation Framework DOCUMENT was pinned into
   * this turn's sources.
   *
   * A separate flag from `hasFrameworkGrounding`, because the two frameworks
   * need different rules and stating one's rules on a turn carrying the other
   * describes a source that is not there. The Employee Performance Framework's
   * rules are about never escalating on a number; these are about never
   * treating a worked example as a measurement.
   */
  hasDailyStatsFramework?: boolean;
  /**
   * Whether this was an interpretation question at all — irrespective of
   * whether the framework document could be pinned.
   *
   * The reasoning contract needs no document to be true, and a corpus that has
   * not had the framework uploaded must still not answer "what should I focus
   * on today?" with a sorted list of the lowest numbers. So the contract
   * travels on this flag and the SOURCE rules travel on the one above.
   */
  wantsDailyStatsReasoning?: boolean;
  /**
   * Whether one or more of the reports this question needed has NO current
   * delivery.
   *
   * The report block names them; this adds the instruction to lead with the
   * absence. Separate from `hasReportData` because the dangerous state is
   * PARTIAL: some families loaded, the one that was asked about did not, and an
   * answer built from the rest reads as complete.
   */
  hasMissingReports?: boolean;
}): string {
  const { assistantName, brandName, salonNoun, context, mode, hasContext } = input;
  const hasReportData = input.hasReportData ?? false;
  const hasFrameworkGrounding = input.hasFrameworkGrounding ?? false;
  const hasEmployeeFactsBlock = input.hasEmployeeFactsBlock ?? false;
  const hasDailyStatsFramework = input.hasDailyStatsFramework ?? false;
  const wantsDailyStatsReasoning = input.wantsDailyStatsReasoning ?? false;
  const hasMissingReports = input.hasMissingReports ?? false;

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
  /*
   * THE STATEMENT TAXONOMY, BUILT FROM WHAT IS ACTUALLY ATTACHED.
   *
   * It used to be hard-wired to "three" or "two" on `hasReportData` alone, so a
   * turn carrying employee figures described a world with no employee figures
   * in it and left the model to guess which citation rule applied to them. The
   * whole point of four separate context blocks is that each has a DIFFERENT
   * rule about what may be asserted and how it is attributed; a taxonomy that
   * omits one of them undoes that at the last step.
   *
   * So the kinds are numbered from the blocks present: 2, 3 or 4.
   */
  const statementKinds: string[] = [
    `Company knowledge — anything drawn from the provided sources. Mark every such statement with the marker of the source that supports it, like [S1] or [S2][S3]. Put the marker at the end of the sentence it supports.`,
    `General management guidance — your own judgement about how to handle a conversation, structure a plan, or approach a person. Never mark these with a source marker, and make it obvious they are general practice rather than ${brandName} policy. A phrase like "as a general approach" is enough.`,
  ];

  if (hasReportData) {
    statementKinds.push(
      `Salon report figures — anything drawn from the REPORT DATA section below. These are measurements from an ingested salon-level report, not policy. Never mark them with a source marker; name the reporting period the figure belongs to instead, and follow the rules stated in that section.`,
    );
  }

  if (hasEmployeeFactsBlock) {
    statementKinds.push(
      `Employee figures — anything drawn from the ${EMPLOYEE_DATA_SECTION} section below. These are CURRENT MEASUREMENTS ABOUT NAMED PEOPLE, not policy and not salon-level results. Never mark them with a source marker — markers belong to company documents. Attribute them to the report and reporting period that section names. Never infer, estimate or calculate an employee metric the section does not state.`,
    );
  }

  const NUMBER_WORD = ["", "one", "two", "three", "four", "five"] as const;
  const taxonomy = statementKinds
    .map((kind, index) => `${index + 1}. ${kind}`)
    .join("\n");

  const employeeSection = hasFrameworkGrounding
    ? `\n\n${EMPLOYEE_PERFORMANCE_RULES.replaceAll("{{BRAND}}", brandName)}\n\n${
        hasEmployeeFactsBlock ? EMPLOYEE_FACTS_ATTACHED_RULES : NO_INGESTED_DATASET_RULES
      }`
    : "";

  /*
   * The Daily Stats sections. Three independent decisions, not one:
   *
   *   the SOURCE rules      only when the document was pinned
   *   the REASONING         whenever this was an interpretation question
   *   the ANSWER SHAPE      only when there are figures to read
   *
   * A corpus missing the framework therefore still gets the contract, and a
   * turn with no figures still gets no five-heading skeleton.
   */
  const dailyStatsSection = [
    hasDailyStatsFramework
      ? DAILY_STATS_SOURCE_RULES.replaceAll("{{BRAND}}", brandName)
      : null,
    wantsDailyStatsReasoning ? DAILY_STATS_REASONING : null,
    wantsDailyStatsReasoning && hasReportData ? MANAGER_ANSWER_SHAPE : null,
  ]
    .filter((section): section is string => section !== null)
    .map((section) => `\n\n${section}`)
    .join("");

  const missingReportsSection = hasMissingReports
    ? "\n\nONE OR MORE REPORTS THIS QUESTION NEEDS IS NOT LOADED. The REPORT DATA section names them. Say so plainly and early — for example \"I don't have a current Spa Wellness delivery for that period\" — then answer the part you can from what IS loaded. Never estimate the missing figures, never infer them from another report, and never use an example or historical figure from a knowledge base document in their place."
    : "";

  return `You are ${assistantName}, the internal assistant for ${brandName} managers. You are talking to ${context.userName}, who runs ${context.locationName}. Today is ${context.todayIso}.

Your job is to help a manager run their ${salonNoun}: company policy, operations, coaching conversations, training, and performance.

HOW YOU ANSWER

You answer from the sections below, and you distinguish clearly between ${NUMBER_WORD[statementKinds.length]} kinds of statement:

${taxonomy}

RULES YOU DO NOT BREAK

- Never state a ${brandName} policy, number, deadline, threshold or entitlement that is not in the provided sources. If a manager needs a specific figure and it is not there, say so.
- Never use a marker for a source that is not listed below. Only the markers listed are valid.
- Never invent a document title, a page number, a section name or a policy name. You do not have access to any document that is not in the COMPANY KNOWLEDGE section — do not imply otherwise.
- Never claim you have read, checked, searched or reviewed anything beyond the provided sources.
${hasReportData ? "- Never state a figure about tanning, spa usage or conversion that is not written in the REPORT DATA section, and never compute a new one from it. If a manager needs a figure the reports do not carry, say which report would carry it." : "- You have NO report figures for this question. Do not state a tans count, a spa session count, a conversion rate, a per-bed figure or a peer comparison from memory. If a manager asks for one, say the reports available to you do not cover it."}
${hasEmployeeFactsBlock ? `- Never state a figure about a named person that is not written in the ${EMPLOYEE_DATA_SECTION} section, and never derive one from it — no rate the section does not state, no total it does not give, no comparison it does not make. A salon-level figure is not an employee's, and dividing one by a headcount is an invention with a number attached.` : ""}
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
