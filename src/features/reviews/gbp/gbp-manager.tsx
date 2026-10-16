"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Loader2, MapPin, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/feedback";
import {
  SEPT_OCT_2026_WINDOW,
  type GbpOverview,
  type OverviewListing,
} from "@/lib/reviews/gbp/overview-types";
import type { RunSummary } from "@/lib/reviews/gbp/summary";

import { describeError, formatWhen, runLabel, summaryTotals } from "./format";

const ENDPOINT = "/api/admin/reviews/gbp";

interface Proposal {
  storeCode: string | null;
  googleLocationName: string;
  title: string | null;
  verdict: string;
  reasons: string[];
  address?: string | null;
}

interface LocationReportLike {
  storeCode: string;
  label: string;
  status: string;
  errorCode?: string;
  fetched: number;
  complete: boolean;
  alreadyLinked: number;
  autoMatched: number;
  newReviews: number;
  deferredNewReviews: number;
  needsReview: number;
  inWindow?: { google: number; alreadyHeld: number; missing: number; needsReview: number };
  projectedIfFull?: { counted: number; historical: number; finding: string | null };
}

interface ReportLike {
  mode: string;
  status: string;
  reason?: string;
  window?: { from: string; to: string };
  locations: LocationReportLike[];
}

async function call(body: Record<string, unknown>): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: response.ok, data };
  } catch {
    return { ok: false, data: { reason: "Could not reach the server." } };
  }
}

const FLASH: Record<string, { tone: "accent" | "attention"; text: string }> = {
  connected: { tone: "accent", text: "Google is connected." },
  denied: { tone: "attention", text: "Google sign-in was cancelled. Nothing changed." },
  error: { tone: "attention", text: "Google sign-in did not complete. Try Connect Google again." },
  expired: { tone: "attention", text: "The sign-in link expired. Try Connect Google again." },
};

function providerLine(overview: GbpOverview) {
  const apify = overview.apify.enabled ? "active" : "off";
  if (overview.primarySource === "google") return { apify, google: "primary (live)" };
  if (overview.mode === "dry_run") return { apify, google: "dry-run only — reads and reports, saves nothing" };
  if (overview.mode === "live") return { apify, google: "enrich-only — links existing reviews, creates none" };
  return { apify, google: "off" };
}

export function GbpManager({ initial, flash }: { initial: GbpOverview; flash?: string | null }) {
  const router = useRouter();
  const [overview, setOverview] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "accent" | "attention"; text: string } | null>(
    flash && FLASH[flash] ? FLASH[flash] : null,
  );
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [report, setReport] = useState<ReportLike | null>(null);
  const [armed, setArmed] = useState(false);
  const discovered = useRef(false);

  const reload = useCallback(async () => {
    try {
      const response = await fetch(ENDPOINT, { cache: "no-store" });
      const data = (await response.json()) as { overview?: GbpOverview };
      if (data.overview) setOverview(data.overview);
    } catch {
      /* keep what is shown */
    }
    router.refresh();
  }, [router]);

  const connected = overview.connection.state === "active";
  const unconfirmed = overview.listings.some((l) => l.mappingStatus !== "confirmed");
  const live = overview.mode === "live";

  const discover = useCallback(async () => {
    setBusy("discover");
    const { ok, data } = await call({ action: "discover" });
    setBusy(null);
    if (!ok) {
      setMessage({ tone: "attention", text: String(data.reason ?? describeError(String(data.code ?? "")) ?? "Discovery failed.") || "Discovery failed." });
      return;
    }
    setProposals((data.proposals as Proposal[]) ?? []);
  }, []);

  /* Auto-discover once when connected: read-only, nothing is saved. */
  useEffect(() => {
    if (discovered.current) return;
    if (connected && overview.mode !== "off" && unconfirmed) {
      discovered.current = true;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot read-only fetch on connect
      void discover();
    }
  }, [connected, overview.mode, unconfirmed, discover]);

  const act = async (key: string, body: Record<string, unknown>, success: string) => {
    setBusy(key);
    const { ok, data } = await call(body);
    setBusy(null);
    if (!ok) {
      setMessage({ tone: "attention", text: String(data.reason ?? data.outcome ?? "That did not complete.") });
      return null;
    }
    setMessage({ tone: "accent", text: success });
    await reload();
    return data;
  };

  const disconnect = async () => {
    if (!window.confirm("Disconnect Google? Stored reviews are kept, but syncing stops until you reconnect.")) return;
    setBusy("disconnect");
    try {
      const response = await fetch("/api/admin/reviews/gbp/disconnect", { method: "POST" });
      setMessage(response.ok ? { tone: "accent", text: "Google was disconnected." } : { tone: "attention", text: "Disconnect did not complete." });
    } catch {
      setMessage({ tone: "attention", text: "Could not reach the server." });
    }
    setBusy(null);
    await reload();
  };

  const runDry = async (backfill: boolean) => {
    setBusy(backfill ? "backfill" : "dry");
    const { ok, data } = await call(
      backfill
        ? { action: "dry_run", scope: "backfill", from: SEPT_OCT_2026_WINDOW.from, to: SEPT_OCT_2026_WINDOW.to }
        : { action: "dry_run", scope: "incremental" },
    );
    setBusy(null);
    if (!ok) {
      setMessage({ tone: "attention", text: String(data.reason ?? "The check did not complete.") });
      return;
    }
    setReport((data.report as ReportLike) ?? null);
    await reload();
  };

  const runSync = async () => {
    if (!armed) {
      setArmed(true);
      return;
    }
    setArmed(false);
    await act("sync", { action: "sync", confirm: true, scope: "incremental" }, "Sync finished.");
  };

  const proposalFor = (l: OverviewListing) => proposals?.find((p) => p.storeCode === l.storeCode);
  const eligible = proposals?.filter((p) => p.verdict === "eligible" && p.storeCode) ?? [];
  const p = providerLine(overview);
  const lastRun = overview.runs[0] ?? null;
  const lastRunSummary: RunSummary | null = overview.lastBackfillDryRun?.summary ?? null;

  return (
    <section aria-label="Google Business Profile" className="flex min-w-0 flex-col gap-5 px-5 py-5 sm:px-6">
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}

      <div className="rounded-[var(--radius-md)] border border-border bg-surface p-4">
        <h2 className="text-[15px] font-semibold">Google Business Profile (official API)</h2>
        <dl className="mt-2 grid gap-1 text-[13px] sm:grid-cols-2">
          <div><dt className="inline text-muted-foreground">Apify: </dt><dd className="inline">{p.apify}</dd></div>
          <div><dt className="inline text-muted-foreground">Google API: </dt><dd className="inline">{p.google}</dd></div>
          <div><dt className="inline text-muted-foreground">Primary source: </dt><dd className="inline">{overview.primarySource === "google" ? "Google" : overview.primarySource === "apify" ? "Apify" : "none"}</dd></div>
          <div><dt className="inline text-muted-foreground">Mode: </dt><dd className="inline">{overview.mode}</dd></div>
        </dl>
        {overview.missingEnv.length ? (
          <p className="mt-2 text-[12px] text-muted-foreground">Missing configuration: <span className="font-mono">{overview.missingEnv.join(", ")}</span></p>
        ) : null}
      </div>

      <div className="rounded-[var(--radius-md)] border border-border bg-surface p-4">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="text-[14px] font-semibold">Connection</h3>
          <Badge tone={connected ? "ready" : overview.connection.state === "none" ? "neutral" : "attention"}>
            {connected ? "Connected" : overview.connection.state === "none" ? "Not connected" : overview.connection.state}
          </Badge>
        </div>
        {connected ? (
          <p className="mt-1 text-[13px] text-muted-foreground">
            Connected by {overview.connection.connectedBy ?? "an administrator"} on {formatWhen(overview.connection.connectedAt)}. Last used {formatWhen(overview.connection.lastUsedAt)}.
          </p>
        ) : null}
        {overview.connection.lastErrorCode ? <p className="mt-1 text-[13px] text-status-attention">{describeError(overview.connection.lastErrorCode)}</p> : null}
        <div className="mt-3 flex flex-wrap gap-2">
          {overview.oauthConfigured ? (
            <Button asChild size="sm" variant={connected ? "outline" : "primary"}>
              <a href="/api/admin/reviews/gbp/connect">{connected ? "Reconnect Google" : "Connect Google"}</a>
            </Button>
          ) : (
            <Button size="sm" disabled>Connect Google</Button>
          )}
          {connected ? (
            <Button size="sm" variant="destructive" disabled={busy !== null} onClick={disconnect}>Disconnect</Button>
          ) : null}
        </div>
      </div>

      <div className="rounded-[var(--radius-md)] border border-border bg-surface p-4">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="flex items-center gap-1.5 text-[14px] font-semibold"><MapPin className="size-4" />Locations</h3>
          <span className="text-[13px] text-muted-foreground">{overview.totals.confirmed} of {overview.totals.listings} mapped and verified</span>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={!connected || overview.mode === "off" || busy !== null} onClick={discover}>
              {busy === "discover" ? <Loader2 className="animate-spin" /> : <RefreshCw />}Discover Google locations
            </Button>
            {eligible.length ? (
              <Button size="sm" disabled={busy !== null || !overview.productionRuntime} onClick={() => act("confirm_all", { action: "confirm_all" }, "Verified mappings confirmed.")}>
                Confirm all {eligible.length} verified
              </Button>
            ) : null}
          </div>
        </div>
        {!overview.productionRuntime ? <p className="mt-1 text-[12px] text-muted-foreground">Mappings can only be changed from the production deployment.</p> : null}
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead className="text-muted-foreground">
              <tr><th className="py-1 pr-3">Store</th><th className="pr-3">Salon</th><th className="pr-3">Mapping</th><th className="pr-3">Reviews linked</th><th className="pr-3">Open items</th><th /></tr>
            </thead>
            <tbody>
              {overview.listings.map((l) => {
                const proposal = proposalFor(l);
                const confirmable = proposal && l.mappingStatus !== "confirmed" && proposal.verdict === "eligible";
                return (
                  <tr key={l.storeCode} className="border-t border-border">
                    <td className="py-1.5 pr-3 font-mono">{l.storeCode}</td>
                    <td className="pr-3">{l.salonName ?? l.label}</td>
                    <td className="pr-3">
                      <Badge tone={l.mappingStatus === "confirmed" ? "ready" : "attention"}>{l.mappingStatus === "confirmed" ? "Verified" : proposal ? proposal.verdict.replace(/_/g, " ") : l.mappingStatus}</Badge>
                    </td>
                    <td className="pr-3">{l.reviewsLinked} of {l.reviewsHeld}</td>
                    <td className="pr-3">{l.openReviewItems}</td>
                    <td className="text-right">
                      {confirmable ? (
                        <Button size="sm" variant="outline" disabled={busy !== null || !overview.productionRuntime} onClick={() => act(`c-${l.storeCode}`, { action: "confirm", storeCode: l.storeCode, locationName: proposal.googleLocationName }, `Store ${l.storeCode} confirmed.`)}>Confirm</Button>
                      ) : l.mappingStatus === "confirmed" && l.reviewsLinked === 0 ? (
                        <Button size="sm" variant="ghost" disabled={busy !== null || !overview.productionRuntime} onClick={() => act(`u-${l.storeCode}`, { action: "unlink", storeCode: l.storeCode }, `Store ${l.storeCode} unlinked.`)}>Unlink</Button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-[var(--radius-md)] border border-border bg-surface p-4">
        <h3 className="text-[14px] font-semibold">Sync</h3>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Check Google reads reviews and reports what it would do. It saves no review data. Saving is disabled until the mode is live
          {overview.creation.allowed ? "" : ` — and review creation stays off${overview.creation.reason ? ` (${overview.creation.reason})` : ""}`}.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" disabled={!connected || overview.mode === "off" || busy !== null} onClick={() => runDry(false)}>
            {busy === "dry" ? <Loader2 className="animate-spin" /> : <RefreshCw />}Check Google now (dry run)
          </Button>
          <Button size="sm" variant="outline" disabled={!connected || !live || busy !== null} onClick={runSync}>
            {armed ? "Click again to confirm saving" : "Sync Google Reviews now"}
          </Button>
        </div>
        {!live ? <p className="mt-2 text-[12px] text-muted-foreground">Sync is disabled while the mode is {overview.mode}.</p> : null}
      </div>

      <div className="rounded-[var(--radius-md)] border border-border bg-surface p-4">
        <h3 className="text-[14px] font-semibold">Historical backfill — September–October 2026</h3>
        <p className="mt-1 text-[13px] text-muted-foreground">
          The dry-run reconciliation covers all {overview.totals.listings} locations over {SEPT_OCT_2026_WINDOW.from} to {SEPT_OCT_2026_WINDOW.to}. It never writes review data, never changes reporting periods, and never creates duplicates.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" disabled={!connected || overview.mode === "off" || busy !== null} onClick={() => runDry(true)}>
            {busy === "backfill" ? <Loader2 className="animate-spin" /> : <RefreshCw />}Run backfill dry run
          </Button>
          <Button size="sm" variant="outline" disabled>Run live backfill</Button>
        </div>
        <p className="mt-2 text-[12px] text-muted-foreground">
          Live backfill is disabled{overview.liveBackfillAllowed ? " until sync is live and creation is allowed" : " — GBP_ALLOW_LIVE_BACKFILL is not enabled"}.
        </p>
        {report ? <ReportTable report={report} /> : lastRunSummary ? <SummaryTable summary={lastRunSummary} /> : null}
      </div>

      <div className="rounded-[var(--radius-md)] border border-border bg-surface p-4">
        <h3 className="text-[14px] font-semibold">History</h3>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Last successful sync: {formatWhen(overview.lastLiveSuccess?.finishedAt ?? null)}. Last dry run: {formatWhen(overview.lastDryRun?.finishedAt ?? null)}.
        </p>
        {lastRun?.errorCode ? <p className="mt-1 text-[13px] text-status-attention">Latest error: {describeError(lastRun.errorCode)}</p> : null}
        {overview.runs.length ? (
          <ul className="mt-2 divide-y divide-border text-[13px]">
            {overview.runs.slice(0, 10).map((run) => {
              const totals = run.summary ? summaryTotals(run.summary) : null;
              return (
                <li key={run.id} className="flex flex-wrap items-center gap-x-3 py-1.5">
                  <span>{formatWhen(run.startedAt)}</span>
                  <span>{runLabel(run)}</span>
                  <Badge tone={run.status === "succeeded" ? "ready" : run.status === "failed" ? "failed" : "attention"}>{run.status}</Badge>
                  {totals ? <span className="text-muted-foreground">{totals.listings} locations · {totals.fetched} read · {totals.missing} not yet held · {totals.needsReview} to review</span> : null}
                  {run.errorCode ? <span className="text-status-attention">{describeError(run.errorCode)}</span> : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-2 text-[13px] text-muted-foreground">No runs yet.</p>
        )}
      </div>

      <div className="rounded-[var(--radius-md)] border border-border bg-surface p-4">
        <h3 className="text-[14px] font-semibold">Cutover readiness</h3>
        <ul className="mt-2 flex flex-col gap-1 text-[13px]">
          {overview.cutover.checks.map((c) => (
            <li key={c.id} className="flex items-start gap-2">
              {c.status === "pass" ? <CheckCircle2 className="mt-0.5 size-4 text-status-ready" /> : <AlertTriangle className={`mt-0.5 size-4 ${c.status === "fail" ? "text-status-attention" : "text-muted-foreground"}`} />}
              <span><span className="font-medium">{c.label}.</span> <span className="text-muted-foreground">{c.detail}</span></span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[12px] text-muted-foreground">
          {overview.cutover.ready ? "Ready for your approval. " : "Not ready. "}
          Cutover is a deliberate configuration change made after approval, not a button here: set creation on, switch Apify off, then retire Apify once Google has run clean.
        </p>
      </div>
    </section>
  );
}

function SummaryTable({ summary }: { summary: RunSummary }) {
  return (
    <ReportRows
      title="Last backfill dry run"
      rows={summary.locations.map((l) => ({
        storeCode: l.storeCode,
        status: l.status,
        google: l.inWindow?.google ?? l.fetched,
        held: l.inWindow?.alreadyHeld ?? l.alreadyLinked + l.autoMatched,
        missing: l.inWindow?.missing ?? l.newReviews,
        needsReview: l.inWindow?.needsReview ?? l.needsReview,
        complete: l.complete,
      }))}
    />
  );
}

function ReportTable({ report }: { report: ReportLike }) {
  return (
    <ReportRows
      title={`Dry-run report (${report.status})`}
      rows={report.locations.map((l) => ({
        storeCode: l.storeCode,
        status: l.status,
        google: l.inWindow?.google ?? l.fetched,
        held: l.inWindow?.alreadyHeld ?? l.alreadyLinked + l.autoMatched,
        missing: l.inWindow?.missing ?? l.newReviews + l.deferredNewReviews,
        needsReview: l.inWindow?.needsReview ?? l.needsReview,
        complete: l.complete,
      }))}
    />
  );
}

function ReportRows({ title, rows }: { title: string; rows: { storeCode: string; status: string; google: number; held: number; missing: number; needsReview: number; complete: boolean }[] }) {
  return (
    <div className="mt-3 overflow-x-auto">
      <p className="text-[13px] font-medium">{title}</p>
      <table className="mt-1 w-full text-left text-[13px]">
        <thead className="text-muted-foreground">
          <tr><th className="py-1 pr-3">Store</th><th className="pr-3">Status</th><th className="pr-3">On Google</th><th className="pr-3">Already held</th><th className="pr-3">Missing</th><th className="pr-3">To review</th><th>Complete</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.storeCode} className="border-t border-border">
              <td className="py-1 pr-3 font-mono">{r.storeCode}</td><td className="pr-3">{r.status}</td><td className="pr-3">{r.google}</td><td className="pr-3">{r.held}</td><td className="pr-3">{r.missing}</td><td className="pr-3">{r.needsReview}</td><td>{r.complete ? "yes" : "no"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
