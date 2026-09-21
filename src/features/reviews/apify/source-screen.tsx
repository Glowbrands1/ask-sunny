import Link from "next/link";
import { AlertTriangle, Info } from "lucide-react";

import { Notice } from "@/components/ui/feedback";
import { ProvenanceChip, ProvenanceChips, SectionRule } from "@/components/ui/marquee";
import { ReportBand } from "@/features/reports/report-frame";
import { REVIEWS_DISPLAY_TIME_ZONE } from "@/lib/reviews/display-time";
import type { SourceReconciliationRow } from "@/lib/reviews/apify/status";
import type {
  ApifyLocationMapping,
  ApifyRunSummary,
  ApifySourceStatusReport,
} from "@/lib/reviews/apify/types";
import { formatNumber } from "@/lib/utils/format";
import {
  addressMatchLabel,
  safeMatches,
  storedAddressMatch,
  unresolvedForRediscovery,
} from "@/lib/reviews/apify/discovery";
import {
  DiscoveryActions,
  ExpectedAddressForm,
  LocationMappingForm,
  SyncNowButtons,
} from "./source-actions";

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
  location_discovery: "Location discovery",
};

/*
 * RUN TIMES ARE CENTRAL, not the host's. These are `timestamptz` columns read
 * back in UTC, and this panel renders on the server — so with no `timeZone` the
 * run that finished at 7:25 in the morning was labelled 12:25 PM. The zone is
 * named explicitly here for the same reason it is named on the dashboard chip.
 */
const RUN_TIME = new Intl.DateTimeFormat("en-US", {
  timeZone: REVIEWS_DISPLAY_TIME_ZONE,
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function when(value: string | null): string {
  if (!value) return "—";
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return "—";
  return RUN_TIME.format(new Date(parsed));
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

/**
 * THE STATUS ONE CELL HAS TO CARRY.
 *
 * Two facts live behind it — whether a search found anything, and whether this
 * listing may be scraped — and a person reading the table needs one word. The
 * ACCEPTED state wins where it exists, because "Verified" is the answer to the
 * only question that changes behaviour; the discovery state is what fills the
 * gap for everything not yet accepted.
 */
function statusLabel(location: ApifyLocationMapping): { label: string; tone: "ok" | "wait" | "attention" } {
  if (location.sourceStatus === "verified") return { label: "Verified", tone: "ok" };
  if (location.sourceStatus === "rejected") return { label: "Rejected", tone: "attention" };

  switch (location.discoveryStatus) {
    case "searching":
      return { label: "Searching", tone: "wait" };
    case "candidate_found":
      return { label: "Candidate found", tone: "wait" };
    case "ambiguous":
      return { label: "Ambiguous", tone: "attention" };
    case "not_found":
      return { label: "Not found", tone: "attention" };
    case "profile_issue":
      return { label: "Google profile issue", tone: "attention" };
    default:
      return location.sourceStatus === "pending_verification"
        ? { label: "Awaiting check", tone: "wait" }
        : { label: "Not mapped", tone: "attention" };
  }
}

/**
 * ONE ROW PER SALON, WITH BOTH NUMBERING SYSTEMS AND BOTH MAPPINGS.
 *
 * The store code and the ASK Sunny salon number sit side by side because they
 * do not agree — Google's 306 is salon 0462 — and this is where somebody
 * confirms a discovery before accepting it.
 *
 * What Google PROPOSED and what ASK Sunny ACCEPTED are separate columns, for
 * the same reason they are separate columns in the database: a proposal that
 * rendered as a mapping would be believed as one.
 */
function DiscoveryTable({ locations }: { locations: ApifyLocationMapping[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1180px] text-[13px]">
        <thead>
          <tr className="border-b border-border text-left text-[11px] tracking-[0.06em] text-muted-foreground uppercase">
            <th className="py-2 pr-3 font-semibold">Store</th>
            <th className="py-2 pr-3 font-semibold">Salon</th>
            <th className="py-2 pr-3 font-semibold">Name</th>
            <th className="py-2 pr-3 font-semibold">District</th>
            <th className="py-2 pr-3 font-semibold">Expected address</th>
            <th className="py-2 pr-3 font-semibold">Google candidate address</th>
            <th className="py-2 pr-3 font-semibold">Address match</th>
            <th className="py-2 pr-3 font-semibold">Place ID</th>
            <th className="py-2 pr-3 font-semibold">Status</th>
            <th className="py-2 font-semibold">Reason</th>
          </tr>
        </thead>
        <tbody>
          {locations.map((location) => {
            const status = statusLabel(location);
            /* What was accepted, or failing that what was proposed. */
            const name = location.canonicalGoogleName ?? location.discoveredName;
            const address = location.canonicalGoogleAddress ?? location.discoveredAddress;
            const placeId = location.googlePlaceId ?? location.discoveredPlaceId;
            const mapsUrl = location.googleMapsUrl ?? location.discoveredMapsUrl;
            /*
              THE SAME VERDICT THE MATCHER ACTED ON, not a second opinion
              computed beside it. `storedAddressMatch` runs the stored candidate
              back through `addressMatch` — so what this column says and what
              discovery decided cannot drift apart.
            */
            const match = storedAddressMatch(location);

            return (
              <tr key={location.storeCode} className="border-b border-border/60 align-top">
                <td className="py-2 pr-3 font-mono text-[12px]">{location.storeCode}</td>
                <td className="py-2 pr-3 font-mono text-[12px]">
                  {location.salonNumber ?? "—"}
                </td>
                <td className="py-2 pr-3">{location.locationName}</td>
                <td className="py-2 pr-3 text-muted-foreground">
                  {location.district ?? "—"}
                </td>
                <td className="py-2 pr-3 text-muted-foreground">
                  {location.expectedStreetAddress ? (
                    <span className="text-foreground">{location.expectedStreetAddress}</span>
                  ) : (
                    /*
                      NAMED AS MISSING RATHER THAN LEFT BLANK. An empty cell
                      reads as "nothing to say"; this is the one field whose
                      absence is the reason a salon could not be resolved.
                    */
                    <span className="text-status-attention">No street address yet</span>
                  )}
                  <p className="text-[11px]">
                    {location.expectedCity ?? "—"}
                    {location.expectedState ? `, ${location.expectedState}` : ""}
                    {location.expectedPostalCode ? ` ${location.expectedPostalCode}` : ""}
                  </p>
                  {!location.expectedStreetAddress &&
                  (location.expectedStreetHint ?? []).length > 0 ? (
                    <p className="text-[11px]">
                      near {(location.expectedStreetHint ?? []).join(" / ")}
                    </p>
                  ) : null}
                </td>
                <td className="py-2 pr-3">
                  {address ? (
                    <span>{address}</span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                  {name ? <p className="text-[11px] text-muted-foreground">{name}</p> : null}
                  {location.discoveryCandidateCount > 1 ? (
                    <p className="text-[11px] text-status-attention">
                      {location.discoveryCandidateCount} candidates matched
                    </p>
                  ) : null}
                </td>
                <td className="py-2 pr-3">
                  <span
                    className={
                      match === "exact" || match === "strong"
                        ? "font-semibold"
                        : match === "weak"
                          ? "text-status-attention"
                          : "text-muted-foreground"
                    }
                  >
                    {addressMatchLabel(match)}
                  </span>
                </td>
                <td className="py-2 pr-3">
                  {placeId ? (
                    mapsUrl ? (
                      <a
                        href={mapsUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono text-[11px] text-primary underline-offset-4 hover:underline"
                      >
                        {placeId.slice(0, 14)}…
                      </a>
                    ) : (
                      <span className="font-mono text-[11px]">{placeId.slice(0, 14)}…</span>
                    )
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="py-2 pr-3">
                  <span
                    className={
                      status.tone === "ok"
                        ? "font-semibold"
                        : status.tone === "attention"
                          ? "text-status-attention"
                          : "text-muted-foreground"
                    }
                  >
                    {status.label}
                  </span>
                </td>
                <td className="py-2 text-[11px] text-muted-foreground">
                  {location.verificationNote ?? location.discoveryNote ?? "—"}
                </td>
              </tr>
            );
          })}
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
  /* Listings a discovery run would cover, and the ones it could not settle. */
  const searchable = source.locations.filter(
    (location) => location.isActive && location.sourceStatus !== "verified",
  );
  const unresolved = source.locations.filter(
    (location) =>
      location.sourceStatus !== "verified" &&
      (location.discoveryStatus === "ambiguous" ||
        location.discoveryStatus === "not_found" ||
        location.discoveryStatus === "profile_issue"),
  );

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

        {/*
          TWO SWITCHES, AND THE SECOND ONE IS THE ONE QA CARES ABOUT. Saying
          "enabled" alone here would be read as "the schedule is running", which
          during QA is exactly the wrong belief to leave somebody holding.
        */}
        {source.enabled && !source.scheduleEnabled ? (
          <Notice tone="neutral" icon={<Info />} title="Manual runs only">
            <p>
              The integration is on, so Discover and Sync work from this screen. The
              twice-daily scheduled sync is <strong>off</strong> —{" "}
              <span className="font-mono text-[12px]">APIFY_SCHEDULE_ENABLED</span> is not
              set to true, so nothing starts unless you press a button.
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
            label="Scheduled sync"
            value={source.scheduleEnabled ? (source.scheduleDescription ?? "On") : "Off"}
            hint={
              source.scheduleEnabled
                ? undefined
                : "Manual runs only — APIFY_SCHEDULE_ENABLED is off"
            }
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
            <strong>Start with the address.</strong> Type each salon&rsquo;s street address
            below and the search looks for that door rather than for &ldquo;a Sun Tan City
            near Lawrence&rdquo;. It is the difference between one candidate and three, and
            it is why nobody here should have to find a Google Place ID.
          </p>
          <p className="mt-1">
            <strong>Discover</strong> then searches Google Maps once per salon and proposes
            a candidate. It maps nothing: a candidate is accepted only when it matched this
            salon&rsquo;s brand, address, city and state — and matched no other salon — and
            only when you press <strong>Verify All Safe Matches</strong>. Accepting costs no
            Apify call, because Google&rsquo;s own name and address were captured when the
            candidate was found.
          </p>
          <p className="mt-1">
            Anything ambiguous, not found or flagged by Google is left unmapped and listed
            with the reason. &ldquo;Sun Tan City&rdquo; is a franchise brand, so a
            name-only match could attach a location this business does not operate to a real
            salon — nothing here will do that on its own.
          </p>
        </Notice>

        {/*
          THE ADDRESSES COME FIRST ON THE PAGE because they come first in the
          work. A person arriving here to connect Google reads downward: say
          where the salons are, search, confirm what came back.
        */}
        <details
          open={source.locations.some((location) => location.expectedStreetAddress === null)}
          className="rounded-[var(--radius-md)] border border-border bg-surface px-4 py-3"
        >
          <summary className="cursor-pointer text-[13px] font-semibold">
            Expected addresses — where each salon should be found
          </summary>
          <div className="mt-3">
            <p className="mb-3 text-[12px] text-muted-foreground">
              Paste each salon&rsquo;s address as one line — Google&rsquo;s own{" "}
              <span className="font-mono text-[11.5px]">
                2624 Iowa St Ste B, Lawrence, KS 66046, United States
              </span>{" "}
              — and it is split into the five fields, which stay editable. An address that
              cannot be read confidently is shown back for correction rather than guessed
              at, and nothing you have already typed is replaced without being shown first.
              Saving an address maps nothing: it is what the next search looks for and what
              the results are checked against.
            </p>
            <ExpectedAddressForm locations={source.locations} />
          </div>
        </details>

        <DiscoveryActions
          liveRunId={source.liveRun?.id ?? null}
          safeMatchCount={safeMatches(source.locations).length}
          unresolvedCount={unresolved.length}
          searchableCount={searchable.length}
          rediscoverableCount={unresolvedForRediscovery(source.locations).length}
        />

        <DiscoveryTable locations={source.locations} />

        <details className="rounded-[var(--radius-md)] border border-border bg-surface px-4 py-3">
          <summary className="cursor-pointer text-[13px] font-semibold">
            Map a location by hand (fallback)
          </summary>
          <div className="mt-3">
            <p className="mb-3 text-[12px] text-muted-foreground">
              For the listings discovery could not resolve, and for re-pointing a salon whose
              Google listing moved. A pasted identifier is checked against Google before it
              counts, exactly as a discovered one is.
            </p>
            <LocationMappingForm
              locations={source.locations}
              liveRunId={source.liveRun?.id ?? null}
            />
          </div>
        </details>

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
