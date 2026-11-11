"use client";

import * as React from "react";

import { onFormUpdate } from "@/features/chat/form-update-events";
import { formsFetch } from "@/features/forms/forms-fetch";
import type { RevisionHistoryResponse } from "@/lib/forms/revision-history";
import { useSession } from "@/lib/session/session-context";
import type { ChatFormInstanceRef } from "@/types";

import { editPermissionFor } from "./edit-permission";

export type RevisionHistoryState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly data: RevisionHistoryResponse }
  | { readonly kind: "error"; readonly message: string };

/** `formsFetch` with this browser's demo headers, the way the form card calls it. */
export function useFormsCall() {
  const { role, user } = useSession();
  return React.useCallback(
    <T,>(url: string, init: RequestInit = {}) => formsFetch<T>(url, role, user.name, init),
    [role, user.name],
  );
}

/**
 * Whether this viewer may edit a form of this template: the permission the
 * server's edit check needs (see `edit-permission.ts`), not the one that lets
 * them see the forms list. Preview (`demoMode`) offers it, as the forms list
 * does for its own controls: there the server carries the permission rather
 * than refusing, so hiding it would change nothing a request can do.
 */
export function useMayEditForm(templateName: string): boolean {
  const { can, demoMode } = useSession();
  return demoMode || can(editPermissionFor(templateName));
}

/**
 * A form's revision chain, read from `GET /api/forms/instances/[id]/history`
 * and read again whenever a chat turn changes that form, or `reload` is
 * called after the card itself changed it.
 */
export function useRevisionHistory(instanceId: string) {
  const call = useFormsCall();
  const [state, setState] = React.useState<RevisionHistoryState>({ kind: "loading" });
  const [tick, setTick] = React.useState(0);
  const reload = React.useCallback(() => setTick((value) => value + 1), []);

  React.useEffect(() => onFormUpdate(instanceId, reload), [instanceId, reload]);
  React.useEffect(() => {
    let live = true;
    call<RevisionHistoryResponse>(`/api/forms/instances/${instanceId}/history`)
      .then((data) => {
        if (live) setState({ kind: "ready", data });
      })
      .catch((error: unknown) => {
        if (live) setState({ kind: "error", message: (error as Error).message });
      });
    return () => {
      live = false;
    };
  }, [call, instanceId, tick]);

  return { state, reload };
}

/**
 * Opens the revision of a finalized form, with the manager's reason. The
 * server answers the draft already open, when there is one, without asking.
 */
export async function openRevisionWithReason(
  call: ReturnType<typeof useFormsCall>,
  reference: ChatFormInstanceRef,
  reason: string,
): Promise<ChatFormInstanceRef> {
  const result = await call<{ instance: { id: string; templateName?: string } }>(
    `/api/forms/instances/${reference.instanceId}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "revise", reason }),
    },
  );
  return {
    ...reference,
    instanceId: result.instance.id,
    templateName: result.instance.templateName || reference.templateName,
  };
}
