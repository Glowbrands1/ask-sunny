"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * ============================================================================
 * LINK REVIEW — Ask Sunny account ↔ Woven EmployeeID, confirmed by a person
 * ============================================================================
 *
 * One card per exact-email match the access planner proposes. Confirming
 * stores a durable link: from then on the account is identified by the Woven
 * EmployeeID and is never matched by email again. "Different person" marks
 * the account not managed by Woven.
 *
 * Neither changes anybody's access. What Woven may later manage is opt-in per
 * field, all off by default, and only offered where the planner could ever
 * act (status: not for administrators; location and role: Salon Director /
 * Assistant Salon Director at a single salon only). The server re-checks
 * everything against the current plan.
 */

export interface LinkReviewItem {
  externalEmployeeId: string;
  employeeName: string;
  wovenEmail: string | null;
  wovenStatus: string | null;
  wovenPosition: string | null;
  wovenPrimaryLocation: string | null;
  account: { appUserId: string; email: string; role: string; status: string; scope: string };
  allowed: { status: boolean; location: boolean; role: boolean };
}

const button = "h-8 rounded-[var(--radius-sm)] border border-border px-2.5 text-[12px] font-semibold disabled:opacity-50";

async function post(body: unknown): Promise<string | null> {
  try {
    const response = await fetch("/api/admin/employees/woven/links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.ok) return null;
    const parsed = (await response.json().catch(() => null)) as { reason?: string; status?: string } | null;
    return parsed?.reason ?? (parsed?.status ? parsed.status.replaceAll("_", " ") : `Not saved (HTTP ${response.status}).`);
  } catch {
    return "Ask Sunny's server could not be reached.";
  }
}

function ReviewCard({ item, disabled }: { item: LinkReviewItem; disabled: boolean }) {
  const router = useRouter();
  const [same, setSame] = useState(false);
  const [managed, setManaged] = useState({ status: false, location: false, role: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = `link-${item.externalEmployeeId}`;

  async function decide(decision: "confirm" | "not_woven_managed") {
    setBusy(true);
    setError(null);
    const failure = await post({
      appUserId: item.account.appUserId,
      externalEmployeeId: item.externalEmployeeId,
      decision,
      ...(decision === "confirm"
        ? { samePersonConfirmed: same, managedStatus: managed.status, managedLocation: managed.location, managedRole: managed.role }
        : {}),
    });
    setBusy(false);
    if (failure) setError(failure);
    else router.refresh();
  }

  const flag = (key: "status" | "location" | "role", text: string) => (
    <label className={`flex items-center gap-1.5 ${item.allowed[key] ? "" : "text-muted-foreground"}`}>
      <input
        type="checkbox"
        checked={managed[key]}
        disabled={disabled || busy || !item.allowed[key]}
        onChange={(e) => setManaged((m) => ({ ...m, [key]: e.target.checked }))}
      />
      {text}
      {item.allowed[key] ? null : <span className="text-[11px]">(not available for this account)</span>}
    </label>
  );

  return (
    <li className="rounded-[var(--radius-md)] border border-border bg-surface p-3" aria-labelledby={id}>
      <h4 id={id} className="sr-only">
        Link review for {item.employeeName}
      </h4>
      <div className="grid gap-3 text-[12.5px] md:grid-cols-[1fr_auto_1fr]">
        <dl>
          <dt className="text-[11px] tracking-wide text-muted-foreground uppercase">Ask Sunny account</dt>
          <dd className="font-semibold text-foreground">{item.account.email}</dd>
          <dd>
            {item.account.role.replaceAll("_", " ")} · {item.account.status} · {item.account.scope}
          </dd>
          <dd className="font-mono text-[11px] text-muted-foreground">{item.account.appUserId}</dd>
        </dl>
        <div aria-hidden className="self-center text-center text-muted-foreground">
          ↔
        </div>
        <dl>
          <dt className="text-[11px] tracking-wide text-muted-foreground uppercase">Woven employee</dt>
          <dd className="font-semibold text-foreground">{item.employeeName}</dd>
          <dd>
            {item.wovenEmail ?? "—"} · {item.wovenStatus ?? "—"} · {item.wovenPosition ?? "—"} · {item.wovenPrimaryLocation ?? "—"}
          </dd>
          <dd className="font-mono text-[11px] text-muted-foreground">EmployeeID {item.externalEmployeeId}</dd>
        </dl>
      </div>

      <fieldset className="mt-3 flex flex-col gap-1 text-[12px]" disabled={disabled || busy}>
        <legend className="mb-1 text-[11px] tracking-wide text-muted-foreground uppercase">After linking, Woven may manage (all off by default)</legend>
        {flag("status", "Status — disable on an authoritative Woven termination")}
        {flag("location", "Primary salon")}
        {flag("role", "Role (Salon Director ↔ Assistant Salon Director only)")}
      </fieldset>

      <label className="mt-3 flex items-start gap-2 text-[12.5px]">
        <input type="checkbox" checked={same} disabled={disabled || busy} onChange={(e) => setSame(e.target.checked)} />
        <span>
          I confirm this Ask Sunny account and Woven EmployeeID <span className="font-mono">{item.externalEmployeeId}</span> are the same person.
        </span>
      </label>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" className={button} disabled={disabled || busy || !same} onClick={() => decide("confirm")}>
          Confirm link
        </button>
        <button type="button" className={button} disabled={disabled || busy} onClick={() => decide("not_woven_managed")}>
          Different person — mark not Woven-managed
        </button>
        {error ? (
          <span role="alert" className="text-[11.5px] text-status-failed">
            {error}
          </span>
        ) : null}
      </div>
    </li>
  );
}

export function LinkReviewPanel({ items, disabled }: { items: LinkReviewItem[]; disabled: boolean }) {
  if (items.length === 0) return null;
  return (
    <section aria-label="Link review" className="flex flex-col gap-2">
      <h3 className="text-[13px] font-semibold text-foreground">Link review · {items.length}</h3>
      <p className="text-[12px] text-muted-foreground">
        Each existing Ask Sunny account below has exactly the same email as one Woven employee. Nothing is linked until a person confirms it.
        Linking changes nobody&apos;s access.
      </p>
      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <ReviewCard key={`${item.account.appUserId}:${item.externalEmployeeId}`} item={item} disabled={disabled} />
        ))}
      </ul>
    </section>
  );
}
