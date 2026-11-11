import "server-only";

import type { AskResponse } from "@/lib/ai/types";

import { authorizeInstance } from "./instance-scope";
import { findOpenRevision, type LoadedInstance } from "./instances";
import { reviseFinalizedForm, RevisionReasonRequiredError } from "./revision-chain";
import { REVISION_RESIGN_NOTICE } from "./revision-history";

/**
 * ============================================================================
 * A FINALIZED FORM IS CHANGED BY OPENING A NEW DRAFT OF IT
 * ============================================================================
 *
 * Production feedback: a manager asked Sunny to "change exit for ashley
 * rogers", then to "duplicate exit … and change date notice given to
 * 9-27-26", and was told both times that a created form cannot be changed. The
 * finalized card said "a correction is a revision" — and nothing anywhere let
 * them make one. The revision existed only as an API action no screen called.
 *
 * So a change to a finalized form now OPENS THAT REVISION, here, for chat and
 * for the card's own button alike:
 *
 *   THE FINALIZED FORM IS NEVER WRITTEN. `reviseInstance` copies its values
 *   and follow-up into a new draft that points back at it. The original is
 *   marked `revised` only when that draft is finalized, so deleting the draft
 *   undoes the whole thing. Signatures are never stored — they are signed on
 *   paper — so the new version is printed and signed like any other.
 *
 *   ONE OPEN DRAFT PER FORM. A finalized form whose revision is still a draft
 *   lands on that draft, and a form already revised is followed to its newer
 *   version, so asking twice never forks a second revision.
 *
 *   EVERY HOP IS RE-AUTHORIZED with the "edit" action, the template's own
 *   permission and the salon scope, exactly as a save is.
 */

/** Far more hops than any real revision history; a bound, not a limit. */
const MAX_HOPS = 25;

export interface EditableDraft {
  instanceId: string;
  templateName: string;
  employeeName: string;
  status: LoadedInstance["instance"]["status"];
  /** The record this draft revises, when it is a revision. */
  revisesInstanceId: string | null;
  /** True when THIS call opened the revision. */
  opened: boolean;
}

/**
 * The record a change to `instanceId` should land on: the form itself while it
 * is a draft, the newer version of a revised one, or — with `revise` — a new
 * revision of a finalized one. Without `revise`, the finalized form is returned
 * as it is, which is what "show me the form" wants.
 */
export async function openEditableDraft(
  request: Request,
  instanceId: string,
  /**
   * `reason`: why the finalized form is being edited. With
   * `FORM_REVISIONS_ENABLED` on, opening a new revision without one throws
   * `RevisionReasonRequiredError` (see `reviseFinalizedForm`); chat passes
   * none, so chat sends the manager to the card's reason dialog.
   */
  options: { revise: boolean; reason?: string } = { revise: true },
): Promise<EditableDraft> {
  let id = instanceId;
  for (let hop = 0; hop < MAX_HOPS; hop += 1) {
    const { actor, loaded } = await authorizeInstance(request, id, "edit");
    const instance = loaded.instance;
    const found = {
      instanceId: instance.id,
      templateName: instance.templateName,
      employeeName: instance.employeeName,
      status: instance.status,
      revisesInstanceId: instance.revisesInstanceId ?? null,
      opened: false,
    };

    if (instance.status === "draft") return found;
    if (instance.status === "finalized") {
      // A revision already open is the draft, whether or not this call revises.
      const open = await findOpenRevision(instance.id);
      if (open) {
        id = open.id;
        continue;
      }
      if (!options.revise) return found;
      const revision = await reviseFinalizedForm(instance.id, actor.id, "revised", options.reason);
      return {
        instanceId: revision.id,
        templateName: revision.templateName || instance.templateName,
        employeeName: revision.employeeName || instance.employeeName,
        status: revision.status,
        revisesInstanceId: instance.id,
        opened: true,
      };
    }

    // Revised: the newer version is named on the original's own history.
    const next = newerVersionOf(loaded);
    if (!next) throw new Error("That form was revised, but its newer version could not be found.");
    id = next;
  }
  throw new Error("That form's revision history is longer than expected.");
}

/** The revision a `revised` form points to, from its `revised` event. */
export function newerVersionOf(loaded: Pick<LoadedInstance, "events">): string | null {
  for (let index = loaded.events.length - 1; index >= 0; index -= 1) {
    const event = loaded.events[index]!;
    if (event.kind !== "revised" && event.kind !== "reevaluated") continue;
    const revisionId = event.detail?.revisionId;
    if (typeof revisionId === "string" && revisionId !== "") return revisionId;
  }
  return null;
}

/**
 * ============================================================================
 * A CHANGE ASKED OF A FINALIZED FORM, MADE ON ITS NEW DRAFT
 * ============================================================================
 *
 * Opens (or finds) the editable draft, runs `apply` against it — the same
 * correction or redraft the turn would have made on a draft — and says what
 * happened in that order: which record now carries the change, then the
 * change. `apply` returning null still leaves the draft open, and the reply
 * says so rather than pretending nothing happened.
 *
 * The response carries `formOpened`, so the chat puts the draft's card in the
 * thread: the manager can see and edit it straight away.
 */
export async function changeOnEditableDraft(
  request: Request,
  instanceId: string,
  apply: (draftId: string) => Promise<AskResponse | null>,
): Promise<AskResponse> {
  let draft: EditableDraft;
  try {
    draft = await openEditableDraft(request, instanceId);
  } catch (error) {
    if (error instanceof RevisionReasonRequiredError) return reasonRequiredReply(request, instanceId);
    return reply(
      `That form is finalized, and I couldn't open a new draft of it: ${(error as Error).message} You can try again from the form card's **Edit as new draft** button.`,
    );
  }
  const applied = await apply(draft.instanceId);
  return {
    ...reply(
      [
        openingLine(draft),
        applied?.content ?? "Edit anything that needs changing below, save, and finalize it when it's ready.",
      ].join("\n\n"),
    ),
    ...(applied?.formUpdate ? { formUpdate: applied.formUpdate } : {}),
    formOpened: formOpenedFor(draft),
  };
}

/**
 * ============================================================================
 * A CHAT EDIT OF A FINALIZED FORM, WITH NO REASON GIVEN
 * ============================================================================
 *
 * `FORM_REVISIONS_ENABLED`: every edit of a finalized form says why, and a
 * chat turn carries no reason field. So the change is not made; the reply
 * says why, and puts the finalized form's card in the thread, where Edit as
 * new draft asks for the reason. Once that draft is open, the same request in
 * chat lands on it (an open revision needs no second reason).
 */
export async function reasonRequiredReply(request: Request, instanceId: string): Promise<AskResponse> {
  let found: EditableDraft | null = null;
  try {
    found = await openEditableDraft(request, instanceId, { revise: false });
  } catch {
    found = null;
  }
  const who = found ? `The **${found.templateName}** for **${found.employeeName}**` : "That form";
  return {
    ...reply(
      `${who} is finalized, and editing a finalized form needs a reason, which is kept on the form's history. Press **Edit as new draft** on the form, say why it's being changed, then tell me the change again and I'll make it on the new draft. ${REVISION_RESIGN_NOTICE}`,
    ),
    ...(found ? { formOpened: formOpenedFor(found) } : {}),
  };
}

/** What the chat says about which record it opened. */
export function openingLine(draft: EditableDraft): string {
  const who = `**${draft.templateName}** for **${draft.employeeName}**`;
  if (draft.opened) {
    return `The ${who} was finalized, so I opened a new draft of it with every answer and the follow-up carried over. The finalized form stays on file unchanged until you finalize this draft, which then replaces it — delete the draft instead and nothing changes. Signatures are on paper, so print and sign the new version once it's final.`;
  }
  if (draft.status === "draft" && draft.revisesInstanceId) {
    return `The ${who} already has a new draft open — here it is. It replaces the finalized form once you finalize it.`;
  }
  if (draft.status === "draft") return `The ${who} is still a draft, so it's open to edit.`;
  return `Here's the ${who}. It's finalized — press **Edit as new draft** on it to make a change.`;
}

export function formOpenedFor(draft: EditableDraft): NonNullable<AskResponse["formOpened"]> {
  return {
    instanceId: draft.instanceId,
    templateName: draft.templateName,
    revisesInstanceId: draft.opened ? draft.revisesInstanceId : null,
  };
}

function reply(content: string): AskResponse {
  return { content, citations: [], coverage: "not_applicable", recommendedVideoIds: [] };
}
