"use client";

import * as React from "react";
import { AlertTriangle, Check, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/feedback";
import { formsFetch } from "@/features/forms/forms-fetch";
import {
  ResponsiveForm,
  type ResponsiveFormValues,
} from "@/features/forms/document/responsive-form";
import { useSession } from "@/lib/session/session-context";
import type {
  FieldResponsibility,
  FormDocument,
  FormVariant,
} from "@/lib/forms/document";
import type { ChatFormInstanceRef } from "@/types";

/**
 * ============================================================================
 * THE REAL FORM, INSIDE THE CONVERSATION
 * ============================================================================
 *
 * THE POSTGRES ROW IS THE SOURCE OF TRUTH, AND THIS COMPONENT IS BUILT AROUND
 * THAT ONE SENTENCE. The chat message stores an id; every render fetches the
 * instance by that id; every save is a request whose response is what gets
 * displayed next. Nothing about the form's contents lives in IndexedDB.
 *
 * Why it has to work this way: a form is an HR record that outlives the browser
 * it was created in. It gets edited from Form Monitoring, finalized, revised and
 * read by people who were never in this conversation. A copy of its values in
 * chat would be stale the first time any of that happened — and stale in the
 * most dangerous direction, because it would look authoritative.
 *
 * ============================================================================
 * WHAT IT DOES WHEN THE SERVER SAYS NO
 * ============================================================================
 *
 *   404  the form is gone. Say so. Do NOT create another one — the manager
 *        asked for a form once, and silently making a second is how duplicate
 *        disciplinary records happen.
 *   403  no longer permitted. Say so, for the same reason.
 *   finalized  render it read-only. Phase 4 adds the finalized controls; this
 *        phase must simply not assume every referenced form stays a draft.
 */

interface LoadedValueRow {
  fieldKey: string;
  value: string | null;
  checked: string[];
  filledBy: FieldResponsibility;
}

interface LoadedInstance {
  instance: {
    id: string;
    templateName: string;
    templateVersion: number;
    templateVersionId: string;
    variantKey: string | null;
    employeeName: string;
    locationId: string | null;
    locationName: string | null;
    status: "draft" | "finalized" | "revised";
  };
  version: { document: FormDocument; variants: FormVariant[] };
  values: LoadedValueRow[];
}

type SaveState =
  | { kind: "clean" }
  | { kind: "dirty" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "error"; message: string };

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; loaded: LoadedInstance }
  | { kind: "gone"; message: string };

function splitValues(rows: LoadedValueRow[]): ResponsiveFormValues {
  const values: Record<string, string> = {};
  const checked: Record<string, string[]> = {};
  for (const row of rows) {
    if (row.value !== null) values[row.fieldKey] = row.value;
    if (row.checked.length) checked[row.fieldKey] = row.checked;
  }
  return { values, checked };
}

export function InlineForm({
  reference,
  /** Set when the AI prefill failed after the instance was created. */
  draftWarning = null,
}: {
  reference: ChatFormInstanceRef;
  draftWarning?: string | null;
}) {
  const { role, user } = useSession();
  const [load, setLoad] = React.useState<LoadState>({ kind: "loading" });
  const [edits, setEdits] = React.useState<ResponsiveFormValues>({ values: {}, checked: {} });
  const [save, setSave] = React.useState<SaveState>({ kind: "clean" });

  const call = React.useCallback(
    <T,>(url: string, init: RequestInit = {}) => formsFetch<T>(url, role, user.name, init),
    [role, user.name],
  );

  const instanceId = reference.instanceId;

  /*
   * FETCH ON MOUNT, AND AFTER A REFRESH THIS IS THE ONLY PATH THERE IS. The
   * conversation reloads from IndexedDB carrying an id; the values come from
   * the server. Local edits are deliberately reset by a fresh load: what the
   * server holds is what the form says.
   */
  React.useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const loaded = await call<LoadedInstance>(`/api/forms/instances/${instanceId}`);
        if (cancelled) return;
        setLoad({ kind: "ready", loaded });
        setEdits(splitValues(loaded.values));
        setSave({ kind: "clean" });
      } catch (error) {
        if (cancelled) return;
        setLoad({ kind: "gone", message: (error as Error).message });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [call, instanceId]);

  if (load.kind === "loading") {
    return (
      <div className="mt-4 flex items-center gap-2 rounded-[var(--radius-md)] border border-border bg-surface-muted px-4 py-3 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
        Opening {reference.templateName}…
      </div>
    );
  }

  if (load.kind === "gone") {
    return (
      <Notice tone="attention" className="mt-4">
        <span className="font-semibold text-foreground">This form is not available</span>
        <p className="mt-0.5">
          {load.message} Ask Sunny has not created another one — if you still need this
          form, start a new conversation about it.
        </p>
      </Notice>
    );
  }

  const { loaded } = load;
  const readOnly = loaded.instance.status !== "draft";
  const variant =
    loaded.version.variants.find((entry) => entry.key === loaded.instance.variantKey) ?? null;

  function change(next: ResponsiveFormValues) {
    setEdits(next);
    // "Saved" must never survive a keystroke — it would be describing the
    // previous state of the form.
    setSave({ kind: "dirty" });
  }

  async function submit() {
    if (save.kind === "saving") return;
    setSave({ kind: "saving" });
    try {
      const result = await call<{ values: LoadedValueRow[] }>(
        `/api/forms/instances/${instanceId}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ values: edits.values, checked: edits.checked }),
        },
      );
      /*
       * The response carries the RELOADED instance, so what is displayed after
       * a save is what the server stored — including any value it rejected
       * because the template does not let a person write it.
       */
      setEdits(splitValues(result.values));
      setSave({ kind: "saved" });
    } catch (error) {
      /*
       * THE MANAGER'S TYPING SURVIVES A FAILED SAVE. `edits` is untouched here
       * on purpose: they may have spent five minutes on the details field, and
       * discarding it to show a clean error would be the worst possible
       * response to a network blip.
       */
      setSave({ kind: "error", message: (error as Error).message });
    }
  }

  return (
    <div className="mt-4 min-w-0 rounded-[var(--radius-md)] border border-border bg-surface-muted p-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[13px] font-semibold text-foreground">
          {loaded.instance.templateName}
        </p>
        <Badge tone={readOnly ? "outline" : "accent"} size="sm">
          {readOnly ? "Finalized" : "Draft"}
        </Badge>
      </div>

      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
        <dt className="text-subtle-foreground">Employee</dt>
        <dd className="min-w-0 text-foreground">{loaded.instance.employeeName}</dd>
        <dt className="text-subtle-foreground">Salon</dt>
        <dd className="min-w-0 text-foreground">
          {/*
            THE ID, OR NOTHING. `location_name` is only set when a caller
            supplied one, and chat deliberately supplies none: the only source
            of a salon display name in this app is `DEMO_LOCATIONS`, which is
            seeded demo data. See docs/chat-phase-3.md.
          */}
          {loaded.instance.locationName ?? (
            <span className="font-mono text-[11px]">
              {loaded.instance.locationId ?? "—"}
            </span>
          )}
        </dd>
      </dl>

      {draftWarning ? (
        <Notice tone="attention" className="mt-3">
          {draftWarning}
        </Notice>
      ) : null}

      <div className="mt-4 min-w-0 border-t border-border pt-4">
        <ResponsiveForm
          document={loaded.version.document}
          variant={variant}
          values={edits}
          readOnly={readOnly}
          onValue={(key, value) =>
            change({ ...edits, values: { ...edits.values, [key]: value } })
          }
          onToggle={(key, option) => {
            const current = edits.checked[key] ?? [];
            const next = current.includes(option)
              ? current.filter((entry) => entry !== option)
              : [...current, option];
            change({ ...edits, checked: { ...edits.checked, [key]: next } });
          }}
        />
      </div>

      {readOnly ? (
        <p className="mt-4 text-xs text-subtle-foreground">
          This form is finalized, so its values are frozen. A correction is a revision.
        </p>
      ) : (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            onClick={() => void submit()}
            disabled={save.kind === "saving" || save.kind === "clean"}
          >
            {save.kind === "saving" ? <Loader2 className="animate-spin" /> : null}
            {save.kind === "saving" ? "Saving…" : "Save changes"}
          </Button>

          {/* "Saved" appears only after the server said so. */}
          {save.kind === "saved" ? (
            <span className="flex items-center gap-1 text-xs text-status-ready">
              <Check className="size-3.5" aria-hidden />
              Saved
            </span>
          ) : null}
          {save.kind === "dirty" ? (
            <span className="text-xs text-muted-foreground">Unsaved changes</span>
          ) : null}
          {save.kind === "error" ? (
            <span className="flex items-center gap-1 text-xs text-status-attention">
              <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
              {save.message} Your changes are still here — try again.
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}
