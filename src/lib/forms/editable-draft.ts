import "server-only";

import type { AskResponse } from "@/lib/ai/types";

import { authorizeInstance } from "./instance-scope";
import { reviseInstance, type LoadedInstance } from "./instances";

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
 *   (signatures excepted) into a new draft that points back at it, and marks
 *   the original `revised`. What was signed stays exactly as it was signed.
 *
 *   A FORM ALREADY REVISED IS FOLLOWED TO ITS NEWER VERSION, so asking twice
 *   never forks a second revision of the same record — the second request
 *   lands on the draft the first one opened.
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
  options: { revise: boolean } = { revise: true },
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
      if (!options.revise) return found;
      const revision = await reviseInstance(instance.id, actor.id, "revised");
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

/** What the chat says about which record it opened. */
export function openingLine(draft: EditableDraft): string {
  const who = `**${draft.templateName}** for **${draft.employeeName}**`;
  if (draft.opened) {
    return `The ${who} was finalized, so I opened a new draft of it with everything carried over except signatures. The finalized form stays on file unchanged, marked as revised.`;
  }
  if (draft.status === "draft" && draft.revisesInstanceId) {
    return `The ${who} already has a newer draft, so I'm working on that one.`;
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
