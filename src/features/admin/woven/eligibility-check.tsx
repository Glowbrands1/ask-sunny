"use client";

import { useState } from "react";

import { Badge, type BadgeTone } from "@/components/ui/badge";
import type { AccessPreviewRow, EligibilityResult, EligibilityVerdict } from "@/lib/employees/woven/view-types";
import { evaluateEligibility } from "@/lib/employees/woven/views";

/**
 * "WOULD THIS PERSON GET AN ACCOUNT?" — a preview of first-login provisioning.
 *
 * Live: POSTs the email to `/api/admin/employees/woven/eligibility`, so the
 * address never sits in a URL or an access log. Sample (demo builds only): the
 * same pure rule, `evaluateEligibility`, over the sample rows.
 *
 * NOTHING IS CREATED. There is no code path in phase one that creates,
 * enables or disables a login; this answers the question and stops.
 */

const TONE: Record<EligibilityVerdict, BadgeTone> = { eligible: "ready", held_for_review: "attention", not_eligible: "failed" };
const LABEL: Record<EligibilityVerdict, string> = { eligible: "Eligible", held_for_review: "Held for review", not_eligible: "Not eligible" };

export function EligibilityCheck({
  sampleRows,
  loginEmailDomains,
  disabled,
}: {
  sampleRows: AccessPreviewRow[] | null;
  loginEmailDomains: string[];
  disabled: boolean;
}) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<EligibilityResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function check(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (sampleRows) {
      setResult(evaluateEligibility(email, sampleRows, loginEmailDomains));
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/admin/employees/woven/eligibility", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const body = (await response.json().catch(() => null)) as { result?: EligibilityResult; reason?: string } | null;
      if (!response.ok || !body?.result) {
        setError(body?.reason ?? `The check could not run (HTTP ${response.status}).`);
        setResult(null);
      } else {
        setResult(body.result);
      }
    } catch {
      setError("Ask Sunny's server could not be reached.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <form onSubmit={check} className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-60 flex-1 flex-col gap-1 text-[12px] font-semibold text-muted-foreground">
          Email address
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@company.com"
            className="h-9 rounded-[var(--radius-sm)] border border-border bg-surface px-3 text-[13px] font-normal text-foreground"
            disabled={disabled && !sampleRows}
          />
        </label>
        <button
          type="submit"
          disabled={busy || (disabled && !sampleRows)}
          className="h-9 rounded-[var(--radius-sm)] bg-primary px-3 text-[13px] font-semibold text-primary-foreground disabled:opacity-50"
        >
          {busy ? "Checking…" : "Check"}
        </button>
      </form>
      <p className="text-[12px] text-muted-foreground">
        Login-email domains: {loginEmailDomains.length > 0 ? loginEmailDomains.join(", ") : "not configured — nobody is eligible yet"}.
      </p>
      {error ? (
        <p role="alert" className="text-[12.5px] text-status-failed">
          {error}
        </p>
      ) : null}
      {result ? (
        <div aria-live="polite" className="rounded-[var(--radius-md)] border border-dashed border-border bg-surface px-4 py-3 text-[13px]">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge tone={TONE[result.verdict]} size="md">
              {LABEL[result.verdict]}
            </Badge>
            <span className="text-[12px] text-muted-foreground">Preview only. No account is created in this phase.</span>
          </div>
          {result.employee ? (
            <dl className="mb-2 grid gap-x-4 gap-y-1 sm:grid-cols-[max-content_1fr]">
              <dt className="text-muted-foreground">Woven employee</dt>
              <dd>
                {result.employee.name} · <span className="font-mono text-[11.5px]">{result.employee.externalEmployeeId}</span>
              </dd>
              <dt className="text-muted-foreground">Status</dt>
              <dd>{result.employee.employmentStatus}</dd>
              <dt className="text-muted-foreground">Would propose</dt>
              <dd>
                {result.employee.wouldCreateRole
                  ? `${result.employee.wouldCreateRole.replaceAll("_", " ")}, ${result.employee.wouldCreateScopeLevel ?? "?"} scope`
                  : "no role — position not confirmed"}
                {result.employee.primarySalonNumber ? ` at salon ${result.employee.primarySalonNumber}` : ""}
              </dd>
            </dl>
          ) : null}
          <ul className="list-disc pl-5 text-[12.5px]">
            {result.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
