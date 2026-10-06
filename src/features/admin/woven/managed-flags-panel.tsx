"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * ============================================================================
 * WOVEN MANAGEMENT FOR LINKED ACCOUNTS — adoption
 * ============================================================================
 *
 * One row per account linked to a Woven EmployeeID. An administrator decides,
 * per account, what Woven may manage: status (Woven's explicit Terminated
 * revokes access), primary salon, and role. Only what the owner's policy
 * allows for that account can be ticked; the server enforces the same policy.
 *
 * Saving changes nobody's access. It only allows a later, separately enabled
 * apply action to act for that field. Every change is audited.
 */

export interface ManagedFlagItem {
  appUserId: string;
  email: string;
  role: string;
  scope: string;
  status: string;
  wovenPosition: string | null;
  isProtected: boolean;
  extraSalonCount: number;
  managed: { status: boolean; location: boolean; role: boolean };
  allowed: { status: boolean; location: boolean; role: boolean };
}

type Flags = ManagedFlagItem["managed"];
const FIELDS: { key: keyof Flags; label: string }[] = [
  { key: "status", label: "Status" },
  { key: "location", label: "Primary salon" },
  { key: "role", label: "Role" },
];

const button = "h-8 rounded-[var(--radius-sm)] border border-border px-2.5 text-[12px] font-semibold disabled:opacity-50";

interface Outcome {
  appUserId: string | null;
  status: "changed" | "unchanged" | "refused";
  reason?: string;
}

async function save(accounts: { appUserId: string; flags: Flags }[]): Promise<{ outcomes: Outcome[]; error: string | null }> {
  try {
    const response = await fetch("/api/admin/employees/woven/links/flags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accounts: accounts.map((a) => ({
          appUserId: a.appUserId,
          managedStatus: a.flags.status,
          managedLocation: a.flags.location,
          managedRole: a.flags.role,
        })),
      }),
    });
    const parsed = (await response.json().catch(() => null)) as { results?: Outcome[]; reason?: string } | null;
    if (!response.ok) return { outcomes: [], error: parsed?.reason ?? `Not saved (HTTP ${response.status}).` };
    return { outcomes: parsed?.results ?? [], error: null };
  } catch {
    return { outcomes: [], error: "Ask Sunny's server could not be reached." };
  }
}

export function ManagedFlagsPanel({ items, disabled }: { items: ManagedFlagItem[]; disabled: boolean }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Record<string, Flags>>(() => Object.fromEntries(items.map((i) => [i.appUserId, i.managed])));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (items.length === 0) return null;

  const dirty = (item: ManagedFlagItem) => FIELDS.some(({ key }) => draft[item.appUserId]![key] !== item.managed[key]);
  const adoptable = items.filter((i) => !i.isProtected && FIELDS.some(({ key }) => i.allowed[key] && !i.managed[key]));

  async function submit(accounts: { appUserId: string; flags: Flags }[]) {
    setBusy(true);
    setMessage(null);
    const { outcomes, error } = await save(accounts);
    setBusy(false);
    if (error) return setMessage(error);
    const refused = outcomes.filter((o) => o.status === "refused");
    const changed = outcomes.filter((o) => o.status === "changed").length;
    setMessage(
      refused.length > 0
        ? `${changed} saved; ${refused.length} refused: ${refused.map((o) => o.reason).join(" ")}`
        : `${changed} account${changed === 1 ? "" : "s"} saved.`,
    );
    setSelected(new Set());
    router.refresh();
  }

  return (
    <section aria-label="Woven management for linked accounts" className="flex flex-col gap-3">
      <header>
        <h3 className="text-[15px] font-semibold">Woven management for linked accounts</h3>
        <p className="text-[12px] text-muted-foreground">
          What Woven may manage for each linked account. Saving changes nobody&rsquo;s access: it only allows a later, separately
          enabled action to act. Salon-tier accounts may have status, primary salon and role managed; District and Regional
          Managers status only; protected accounts nothing.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={button}
          disabled={disabled || busy || selected.size === 0}
          onClick={() =>
            void submit(items.filter((i) => selected.has(i.appUserId)).map((i) => ({ appUserId: i.appUserId, flags: { ...i.allowed } })))
          }
        >
          Apply policy to selected ({selected.size})
        </button>
        <button
          type="button"
          className={button}
          disabled={disabled || busy || adoptable.length === 0}
          onClick={() => setSelected(new Set(adoptable.map((i) => i.appUserId)))}
        >
          Select all not yet adopted ({adoptable.length})
        </button>
        {message ? (
          <p role="status" className="text-[12px]">
            {message}
          </p>
        ) : null}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-[12px]">
          <thead>
            <tr className="border-b border-border">
              <th className="p-2">
                <span className="sr-only">Select</span>
              </th>
              <th className="p-2">Ask Sunny account</th>
              <th className="p-2">Role · scope</th>
              <th className="p-2">Woven position</th>
              {FIELDS.map(({ key, label }) => (
                <th key={key} className="p-2">
                  {label}
                </th>
              ))}
              <th className="p-2">
                <span className="sr-only">Save</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const flags = draft[item.appUserId]!;
              return (
                <tr key={item.appUserId} className="border-b border-border/60 align-top">
                  <td className="p-2">
                    <input
                      type="checkbox"
                      aria-label={`Select ${item.email}`}
                      checked={selected.has(item.appUserId)}
                      disabled={disabled || busy || item.isProtected}
                      onChange={(e) =>
                        setSelected((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(item.appUserId);
                          else next.delete(item.appUserId);
                          return next;
                        })
                      }
                    />
                  </td>
                  <td className="p-2">
                    <div className="font-medium">{item.email}</div>
                    <div className="text-muted-foreground">
                      {item.status}
                      {item.isProtected ? " · protected" : ""}
                      {item.extraSalonCount > 0 ? ` · ${item.extraSalonCount} extra salon${item.extraSalonCount === 1 ? "" : "s"} (review)` : ""}
                    </div>
                  </td>
                  <td className="p-2">
                    {item.role} · {item.scope}
                  </td>
                  <td className="p-2">{item.wovenPosition ?? "—"}</td>
                  {FIELDS.map(({ key, label }) => (
                    <td key={key} className="p-2">
                      <input
                        type="checkbox"
                        aria-label={`${label} managed by Woven for ${item.email}`}
                        checked={flags[key]}
                        disabled={disabled || busy || !item.allowed[key]}
                        title={item.allowed[key] ? undefined : "Not allowed by policy for this account"}
                        onChange={(e) => setDraft((prev) => ({ ...prev, [item.appUserId]: { ...flags, [key]: e.target.checked } }))}
                      />
                    </td>
                  ))}
                  <td className="p-2">
                    <button
                      type="button"
                      className={button}
                      disabled={disabled || busy || !dirty(item)}
                      onClick={() => void submit([{ appUserId: item.appUserId, flags }])}
                    >
                      Save
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
