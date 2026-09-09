import "server-only";

import { AUTHORIZED_COMPANY } from "../store-identity";
import { loadBedSpaSections } from "./bed-spa/briefing-source";
import type { ChatReportContext } from "./chat-report-context";
import {
  orderReportFamilies,
  REPORT_FAMILIES_BY_ID,
  REPORT_PERIOD_TYPE_LABEL,
  type ReportFamilyId,
} from "./report-families";
import {
  loadReportCatalog,
  type CatalogPeriod,
  type ReportCatalog,
} from "./report-catalog";
import {
  detectPeriodIntent,
  resolvePeriod,
  type PeriodIntent,
  type PeriodResolution,
} from "./period-language";
import {
  buildFreshnessBlock,
  familyFreshness,
  type FamilyFreshness,
} from "./report-freshness";
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
  /**
   * The period window the question asked for, when it named one.
   *
   * Reported so a caller can see that "last month" was understood, and so a
   * test can prove it without reading the rendered text.
   */
  readonly periodIntent: PeriodIntent | null;
  /** Per family: which period was read, or why the one asked for could not be. */
  readonly periods: Readonly<Partial<Record<ReportFamilyId, PeriodResolution<CatalogPeriod>>>>;
  /** Per family: how current its newest figures are. */
  readonly freshness: readonly FamilyFreshness[];
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
  /**
   * The manager's question, for the period language in it.
   *
   * THE QUESTION, NOT A PARSED PERIOD. "Last month" has to be resolved against
   * the periods this deployment actually holds, and only this layer can see
   * both. A caller that resolved it first would need the catalog, at which
   * point it is doing this function's job with none of its data.
   *
   * Optional, because a caller with no question — an operator health check —
   * still wants the latest of everything.
   */
  readonly question?: string;
  /**
   * The day the question is being asked about, ISO `yyyy-mm-dd`.
   *
   * REQUIRED FOR FRESHNESS TO MEAN ANYTHING, and passed in rather than read
   * here: `utils/date.ts` holds `DEMO_ANCHOR`, a frozen prototype date, and a
   * freshness check that reached for a module constant would report every
   * report as current forever. `answerQuestion` passes the server clock's day.
   *
   * Omitted means no freshness block — an operator listing the catalog is not
   * asking "is this current enough to act on today".
   */
  readonly today?: string;
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
   * ==========================================================================
   * WHICH PERIOD, RESOLVED BEFORE ANYTHING IS LOADED
   * ==========================================================================
   *
   * The catalog is period metadata only — ids, dates, labels, timestamps — so
   * reading it first costs one cheap round trip per family and buys two things
   * the loaders cannot do for themselves: "last month" against the periods that
   * exist, and a freshness comparison against the day being asked about.
   *
   * PRECEDENCE, AND IT IS THE ONE JUDGEMENT IN THIS FUNCTION:
   *
   *   1. THE QUESTION'S OWN WORDS. A manager who arrives from the Bed Usage tab
   *      showing August and then types "what about last month?" is asking to
   *      MOVE. Letting the tab's period win there would answer August twice and
   *      look like the question was ignored.
   *   2. THE REPORT CONTEXT the tab handed over, for a question that names no
   *      window — which every seeded opening question does.
   *   3. THE LATEST PERIOD, reported as a fallback so the briefing says which
   *      one it read.
   */
  const periodIntent = input.question ? detectPeriodIntent(input.question) : null;
  const catalog: ReportCatalog = await loadReportCatalog({
    families: requested,
    company,
  });

  const periods: Partial<Record<ReportFamilyId, PeriodResolution<CatalogPeriod>>> = {};
  for (const family of requested) {
    const status = catalog.byFamily[family];
    periods[family] = resolvePeriod({
      family: status.family,
      periods: status.periods,
      intent: periodIntent,
    });
  }

  /**
   * The period a family should be loaded for, or null to let it read its own
   * default. Null on a refusal too: a family that cannot answer the window
   * asked for gets no figures rather than the wrong window's.
   */
  const chosen = (family: ReportFamilyId) => {
    const resolution = periods[family];
    if (!resolution?.ok) return null;
    // A question that named no window leaves the tab's pointer in charge.
    if (resolution.fellBackToLatest) return null;
    return resolution.period;
  };

  /**
   * Whether a family should be SKIPPED because the window asked for is one it
   * cannot answer.
   *
   * NOT EVERY REFUSAL SKIPS, and the distinction matters. `type_not_delivered`,
   * `period_not_ingested` and `no_previous_period` are all "that window does
   * not exist here", and loading the newest period instead would put figures
   * under a heading nobody asked for.
   *
   * `no_periods` is different: it means the CATALOG saw nothing, which is also
   * what a failed period listing looks like — `loadReportCatalog` swallows its
   * own errors by design. Skipping on it would let a metadata read failure
   * suppress figures that would have loaded perfectly, so the loader is left to
   * judge for itself and to return null if there is genuinely nothing.
   */
  const refused = (family: ReportFamilyId) => {
    const resolution = periods[family];
    if (!resolution || resolution.ok) return null;
    return resolution.failure.reason === "no_periods" ? null : resolution;
  };

  /*
   * THE THREE READS RUN TOGETHER. None depends on another and each is several
   * queries of its own, so serialising them would add every one's latency to
   * the others for no benefit.
   *
   * A FAMILY WHOSE WINDOW WAS REFUSED IS NOT READ AT ALL. Loading its latest
   * period instead would put figures under a heading the manager did not ask
   * for, which is the failure `resolvePeriod` returns reasons to prevent.
   */
  const salesTotalsPeriod = chosen("sales-totals");
  const salonPerformancePeriod = chosen("salon-performance");

  const [salesTotals, salonPerformance, bedSpa] = await Promise.all([
    wantsSalesTotals && !refused("sales-totals")
      ? loadSalesTotalsSection(context, salesTotalsPeriod)
      : Promise.resolve(null),
    wantsSalonPerformance && !refused("salon-performance")
      ? loadSalonPerformanceSection(context, salonPerformancePeriod)
      : Promise.resolve(null),
    wantsBedSpa
      ? loadBedSpaSections(company, {
          "bed-usage": refused("bed-usage") ? "skip" : chosen("bed-usage")?.id ?? null,
          "spa-wellness": refused("spa-wellness") ? "skip" : chosen("spa-wellness")?.id ?? null,
          "spa-engagement": refused("spa-engagement")
            ? "skip"
            : chosen("spa-engagement")?.id ?? null,
        })
      : Promise.resolve(null),
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

  /*
   * FRESHNESS, per family, against the day being asked about.
   *
   * Built from the catalog rather than from the sections, because a family
   * whose window was refused still has a newest delivery worth naming — "I
   * don't hold July, the newest Bed Usage is August" is a better answer than
   * silence.
   */
  const freshness: FamilyFreshness[] = input.today
    ? requested.map((family) =>
        familyFreshness({
          family: catalog.byFamily[family].family,
          latest: catalog.byFamily[family].latest,
          today: input.today as string,
        }),
      )
    : [];

  const freshnessBlock = input.today ? buildFreshnessBlock(freshness) : null;

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
      /*
       * THE SOURCE IS NAMED AS WELL AS THE CONTENT, because they answer
       * different questions. "It would carry spa sessions by equipment" tells
       * the manager what they are missing; "the STC SPA Wellness Tracking
       * workbook" tells them what to go and ask somebody for. An answer that
       * only says the first leaves them with nothing to do about it.
       */
      header.push(
        `  ${entry.label}: no current delivery — it arrives as the ${entry.sourceReport}. It would carry ${entry.carries}`,
      );
    }
  }

  /*
   * WHAT WINDOW WAS ASKED FOR, AND WHICH ONE EACH FAMILY COULD ACTUALLY GIVE.
   *
   * Stated per family because the five sources deliver different windows: "year
   * to date" is answerable from the Comp Report and from Spa Wellness, and not
   * from Bed Usage at all. A block that showed the Comp Report's year to date
   * beside Bed Usage's month and said nothing would read as one period.
   */
  if (periodIntent) {
    header.push("");
    header.push(
      `The manager asked about "${periodIntent.phrase}". Which period each report could give for that:`,
    );
    for (const family of requested) {
      const resolution = periods[family];
      const label = REPORT_FAMILIES_BY_ID[family].label;
      if (!resolution) continue;
      if (resolution.ok) {
        header.push(
          `  ${label}: ${REPORT_PERIOD_TYPE_LABEL[resolution.period.type]} ${resolution.period.start} to ${resolution.period.end} ("${resolution.period.label}").`,
        );
      } else if (resolution.failure.reason !== "no_periods") {
        header.push(`  ${label}: CANNOT ANSWER THAT WINDOW. ${resolution.failure.detail}`);
      } else {
        // Nothing ingested at all. The NOT LOADED block above already names it,
        // and saying "cannot answer that window" as well would read as two
        // different problems.
        header.push(`  ${label}: no delivery loaded, so no period at all.`);
      }
    }
    header.push(
      "Where a report cannot answer the window asked for, say so and name what it does hold. Never substitute a different window's figures.",
    );
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
    ...(freshnessBlock ? ["", freshnessBlock] : []),
    "",
    rules.join("\n\n"),
    ...(sections.length > 0 ? ["", sections.join("\n\n")] : []),
  ].join("\n");

  return {
    text,
    requested,
    present: requested.filter((family) => present.has(family)),
    missing,
    periodIntent,
    periods,
    freshness,
  };
}
