"use client";

import { useState, type ReactNode } from "react";
import { PlayCircle } from "lucide-react";

import { Badge, StatusDot, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/feedback";
import { SectionHeader } from "@/components/ui/layout";
import type { ValidationReport, Verdict } from "@/lib/employees/woven/validate";

/**
 * "Test Woven connection" — the read-only validation, run on request by an
 * administrator. Its own switch (`WOVEN_VALIDATION_ENABLED`); it never runs a
 * sync, and "Run employee sync" is a separate panel with a separate switch.
 *
 * The server does the work (`POST /api/admin/employees/woven/validate`); this
 * only shows its report — a summary in the order the review reads it, the
 * findings, then the counts and KEY NAMES behind them. The report carries no
 * employee record, id, name or email by construction, so nothing here can
 * display one. Location numbers and names appear only when the server sent a
 * `locationReview`, which it does for a `manage_users` caller alone.
 *
 * THE ACCESS CODE (demo mode only). Typed into a password field, held in this
 * component's state and nowhere else — no storage, no URL — sent in the POST
 * body, and cleared after every attempt. The server compares it; this never
 * shows it back.
 */

const VERDICT_TONE: Record<Verdict, BadgeTone> = { pass: "ready", warn: "attention", fail: "failed" };
const VERDICT_LABEL: Record<Verdict, string> = { pass: "Pass", warn: "Check", fail: "Fail" };

function KeyList({ keys }: { keys: string[] }) {
  if (keys.length === 0) return <span className="text-muted-foreground">none</span>;
  return <span className="font-mono text-[12px] break-words">{keys.join(", ")}</span>;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-words tabular-nums">{children}</dd>
    </>
  );
}

const labels = (map: Record<string, string>) =>
  Object.entries(map)
    .map(([value, label]) => `${value} = ${label}`)
    .join(", ");

/** The summary, in the order the validation review asks for it. Counts, names and codes only. */
function Summary({ report }: { report: ValidationReport }) {
  const n = report.normalized;
  const token = report.token;
  const enums = report.enums;
  const coverage = report.locations?.salonCoverage ?? null;
  const details = report.details;
  const employeeTriggers = enums?.employeeWebhookTriggers ?? [];

  return (
    <dl data-testid="woven-validation-summary" className="grid gap-x-6 gap-y-2 rounded-[var(--radius-md)] border border-border bg-surface px-4 py-3 text-[13px] sm:grid-cols-[max-content_1fr]">
      <Row label="Authentication">
        {token.ok ? "Succeeded" : `Failed (${token.code}${token.status ? `, HTTP ${token.status}` : ""})`}
      </Row>
      {token.ok ? (
        <>
          <Row label="CompanyID">
            {token.companyId ?? "not stated by Woven"}
            {token.companyName ? ` · ${token.companyName}` : ""}
            {token.companyIdSent ? " (WOVEN_COMPANY_ID sent)" : " (chosen by Woven; WOVEN_COMPANY_ID not set)"}
          </Row>
          <Row label="Company options">
            {token.companyOptions.length === 0
              ? "none returned"
              : token.companyOptions.map((o) => `${o.companyName ?? "(no name)"} — ${o.companyId}`).join("; ")}
          </Row>
        </>
      ) : null}
      {enums ? (
        <>
          <Row label="Employee-status values">
            {enums.statusEnumeration ? `${enums.statusEnumeration}: ${labels(enums.statusLabels)}` : "no employee-status enumeration found"}
          </Row>
          <Row label="Termination types">{labels(enums.terminationTypeLabels) || "not listed"}</Row>
          <Row label="Webhook triggers">
            {Object.keys(enums.webhookTriggerVocabularies).length === 0
              ? "no webhook-trigger enumeration listed"
              : Object.entries(enums.webhookTriggerVocabularies)
                  .map(([name, list]) => `${name}: ${list.map((t) => t.name).join(", ")}`)
                  .join(" · ")}
          </Row>
          <Row label="Employee-related triggers">
            {employeeTriggers.length > 0 ? (
              <Badge tone="attention" size="sm">
                <StatusDot />
                Found: {employeeTriggers.join(", ")}
              </Badge>
            ) : (
              "none found"
            )}
          </Row>
        </>
      ) : null}
      {report.passes.length > 0 ? (
        <>
          <Row label="Employees">
            {n.active} active · {n.terminated} terminated · {n.statusUnknown} other status · {n.employees} unique
          </Row>
          <Row label="Unique PositionIDs">{n.distinctPositionIds}</Row>
        </>
      ) : null}
      {report.locations ? (
        <>
          <Row label="Woven locations">
            {report.locations.records} total · {report.locations.withNumber} with a Number · {report.locations.closed} closed ·{" "}
            {report.locations.nonLocations} non-locations
          </Row>
          <Row label="Ask Sunny salon match">
            {coverage?.outcome === "compared"
              ? `${coverage.exactMatches} exact Number matches, covering ${coverage.salonsMatched} of ${coverage.salons} salons · ${coverage.unmatchedWovenLocations} Woven locations unmatched (${coverage.unmatchedOpenWovenLocations} open) · ${coverage.salonsWithoutWovenLocation} salons with no Woven location${coverage.leadingZeroOnlyMatches > 0 ? ` · ${coverage.leadingZeroOnlyMatches} match only if leading zeros are ignored (not counted)` : ""}`
              : coverage?.outcome === "salons_unavailable"
                ? "Ask Sunny's salons could not be read"
                : "not compared"}
          </Row>
        </>
      ) : null}
      {report.passes.length > 0 ? (
        <>
          <Row label="Email domains">
            {Object.entries(n.emailDomains)
              .sort((a, b) => b[1] - a[1])
              .map(([d, c]) => `${d} (${c})`)
              .join(", ") || "none"}
          </Row>
          <Row label="Location access flags">
            {n.multipleLocationFlagTrue} with HasMultipleLocationAccess · {n.allLocationAccess} with AllLocationAccess
          </Row>
        </>
      ) : null}
      {details ? (
        <>
          <Row label={details.isSample ? "Employee details (sample)" : "Employee details"}>
            {details.sampled} checked{details.isSample ? ` of ${details.eligible} employees not terminated — a sample` : ""} ·{" "}
            {details.withMoreThanOneLocation} with more than one location
            {details.failed > 0 ? ` · ${details.failed} failed` : ""}
          </Row>
          <Row label="ExpiresOn">
            ExpiresOn present: {details.entriesWithExpiresOn} affiliations{details.isSample ? " (in the sample)" : ""}.{" "}
            <Badge tone="attention" size="sm">
              <StatusDot />
              Needs live operational confirmation
            </Badge>
          </Row>
        </>
      ) : null}
      <Row label="Sensitive HR field names">
        <KeyList keys={report.sensitiveKeysReturned} />
      </Row>
      <Row label="Differences from the OpenAPI spec">
        {report.specDiscrepancies.length === 0 ? (
          "none seen"
        ) : (
          <ul className="list-disc pl-4">
            {report.specDiscrepancies.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        )}
      </Row>
    </dl>
  );
}

function LocationReviewArea({ review }: { review: NonNullable<ValidationReport["locationReview"]> }) {
  return (
    <details data-testid="woven-location-review" className="rounded-[var(--radius-md)] border border-border bg-surface px-4 py-3 text-[13px]">
      <summary className="cursor-pointer font-semibold">Location numbers and names (review only — nothing is mapped)</summary>
      <p className="mt-2 text-muted-foreground">
        Woven locations and Ask Sunny salons only; no employee appears here. Matching is exact on the number. Mappings are made on the
        Mappings tab, by a person.
      </p>
      <div className="mt-3 grid gap-4 lg:grid-cols-2">
        <table className="w-full text-left">
          <caption className="mb-1 text-left font-semibold">Woven locations</caption>
          <thead>
            <tr className="text-muted-foreground">
              <th className="pr-3 font-medium">Number</th>
              <th className="pr-3 font-medium">Name</th>
              <th className="font-medium">Match</th>
            </tr>
          </thead>
          <tbody>
            {review.wovenLocations.map((l, i) => (
              <tr key={`${l.number ?? "none"}-${i}`}>
                <td className="pr-3 font-mono">{l.number ?? "—"}</td>
                <td className="pr-3">
                  {l.name ?? "—"}
                  {l.closed ? " · closed" : ""}
                  {l.nonLocation ? " · non-location" : ""}
                </td>
                <td>{l.matchedSalonNumber ? `salon ${l.matchedSalonNumber}` : "none"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <table className="w-full text-left">
          <caption className="mb-1 text-left font-semibold">Ask Sunny salons with no Woven location</caption>
          <thead>
            <tr className="text-muted-foreground">
              <th className="pr-3 font-medium">Salon number</th>
              <th className="font-medium">Name</th>
            </tr>
          </thead>
          <tbody>
            {review.salonsWithoutWovenLocation.length === 0 ? (
              <tr>
                <td colSpan={2} className="text-muted-foreground">
                  none
                </td>
              </tr>
            ) : (
              review.salonsWithoutWovenLocation.map((s) => (
                <tr key={s.number}>
                  <td className="pr-3 font-mono">{s.number}</td>
                  <td>{s.name}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </details>
  );
}

export function ValidationPanel({
  available,
  reason,
  accessCodeRequired = false,
}: {
  available: boolean;
  reason: string | null;
  /** Demo mode: the server also asks for WOVEN_VALIDATION_ACCESS_CODE. */
  accessCodeRequired?: boolean;
}) {
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<ValidationReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accessCode, setAccessCode] = useState("");

  async function run() {
    setRunning(true);
    setError(null);
    const requestBody = accessCodeRequired ? JSON.stringify({ accessCode }) : undefined;
    /* Cleared as soon as it is sent: one attempt, then gone from the page. */
    setAccessCode("");
    try {
      const response = await fetch("/api/admin/employees/woven/validate", {
        method: "POST",
        ...(requestBody ? { headers: { "content-type": "application/json" }, body: requestBody } : {}),
      });
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
    <section className="mb-8" data-testid="woven-validation-panel">
      <SectionHeader
        title="Test Woven connection"
        description="Read-only validation. Signs in to Woven and reads the enum list, every employee page, a small sample of employee details and the location list, and compares the locations with Ask Sunny's salons. Runs no sync and writes nothing anywhere. Shows counts, field names and Woven's own labels only."
        actions={
          <Button onClick={run} disabled={!available || running || (accessCodeRequired && accessCode.trim().length === 0)}>
            <PlayCircle />
            {running ? "Checking…" : "Run read-only validation"}
          </Button>
        }
      />

      {!available && reason ? (
        <Notice tone="neutral" className="mb-4">
          {reason}
        </Notice>
      ) : null}
      {accessCodeRequired && available ? (
        <div className="mb-4 flex max-w-md flex-col gap-1.5 text-[13px]">
          <label htmlFor="woven-validation-access-code" className="font-semibold">
            Access code
          </label>
          <input
            id="woven-validation-access-code"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={accessCode}
            onChange={(event) => setAccessCode(event.target.value)}
            className="rounded-[var(--radius-sm)] border border-border bg-surface px-3 py-2"
          />
          <p className="text-muted-foreground">
            This deployment runs in demo mode, so the connection test also needs the code set in WOVEN_VALIDATION_ACCESS_CODE. The
            report below is real Woven data, not sample data.
          </p>
        </div>
      ) : null}
      {error ? (
        <Notice tone="attention" className="mb-4" title="The check did not run">
          {error}
        </Notice>
      ) : null}

      {report ? (
        <div className="flex flex-col gap-4">
          <Summary report={report} />

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

          {report.locationReview ? <LocationReviewArea review={report.locationReview} /> : null}

          <details className="rounded-[var(--radius-md)] border border-border bg-surface px-4 py-3 text-[13px]">
            <summary className="cursor-pointer font-semibold">Counts and field names</summary>
            <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-[max-content_1fr]">
              <Row label="Requests made">{report.requestsMade}</Row>
              {report.token.ok ? (
                <>
                  <Row label="Token response keys">
                    <KeyList keys={report.token.responseKeys} />
                  </Row>
                  <Row label="Token lifetime">
                    {report.token.lifetimeSeconds}s ({report.token.lifetimeSource.replace("_", " ")})
                  </Row>
                </>
              ) : null}
              {report.enums ? (
                <>
                  <Row label="Webhook trigger values">
                    {Object.entries(report.enums.webhookTriggerVocabularies)
                      .map(([name, list]) => `${name}: ${list.map((t) => `${t.value} ${t.name}`).join(", ")}`)
                      .join(" · ") || "none"}
                  </Row>
                  <Row label="Enumeration names">
                    <KeyList keys={Object.keys(report.enums.enumerationNames).sort()} />
                  </Row>
                </>
              ) : null}
              {report.passes.map((pass) => (
                <div key={pass.label} className="contents">
                  <Row label={`${pass.label.replaceAll("_", " ")} read`}>
                    {pass.records} records · {pass.pages} pages · page sizes {pass.pageSizes.join("/")} · {pass.shape}
                    <br />
                    Status integers: {Object.entries(pass.statusCodes).map(([v, c]) => `${v} (${c})`).join(", ") || "none"}
                    <br />
                    Keys returned: <KeyList keys={pass.keysReturned} />
                    <br />
                    Keys not in the contract: <KeyList keys={pass.keysNotInContract} />
                  </Row>
                </div>
              ))}
              <Row label="Default read not in the with-terminated read">{report.currentNotInWithTerminated}</Row>
              <Row label="Employees normalised">
                {report.normalized.rejected} rejected · {report.normalized.distinctPrimaryLocations} distinct primary locations ·{" "}
                {report.normalized.multipleLocationFlagFalse} with HasMultipleLocationAccess false
              </Row>
              <Row label="Issues">
                {Object.entries(report.normalized.issueCounts).map(([k, v]) => `${k.replaceAll("_", " ")} (${v})`).join(", ") || "none"}
              </Row>
              <Row label="Login-email rule">{report.normalized.loginEligibleByDomain} at a WOVEN_LOGIN_EMAIL_DOMAINS domain</Row>
              {report.details ? (
                <Row label="Employee details">
                  {report.details.sampled} read (limit {report.details.sampleLimit}) · {report.details.withLocationsArray} with Locations[] · entries:{" "}
                  {report.details.accessTypes.primary} primary, {report.details.accessTypes.additional} additional,{" "}
                  {report.details.accessTypes.temporary_or_expiring_access} temporary or expiring
                  <br />
                  Keys returned: <KeyList keys={report.details.keysReturned} />
                  <br />
                  Location entry keys: <KeyList keys={report.details.locationEntryKeys} />
                </Row>
              ) : null}
              {report.locations ? (
                <Row label="/locations">
                  {report.locations.outcome} · keys: <KeyList keys={report.locations.keysReturned} />
                </Row>
              ) : null}
            </dl>
          </details>
        </div>
      ) : null}
    </section>
  );
}
