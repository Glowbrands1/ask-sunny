"use client";

import { useState } from "react";
import { PlayCircle } from "lucide-react";

import { Badge, StatusDot, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/feedback";
import { SectionHeader } from "@/components/ui/layout";
import type { ValidationReport, Verdict } from "@/lib/employees/woven/validate";

/**
 * The read-only live check, run on request by an administrator.
 *
 * The server does the work (`POST /api/admin/employees/woven/validate`); this
 * only shows its report — findings first, then the counts and KEY NAMES behind
 * them. The report carries no employee record, id, name or email by
 * construction, so nothing here can display one.
 */

const VERDICT_TONE: Record<Verdict, BadgeTone> = { pass: "ready", warn: "attention", fail: "failed" };
const VERDICT_LABEL: Record<Verdict, string> = { pass: "Pass", warn: "Check", fail: "Fail" };

function KeyList({ keys }: { keys: string[] }) {
  if (keys.length === 0) return <span className="text-muted-foreground">none</span>;
  return <span className="font-mono text-[12px] break-words">{keys.join(", ")}</span>;
}

export function ValidationPanel({ available, reason }: { available: boolean; reason: string | null }) {
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<ValidationReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/employees/woven/validate", { method: "POST" });
      const body = (await response.json().catch(() => null)) as { report?: ValidationReport; reason?: string; error?: string } | null;
      if (!response.ok || !body?.report) {
        setError(body?.reason ?? body?.error ?? `The check could not run (HTTP ${response.status}).`);
        setReport(null);
      } else {
        setReport(body.report);
      }
    } catch {
      setError("The check could not reach Ask Sunny's server.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="mb-8">
      <SectionHeader
        title="Read-only live check"
        description="Signs in to Woven and reads employees, a few employee details, and the position and location lists. Writes nothing anywhere. Shows counts and field names only."
        actions={
          <Button onClick={run} disabled={!available || running}>
            <PlayCircle />
            {running ? "Checking…" : "Run read-only check"}
          </Button>
        }
      />

      {!available && reason ? (
        <Notice tone="neutral" className="mb-4">
          {reason}
        </Notice>
      ) : null}
      {error ? (
        <Notice tone="attention" className="mb-4" title="The check did not run">
          {error}
        </Notice>
      ) : null}

      {report ? (
        <div className="flex flex-col gap-4">
          <ul className="flex flex-col divide-y divide-border rounded-[var(--radius-md)] border border-border bg-surface">
            {report.findings.map((finding, index) => (
              <li key={index} className="flex flex-col gap-1.5 px-4 py-2.5 sm:flex-row sm:items-start sm:gap-4">
                <Badge tone={VERDICT_TONE[finding.verdict]} size="sm" className="shrink-0 self-start">
                  <StatusDot />
                  {VERDICT_LABEL[finding.verdict]}
                </Badge>
                <p className="min-w-0 flex-1 text-[13px] leading-relaxed break-words">
                  <span className="font-semibold">{finding.area}.</span> {finding.message}
                </p>
              </li>
            ))}
          </ul>

          <details className="rounded-[var(--radius-md)] border border-border bg-surface px-4 py-3 text-[13px]">
            <summary className="cursor-pointer font-semibold">Counts and field names</summary>
            <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-[max-content_1fr]">
              <dt className="text-muted-foreground">Requests made</dt>
              <dd className="tabular-nums">{report.requestsMade}</dd>
              {report.token.ok ? (
                <>
                  <dt className="text-muted-foreground">Token response keys</dt>
                  <dd><KeyList keys={report.token.responseKeys} /></dd>
                  <dt className="text-muted-foreground">Token lifetime</dt>
                  <dd className="tabular-nums">{report.token.lifetimeSeconds}s ({report.token.lifetimeSource.replace("_", " ")})</dd>
                </>
              ) : null}
              {report.passes.map((pass) => (
                <div key={pass.label} className="contents">
                  <dt className="text-muted-foreground">{pass.label} pass</dt>
                  <dd className="tabular-nums">
                    {pass.records} records · {pass.pages} pages · page sizes {pass.pageSizes.join("/")} · {pass.shape}
                    {pass.reportedTotal !== null ? ` · reported total ${pass.reportedTotal}` : ""}
                    <br />
                    Status values:{" "}
                    {Object.entries(pass.statusValues).map(([v, c]) => `${v} (${c})`).join(", ") || "none"}
                    <br />
                    Keys returned: <KeyList keys={pass.keysReturned} />
                    <br />
                    Keys not in the contract: <KeyList keys={pass.keysNotInContract} />
                  </dd>
                </div>
              ))}
              <dt className="text-muted-foreground">In both passes</dt>
              <dd className="tabular-nums">{report.idsInBothPasses}</dd>
              {report.unfiltered ? (
                <>
                  <dt className="text-muted-foreground">Unfiltered read</dt>
                  <dd className="tabular-nums">
                    {report.unfiltered.records} records · {report.unfiltered.notInEitherPass} in neither pass
                    {report.unfiltered.notInEitherPass > 0
                      ? ` (${Object.entries(report.unfiltered.statusValues).map(([v, c]) => `${v} (${c})`).join(", ")})`
                      : ""}
                  </dd>
                </>
              ) : null}
              <dt className="text-muted-foreground">Employees normalised</dt>
              <dd className="tabular-nums">
                {report.normalized.employees} ({report.normalized.active} active, {report.normalized.terminated} terminated,{" "}
                {report.normalized.statusUnknown} unknown) · {report.normalized.rejected} rejected ·{" "}
                {report.normalized.distinctPositionIds} positions · {report.normalized.distinctPrimaryLocations} primary locations
              </dd>
              <dt className="text-muted-foreground">Multiple-location flag</dt>
              <dd className="tabular-nums">
                {report.normalized.multipleLocationFlagTrue} yes · {report.normalized.multipleLocationFlagFalse} no ·{" "}
                {report.normalized.multipleLocationFlagMissing} not stated
              </dd>
              <dt className="text-muted-foreground">Issues</dt>
              <dd className="tabular-nums">
                {Object.entries(report.normalized.issueCounts).map(([k, v]) => `${k.replaceAll("_", " ")} (${v})`).join(", ") || "none"}
              </dd>
              <dt className="text-muted-foreground">Work-email domains</dt>
              <dd className="tabular-nums">
                {Object.entries(report.normalized.workEmailDomains).map(([d, c]) => `${d} (${c})`).join(", ") || "none"}
              </dd>
              {report.details ? (
                <>
                  <dt className="text-muted-foreground">Employee details</dt>
                  <dd className="tabular-nums">
                    {report.details.sampled} sampled · {report.details.withLocationsArray} with a locations list ·{" "}
                    {report.details.entriesWithExpiry} with an end date · {report.details.entriesFlaggedBorrowed} flagged borrowed
                    <br />
                    Keys returned: <KeyList keys={report.details.keysReturned} />
                    <br />
                    Location entry keys: <KeyList keys={report.details.locationEntryKeys} />
                  </dd>
                </>
              ) : null}
              {report.references.map((ref) => (
                <div key={ref.path} className="contents">
                  <dt className="text-muted-foreground font-mono">{ref.path}</dt>
                  <dd>
                    {ref.outcome}
                    {ref.records !== null ? ` · ${ref.records} records` : ""}
                    {ref.keysReturned.length > 0 ? (
                      <>
                        {" · "}
                        <KeyList keys={ref.keysReturned} />
                      </>
                    ) : null}
                  </dd>
                </div>
              ))}
              <dt className="text-muted-foreground">Sensitive-looking keys</dt>
              <dd><KeyList keys={report.sensitiveKeysReturned} /></dd>
            </dl>
          </details>
        </div>
      ) : null}
    </section>
  );
}
