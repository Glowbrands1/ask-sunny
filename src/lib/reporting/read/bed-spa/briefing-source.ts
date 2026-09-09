import "server-only";

import { AUTHORIZED_COMPANY } from "../../store-identity";
import { summarizeLevels, summarizeSalons, totalsFor } from "./bed-usage-analytics";
import { buildBedSpaBriefing, type BedSpaBriefingInput } from "./briefing";
import { buildCombinedView, worstPeerBandBySalon } from "./combined";
import { newestSharedPeriod } from "./period-token";
import {
  listBedUsagePeriods,
  listSpaEngagementPeriods,
  listSpaWellnessPeriods,
  loadBedUsage,
  loadSpaEngagement,
  loadSpaWellness,
} from "./read";
import { engagementTotals, summarizeEngagement } from "./spa-engagement-analytics";
import {
  equipmentPerformance,
  firstUsedWithinPeriod,
  spaWellnessTotals,
  summarizeSpaSalons,
} from "./spa-wellness-analytics";

/**
 * ============================================================================
 * LOADING THE BRIEFING THE ASSISTANT IS GROUNDED ON
 * ============================================================================
 *
 * The server-only half of `briefing.ts`: it reads the newest loaded period of
 * each report, runs the SAME analytics functions the three dashboard tabs run,
 * and hands the results to the pure renderer.
 *
 * WHY IT REUSES THE DASHBOARD'S FUNCTIONS RATHER THAN QUERYING FOR SUMMARIES.
 * If the assistant computed its own totals, a manager could read 13.2% on the
 * Spa Engagement tab and be told 12.8% in chat, and both would be defensible.
 * There is one implementation of each figure and both surfaces call it.
 *
 * WHAT IT DOES NOT DO:
 *
 *   IT NEVER THROWS. A reporting outage must not take down the answer path —
 *   the knowledge base half of the grounding is unaffected by it, and a
 *   manager asking about a policy should not see an error because a spa table
 *   was unreachable. Every failure returns null and the pipeline continues
 *   without the block.
 *
 *   IT TAKES NO PERIOD FROM THE CALLER. There is no request field that could
 *   select one, so a crafted question cannot reach a period, a company or a
 *   salon the dashboards would not show. The company is the authorized one by
 *   construction, exactly as in the read layer below it.
 *
 *   IT DOES NOT CACHE. The reports change monthly and a chat turn is not hot
 *   path enough to justify a cache whose invalidation would be a second thing
 *   to get wrong. If this becomes a cost, the place to fix it is the read
 *   layer, where the dashboards would benefit too.
 */

/** How the newest period of each report is chosen: the first, newest-first. */
function newest<T extends { periodId: string }>(options: readonly T[]): T | null {
  return options[0] ?? null;
}

/**
 * The bed and spa block, plus WHICH OF THE THREE FAMILIES ACTUALLY HAD DATA.
 *
 * The presence list is what lets the composer above obey the no-data rule. A
 * manager who asks about Spa Wellness when no Spa Wellness delivery has been
 * ingested must be told that, by name — the failure being prevented is Sunny
 * answering from the two families that ARE loaded and never mentioning that the
 * one they asked about is absent. The text alone cannot carry that: a section
 * that is missing looks exactly like a section that was never wanted.
 */
export interface BedSpaSections {
  /** The whole block — header, rules and every section that had data. */
  readonly text: string | null;
  /** Families with a current delivery, so the caller can name the rest. */
  readonly present: readonly BedSpaFamilyId[];
}

/** The three families this module covers, as `read/report-families.ts` names them. */
export type BedSpaFamilyId = "bed-usage" | "spa-wellness" | "spa-engagement";

/**
 * The briefing text for the authorized company, or null.
 *
 * Null covers every reason there is nothing to say: nothing ingested, Supabase
 * not configured, a query that failed. The caller cannot tell them apart and
 * does not need to — all four mean "answer from the knowledge base alone".
 *
 * A THIN WRAPPER over `loadBedSpaSections`, kept because the presence list is
 * of no use to a caller that only wants the block.
 */
export async function loadBedSpaBriefing(
  company: string = AUTHORIZED_COMPANY,
): Promise<string | null> {
  return (await loadBedSpaSections(company)).text;
}

/** The block and the presence list. See `BedSpaSections`. */
export async function loadBedSpaSections(
  company: string = AUTHORIZED_COMPANY,
): Promise<BedSpaSections> {
  try {
    const [bedPeriods, spaPeriods, engagementPeriods] = await Promise.all([
      listBedUsagePeriods(company),
      listSpaWellnessPeriods(company),
      listSpaEngagementPeriods(company),
    ]);

    const bedNewest = newest(bedPeriods);
    const spaNewest = newest(spaPeriods);
    const engagementNewest = newest(engagementPeriods);

    /*
     * THE CONVERSION METRIC RESOLVES ITS OWN PERIOD, for the reason the
     * dashboard does: the three reports arrive on their own schedules, and a
     * conversion rate keyed to whichever report happens to be newest would be
     * permanently N/A. The newest window BOTH halves cover is the one that can
     * be divided.
     */
    const shared = newestSharedPeriod(bedPeriods, spaPeriods);

    const [bedData, spaData, engagementData, sharedBed, sharedSpa] = await Promise.all([
      bedNewest ? loadBedUsage(bedNewest.periodId, company) : Promise.resolve(null),
      spaNewest ? loadSpaWellness(spaNewest.periodId, company) : Promise.resolve(null),
      engagementNewest ? loadSpaEngagement(engagementNewest.periodId, company) : Promise.resolve(null),
      // Re-read only when the shared window is not the one already loaded.
      shared && shared.left.periodId !== bedNewest?.periodId
        ? loadBedUsage(shared.left.periodId, company)
        : Promise.resolve(null),
      shared && shared.right.periodId !== spaNewest?.periodId
        ? loadSpaWellness(shared.right.periodId, company)
        : Promise.resolve(null),
    ]);

    const bedForConversion = sharedBed ?? (shared ? bedData : null);
    const spaForConversion = sharedSpa ?? (shared ? spaData : null);

    /* ------------------------------------------------------------ bed usage */
    const bedSection = bedData
      ? (() => {
          const salons = summarizeSalons(bedData.salons, bedData.equipment);
          return {
            period: bedData.period,
            provenance: bedData.provenance,
            totals: totalsFor(salons),
            levels: summarizeLevels(bedData.equipment, bedData.benchmarks),
            // Highest traffic first: the order the estate is read in, and the
            // order that survives truncation usefully.
            salons: [...salons].sort((a, b) => (b.totalTans ?? -1) - (a.totalTans ?? -1)),
          };
        })()
      : null;

    /* --------------------------------------------------------- spa wellness */
    const spaPerformance = spaData
      ? equipmentPerformance(spaData.equipmentTypes, spaData.equipmentUse, spaData.benchmarks)
      : [];
    const spaSection = spaData
      ? {
          period: spaData.period,
          provenance: spaData.provenance,
          totals: spaWellnessTotals(spaData.salons, spaPerformance),
          equipment: spaPerformance,
        }
      : null;

    /* ------------------------------------------------------- spa engagement */
    const engagementSection = engagementData
      ? (() => {
          const summaries = summarizeEngagement(engagementData.salons);
          return {
            period: engagementData.period,
            provenance: engagementData.provenance,
            totals: engagementTotals(summaries),
            // Lowest Spa Per Unique % first, so the salons a manager is most
            // likely to be asking about survive truncation.
            salons: [...summaries].sort(
              (a, b) =>
                (a.spaPerUniquePercent ?? Number.POSITIVE_INFINITY) -
                (b.spaPerUniquePercent ?? Number.POSITIVE_INFINITY),
            ),
            rankedPopulation: engagementData.rankPopulation,
          };
        })()
      : null;

    /* ------------------------------------------------------------- combined */
    const conversionSpa = spaForConversion;
    const combinedSection =
      bedForConversion || conversionSpa
        ? (() => {
            const conversionPerformance = conversionSpa
              ? equipmentPerformance(
                  conversionSpa.equipmentTypes,
                  conversionSpa.equipmentUse,
                  conversionSpa.benchmarks,
                )
              : [];
            const peerBandBySalon = conversionSpa
              ? worstPeerBandBySalon(
                  conversionPerformance.flatMap((entry) =>
                    conversionSpa.equipmentUse
                      .filter((use) => use.equipmentCode === entry.equipmentCode)
                      .map((use) => ({
                        storeName: use.storeName,
                        band: entry.versusPeers.band,
                        reportableFinding: entry.versusPeers.reportableFinding,
                      })),
                  ),
                )
              : {};

            /*
             * ENGAGEMENT COLUMNS ARE WITHHELD unless the engagement report
             * covers the same window as the traffic and the sessions. Placing
             * a September ratio on an August row would read as one period.
             */
            const engagementCoversShared =
              engagementData !== null &&
              bedForConversion !== null &&
              engagementData.period.grain === bedForConversion.period.grain &&
              engagementData.period.periodStart === bedForConversion.period.periodStart &&
              engagementData.period.periodEnd === bedForConversion.period.periodEnd;

            const view = buildCombinedView({
              bedUsage: bedForConversion
                ? summarizeSalons(bedForConversion.salons, bedForConversion.equipment)
                : [],
              bedUsagePeriod: bedForConversion?.period ?? null,
              spaWellness: conversionSpa
                ? summarizeSpaSalons(conversionSpa.salons, conversionSpa.equipmentUse)
                : [],
              spaWellnessPeriod: conversionSpa?.period ?? null,
              spaEngagement: engagementCoversShared
                ? summarizeEngagement(engagementData!.salons)
                : [],
              spaEngagementPeriod: engagementCoversShared ? engagementData!.period : null,
              peerBandBySalon,
              partialPeriodSalons: conversionSpa
                ? [
                    ...new Set(
                      firstUsedWithinPeriod(
                        conversionSpa.equipmentUse,
                        conversionSpa.period,
                      ).map((row) => row.storeName),
                    ),
                  ]
                : [],
            });

            return { view, period: bedForConversion?.period ?? null };
          })()
        : null;

    const input: BedSpaBriefingInput = {
      company,
      bedUsage: bedSection,
      spaWellness: spaSection,
      spaEngagement: engagementSection,
      combined: combinedSection,
    };

    /*
     * PRESENCE IS DECIDED BY WHETHER A SECTION WAS BUILT, not by whether a
     * period list was non-empty. A period can exist and hold no rows for the
     * authorized company, and "we have a delivery" would then be true of a
     * family the briefing says nothing about.
     */
    const present: BedSpaFamilyId[] = [];
    if (bedSection) present.push("bed-usage");
    if (spaSection) present.push("spa-wellness");
    if (engagementSection) present.push("spa-engagement");

    return { text: buildBedSpaBriefing(input), present };
  } catch {
    // Deliberately silent to the caller and deliberately not rethrown — see
    // the "IT NEVER THROWS" note above. The reporting read layer logs its own
    // failures; the answer path's job here is only to continue without them.
    return { text: null, present: [] };
  }
}
