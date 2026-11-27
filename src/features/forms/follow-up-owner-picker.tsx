"use client";

import * as React from "react";
import { Loader2, UserRound } from "lucide-react";

/**
 * WHO OWNS THIS FOLLOW-UP (the owner, 27 Nov 2026: hand a form's follow-up to someone else, e.g. the DM).
 *
 * One control for Form Monitoring's row and the form itself. Shows who does the follow-up (the creator unless someone
 * else was named); "Change" asks the server who may own it — only people with access to the form's salon and its forms
 * (`GET /api/forms/instances/{id}/follow-up/owner`) — and saves through the same route, whose checks decide. A refusal
 * is shown in the server's own words.
 */
interface OwnerRead {
  owner: { id: string; name: string } | null;
  creator: { id: string; name: string };
  choices: { id: string; name: string }[];
}

export function FollowUpOwnerPicker({
  formId,
  ownerName,
  send,
  onChanged,
  disabled = false,
  ownerId = null,
}: {
  formId: string;
  /** The named owner's name, or null when the creator does it. */
  ownerName: string | null;
  /** The host's forms fetch (`formsFetch` with the signed-in role); throws the server's message on a refusal. */
  send: <T>(url: string, init?: RequestInit) => Promise<T>;
  /** Called with the new owner's name (null: back to the creator) once the server has saved it. */
  onChanged?: (name: string | null) => void;
  disabled?: boolean;
  /** The named owner's account, when the host knows the id but not the name (the form itself): read once on mount. */
  ownerId?: string | null;
}) {
  const [open, setOpen] = React.useState(false);
  const [read, setRead] = React.useState<OwnerRead | null>(null);
  const [choice, setChoice] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [problem, setProblem] = React.useState<string | null>(null);
  /* What this control saved or read itself; until then, the host's name. */
  const [own, setOwn] = React.useState<{ name: string | null } | null>(null);
  const shown = own ? own.name : ownerName;
  const setShown = (name: string | null) => setOwn({ name });

  const url = `/api/forms/instances/${encodeURIComponent(formId)}/follow-up/owner`;

  React.useEffect(() => {
    if (!ownerId || ownerName) return;
    let cancelled = false;
    send<OwnerRead>(url)
      .then((loaded) => {
        if (!cancelled) setShown(loaded.owner?.name ?? null);
      })
      .catch(() => {
        if (!cancelled) setShown("someone else");
      });
    return () => {
      cancelled = true;
    };
  }, [ownerId, ownerName, send, url]);

  async function start() {
    setOpen(true);
    setBusy(true);
    setProblem(null);
    try {
      const loaded = await send<OwnerRead>(url);
      setRead(loaded);
      setChoice(loaded.owner?.id ?? "");
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    setProblem(null);
    try {
      const saved = await send<{ owner: { id: string; name: string } | null }>(url, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ownerId: choice || null }),
      });
      const name = saved.owner?.name ?? null;
      setShown(name);
      setOpen(false);
      onChanged?.(name);
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const control =
    "rounded-[var(--radius-sm)] border border-border bg-background px-2 py-1 text-xs text-foreground disabled:opacity-50";

  return (
    <span className="inline-flex min-w-0 flex-col gap-1">
      {open ? (
        <span className="flex flex-wrap items-center gap-1.5">
          <select
            aria-label="Who owns this follow-up"
            className={control}
            value={choice}
            disabled={busy || !read}
            onChange={(event) => setChoice(event.target.value)}
          >
            <option value="">{read ? `${read.creator.name} (created the form)` : "Loading…"}</option>
            {(read?.choices ?? []).map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
          <button type="button" className={control} disabled={busy || !read} onClick={() => void save()}>
            {busy ? <Loader2 className="inline size-3 animate-spin" aria-hidden /> : null} Save owner
          </button>
          <button type="button" className="text-xs text-muted-foreground hover:text-foreground" disabled={busy} onClick={() => setOpen(false)}>
            Cancel
          </button>
        </span>
      ) : (
        <span className="flex items-center gap-1 text-[11px] text-subtle-foreground">
          <UserRound className="size-3" aria-hidden />
          <span>{shown ? `Owner: ${shown}` : "Owner: the form's creator"}</span>
          {disabled ? null : (
            <button type="button" className="underline-offset-4 hover:text-foreground hover:underline" onClick={() => void start()}>
              Change
            </button>
          )}
        </span>
      )}
      {problem ? (
        <span role="alert" className="text-[11px] text-status-failed">
          {problem}
        </span>
      ) : null}
    </span>
  );
}
