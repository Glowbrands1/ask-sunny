"use client";

import Link from "next/link";
import { useState } from "react";
import { AlertTriangle, ArrowLeft, CheckCircle2, ChevronDown, Loader2, PlugZap, RefreshCw, ScanSearch } from "lucide-react";

import { Badge, StatusDot, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/controls";
import { Notice } from "@/components/ui/feedback";
import { PageHeader, PageShell, SectionHeader } from "@/components/ui/layout";
import { CONTENT_TYPES, CONTENT_TYPE_LABEL, type SyncReport } from "@/lib/knowledge-sync/types";
import { CONTENT_SYNC_STATE_LABEL } from "@/lib/knowledge-sync/inventory";
import type { AttentionDetail, AttentionItem } from "@/lib/knowledge-sync/types";
import type { AudienceReview, HeadlineState, WovenKnowledgeStatus } from "@/lib/knowledge-sync/woven/status";
import type { WovenKnowledgePageProps } from "./load";
import { PartPreviewButton } from "./part-preview";
import { ContentTab, HistoryTab, type ContentFocus } from "./woven-knowledge-content";

/**
 * ============================================================================
 * WOVEN KNOWLEDGE SYNC — configure once, then it keeps itself current
 * ============================================================================
 *
 * WRITTEN FOR A BUSY MANAGER. The top of the screen answers three questions —
 * is it working, when did it last run, is anything waiting on me — in plain
 * words and counts. Setup appears only until it is finished. Routes, hashes,
 * capability codes and run history live under "Advanced", closed by default.
 *
 * Every number is read from the server; nothing here is sample data.
 */

const HEADLINE: Record<HeadlineState, { label: string; tone: BadgeTone }> = {
  not_set_up: { label: "Not set up", tone: "outline" },
  setup_in_progress: { label: "Connected", tone: "processing" },
  syncing: { label: "Syncing", tone: "processing" },
  up_to_date: { label: "Up to date", tone: "ready" },
  needs_attention: { label: "Needs attention", tone: "attention" },
};

const CAPABILITY_LABEL: Record<string, string> = {
  file_library_download: "File Library files",
  procedure_attachment_download: "Procedure attachment files (the steps themselves do sync)",
  procedure_content: "Procedures whose page layout is not recognised",
  policy_body: "Policies whose page layout is not recognised (their attachments still sync)",
  knowledge_element_content: "Knowledge Elements of a content type not yet supported",
  course_content: "Course items",
  handbook_no_current_version: "Handbooks with no published version",
};

const DATE = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", year: "numeric" });
const DATE_TIME = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function day(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? "—" : DATE.format(new Date(parsed));
}

function moment(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? "—" : DATE_TIME.format(new Date(parsed));
}

type Action = "test" | "preview" | "sync" | "auto" | "audience" | "confirm";

interface Feedback {
  tone: "accent" | "attention";
  text: string;
}

async function call(path: string, init: RequestInit): Promise<{ ok: boolean; body: Record<string, unknown> | null; status: number }> {
  try {
    const response = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...(init.headers ?? {}) } });
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    return { ok: response.ok, body, status: response.status };
  } catch {
    return { ok: false, body: null, status: 0 };
  }
}

function reasonOf(body: Record<string, unknown> | null, fallback: string): string {
  const reason = body?.reason ?? body?.error;
  return typeof reason === "string" && reason.trim() ? reason : fallback;
}

export function WovenKnowledgeScreen({ liveMode, status: initial }: WovenKnowledgePageProps) {
  const [status, setStatus] = useState<WovenKnowledgeStatus | null>(initial);
  const [busy, setBusy] = useState<Action | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [tab, setTab] = useState("overview");
  /* Where "Show in Content" points; a new nonce opens the tab afresh with that filter. */
  const [contentFocus, setContentFocus] = useState<ContentFocus & { nonce: number }>({ nonce: 0 });
  const openContent = (focus: ContentFocus) => {
    setContentFocus((current) => ({ ...focus, nonce: current.nonce + 1 }));
    setTab("content");
  };
  /** The last Preview-test-mode scan, held only in this page: it is not saved anywhere. */
  const [testReport, setTestReport] = useState<SyncReport | null>(null);

  async function refresh() {
    const result = await call("/api/admin/knowledge-sync/woven", { method: "GET" });
    const sync = result.body?.sync as WovenKnowledgeStatus | undefined;
    if (sync) setStatus(sync);
  }

  async function act(action: Action, run: () => Promise<Feedback>) {
    setBusy(action);
    setFeedback(null);
    try {
      setFeedback(await run());
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  const testConnection = () =>
    act("test", async () => {
      const r = await call("/api/admin/knowledge-sync/woven/test", { method: "POST" });
      if (r.body?.status === "ok") {
        return { tone: "accent", text: `Connected to ${String(r.body.company)}. Woven answered normally.` };
      }
      return { tone: "attention", text: reasonOf(r.body, "The connection test did not succeed.") };
    });

  const runSync = (mode: "preview" | "sync", confirmLargeRemoval = false) =>
    act(confirmLargeRemoval ? "confirm" : mode, async () => {
      const r = await call("/api/admin/knowledge-sync/woven/run", { method: "POST", body: JSON.stringify({ mode, confirmLargeRemoval }) });
      const outcome = String(r.body?.status ?? "");
      if (r.body?.previewTestMode === true) {
        setTestReport((r.body.report as SyncReport | undefined) ?? null);
        if (outcome === "failed") return { tone: "attention", text: reasonOf(r.body, "The scan did not finish.") };
        return { tone: "accent", text: "Scan finished in Preview test mode. The counts are below; nothing was saved." };
      }
      if (outcome === "succeeded" || (mode === "preview" && outcome === "succeeded_with_warnings")) {
        return {
          tone: "accent",
          text: mode === "preview" ? "Scan finished. Nothing in Ask Sunny was changed — see what Sync Now would do below." : "Sync finished. Ask Sunny is up to date.",
        };
      }
      if (outcome === "succeeded_with_warnings") return { tone: "attention", text: "Sync finished, with a few things to look at below." };
      if (outcome === "busy") return { tone: "attention", text: "A sync is already running. It will finish on its own." };
      return { tone: "attention", text: reasonOf(r.body, "The sync did not finish.") };
    });

  const setAuto = (enabled: boolean) =>
    act("auto", async () => {
      const r = await call("/api/admin/knowledge-sync/woven", { method: "PATCH", body: JSON.stringify({ autoSyncEnabled: enabled }) });
      if (!r.ok) return { tone: "attention", text: reasonOf(r.body, "The setting could not be saved.") };
      return { tone: "accent", text: enabled ? "Automatic sync is on. Ask Sunny will check Woven every 30 days." : "Automatic sync is off." };
    });

  const decide = (audience: AudienceReview, decision: AudienceReview["decision"]) =>
    act("audience", async () => {
      const r = await call("/api/admin/knowledge-sync/woven/audiences", { method: "PUT", body: JSON.stringify({ audienceKey: audience.audienceKey, decision }) });
      if (!r.ok) return { tone: "attention", text: reasonOf(r.body, "The choice could not be saved.") };
      return {
        tone: "accent",
        text:
          decision === "company_wide"
            ? `“${audience.label}” items will be added on the next sync.`
            : decision === "excluded"
              ? `“${audience.label}” items will stay out of Ask Sunny.`
              : `“${audience.label}” is back to waiting for a decision.`,
      };
    });

  return (
    <PageShell>
      <Link href="/admin/integrations" className="mb-3 inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" />
        Integrations
      </Link>
      <PageHeader
        eyebrow="Admin · Integrations"
        title="Woven Knowledge Sync"
        description="Woven is where policies, handbooks and training live. Ask Sunny checks it every 30 days and keeps its own knowledge base current — no uploads, no comparing versions."
      />

      {!liveMode ? (
        <Notice tone="attention" icon={<AlertTriangle />} title="Demo mode" className="mb-6">
          This deployment runs in demo mode, so it does not connect to Woven.
        </Notice>
      ) : null}
      {!status ? (
        <Notice tone="attention" icon={<AlertTriangle />} title="Database not configured" className="mb-6">
          Ask Sunny&apos;s database is not configured for this deployment.
        </Notice>
      ) : status.previewTestMode ? (
        <PreviewTestPanel status={status} busy={busy} canAct={liveMode} report={testReport} onTest={testConnection} onScan={() => runSync("preview")} />
      ) : status.database !== "ready" ? (
        <Notice tone="attention" icon={<AlertTriangle />} title="Not installed yet" className="mb-6">
          {status.database === "missing"
            ? "The Woven sync's storage has not been added to the database yet. That is a one-time step for whoever maintains Ask Sunny."
            : "The sync's status could not be read just now. Try again in a moment."}
        </Notice>
      ) : null}

      {feedback ? (
        <Notice tone={feedback.tone} className="mb-6" icon={feedback.tone === "accent" ? <CheckCircle2 /> : <AlertTriangle />}>
          <span role="status">{feedback.text}</span>
        </Notice>
      ) : null}

      {status && status.database === "ready" ? (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList aria-label="Woven Knowledge Sync views" className="mb-1">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="content">Content</TabsTrigger>
            <TabsTrigger value="history">Sync History</TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <StatusPanel
              status={status}
              busy={busy}
              canAct={liveMode}
              onSyncNow={() => runSync("sync")}
              onScan={() => runSync("preview")}
              showDetails={showDetails}
              onToggleDetails={() => setShowDetails((v) => !v)}
            />

            {status.settings?.initialSyncCompletedAt && status.latestPreview ? <ScanPlanPanel status={status} /> : null}

            {status.attention.length > 0 || status.audienceReviews.length > 0 ? (
              <AttentionPanel
                status={status}
                busy={busy}
                onDecide={decide}
                onConfirmRemoval={() => runSync("sync", true)}
                onOpenContent={openContent}
              />
            ) : null}

            {status.setupStep !== "done" ? (
              <SetupPanel status={status} busy={busy} canAct={liveMode} onTest={testConnection} onScan={() => runSync("preview")} onInitialSync={() => runSync("sync")} onEnableAuto={() => setAuto(true)} />
            ) : (
              <div className="mb-8 flex flex-wrap items-center gap-3 text-[13px] text-muted-foreground">
                <span>Automatic sync is on — every {status.settings?.intervalDays ?? 30} days.</span>
                <Button variant="ghost" size="sm" disabled={busy !== null || !liveMode} onClick={() => setAuto(false)}>
                  Turn off
                </Button>
              </div>
            )}

            {showDetails ? <DetailsPanel status={status} /> : null}
            <AdvancedPanel status={status} />
          </TabsContent>

          <TabsContent value="content">
            <ContentTab
              key={`${status.advanced.recentRuns[0]?.id ?? "none"}-${contentFocus.nonce}`}
              active={tab === "content"}
              focus={contentFocus}
            />
          </TabsContent>

          <TabsContent value="history">
            <HistoryTab runs={status.advanced.recentRuns} />
          </TabsContent>
        </Tabs>
      ) : null}
    </PageShell>
  );
}

/* ---------------------------------------------------- preview test mode -- */

/**
 * Shown on a Preview (never Production) deployment whose database does not
 * have the sync tables. Test Connection and Run Initial Scan read the real
 * Woven and show what they found; nothing is saved and nothing reaches Ask
 * Sunny's knowledge base.
 */
function PreviewTestPanel(props: {
  status: WovenKnowledgeStatus;
  busy: Action | null;
  canAct: boolean;
  report: SyncReport | null;
  onTest: () => void;
  onScan: () => void;
}) {
  const { status, report } = props;
  const configured = status.enabled && status.missingCredentials.length === 0;
  const disabled = !props.canAct || !configured || props.busy !== null;
  return (
    <section className="mb-8" aria-label="Preview test mode">
      <Notice tone="attention" icon={<AlertTriangle />} title="Preview test mode — results are not saved" className="mb-4">
        This Preview deployment does not have the Woven sync&apos;s storage installed. You can test the connection and
        run the initial scan against the real Woven. The results are shown here only; nothing is saved and nothing is
        added to Ask Sunny.
      </Notice>
      {!configured ? (
        <p className="mb-3 text-[13px] text-muted-foreground">
          Add {[...(status.enabled ? [] : ["WOVEN_KNOWLEDGE_SYNC_ENABLED=true"]), ...status.missingCredentials].join(", ")} to this Preview deployment, then redeploy.
        </p>
      ) : null}
      <div className="mb-4 flex flex-wrap gap-2">
        <Button onClick={props.onTest} disabled={disabled}>
          {props.busy === "test" ? <Loader2 className="animate-spin" /> : <PlugZap />}
          Test Connection
        </Button>
        <Button variant="outline" onClick={props.onScan} disabled={disabled}>
          {props.busy === "preview" ? <Loader2 className="animate-spin" /> : <ScanSearch />}
          Run Initial Scan
        </Button>
      </div>
      {report ? (
        <div className="rounded-[var(--radius-md)] border border-border bg-surface p-4 text-[13px]">
          <p className="mb-2 font-semibold">
            Scan result{report.company?.companyLabel ? ` — ${report.company.companyLabel}` : ""}
          </p>
          {report.attention.length > 0 ? (
            <ul className="mb-3 flex flex-col gap-1">
              {report.attention.map((a) => (
                <li key={a.code} className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-status-attention" />
                  <span>
                    {a.message} <span className="font-mono text-[11px] text-muted-foreground">({a.code})</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          <PreviewSummary report={report} awaitingAudience={report.totals.needsReview} />
          <p className="mt-2 font-mono text-[11px] text-muted-foreground">
            {report.requestsMade} Woven requests · {Math.round(report.durationMs / 1000)} s
          </p>
        </div>
      ) : null}
    </section>
  );
}

/* ---------------------------------------------------------------- status -- */

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2.5">
      <dt className="text-[10px] font-semibold tracking-[0.07em] text-muted-foreground uppercase">{label}</dt>
      <dd className="mt-1 text-[17px] leading-tight font-semibold tabular-nums break-words">{value}</dd>
    </div>
  );
}

function StatusPanel(props: {
  status: WovenKnowledgeStatus;
  busy: Action | null;
  canAct: boolean;
  onSyncNow: () => void;
  onScan: () => void;
  showDetails: boolean;
  onToggleDetails: () => void;
}) {
  const { status } = props;
  const headline = HEADLINE[status.headline];
  const initialDone = Boolean(status.settings?.initialSyncCompletedAt);

  return (
    <section aria-label="Sync status" className="mb-8 rounded-[var(--radius-md)] border border-border bg-surface p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone={headline.tone} size="md" data-testid="headline">
            <StatusDot />
            {headline.label}
          </Badge>
          <span className="text-[13px] text-muted-foreground">Company: {status.company}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {initialDone ? (
            <Button variant="outline" onClick={props.onScan} disabled={!props.canAct || props.busy !== null || status.running !== null}>
              {props.busy === "preview" ? <Loader2 className="animate-spin" /> : <ScanSearch />}
              Scan Woven
            </Button>
          ) : null}
          <Button onClick={props.onSyncNow} disabled={!props.canAct || !initialDone || props.busy !== null || status.running !== null}>
            {props.busy === "sync" ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            Sync Now
          </Button>
          <Button variant="outline" onClick={props.onToggleDetails} aria-expanded={props.showDetails}>
            {props.showDetails ? "Hide Sync Details" : "View Sync Details"}
          </Button>
        </div>
      </div>
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Last successful sync" value={day(status.lastSuccessAt)} />
        <Stat label="Next automatic sync" value={status.nextSyncAt ? day(status.nextSyncAt) : initialDone ? "Off" : "After setup"} />
        <Stat label="Documents in sync" value={String(status.documentsInSync)} />
        <Stat label="Needs attention" value={String(status.needsAttention)} />
        <Stat label="New last sync" value={status.lastSync ? String(status.lastSync.new) : "—"} />
        <Stat label="Updated last sync" value={status.lastSync ? String(status.lastSync.updated) : "—"} />
        <Stat label="Removed last sync" value={status.lastSync ? String(status.lastSync.removed) : "—"} />
        <Stat label="Last checked Woven" value={day(status.lastCheckedAt)} />
      </dl>
      {initialDone ? (
        <p className="mt-3 text-[12px] text-muted-foreground">
          <strong>Scan Woven</strong> previews what changed — nothing is added, removed or replaced in Ask Sunny, and the next automatic sync date does not move.{" "}
          <strong>Sync Now</strong> applies the changes.
        </p>
      ) : null}
      {status.running ? (
        <p className="mt-3 text-[13px] text-muted-foreground">A sync has been running since {moment(status.running.since)}. It finishes on its own.</p>
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------ scan plan -- */

/** After setup: the latest Scan Woven, when it is newer than the last sync — what Sync Now would do. */
function ScanPlanPanel({ status }: { status: WovenKnowledgeStatus }) {
  const t = status.latestPreview!.totals;
  const lines: [string, number][] = [
    ["Add to Ask Sunny", t.new],
    ["Update in Ask Sunny", t.updated],
    ["Take out of Ask Sunny (unpublished, removed or narrowed in Woven)", t.unpublished + t.removed + t.permissionChanged],
    ["Leave as they are (unchanged)", t.unchanged],
    ["Wait for an audience choice", t.needsReview],
    ["Not yet supported", t.blocked],
    ["Could not be read", t.errors],
  ];
  return (
    <section aria-label="What Sync Now would do" className="mb-8 rounded-[var(--radius-md)] border border-border bg-surface p-4">
      <p className="text-[14px] font-semibold">Latest scan{status.latestScanAt ? ` — ${moment(status.latestScanAt)}` : ""}: what Sync Now would do</p>
      <p className="mb-3 text-[12px] text-muted-foreground">Nothing has been changed yet. The Content tab shows each item under this scan.</p>
      <dl className="grid gap-x-6 gap-y-1 text-[13px] sm:grid-cols-2">
        {lines.map(([label, n]) => (
          <div key={label} className="flex justify-between gap-3 border-b border-border py-1">
            <dt>{label}</dt>
            <dd className="font-semibold tabular-nums">{n}</dd>
          </div>
        ))}
      </dl>
      {status.scanProblems.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-1 text-[13px]">
          {status.scanProblems.map((p) => (
            <li key={p} className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-status-attention" />
              {p}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------- attention -- */

function AttentionPanel(props: {
  status: WovenKnowledgeStatus;
  busy: Action | null;
  onDecide: (audience: AudienceReview, decision: AudienceReview["decision"]) => void;
  onConfirmRemoval: () => void;
  onOpenContent: (focus: ContentFocus) => void;
}) {
  const { status } = props;
  const undecided = status.audienceReviews.filter((a) => a.decision === null && a.items > 0);
  const decided = status.audienceReviews.filter((a) => a.decision !== null);
  const massRemoval = status.attention.find((a) => a.code === "mass_removal_held");

  return (
    <section className="mb-8">
      <SectionHeader title="Needs attention" description="Only these need a person. Everything else is handled automatically." />
      <ul className="mb-4 flex flex-col gap-2">
        {status.attention.map((item) => (
          <li key={item.code} className="rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2.5 text-[14px]" data-testid={`attention-${item.code}`}>
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-status-attention" />
              <span>{item.message}</span>
            </div>
            {item.items && item.items.length > 0 ? <AttentionDetails item={item} onOpenContent={props.onOpenContent} /> : null}
          </li>
        ))}
      </ul>

      {massRemoval ? (
        <div className="mb-4">
          <Button variant="destructive" size="sm" disabled={props.busy !== null} onClick={props.onConfirmRemoval}>
            Yes, remove them from Ask Sunny
          </Button>
        </div>
      ) : null}

      {undecided.length > 0 ? (
        <div className="rounded-[var(--radius-md)] border border-border bg-surface">
          <p className="border-b border-border px-4 py-3 text-[13px] leading-relaxed text-muted-foreground">
            Woven shares these only with certain teams or positions. Ask Sunny can&apos;t limit a document to those
            same people yet, so it either shares it with <strong>everyone who uses Ask Sunny</strong> or leaves it out.
            You decide once per audience; new items with the same audience follow your choice.
          </p>
          <ul className="divide-y divide-border">
            {undecided.map((audience) => (
              <li key={audience.audienceKey} className="px-4 py-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-[14px] font-semibold">{audience.label}</p>
                    <p className="text-[13px] text-muted-foreground">
                      {audience.items} item{audience.items === 1 ? "" : "s"}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" disabled={props.busy !== null} onClick={() => props.onDecide(audience, "company_wide")}>
                      Share with everyone
                    </Button>
                    <Button size="sm" variant="outline" disabled={props.busy !== null} onClick={() => props.onDecide(audience, "excluded")}>
                      Keep out of Ask Sunny
                    </Button>
                  </div>
                </div>
                <AudienceMembers audience={audience} onOpenContent={props.onOpenContent} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {decided.length > 0 ? (
        <details className="mt-3 text-[13px]">
          <summary className="cursor-pointer text-muted-foreground">Audience choices already made ({decided.length})</summary>
          <ul className="mt-2 flex flex-col gap-1.5">
            {decided.map((audience) => (
              <li key={audience.audienceKey} className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{audience.label}</span>
                <Badge tone={audience.decision === "company_wide" ? "ready" : "neutral"}>
                  {audience.decision === "company_wide" ? "Shared with everyone" : "Kept out"}
                </Badge>
                <Button size="sm" variant="ghost" disabled={props.busy !== null} onClick={() => props.onDecide(audience, null)}>
                  Change
                </Button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

const RETRY_LABEL: Record<AttentionDetail["retry"], { label: string; tone: BadgeTone }> = {
  retrying: { label: "Retrying automatically", tone: "processing" },
  stopped: { label: "Stopped retrying — needs a person", tone: "attention" },
  queued: { label: "Queued", tone: "processing" },
};

function AttentionDetails({ item, onOpenContent }: { item: AttentionItem; onOpenContent: (focus: ContentFocus) => void }) {
  return (
    <ul className="mt-2 ml-6 flex flex-col gap-2 text-[13px]" aria-label={`Items: ${item.message}`}>
      {item.items!.map((d, i) => (
        <li key={`${d.rowKey}-${i}`} className="rounded-[var(--radius-sm)] bg-surface-muted px-3 py-2">
          <p className="font-medium">{d.title}</p>
          <p className="text-muted-foreground">
            {CONTENT_TYPE_LABEL[d.contentType]} · {d.reason}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Badge tone={RETRY_LABEL[d.retry].tone}>{RETRY_LABEL[d.retry].label}</Badge>
            {d.nextRetryAt ? <span className="text-[12px] text-muted-foreground">Next try {moment(d.nextRetryAt)}</span> : null}
            <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[12px]" onClick={() => onOpenContent({ search: d.title })}>
              Show in Content
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** "View items": what an audience choice would share or keep out, by title — each previewable before deciding. */
function AudienceMembers({ audience, onOpenContent }: { audience: AudienceReview; onOpenContent: (focus: ContentFocus) => void }) {
  const [open, setOpen] = useState(false);
  const members = audience.members ?? [];
  const total = audience.membersTotal ?? members.length;
  if (total === 0) return null;
  return (
    <div className="mt-2">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="ghost" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          <ChevronDown className={`size-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
          {open ? "Hide items" : `View items (${total} in Woven)`}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onOpenContent({ audienceKey: audience.audienceKey })}>
          Show in Content
        </Button>
      </div>
      {open ? (
        <ul className="mt-2 flex flex-col gap-2 text-[13px]" aria-label={`Items with audience ${audience.label}`}>
          {members.map((m) => (
            <li key={m.key} className="rounded-[var(--radius-sm)] bg-surface-muted px-3 py-2">
              <p className="font-medium">{m.title}</p>
              <p className="text-muted-foreground">
                {CONTENT_TYPE_LABEL[m.contentType]} · {m.wovenStatus ?? "No Woven status"} · {CONTENT_SYNC_STATE_LABEL[m.syncState]}
              </p>
              <div className="mt-1 flex flex-wrap gap-x-3">
                {m.parts
                  .filter((p) => p.previewable || p.askSunnyDocumentId)
                  .map((p) => (
                    <PartPreviewButton
                      key={p.key}
                      part={p}
                      label={m.parts.length > 1 ? `Preview ${p.kind === "body" ? (m.contentType === "procedure" ? "step text" : "text") : (p.fileName ?? p.title)}` : "Preview"}
                    />
                  ))}
              </div>
            </li>
          ))}
          {total > members.length ? (
            <li className="text-muted-foreground">
              And {total - members.length} more — <button type="button" className="underline" onClick={() => onOpenContent({ audienceKey: audience.audienceKey })}>see them all in Content</button>.
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}

/* ----------------------------------------------------------------- setup -- */

type StepState = "done" | "current" | "later";

function SetupStep({ n, title, state, children }: { n: number; title: string; state: StepState; children: React.ReactNode }) {
  return (
    <li className="flex gap-3 px-4 py-3">
      <span
        className={`flex size-6 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold ${
          state === "done" ? "bg-status-ready-bg text-status-ready" : state === "current" ? "bg-accent-soft text-accent-soft-foreground" : "bg-surface-muted text-muted-foreground"
        }`}
        aria-hidden
      >
        {state === "done" ? "✓" : n}
      </span>
      <div className="min-w-0 flex-1">
        <p className={`text-[14px] font-semibold ${state === "later" ? "text-muted-foreground" : ""}`}>{title}</p>
        {state === "current" ? <div className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{children}</div> : null}
      </div>
    </li>
  );
}

function SetupPanel(props: {
  status: WovenKnowledgeStatus;
  busy: Action | null;
  canAct: boolean;
  onTest: () => void;
  onScan: () => void;
  onInitialSync: () => void;
  onEnableAuto: () => void;
}) {
  const { status } = props;
  const order = ["connect", "scan", "initial_sync", "enable_auto"] as const;
  const at = order.indexOf(status.setupStep as (typeof order)[number]);
  const stateOf = (i: number): StepState => (i < at ? "done" : i === at ? "current" : "later");
  const disabled = !props.canAct || props.busy !== null || status.running !== null;
  const configured = status.enabled && status.missingCredentials.length === 0;

  return (
    <section className="mb-8">
      <SectionHeader title="First-time setup" description="Four steps, once. After that the sync runs by itself." />
      <ol className="flex flex-col divide-y divide-border rounded-[var(--radius-md)] border border-border bg-surface">
        <SetupStep n={1} title="Connect to Woven" state={stateOf(0)}>
          {configured ? (
            <>
              <p>The Woven sign-in for the Ask Sunny integration account is in place. Check it works:</p>
              <Button className="mt-2" size="sm" onClick={props.onTest} disabled={disabled}>
                {props.busy === "test" ? <Loader2 className="animate-spin" /> : <PlugZap />}
                Test Connection
              </Button>
            </>
          ) : (
            <p>
              Whoever maintains Ask Sunny adds the Woven sign-in for a dedicated integration account once, as protected
              settings in Vercel{status.missingCredentials.length > 0 ? ` (${status.missingCredentials.join(", ")})` : ""}
              {!status.enabled ? " and switches the sync on (WOVEN_KNOWLEDGE_SYNC_ENABLED)" : ""}. Nobody needs to sign in to Woven again after that.
            </p>
          )}
        </SetupStep>
        <SetupStep n={2} title="Run the initial scan" state={stateOf(1)}>
          <p>Reads everything in Woven and shows what would be added — without changing anything.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" onClick={props.onScan} disabled={disabled}>
              {props.busy === "preview" ? <Loader2 className="animate-spin" /> : <ScanSearch />}
              Run Initial Scan
            </Button>
            <Button size="sm" variant="ghost" onClick={props.onTest} disabled={disabled}>
              Test Connection
            </Button>
          </div>
        </SetupStep>
        <SetupStep n={3} title="Review the counts and start the initial sync" state={stateOf(2)}>
          {status.latestPreview ? <PreviewSummary report={status.latestPreview} awaitingAudience={status.awaitingAudience} /> : null}
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" onClick={props.onInitialSync} disabled={disabled}>
              {props.busy === "sync" ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              Start Initial Sync
            </Button>
            <Button size="sm" variant="ghost" onClick={props.onScan} disabled={disabled}>
              Scan again
            </Button>
          </div>
        </SetupStep>
        <SetupStep n={4} title="Turn on automatic sync" state={stateOf(3)}>
          <p>Ask Sunny will check Woven every 30 days and keep itself current. You only hear from it if something needs you.</p>
          <Button className="mt-2" size="sm" onClick={props.onEnableAuto} disabled={disabled}>
            Enable Automatic Sync
          </Button>
        </SetupStep>
      </ol>
    </section>
  );
}

function PreviewSummary({ report, awaitingAudience }: { report: SyncReport; awaitingAudience: number }) {
  const rows = CONTENT_TYPES.map((type) => ({ type, r: report.byType[type] })).filter((row) => row.r);
  const decided = report.totals.needsReview - awaitingAudience;
  return (
    <div className="mt-1">
      <p className="mb-2">
        <strong>{report.totals.new}</strong> document{report.totals.new === 1 ? "" : "s"} ready to add.{" "}
        {awaitingAudience > 0
          ? `${awaitingAudience} wait for an audience choice above, and are not added until you choose. `
          : report.totals.needsReview > 0
            ? "Every audience has a choice. "
            : ""}
        {decided > 0 ? `${decided} follow the audience choices already made. ` : ""}
        {report.possibleManualDuplicates > 0
          ? `${report.possibleManualDuplicates} share a title with a document someone already uploaded by hand — you may want to remove the manual copy afterwards.`
          : ""}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-left text-[13px]">
          <thead>
            <tr className="text-muted-foreground">
              <th className="py-1 pr-3 font-medium">In Woven</th>
              <th className="py-1 pr-3 font-medium">Found</th>
              <th className="py-1 pr-3 font-medium">Will sync</th>
              <th className="py-1 pr-3 font-medium">Drafts / unpublished</th>
              <th className="py-1 pr-3 font-medium">Audience choice</th>
              <th className="py-1 font-medium">Not yet supported</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ type, r }) => (
              <tr key={type} className="border-t border-border text-foreground tabular-nums">
                <td className="py-1 pr-3">{CONTENT_TYPE_LABEL[type]}</td>
                <td className="py-1 pr-3">
                  {r!.listing === "failed" ? (
                    <>
                      Could not read{r!.listingCode ? <span className="font-mono text-[11px] text-muted-foreground"> ({r!.listingCode})</span> : null}
                    </>
                  ) : (
                    r!.discovered
                  )}
                </td>
                <td className="py-1 pr-3">{r!.new + r!.updated + r!.unchanged}</td>
                <td className="py-1 pr-3">{r!.excludedUnpublished}</td>
                <td className="py-1 pr-3">{r!.needsReview}</td>
                <td className="py-1">{r!.blocked + r!.excludedUnsupported}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- details -- */

function DetailsPanel({ status }: { status: WovenKnowledgeStatus }) {
  const byType = status.advanced.byType;
  return (
    <section className="mb-8" aria-label="Sync details">
      <SectionHeader title="Sync details" description="What the most recent check of Woven found." />
      {byType ? (
        <div className="mb-4 overflow-x-auto rounded-[var(--radius-md)] border border-border bg-surface">
          <table className="w-full min-w-[620px] text-left text-[13px]">
            <thead>
              <tr className="text-muted-foreground">
                {["", "Found", "New", "Updated", "Unchanged", "Removed", "Audience choice", "Not yet supported", "Problems"].map((h) => (
                  <th key={h} className="px-3 py-2 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {CONTENT_TYPES.map((type) => {
                const r = byType[type];
                if (!r) return null;
                return (
                  <tr key={type} className="border-t border-border tabular-nums">
                    <td className="px-3 py-2 font-medium">{CONTENT_TYPE_LABEL[type]}</td>
                    <td className="px-3 py-2">{r.listing === "failed" ? "—" : r.discovered}</td>
                    <td className="px-3 py-2">{r.new}</td>
                    <td className="px-3 py-2">{r.updated}</td>
                    <td className="px-3 py-2">{r.unchanged}</td>
                    <td className="px-3 py-2">{r.removed + r.unpublished + r.permissionChanged}</td>
                    <td className="px-3 py-2">{r.needsReview}</td>
                    <td className="px-3 py-2">{r.blocked + r.excludedUnsupported}</td>
                    <td className="px-3 py-2">{r.listing === "ok" ? r.errors : r.listing === "failed" ? "Could not read" : "Removals held"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mb-4 text-[13px] text-muted-foreground">No sync has run yet.</p>
      )}
      {status.advanced.failingItems.length > 0 ? (
        <>
          <p className="mb-2 text-[14px] font-semibold">Documents that did not sync</p>
          <ul className="flex flex-col gap-1.5 text-[13px]">
            {status.advanced.failingItems.map((item, i) => (
              <li key={`${item.title}-${i}`} className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{item.title}</span>
                <span className="text-muted-foreground">{CONTENT_TYPE_LABEL[item.contentType]}</span>
                <Badge tone={item.willRetry ? "processing" : "attention"}>{item.willRetry ? "Retrying automatically" : "Stopped retrying"}</Badge>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

function AdvancedPanel({ status }: { status: WovenKnowledgeStatus }) {
  const blocked = Object.entries(status.advanced.blockedByCapability);
  return (
    <details className="group mb-8 rounded-[var(--radius-md)] border border-border bg-surface">
      <summary className="flex cursor-pointer items-center justify-between px-4 py-3 text-[14px] font-semibold">
        Advanced
        <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t border-border px-4 py-3 text-[13px]">
        <p className="mb-1 font-semibold">Tracked, but not yet brought into Ask Sunny</p>
        {blocked.length === 0 ? (
          <p className="mb-3 text-muted-foreground">Nothing.</p>
        ) : (
          <ul className="mb-3 list-disc pl-5">
            {blocked.map(([capability, count]) => (
              <li key={capability}>
                {CAPABILITY_LABEL[capability] ?? capability}: {count} <span className="font-mono text-[12px] text-muted-foreground">({capability})</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mb-1 font-semibold">Schedule</p>
        <p className="mb-3 text-muted-foreground">
          {status.advanced.scheduleDeployed
            ? "The hourly check is deployed. It runs a full scan and sync once 30 days have passed (in its 09:40 UTC run), and every hour in between it finishes unfinished work and retries failed items — without rescanning Woven."
            : "The hourly check is not deployed in this build yet, so automatic sync will not run until it is."}
        </p>
        {status.advanced.problems.length > 0 ? (
          <>
            <p className="mb-1 font-semibold">Configuration</p>
            <ul className="mb-3 list-disc pl-5">
              {status.advanced.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </>
        ) : null}
        <p className="mb-1 font-semibold">Recent runs</p>
        {status.advanced.recentRuns.length === 0 ? (
          <p className="text-muted-foreground">None yet.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {status.advanced.recentRuns.map((run) => (
              <li key={run.id} className="font-mono text-[12px] break-words">
                {moment(run.startedAt)} · {run.mode}/{run.trigger} · {run.status}
                {run.errorCode ? ` · ${run.errorCode}` : ""}
                {run.totals ? ` · new ${run.totals.new}, updated ${run.totals.updated}, errors ${run.totals.errors}, deferred ${run.totals.deferred}` : ""}
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
