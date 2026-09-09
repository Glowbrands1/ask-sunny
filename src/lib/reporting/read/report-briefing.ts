import "server-only";

import { AUTHORIZED_COMPANY } from "../store-identity";
import { loadBedSpaSections } from "./bed-spa/briefing-source";
import type { ChatReportContext } from "./chat-report-context";
import {
  orderReportFamilies,
  REPORT_FAMILIES_BY_ID,
  type ReportFamilyId,
} from "./report-families";
import { loadSalesTotalsSection } from "./sales-totals-briefing-source";
import { SALES_TOTALS_BRIEFING_RULES } from "./sales-totals-briefing";
import { loadSalonPerformanceSection } from "./salon-performance-briefing-source";
import { SALON_PERFORMANCE_BRIEFING_RULES } from "./salon-performance-briefing";

/**
 * ============================================================================
 * ONE REPORT BLOCK, FIVE FAMILIES
 * ============================================================================
 *
 * A manager's question does not respect report boundaries. "Why is revenue
 * down?" needs the daily signal, the trend and the traffic; "why is Spa weak?"
 * needs engagement, equipment and traffic. So this module loads whichever
 * families the question routed to and renders ONE block, in one reasoning
 * order, for one model call.
 *
 * There is deliberately no second model call, no second retrieval step and no
 * per-family "analytics assistant". The Sales Totals dashboard has its own
 * in-panel analyser and that stays where it is — it answers about one view the
 * reader is looking at. This is the cross-report path, and it is the same
 * pipeline every other Ask Sunny answer runs on.
 *
 * ============================================================================
 * THE NO-DATA RULE IS THE REASON THIS MODULE EXISTS AT ALL
 * ============================================================================
 *
 * The dangerous failure is not a missing section. It is a missing section that
 * looks like an answer.
 *
 * Ask "why is Spa weak?" with no Spa Wellness delivery ingested and the old
 * pipeline would brief bed usage and engagement, say nothing about the absence,
 * and let the model reason about equipment performance it could not see. So
 * every family the question ASKED FOR is accounted for here: present ones get
 * their figures, absent ones get a line naming the report that would carry them
 * and an instruction to say so. `NO_DATA_RULE` makes the instruction explicit
 * rather than hoping the absence speaks for itself.
 *
 * AND THE SAMPLE WORKBOOKS ARE NOT A FALLBACK. The repository's fixtures and
 * the sample deliveries used to validate the parsers are TEST DATA. Nothing in
 * this path can reach them: every figure comes from `loadSalesTotals`,
 * `loadReportContext` and the bed/spa read layer, all of which read Postgres.
 * There is no code path from a fixture file to a prompt, which is a stronger
 * guarantee than a rule telling the model not to use one — but the rule is
 * stated too, because the KNOWLEDGE BASE frameworks contain worked examples
 * with numbers in them, and those reach the prompt legitimately as retrieved
 * chunks. That is the substitution actually worth forbidding.
 */

/** The instruction that travels whenever a requested family had no delivery. */
export const NO_DATA_RULE = `WHEN A REPORT IS NOT LOADED

- One or more of the reports this question needs has NO CURRENT DELIVERY, and each is named below. Say so plainly and early — "I don't have a current Spa Wellness delivery for that period" — before answering from whatever else is loaded.
- Never fill the gap. Do not estimate the missing figures, do not infer them from another report, and do not use an example, sample or historical figure from any knowledge base document as though it were current.
- Answer the part you can answer, name the part you cannot, and say which report would carry it.`;

/**
 * The shared rules that apply to every report figure whatever the family.
 *
 * The per-family blocks state the rules that are specific to one source — the
 * FAST exemption, the two spa denominators, the two Sales Totals populations.
 * These are the ones true of all five, and they are the ones that decide
 * whether Sunny's answer is honest rather than whether it is arithmetically
 * right.
 */
export const REPORT_DATA_RULES = `HOW TO USE THE REPORT DATA

- These figures are DATA, not company policy. Do not attach a knowledge base source marker to them; markers belong to documents only. Never call a figure below a target, a goal or a standard — no target has been set anywhere in this data.
- CITE A FIGURE BY ITS REPORT AND ITS PERIOD. Every section states its own, and they differ; the reports arrive on their own schedules.
- NEVER COMBINE OR COMPARE FIGURES FROM TWO DIFFERENT PERIODS OR TWO DIFFERENT REPORTS unless a section below has already combined them for you. A daily figure and a month-to-date figure are not the same measurement.
- These reports describe what happened. They do not authorise equipment purchases, removals, discipline or any other consequence. Where somebody asks what to do, say what the reports show, reason about the likely behaviour behind it, and leave the decision with them.
- The reports are SALON-LEVEL. None of them carries employee-level figures, so never name or imply an individual employee's performance from them.`;

export interface ReportBriefing {
  /** The whole block, ready to hand to the model. */
  readonly text: string;
  /** Families the question asked for, in reasoning order. */
  readonly requested: readonly ReportFamilyId[];
  /** Families that had a current delivery. */
  readonly present: readonly ReportFamilyId[];
  /** Families asked for that had nothing ingested. */
  readonly missing: readonly ReportFamilyId[];
}

export interface LoadReportBriefingInput {
  /** The families this question needs. Empty means attach no block at all. */
  readonly families: readonly ReportFamilyId[];
  /**
   * What the manager was looking at when they asked, when they came from a
   * report tab. Pointers only — see `chat-report-context.ts`.
   */
  readonly context?: ChatReportContext | null;
  /**
   * The company whose figures may be read.
   *
   * DEFAULTED, NEVER PASSED FROM A REQUEST. `answerQuestion` calls this without
   * it, so no question, history entry or context field can widen which
   * company's figures are read. The parameter exists for tests and for the same
   * reason `loadBedSpaBriefing` has one: the read layer below takes it
   * explicitly and hiding that would be worse.
   */
  readonly company?: string;
}

const BED_SPA_FAMILIES: readonly ReportFamilyId[] = [
  "bed-usage",
  "spa-wellness",
  "spa-engagement",
];

/**
 * The report block for a question, or null when no report figures are wanted.
 *
 * NULL WHEN NO FAMILY WAS ASKED FOR — a policy question, a form request, a
 * greeting. Not null merely because nothing was ingested: a manager who asked
 * about Spa and has no Spa delivery needs to be told that, so a block naming
 * the absence is exactly what should reach the prompt.
 *
 * NEVER THROWS. Each loader swallows its own failures and returns null, so a
 * reporting outage costs the report block and not the answer.
 */
export async function loadReportBriefing(
  input: LoadReportBriefingInput,
): Promise<ReportBriefing | null> {
  const requested = orderReportFamilies(input.families);
  if (requested.length === 0) return null;

  const company = input.company ?? AUTHORIZED_COMPANY;
  const context = input.context ?? null;

  const wantsSalesTotals = requested.includes("sales-totals");
  const wantsSalonPerformance = requested.includes("salon-performance");
  const wantsBedSpa = requested.some((family) => BED_SPA_FAMILIES.includes(family));

  /*
   * THE THREE READS RUN TOGETHER. None depends on another and each is several
   * queries of its own, so serialising them would add every one's latency to
   * the others for no benefit.
   */
  const [salesTotals, salonPerformance, bedSpa] = await Promise.all([
    wantsSalesTotals ? loadSalesTotalsSection(context) : Promise.resolve(null),
    wantsSalonPerformance ? loadSalonPerformanceSection(context) : Promise.resolve(null),
    wantsBedSpa ? loadBedSpaSections(company) : Promise.resolve(null),
  ]);

  const present = new Set<ReportFamilyId>();
  if (salesTotals) present.add("sales-totals");
  if (salonPerformance) present.add("salon-performance");
  for (const family of bedSpa?.present ?? []) present.add(family);

  const missing = requested.filter((family) => !present.has(family));

  /*
   * SECTIONS IN REASONING ORDER. The bed/spa block is a single rendered unit
   * from `briefing.ts` — it carries its own header, its own rules and up to
   * four sections including the combined conversion view, which spans two
   * families and cannot be split between them. So it is placed at the position
   * of the first bed/spa family the question wanted.
   */
  const sections: string[] = [];
  const rules: string[] = [REPORT_DATA_RULES];
  let bedSpaPlaced = false;

  for (const family of requested) {
    if (family === "sales-totals" && salesTotals) {
      sections.push(salesTotals.text);
      rules.push(SALES_TOTALS_BRIEFING_RULES);
      continue;
    }
    if (family === "salon-performance" && salonPerformance) {
      sections.push(salonPerformance.text);
      rules.push(SALON_PERFORMANCE_BRIEFING_RULES);
      continue;
    }
    if (BED_SPA_FAMILIES.includes(family) && !bedSpaPlaced && bedSpa?.text) {
      // The block brings its own rules with it; they are reporting rules for
      // three families and they live beside their renderer.
      sections.push(bedSpa.text);
      bedSpaPlaced = true;
    }
  }

  if (missing.length > 0) rules.push(NO_DATA_RULE);

  const header = [
    `REPORT DATA — ${company}`,
    "",
    `Every figure below is for ${company} only. No other company's salon figures are available to you, and peer and chain comparisons are averages that name nobody.`,
    "",
    `Reports this question needs: ${requested
      .map((family) => REPORT_FAMILIES_BY_ID[family].label)
      .join(", ")}.`,
  ];

  if (missing.length > 0) {
    header.push("");
    header.push("NOT LOADED — there is no current delivery for these, so you have no figures for them:");
    for (const family of missing) {
      const entry = REPORT_FAMILIES_BY_ID[family];
      header.push(`  ${entry.label}: no current delivery. It would carry ${entry.carries}`);
    }
  }

  if (context) {
    const entry = REPORT_FAMILIES_BY_ID[context.family];
    header.push("");
    header.push(
      `The manager asked this from the ${entry.label} dashboard. Their filters were re-read from the database for this answer; nothing their screen displayed was sent here or treated as a fact.`,
    );
  }

  const text = [
    header.join("\n"),
    "",
    rules.join("\n\n"),
    ...(sections.length > 0 ? ["", sections.join("\n\n")] : []),
  ].join("\n");

  return {
    text,
    requested,
    present: requested.filter((family) => present.has(family)),
    missing,
  };
}
