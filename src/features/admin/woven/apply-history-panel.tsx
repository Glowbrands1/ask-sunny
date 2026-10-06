"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import type { ApplyHistory } from "@/lib/admin/woven-apply-history";

/**
 * ============================================================================
 * AUTOMATIC ACTIONS — DISABLE_TERMINATED switches and history (read-only)
 * ============================================================================
 *
 * Shows whether automatic termination enforcement can run (both keys), what
 * it has done, and offers the disposable-test run. Nothing here turns the
 * Production switch on: that is an owner-only change in the SQL editor.
 */

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "—");
const short = (id: string) => (id ? `${id.slice(0, 8)}…` : "—");
const button = "h-8 rounded-[var(--radius-sm)] border border-border px-2.5 text-[12px] font-semibold disabled:opacity-50";

function TestRun({ disabled }: { disabled: boolean }) {
  const router = useRouter();
  const [appUserId, setAppUserId] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/employees/woven/apply/test-termination", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appUserId: appUserId.trim(), confirm: true }),
      });
      const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
      setMessage(body ? JSON.stringify(body) : `HTTP ${response.status}`);
      router.refresh();
    } catch {
      setMessage("Ask Sunny's server could not be reached.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius-sm)] border border-border p-3 text-[12px]">
      <strong>Disposable test run</strong>
      <p className="text-muted-foreground">
        Runs the real termination path for ONE account linked to a test employee (EmployeeID starting <code>ASK-SUNNY-TEST-</code>).
        Every other account is refused. The account is disabled for real.
      </p>
      <label className="flex flex-col gap-1">
        Account id
        <input
          className="h-8 rounded-[var(--radius-sm)] border border-border px-2 font-mono"
          value={appUserId}
          onChange={(e) => setAppUserId(e.target.value)}
          disabled={disabled || busy}
        />
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} disabled={disabled || busy} />
        I confirm this is a disposable test account and it should be disabled.
      </label>
      <div>
        <button type="button" className={button} disabled={disabled || busy || !confirmed || appUserId.trim().length === 0} onClick={() => void run()}>
          Run test termination
        </button>
      </div>
      {message ? (
        <p role="status" className="break-all font-mono">
          {message}
        </p>
      ) : null}
    </div>
  );
}

export function ApplyHistoryPanel({ history, disabled }: { history: ApplyHistory | null; disabled: boolean }) {
  if (!history) {
    return (
      <section aria-label="Automatic actions" className="text-[12px] text-muted-foreground">
        Automatic actions are not set up in this database yet.
      </section>
    );
  }
  const on = history.envSwitchOn && history.control?.enabled === true;

  return (
    <section aria-label="Automatic actions" className="flex flex-col gap-3">
      <header>
        <h3 className="text-[15px] font-semibold">Automatic actions — terminations</h3>
        <p className="text-[12px] text-muted-foreground">
          When on, an account that is linked, status-managed and not protected is disabled automatically after Woven reports the
          employee Terminated in the latest read (profile disabled, sign-in banned, sessions revoked; nothing deleted). It runs only
          when BOTH switches are on.
        </p>
      </header>

      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-[12px]">
        <dt>Automatic termination</dt>
        <dd>
          <strong>{on ? "ON" : "OFF"}</strong>
        </dd>
        <dt>Deployment switch (WOVEN_APPLY_ACTIONS)</dt>
        <dd>{history.envSwitchOn ? "on" : "off"}</dd>
        <dt>Owner switch (database)</dt>
        <dd>
          {history.control ? `${history.control.enabled ? "on" : "off"} · up to ${history.control.maxPerRun} per run · last set by ${history.control.changedBy} ${when(history.control.updatedAt)}` : "missing"}
        </dd>
      </dl>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-[12px]">
          <caption className="text-left font-semibold">Recent apply runs</caption>
          <thead>
            <tr className="border-b border-border">
              <th className="p-2">When</th>
              <th className="p-2">Source</th>
              <th className="p-2">Status</th>
              <th className="p-2">Applied</th>
              <th className="p-2">Skipped</th>
              <th className="p-2">Failed</th>
              <th className="p-2">Blocked</th>
              <th className="p-2">Guards</th>
            </tr>
          </thead>
          <tbody>
            {history.runs.length === 0 ? (
              <tr>
                <td className="p-2" colSpan={8}>
                  No apply run yet.
                </td>
              </tr>
            ) : (
              history.runs.map((run) => (
                <tr key={run.id} className="border-b border-border/60">
                  <td className="p-2">{when(run.createdAt)}</td>
                  <td className="p-2">{run.requestedBy}</td>
                  <td className="p-2">{run.status}</td>
                  <td className="p-2">{run.applied}</td>
                  <td className="p-2">{run.skipped}</td>
                  <td className="p-2">{run.failed}</td>
                  <td className="p-2">{run.blocked}</td>
                  <td className="p-2">{run.guardCodes.join(", ") || "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-[12px]">
          <caption className="text-left font-semibold">Recent operations</caption>
          <thead>
            <tr className="border-b border-border">
              <th className="p-2">Started</th>
              <th className="p-2">Account</th>
              <th className="p-2">Source</th>
              <th className="p-2">Status</th>
              <th className="p-2">Error</th>
              <th className="p-2">Finished</th>
            </tr>
          </thead>
          <tbody>
            {history.operations.length === 0 ? (
              <tr>
                <td className="p-2" colSpan={6}>
                  No operation yet.
                </td>
              </tr>
            ) : (
              history.operations.map((op) => (
                <tr key={`${op.appUserId}:${op.startedAt}`} className="border-b border-border/60">
                  <td className="p-2">{when(op.startedAt)}</td>
                  <td className="p-2 font-mono">{short(op.appUserId)}</td>
                  <td className="p-2">{op.triggerSource}</td>
                  <td className="p-2">{op.status}</td>
                  <td className="p-2">{op.errorCode ?? "—"}</td>
                  <td className="p-2">{when(op.finishedAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <TestRun disabled={disabled} />
    </section>
  );
}
