"use client";

import { useState } from "react";

/**
 * COMPLETED / EXTEND ON A FOLLOW-UP NOTIFICATION (Pau, 26 Nov 2026: "ability to click from notification that they have
 * completed it like COmpleted or extend").
 *
 * The same two writes Form Monitoring's row makes, through the same route and its checks
 * (`/api/forms/instances/{id}/follow-up`): Completed marks the follow-up done; Extend sets a new follow-up date. The
 * server decides, so a person who may not change the form is told why rather than shown success.
 */
export function FollowUpActions({
  formId,
  onDone,
  today = localToday(),
}: {
  formId: string;
  /** Called with what happened ("Marked done.", "Moved to Dec 3."), once the server has agreed. */
  onDone: (message: string) => void;
  today?: string;
}) {
  const [extending, setExtending] = useState(false);
  const [date, setDate] = useState(() => addDays(today, 7));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function send(init: RequestInit, message: string) {
    setBusy(true);
    setProblem(null);
    try {
      const response = await fetch(`/api/forms/instances/${formId}/follow-up`, {
        ...init,
        headers: { "content-type": "application/json" },
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? "That did not work.");
      }
      onDone(message);
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const button =
    "rounded-[var(--radius-sm)] border border-border px-2.5 py-1 text-xs font-semibold text-foreground hover:bg-hover-surface disabled:opacity-50";

  return (
    <div className="space-y-1.5">
      {extending ? (
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            aria-label="New follow-up date"
            value={date}
            min={today}
            onChange={(event) => setDate(event.target.value)}
            className="rounded-[var(--radius-sm)] border border-border bg-background px-2 py-1 text-xs text-foreground"
          />
          <button
            type="button"
            className={button}
            disabled={busy || !date}
            onClick={() => send({ method: "PUT", body: JSON.stringify({ date }) }, `Moved to ${shortDate(date)}.`)}
          >
            Save date
          </button>
          <button type="button" className="text-xs text-muted-foreground hover:text-foreground" disabled={busy} onClick={() => setExtending(false)}>
            Cancel
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={button}
            disabled={busy}
            onClick={() => send({ method: "POST", body: JSON.stringify({ action: "complete" }) }, "Marked done.")}
          >
            Completed
          </button>
          <button type="button" className={button} disabled={busy} onClick={() => setExtending(true)}>
            Extend
          </button>
        </div>
      )}
      {problem ? (
        <p role="alert" className="text-xs text-destructive">
          {problem}
        </p>
      ) : null}
    </div>
  );
}

function localToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return next.toISOString().slice(0, 10);
}

function shortDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, day)));
}
