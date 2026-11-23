"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { canSeeAssignmentTracker, type Half, type MarkState } from "@/lib/ai-training/assignments";
import { addAssignmentPeople, loadAssignmentTracker, removeAssignmentPerson, setAssignmentMark } from "@/lib/ai-training/assignments-repository";
import { authorizeRequest } from "@/lib/auth/server";
import type { AuthenticatedIdentity } from "@/lib/auth/types";

import type { ActionResult } from "./actions";

/**
 * AI TRAINING -> ASSIGNMENTS: THE TRACKER'S SERVER FUNCTIONS.
 *
 * Anyone who can reach the app can call a Server Function, so each one checks the caller first: a verified identity
 * with `view_ai_training` (`authorizeRequest`, as every API route), AND on the tracker's named list
 * (`canSeeAssignmentTracker`). Inputs are validated here, never trusted from the form. Failures are returned, not
 * thrown, so the message reaches the person.
 */

async function trackerUser(): Promise<AuthenticatedIdentity> {
  const request = new Request("http://ai-training.internal/", { headers: new Headers(await headers()) });
  const { identity } = await authorizeRequest(request, "view_ai_training");
  if (!canSeeAssignmentTracker(identity)) throw new Error("The assignment tracker is limited to the people it was set up for.");
  return identity;
}

async function attempt(work: () => Promise<void>): Promise<ActionResult> {
  try {
    await work();
    revalidatePath("/ai-training");
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Something went wrong." };
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONTH = /^20[0-9]{2}-(0[1-9]|1[0-2])$/;
const DAY = /^20[0-9]{2}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;

function personId(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new Error("Unknown person.");
  return value;
}

export async function addAssignmentPeopleAction(input: { names: string; group: string; startDate: string }): Promise<ActionResult> {
  return attempt(async () => {
    const identity = await trackerUser();
    const typed = String(input?.names ?? "")
      .split("\n")
      .map((s) => s.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    if (!typed.length) throw new Error("Type at least one name.");
    if (typed.some((n) => n.length > 200)) throw new Error("A name is too long (200 characters at most).");
    const group = String(input?.group ?? "").trim();
    if (group.length > 100) throw new Error("The group is too long (100 characters at most).");
    const startDate = String(input?.startDate ?? "").trim();
    if (startDate && !DAY.test(startDate)) throw new Error("The start date is not a date.");
    // Names already on the roster (any case) are skipped, as are repeats in what was typed.
    const have = new Set((await loadAssignmentTracker()).people.map((p) => p.name.trim().toLowerCase()));
    const fresh = typed.filter((n) => {
      const key = n.toLowerCase();
      if (have.has(key)) return false;
      have.add(key);
      return true;
    });
    if (!fresh.length) throw new Error(typed.length === 1 ? "That name is already on the roster." : "Those names are already on the roster.");
    await addAssignmentPeople({ names: fresh, group: group || null, startDate: startDate || null, by: identity.email });
  });
}

export async function removeAssignmentPersonAction(input: { personId: string }): Promise<ActionResult> {
  return attempt(async () => {
    await trackerUser();
    await removeAssignmentPerson(personId(input?.personId));
  });
}

/** Sets one half's mark: "done", "extended" (More time), or null to clear it. */
export async function setAssignmentMarkAction(input: { personId: string; month: string; half: number; state: MarkState | null }): Promise<ActionResult> {
  return attempt(async () => {
    const identity = await trackerUser();
    const month = String(input?.month ?? "");
    if (!MONTH.test(month)) throw new Error("Unknown month.");
    if (input?.half !== 0 && input?.half !== 1) throw new Error("Unknown half of the month.");
    const state = input?.state ?? null;
    if (state !== null && state !== "done" && state !== "extended") throw new Error("Unknown mark.");
    await setAssignmentMark({ personId: personId(input?.personId), month, half: input.half as Half, state, by: identity.email });
  });
}
