"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/feedback";
import { SectionHeader } from "@/components/ui/layout";
import type { SyncOutcome } from "@/lib/employees/woven/sync";

/**
 * "Run employee sync" — kept apart from "Test Woven connection" on purpose.
 *
 * DISABLED WHILE `WOVEN_SYNC_ENABLED` IS OFF, whatever the validation switch
 * says; the server refuses it too (`runWovenEmployeeSync` returns "disabled"
 * before it reaches Woven or the database), so the button being off is not
 * the only lock.
 *
 * When the sync IS switched on, this button starts a DRY RUN only: it reads
 * and compares, and saves nothing. No button in this phase starts a saving
 * run — that is a separate, approved step after the migration.
 */

function outcomeText(outcome: SyncOutcome): string {
  switch (outcome.status) {
    case "succeeded":
      return `Dry run finished. ${outcome.summary.employeesReceived} employees read; nothing was saved.`;
    case "disabled":
      return outcome.reason;
    case "not_configured":
      return `Not configured: ${outcome.missing.join(", ")}.`;
    case "busy":
      return "Another sync is running.";
    case "rejected":
    case "failed":
      return `${outcome.status === "rejected" ? "Refused" : "Failed"} (${outcome.code}). ${outcome.reason}`;
  }
}

export function SyncPanel({ available, reason }: { available: boolean; reason: string | null }) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setResult(null);
    try {
      const response = await fetch("/api/admin/employees/woven/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dryRun: true }),
      });
      const body = (await response.json().catch(() => null)) as (SyncOutcome & { error?: string }) | null;
      setResult(body && "status" in body ? outcomeText(body) : `The sync could not run (HTTP ${response.status}).`);
    } catch {
      setResult("The sync could not reach Ask Sunny's server.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="mb-8" data-testid="woven-sync-panel">
      <SectionHeader
        title="Run employee sync"
        description="Reads every employee from Woven and compares with the directory. Separate from the connection test above, and off until WOVEN_SYNC_ENABLED is on. In this phase it runs as a dry run and saves nothing."
        actions={
          <Button variant="secondary" onClick={run} disabled={!available || running}>
            <RefreshCw />
            {running ? "Running…" : "Run employee sync"}
          </Button>
        }
      />
      {!available && reason ? (
        <Notice tone="neutral" className="mb-4">
          {reason}
        </Notice>
      ) : null}
      {result ? (
        <Notice tone="neutral" className="mb-4">
          {result}
        </Notice>
      ) : null}
    </section>
  );
}
