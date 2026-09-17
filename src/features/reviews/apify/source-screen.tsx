import Link from "next/link";
import { AlertTriangle, Info } from "lucide-react";

import { Notice } from "@/components/ui/feedback";
import { ProvenanceChip, ProvenanceChips, SectionRule } from "@/components/ui/marquee";
import { ReportBand } from "@/features/reports/report-frame";
import type { SourceReconciliationRow } from "@/lib/reviews/apify/status";
import type {
  ApifyLocationMapping,
  ApifyRunSummary,
  ApifySourceStatusReport,
} from "@/lib/reviews/apify/types";
import { formatNumber } from "@/lib/utils/format";
import { LocationMappingForm, SyncNowButtons } from "./source-actions";

/**
 * ============================================================================
 * GOOGLE REVIEW SOURCE — the server-side Apify integration's status area
 * ============================================================================
 *
 * A SEPARATE ADMIN SCREEN, NOT A BAND ON THE DASHBOARD. `/reviews` answers
 * "what are our customers saying"; this answers "is the pipe connected". They
 * have different readers — most of the org chart holds `view_google_reviews`
 * and three roles hold `manage_integrations` — and mixing them would put run
 * ids, Place IDs and Actor limits in front of a district manager who wants to
 * read a one-star review.
 *
 * ============================================================================
 * THE ONE DISTINCTION THIS SCREEN EXISTS TO PRESERVE
 * ============================================================================
 *
 * "This location had no new reviews" and "this location did not answer" both
 * show zero, and a panel that renders them the same way is how a broken mapping
 * survives for six weeks. So three figures are shown separately and never
 * derived from each other:
 *
 *   LOCATIONS CONFIGURED   how many of the fifteen have a verified Place ID
 *   LOCATIONS RETURNED     how many answered the last run AT ALL
 *   REVIEWS FETCHED        how many records came back
 *
 * A location missing from the second is NAMED, by store code, in the words
 * "did not answer".
 *
 * ============================================================================
 * AND EVERY COST FIGURE IS APIFY'S, NOT OURS
 * ============================================================================
 *
 * `usageTotalUsd` is read back from Apify's own run object. Nothing on this
 * screen estimates what a run cost — a figure computed by the code that spends
 * the money is the one number nobody should trust.
 */

const STATUS_LABEL: Record<ApifyRunSummary["status"], string> = {
  running: "Running",
  succeeded: "Succeeded",
  partial: "Partial",
  failed: "Failed",
};

const KIND_LABEL: Record<ApifyRunSummary["kind"], string> = {
  backfill: "History import",
  incremental: "Scheduled sync",
  location_resolution: "Location check",
};

function when(value: string | null): string {
  if (!value) return "—";
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return "—";
  return new Date(parsed).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function Figure({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "neutral" | "attention";
}) {
  return (
    <div className="min-w-0 rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2.5">
      <p className="text-[10px] font-semibold tracking-[0.07em] text-muted-foreground uppercase">
        {label}
      </p>
      <p
        className={
          tone === "attention"
            ? "mt-1 text-[19px] leading-none font-semibold text-status-attention"
            : "mt-1 text-[19px] leading-none font-semibold"
        }
      >
        {value}
      </p>
      {hint ? <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function LastRunPanel({ run }: { run: ApifyRunSummary }) {
  const answered = `${run.locationsReturned} / ${run.locationsRequested}`;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <span className="font-semibold">{KIND_LABEL[run.kind]}</span>
        <span className="text-muted-foreground">·</span>
        <span
          className={
            run.status === "failed"
              ? "text-status-attention"
              : run.status === "partial"
                ? "text-status-attention"
                : "text-muted-foreground"
          }
        >
          {STATUS_LABEL[run.status]}
        </span>
        <span className="text-muted-foreground">·</span>
        <span className="text-muted-foreground">started {when(run.startedAt)}</span>
        <span className="text-muted-foreground">·</span>
        <span className="text-muted-foreground">by {run.requestedBy}</span>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Figure
          label="Locations returned"
          value={answered}
          hint="Answered at all, including with nothing new"
          tone={
            run.status !== "running" && run.locationsReturned < run.locationsRequested
              ? "attention"
              : "neutral"
          }
        />
        <Figure label="Reviews fetched" value={formatNumber(run.reviewsFetched)} />
        <Figure label="New" value={formatNumber(run.reviewsCreated)} />
        <Figure label="Updated" value={formatNumber(run.reviewsUpdated)} />
        <Figure
          label="Duplicates"
          value={formatNumber(run.reviewsDuplicate)}
          hint="Already held, unchanged"
        />
        <Figure
          label="Apify usage"
          value={run.usageTotalUsd === null ? "—" : `$${run.usageTotalUsd.toFixed(4)}`}
          hint="Reported by Apify"
        />
      </div>

      {/*
        COUNTED AND HELD ARE TWO ANSWERS, AND THE ORDER MATTERS. The extension's
        first live run reported "imported, 5 listings counted nothing" in the
        colour reserved for faults and a manager read it as "the reviews are not
        there". Both facts were true; stating them as one is what misled.
      */}
      <p className="text-[12px] text-muted-foreground">
        {formatNumber(run.countedIntoPeriod)} counted toward the open reporting week;{" "}
        {formatNumber(run.storedAsHistorical)} stored as history and counted toward
        nothing. History counting toward nothing is the rule working, not a fault.
      </p>

      {run.missingStoreCodes.length > 0 ? (
        <Notice tone="attention" icon={<AlertTriangle />} title="Locations that did not answer">
          <p>
            Store {run.missingStoreCodes.length === 1 ? "code" : "codes"}{" "}
            <span className="font-mono">{run.missingStoreCodes.join(", ")}</span> were asked
            for and were not in the results at all. That is different from having no new
            reviews — check the Place ID mapping below before reading these salons as quiet.
          </p>
        </Notice>
      ) : null}
    </div>
  );
}

function LocationTable({ locations }: { locations: ApifyLocationMapping[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-[13px]">
        <thead>
          <tr className="border-b border-border text-left text-[11px] tracking-[0.06em] text-muted-foreground uppercase">
            <th className="py-2 pr-3 font-semibold">Store</th>
            <th className="py-2 pr-3 font-semibold">Salon</th>
            <th className="py-2 pr-3 font-semibold">Source state</th>
            <th className="py-2 pr-3 font-semibold">Google name on record</th>
            <th className="py-2 pr-3 font-semibold text-right">Held</th>
            <th className="py-2 pr-3 font-semibold text-right">From Apify</th>
            <th className="py-2 font-semibold">Newest review</th>
          </tr>
        </thead>
        <tbody>
          {locations.map((location) => (
            <tr key={location.storeCode} className="border-b border-border/60 align-top">
              <td className="py-2 pr-3 font-mono text-[12px]">{location.storeCode}</td>
              <td className="py-2 pr-3">
                {location.locationName}
                <span className="ml-2 font-mono text-[11px] text-muted-foreground">
                  {location.salonNumber ?? "—"}
                </span>
              </td>
              <td className="py-2 pr-3">
                <span
                  className={
                    location.sourceStatus === "verified"
                      ? "text-foreground"
                      : "text-status-attention"
                  }
                >
                  {location.sourceStatus === "verified"
                    ? "Verified"
                    : location.sourceStatus === "pending_verification"
                      ? "Awaiting check"
                      : location.sourceStatus === "rejected"
                        ? "Rejected"
                        : "Not mapped"}
                </span>
                {location.verificationNote ? (
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {location.verificationNote}
                  </p>
                ) : null}
              </td>
              <td className="py-2 pr-3 text-muted-foreground">
                {location.canonicalGoogleName ?? "—"}
                {location.canonicalGoogleAddress ? (
                  <p className="text-[11px]">{location.canonicalGoogleAddress}</p>
                ) : null}
              </td>
              <td className="py-2 pr-3 text-right">{formatNumber(location.reviewsTotal)}</td>
              <td className="py-2 pr-3 text-right">{formatNumber(location.reviewsFromApify)}</td>
              <td className="py-2 text-muted-foreground">{when(location.latestPublishedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * THE BRAVE-VERSUS-APIFY COMPARISON, which is the question the cutover rests on.
 *
 * If both transports report the same Google review id, the same review found
 * twice is ONE row that both have seen — `seenByBothSources` counts those, and
 * a positive number is the evidence that the deduplication key holds across
 * sources. `suspectedDuplicates` is the opposite evidence: a pair at one salon
 * with the same reviewer, the same rating and a publication time within a day,
 * under two different ids, discovered by two different transports.
 *
 * NOTHING HERE MERGES ANYTHING. A resemblance is not an identity, and a system
 * that quietly merged on one would eventually merge two real customers.
 */
function ReconciliationTable({ rows }: { rows: SourceReconciliationRow[] }) {
  const withBoth = rows.filter((row) => row.seenByBothSources > 0);
  const suspect = rows.filter((row) => row.suspectedDuplicates > 0);

  return (
    <div className="flex flex-col gap-3">
      {suspect.length > 0 ? (
        <Notice tone="attention" icon={<AlertTriangle />} title="Possible duplicate identities">
          <p>
            At{" "}
            <span className="font-mono">
              {suspect.map((row) => row.storeCode).join(", ")}
            </span>{" "}
            there are review pairs that look like one customer stored twice under two
            different Google ids — one found by the extension, one by Apify. Nothing has
            been merged. Do not switch the production source over until this is understood.
          </p>
        </Notice>
      ) : withBoth.length > 0 ? (
        <Notice tone="neutral" icon={<Info />}>
          {withBoth.length} location{withBoth.length === 1 ? " has" : "s have"} reviews that
          both the Brave extension and Apify have seen, under the same Google review id.
          That is the evidence the two sources deduplicate into one record.
        </Notice>
      ) : (
        <Notice tone="neutral" icon={<Info />}>
          No review has yet been seen by both sources, so the two have not been compared
          against each other. Run the extension over a location Apify has already imported —
          306 KS Manhattan is the one this was tested on — and come back here.
        </Notice>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-[13px]">
          <thead>
            <tr className="border-b border-border text-left text-[11px] tracking-[0.06em] text-muted-foreground uppercase">
              <th className="py-2 pr-3 font-semibold">Store</th>
              <th className="py-2 pr-3 font-semibold text-right">Held</th>
              <th className="py-2 pr-3 font-semibold text-right">Found by Brave</th>
              <th className="py-2 pr-3 font-semibold text-right">Found by Apify</th>
              <th className="py-2 pr-3 font-semibold text-right">Seen by both</th>
              <th className="py-2 pr-3 font-semibold text-right">With real timestamp</th>
              <th className="py-2 font-semibold text-right">Suspected duplicates</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.storeCode} className="border-b border-border/60">
                <td className="py-2 pr-3 font-mono text-[12px]">{row.storeCode}</td>
                <td className="py-2 pr-3 text-right">{formatNumber(row.reviewsTotal)}</td>
                <td className="py-2 pr-3 text-right">{formatNumber(row.discoveredByBrave)}</td>
                <td className="py-2 pr-3 text-right">{formatNumber(row.discoveredByApify)}</td>
                <td className="py-2 pr-3 text-right">{formatNumber(row.seenByBothSources)}</td>
                <td className="py-2 pr-3 text-right">
                  {formatNumber(row.withPublicationTime)}
                </td>
                <td
                  className={
                    row.suspectedDuplicates > 0
                      ? "py-2 text-right font-semibold text-status-attention"
                      : "py-2 text-right"
                  }
                >
                  {formatNumber(row.suspectedDuplicates)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ApifySourceScreen({
  source,
  reconciliation,
}: {
  source: ApifySourceStatusReport;
  reconciliation: SourceReconciliationRow[];
}) {
  return (
    <div className="min-w-0">
      <ReportBand
        title="Google Review Source"
        description="The server-side Apify sync — what it is configured to do, and what it last did"
        provenance={
          <ProvenanceChips>
            <ProvenanceChip emphasis>
              {source.enabled ? "Apify — enabled" : "Apify — switched off"}
            </ProvenanceChip>
            <ProvenanceChip>
              {source.locationsConfigured} of {source.locationsTotal} locations configured
            </ProvenanceChip>
            <ProvenanceChip>Administration</ProvenanceChip>
          </ProvenanceChips>
        }
      />

      <div className="flex min-w-0 flex-col gap-5 px-5 py-5 pb-7 sm:px-6">
        {!source.enabled ? (
          <Notice tone="attention" icon={<AlertTriangle />} title="Server-side sync is switched off">
            <p>
              <span className="font-mono text-[12px]">APIFY_SYNC_ENABLED</span> is not set to
              true, so no scheduled or manual run will start and nothing is being spent. The
              Brave extension remains available and unaffected.
            </p>
          </Notice>
        ) : null}

        {source.problems.length > 0 ? (
          <Notice tone="attention" icon={<AlertTriangle />} title="Configuration">
            <ul className="list-disc space-y-1 pl-4">
              {source.problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </Notice>
        ) : null}

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <Figure
            label="Locations configured"
            value={`${source.locationsConfigured} / ${source.locationsTotal}`}
            hint="Verified Place ID"
            tone={
              source.locationsConfigured < source.locationsTotal ? "attention" : "neutral"
            }
          />
          <Figure
            label="Last successful sync"
            value={when(source.lastSuccessfulRun?.finishedAt ?? null)}
          />
          <Figure
            label="Runs today"
            value={`${source.runsStartedInLastDay} / ${source.maxRunsPerDay}`}
            hint="Rolling 24 hours"
          />
          <Figure
            label="Recurring window"
            value={String(source.incrementalLimitPerLocation)}
            hint="Newest reviews per location"
          />
          <Figure
            label="Next scheduled sync"
            value={source.scheduleDescription ?? "Not stated"}
            hint={source.scheduleDescription ? undefined : "Set APIFY_SYNC_SCHEDULE"}
          />
        </div>

        <SectionRule label="Run now" />

        <SyncNowButtons liveRunId={source.liveRun?.id ?? null} />

        <SectionRule label="The last run" />

        {source.lastRun ? (
          <LastRunPanel run={source.lastRun} />
        ) : (
          <Notice tone="neutral" icon={<Info />}>
            No Apify run has been started from this deployment yet.
          </Notice>
        )}

        <SectionRule label="The fifteen locations" />

        <Notice tone="neutral" icon={<Info />} title="How a location is mapped">
          <p>
            Paste the Google Place ID, or a Maps URL containing one, then check it against
            Google. A saved identifier is <strong>awaiting check</strong> and takes part in
            no run until Google&rsquo;s own name and address match the salon&rsquo;s expected
            city and state. Nothing is ever matched by business name — &ldquo;Sun Tan
            City&rdquo; is a franchise brand, and a name match could attach a location this
            business does not operate to a real salon.
          </p>
        </Notice>

        <LocationTable locations={source.locations} />

        <LocationMappingForm
          locations={source.locations}
          liveRunId={source.liveRun?.id ?? null}
        />

        <SectionRule label="Brave extension versus Apify" />

        <ReconciliationTable rows={reconciliation} />

        <Notice tone="neutral" icon={<Info />} title="The Brave extension is still available">
          <p>
            Apify is the production candidate; the{" "}
            <span className="font-semibold">ASK Sunny Review Sync</span> extension stays as a
            fallback and as the way to check Apify&rsquo;s results by hand. Apify does not
            need it, and nothing here turns it off. The baselines that decide what counts
            are set on{" "}
            <Link href="/reviews/setup" className="text-primary underline-offset-4 hover:underline">
              Review Baselines
            </Link>
            , and both sources go through them.
          </p>
        </Notice>
      </div>
    </div>
  );
}
