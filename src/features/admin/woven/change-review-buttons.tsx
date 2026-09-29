"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import type { ReviewStatus } from "@/lib/employees/woven/view-types";

/**
 * Marks one change acknowledged or dismissed. That writes the change's three
 * review columns — the only part of the history that can change — and nothing
 * else. Disabled on sample data and in demo mode, where the route refuses.
 */
export function ChangeReviewButtons({
  changeId,
  status,
  disabled,
}: {
  changeId: string;
  status: ReviewStatus;
  disabled: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function set(reviewStatus: ReviewStatus) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/employees/woven/changes/${encodeURIComponent(changeId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewStatus }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { reason?: string } | null;
        setError(body?.reason ?? `Not saved (HTTP ${response.status}).`);
      } else {
        router.refresh();
      }
    } catch {
      setError("Ask Sunny's server could not be reached.");
    } finally {
      setBusy(false);
    }
  }

  const button = "rounded-[var(--radius-sm)] border border-border px-2 py-0.5 text-[11.5px] font-semibold disabled:opacity-50";
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {status !== "acknowledged" ? (
        <button type="button" className={button} disabled={disabled || busy} onClick={() => set("acknowledged")}>
          Acknowledge
        </button>
      ) : null}
      {status !== "dismissed" ? (
        <button type="button" className={button} disabled={disabled || busy} onClick={() => set("dismissed")}>
          Dismiss
        </button>
      ) : null}
      {status !== "unreviewed" ? (
        <button type="button" className={button} disabled={disabled || busy} onClick={() => set("unreviewed")}>
          Reopen
        </button>
      ) : null}
      {error ? (
        <span role="alert" className="text-[11.5px] text-status-failed">
          {error}
        </span>
      ) : null}
    </span>
  );
}
