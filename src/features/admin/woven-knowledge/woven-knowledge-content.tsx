"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, Loader2 } from "lucide-react";

import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/feedback";
import { Input, Select } from "@/components/ui/field";
import { ScrollTable } from "@/components/ui/layout";
import { CONTENT_SYNC_STATE_LABEL, type ContentRow, type ContentSyncState } from "@/lib/knowledge-sync/inventory";
import { CONTENT_TYPES, CONTENT_TYPE_LABEL, type ContentType } from "@/lib/knowledge-sync/types";
import type { RunSummary, WovenKnowledgeContent } from "@/lib/knowledge-sync/woven/status";

/**
 * ============================================================================
 * CONTENT AND SYNC HISTORY — what Woven holds, and what each sync did
 * ============================================================================
 *
 * CONTENT lists every Woven item the latest scan or sync found, by its own
 * title: one row per item, a policy and its attachments together, with a plain
 * sync state. Before the initial sync it shows what the latest dry run found,
 * so the list can be checked before anything is added.
 *
 * DATES ARE WOVEN'S OR NONE. A missing Woven date reads "Updated date
 * unavailable"; nothing is filled in from elsewhere.
 */

const DATE = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", year: "numeric" });
const DATE_TIME = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function day(value: string | null | undefined, fallback = "—"): string {
  if (!value) return fallback;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? fallback : DATE.format(new Date(parsed));
}

function moment(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? "—" : DATE_TIME.format(new Date(parsed));
}

export const SYNC_STATE_TONE: Record<ContentSyncState, BadgeTone> = {
  up_to_date: "ready",
  new: "processing",
  updated: "processing",
  waiting_for_audience: "attention",
  kept_out: "neutral",
  not_supported: "outline",
  unpublished: "neutral",
  retired: "neutral",
  stale: "neutral",
  error: "attention",
};

const PART_KIND_LABEL: Record<ContentRow["parts"][number]["kind"], string> = {
  body: "Text",
  attachment: "Attachment",
  file: "File",
  version: "Published version",
  other: "Part",
  superseded_copy: "Previous uploaded copy",
};

type DecisionFilter = "all" | "public" | "company_wide" | "excluded" | "waiting";

const DECISION_LABEL: Record<Exclude<DecisionFilter, "all">, string> = {
  public: "Public in Woven",
  company_wide: "Shared with everyone",
  excluded: "Kept out",
  waiting: "Waiting for a choice",
};

function decisionOf(row: ContentRow): Exclude<DecisionFilter, "all"> {
  return row.audienceDecision === null ? "waiting" : row.audienceDecision;
}

const PAGE = 100;

export function ContentTab({ active }: { active: boolean }) {
  const [content, setContent] = useState<WovenKnowledgeContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requested = useRef(false);
  const [query, setQuery] = useState("");
  const [type, setType] = useState<ContentType | "all">("all");
  const [state, setState] = useState<ContentSyncState | "all">("all");
  const [publication, setPublication] = useState<"all" | "published" | "draft">("all");
  const [decision, setDecision] = useState<DecisionFilter>("all");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [shown, setShown] = useState(PAGE);

  /* Loaded the first time the tab is opened, once. */
  useEffect(() => {
    if (!active || requested.current) return;
    requested.current = true;
    fetch("/api/admin/knowledge-sync/woven/content", { headers: { "Content-Type": "application/json" } })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as { content?: WovenKnowledgeContent; reason?: string } | null;
        if (!response.ok || !body?.content) throw new Error(body?.reason ?? "The content list could not be loaded.");
        setContent(body.content);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "The content list could not be loaded."));
  }, [active]);
  const loading = active && content === null && error === null;

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (content?.rows ?? []).filter(
      (row) =>
        (!q || row.title.toLowerCase().includes(q) || row.parts.some((p) => p.title.toLowerCase().includes(q))) &&
        (type === "all" || row.contentType === type) &&
        (state === "all" || row.syncState === state || row.parts.some((p) => p.syncState === state)) &&
        (publication === "all" || (publication === "published") === row.published) &&
        (decision === "all" || decisionOf(row) === decision),
    );
  }, [content, query, type, state, publication, decision]);

  if (loading && !content) {
    return (
      <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading what Woven holds…
      </p>
    );
  }
  if (error) {
    return (
      <Notice tone="attention" icon={<AlertTriangle />}>
        {error}
      </Notice>
    );
  }
  if (!content || content.basis === "none") {
    return <p className="text-[13px] text-muted-foreground">Nothing yet. Run the initial scan to see what Woven holds.</p>;
  }

  const toggle = (key: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <section aria-label="Woven content">
      <p className="mb-3 text-[13px] text-muted-foreground">
        {content.basis === "latest_scan"
          ? `What the latest scan found in Woven (${day(content.scannedAt)}). Nothing below has been added to Ask Sunny yet.`
          : `Everything the sync tracks in Woven, as of ${day(content.scannedAt)}.`}{" "}
        {content.rows.length} item{content.rows.length === 1 ? "" : "s"}.
      </p>

      <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <Input aria-label="Search by title" placeholder="Search by title" value={query} onChange={(e) => (setQuery(e.target.value), setShown(PAGE))} />
        <Select aria-label="Content type" value={type} onChange={(e) => (setType(e.target.value as ContentType | "all"), setShown(PAGE))}>
          <option value="all">All types</option>
          {CONTENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {CONTENT_TYPE_LABEL[t]}
            </option>
          ))}
        </Select>
        <Select aria-label="Sync state" value={state} onChange={(e) => (setState(e.target.value as ContentSyncState | "all"), setShown(PAGE))}>
          <option value="all">Any sync state</option>
          {(Object.keys(CONTENT_SYNC_STATE_LABEL) as ContentSyncState[]).map((s) => (
            <option key={s} value={s}>
              {CONTENT_SYNC_STATE_LABEL[s]}
            </option>
          ))}
        </Select>
        <Select aria-label="Published or draft" value={publication} onChange={(e) => (setPublication(e.target.value as "all" | "published" | "draft"), setShown(PAGE))}>
          <option value="all">Published and drafts</option>
          <option value="published">Published</option>
          <option value="draft">Draft / unpublished</option>
        </Select>
        <Select aria-label="Audience decision" value={decision} onChange={(e) => (setDecision(e.target.value as DecisionFilter), setShown(PAGE))}>
          <option value="all">Any audience</option>
          {(Object.keys(DECISION_LABEL) as Exclude<DecisionFilter, "all">[]).map((d) => (
            <option key={d} value={d}>
              {DECISION_LABEL[d]}
            </option>
          ))}
        </Select>
      </div>

      <p className="mb-2 text-[12px] text-muted-foreground" role="status">
        Showing {Math.min(shown, rows.length)} of {rows.length}
      </p>
      <ScrollTable>
        <table className="w-full min-w-[1100px] text-left text-[13px]">
          <thead>
            <tr className="text-muted-foreground">
              {["Title", "Type", "Woven status", "Audience", "Version", "Woven last updated", "First seen", "Last seen", "Last synced", "Sync state", "In Ask Sunny"].map((h) => (
                <th key={h} className="px-3 py-2 font-medium whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, shown).map((row) => {
              const expanded = open.has(row.key);
              return (
                <ContentRowView key={row.key} row={row} expanded={expanded} onToggle={() => toggle(row.key)} />
              );
            })}
          </tbody>
        </table>
      </ScrollTable>
      {rows.length > shown ? (
        <Button className="mt-3" size="sm" variant="outline" onClick={() => setShown((n) => n + PAGE)}>
          Show {Math.min(PAGE, rows.length - shown)} more
        </Button>
      ) : null}
    </section>
  );
}

function ContentRowView({ row, expanded, onToggle }: { row: ContentRow; expanded: boolean; onToggle: () => void }) {
  const multi = row.parts.length > 1;
  return (
    <>
      <tr className="border-t border-border align-top" data-testid="content-row">
        <td className="px-3 py-2">
          {multi ? (
            <button type="button" onClick={onToggle} aria-expanded={expanded} className="inline-flex items-start gap-1 text-left font-medium hover:underline">
              {expanded ? <ChevronDown className="mt-0.5 size-3.5 shrink-0" /> : <ChevronRight className="mt-0.5 size-3.5 shrink-0" />}
              <span>{row.title}</span>
            </button>
          ) : (
            <span className="font-medium">{row.title}</span>
          )}
          {multi ? <span className="ml-1 text-[12px] text-muted-foreground">({row.parts.length} parts)</span> : null}
        </td>
        <td className="px-3 py-2 whitespace-nowrap">{CONTENT_TYPE_LABEL[row.contentType]}</td>
        <td className="px-3 py-2">{row.wovenStatus ?? "—"}</td>
        <td className="px-3 py-2">
          {row.audience}
          {row.audienceDecision === "company_wide" ? <span className="block text-[12px] text-muted-foreground">Shared with everyone</span> : null}
          {row.audienceDecision === "excluded" ? <span className="block text-[12px] text-muted-foreground">Kept out</span> : null}
        </td>
        <td className="px-3 py-2">{row.version ?? "—"}</td>
        <td className="px-3 py-2 whitespace-nowrap">{day(row.wovenUpdatedAt, "Updated date unavailable")}</td>
        <td className="px-3 py-2 whitespace-nowrap">{day(row.firstSeenAt)}</td>
        <td className="px-3 py-2 whitespace-nowrap">{day(row.lastSeenAt)}</td>
        <td className="px-3 py-2 whitespace-nowrap">{day(row.lastSyncedAt, "Not yet")}</td>
        <td className="px-3 py-2">
          <Badge tone={SYNC_STATE_TONE[row.syncState]}>{CONTENT_SYNC_STATE_LABEL[row.syncState]}</Badge>
        </td>
        <td className="px-3 py-2">
          {row.askSunny.length === 0 ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {row.askSunny.map((doc) => (
                <li key={doc.id}>
                  <Link className="text-primary hover:underline" href={`/knowledge/document/${encodeURIComponent(doc.id)}`}>
                    {doc.title}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </td>
      </tr>
      {multi && expanded ? (
        <tr className="bg-surface-muted">
          <td colSpan={11} className="px-6 py-2">
            <ul className="flex flex-col gap-1" aria-label={`Parts of ${row.title}`}>
              {row.parts.map((part) => (
                <li key={part.key} className="flex flex-wrap items-center gap-2">
                  {/* A body is named by its kind ("Step text: Current"); a file by the name people see, never its storage name. */}
                  {part.kind === "body" ? (
                    <span>{row.contentType === "procedure" ? "Step text" : PART_KIND_LABEL.body}:</span>
                  ) : (
                    <>
                      <span className="text-muted-foreground">
                        {part.kind !== "superseded_copy" && row.parts.some((p) => p.kind === "superseded_copy") ? "Current Woven copy" : PART_KIND_LABEL[part.kind]}:
                      </span>
                      <span>{part.fileName ?? part.title}</span>
                    </>
                  )}
                  <Badge tone={SYNC_STATE_TONE[part.syncState]}>{CONTENT_SYNC_STATE_LABEL[part.syncState]}</Badge>
                </li>
              ))}
            </ul>
          </td>
        </tr>
      ) : null}
    </>
  );
}

/* ---------------------------------------------------------- sync history -- */

const RUN_KIND: Record<RunSummary["mode"], string> = { preview: "Scan (nothing changed)", sync: "Sync", continue: "Finishing earlier work" };
const RUN_OUTCOME: Record<RunSummary["status"], { label: string; tone: BadgeTone }> = {
  running: { label: "Running", tone: "processing" },
  succeeded: { label: "Succeeded", tone: "ready" },
  succeeded_with_warnings: { label: "Succeeded, with warnings", tone: "attention" },
  failed: { label: "Failed", tone: "attention" },
};

export function HistoryTab({ runs }: { runs: RunSummary[] }) {
  if (runs.length === 0) return <p className="text-[13px] text-muted-foreground">No sync has run yet.</p>;
  return (
    <ScrollTable>
      <table className="w-full min-w-[820px] text-left text-[13px]">
        <thead>
          <tr className="text-muted-foreground">
            {["Started", "What", "Outcome", "Found", "New", "Updated", "Removed", "Errors", "Notes"].map((h) => (
              <th key={h} className="px-3 py-2 font-medium whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => {
            const outcome = RUN_OUTCOME[run.status];
            const t = run.totals;
            return (
              <tr key={run.id} className="border-t border-border align-top tabular-nums" data-testid="history-row">
                <td className="px-3 py-2 whitespace-nowrap">{moment(run.startedAt)}</td>
                <td className="px-3 py-2">
                  {RUN_KIND[run.mode]}
                  <span className="block text-[12px] text-muted-foreground">{run.trigger === "schedule" ? "Automatic" : "Started by an admin"}</span>
                </td>
                <td className="px-3 py-2">
                  <Badge tone={outcome.tone}>{outcome.label}</Badge>
                </td>
                <td className="px-3 py-2">{t ? t.discovered : "—"}</td>
                <td className="px-3 py-2">{t ? t.new : "—"}</td>
                <td className="px-3 py-2">{t ? t.updated : "—"}</td>
                <td className="px-3 py-2">{t ? t.removed + t.unpublished : "—"}</td>
                <td className="px-3 py-2">{t ? t.errors : "—"}</td>
                <td className="px-3 py-2">
                  {run.notes.length === 0 ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <ul className="flex flex-col gap-0.5">
                      {run.notes.map((note) => (
                        <li key={note.code}>{note.message}</li>
                      ))}
                    </ul>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </ScrollTable>
  );
}
