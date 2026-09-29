"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { ROLE_LABEL, ROLES } from "@/lib/permissions";
import type { LocationMappingRow, PositionMappingRow } from "@/lib/employees/woven/view-types";

/**
 * The two review forms. Each saves ONE map row through its route and nothing
 * else: a location's salon, a position's role, default scope and rank. They
 * change nobody's access — phase one uses a mapping as a label only.
 * Disabled on sample data and in demo mode, where the routes refuse.
 */

const input = "h-8 rounded-[var(--radius-sm)] border border-border bg-surface px-2 text-[12.5px]";
const button = "h-8 rounded-[var(--radius-sm)] border border-border px-2.5 text-[12px] font-semibold disabled:opacity-50";

async function patch(url: string, body: unknown): Promise<string | null> {
  try {
    const response = await fetch(url, {
      method: "PATCH",
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

export function LocationReviewForm({ row, disabled }: { row: LocationMappingRow; disabled: boolean }) {
  const router = useRouter();
  const [salonNumber, setSalonNumber] = useState(row.salonNumber ?? row.suggestedSalonNumber ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(status: "mapped" | "ignored" | "unmapped") {
    setBusy(true);
    setError(null);
    const failure = await patch("/api/admin/employees/woven/locations", {
      wovenLocationId: row.wovenLocationId,
      status,
      ...(status === "mapped" ? { salonNumber } : {}),
    });
    setBusy(false);
    if (failure) setError(failure);
    else router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <label className="sr-only" htmlFor={`salon-${row.wovenLocationId}`}>
        Ask Sunny salon number
      </label>
      <input
        id={`salon-${row.wovenLocationId}`}
        className={`${input} w-24 font-mono`}
        value={salonNumber}
        onChange={(e) => setSalonNumber(e.target.value)}
        placeholder="0306"
        disabled={disabled || busy}
      />
      <button type="button" className={button} disabled={disabled || busy || salonNumber.trim() === ""} onClick={() => save("mapped")}>
        {row.status === "mapped" ? "Change" : row.suggestedSalonNumber && salonNumber === row.suggestedSalonNumber ? "Confirm" : "Map"}
      </button>
      {row.status !== "ignored" ? (
        <button type="button" className={button} disabled={disabled || busy} onClick={() => save("ignored")}>
          Ignore
        </button>
      ) : null}
      {row.status !== "unmapped" ? (
        <button type="button" className={button} disabled={disabled || busy} onClick={() => save("unmapped")}>
          Unmap
        </button>
      ) : null}
      {error ? (
        <span role="alert" className="text-[11.5px] text-status-failed">
          {error}
        </span>
      ) : null}
    </div>
  );
}

const SCOPES = ["salon", "district", "region", "global"] as const;

export function PositionReviewForm({ row, disabled }: { row: PositionMappingRow; disabled: boolean }) {
  const router = useRouter();
  const [role, setRole] = useState(row.role ?? "");
  const [scope, setScope] = useState(row.scopeLevel ?? "salon");
  const [rank, setRank] = useState(row.hierarchyRank === null ? "" : String(row.hierarchyRank));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(status: "mapped" | "ignored" | "unmapped") {
    setBusy(true);
    setError(null);
    const failure = await patch("/api/admin/employees/woven/positions", {
      wovenPositionId: row.wovenPositionId,
      status,
      ...(status === "mapped" ? { role, scopeLevel: scope, hierarchyRank: rank === "" ? null : Number(rank) } : {}),
    });
    setBusy(false);
    if (failure) setError(failure);
    else router.refresh();
  }

  const id = row.wovenPositionId;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <label className="sr-only" htmlFor={`role-${id}`}>
        Ask Sunny role
      </label>
      <select id={`role-${id}`} className={input} value={role} onChange={(e) => setRole(e.target.value)} disabled={disabled || busy}>
        <option value="">Role…</option>
        {ROLES.map((r) => (
          <option key={r} value={r}>
            {ROLE_LABEL[r]}
          </option>
        ))}
      </select>
      <label className="sr-only" htmlFor={`scope-${id}`}>
        Default scope level
      </label>
      <select id={`scope-${id}`} className={input} value={scope} onChange={(e) => setScope(e.target.value)} disabled={disabled || busy}>
        {SCOPES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <label className="sr-only" htmlFor={`rank-${id}`}>
        Rank (higher is more senior)
      </label>
      <input
        id={`rank-${id}`}
        className={`${input} w-16 tabular-nums`}
        inputMode="numeric"
        placeholder="rank"
        value={rank}
        onChange={(e) => setRank(e.target.value.replace(/[^0-9]/g, "").slice(0, 4))}
        disabled={disabled || busy}
      />
      <button type="button" className={button} disabled={disabled || busy || role === ""} onClick={() => save("mapped")}>
        {row.isConfirmed ? "Save" : "Confirm"}
      </button>
      {row.status !== "ignored" ? (
        <button type="button" className={button} disabled={disabled || busy} onClick={() => save("ignored")}>
          Ignore
        </button>
      ) : null}
      {error ? (
        <span role="alert" className="text-[11.5px] text-status-failed">
          {error}
        </span>
      ) : null}
    </div>
  );
}
