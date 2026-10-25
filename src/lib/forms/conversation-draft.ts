import "server-only";

import { wantsSeparateDocument } from "@/lib/ai/second-form";
import { getSupabaseAdmin } from "@/lib/supabase/server";

import { correctActiveForm } from "./chat-correction";
import { sameEmployee } from "./draft-reopen";
import { loadInstance, type InstanceRow } from "./instances";

/**
 * ONE DRAFT PER FORM IN A CONVERSATION (CONVERSATION_DRAFT_REUSE_ENABLED).
 *
 * Meeting M5 / QA F7, 24 Oct 2026: every new card in a chat filed a new draft.
 * One manager pressed Create on three cards for the same person in one chat
 * ("create a corrective action form for …", "Please create another corrective
 * action …", "I need it to be a corrective action form") and got three drafts.
 * Another got two in one chat because a later turn named a different date.
 *
 * The cards had different ids, so the card guard did not apply, and one
 * "another" anywhere in the chat switched the any-chat guard off for every
 * later card. Here, a draft this chat already made for the same form and
 * employee is opened again, unless a manager turn SINCE that draft asked for
 * a separate document.
 *
 * The caller's own drafts only, still a draft, made in the last 24 hours.
 */

const WINDOW_MS = 24 * 3_600_000;

export interface ConversationTurn {
  readonly id?: string;
  readonly role: string;
  readonly content: string;
}

export interface ConversationDraftRow {
  readonly id: string;
  readonly employeeName: string;
  readonly templateId: string;
  readonly createdAt: string;
  /** The chat that made it, as recorded on its `created` event. */
  readonly conversation: string | null;
  /** The last manager turn the chat had when it was made. */
  readonly lastTurnId: string | null;
}

export interface ConversationDraftWanted {
  readonly templateId: string;
  readonly employeeName: string;
  readonly conversationKey: string;
  readonly turns: readonly ConversationTurn[];
}

/** The id of the last manager turn, recorded on the draft so later turns can be told apart. */
export function lastManagerTurnId(turns: readonly ConversationTurn[]): string | null {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index]!;
    if (turn.role === "user" && typeof turn.id === "string" && turn.id) return turn.id;
  }
  return null;
}

/*
 * "ALSO CREATE A CA FOR HER FOR DRESS CODE ON 10-22" IS A SECOND DOCUMENT.
 * `wantsSeparateDocument` reads "another", "second", "new" and "separate";
 * QA, 24 Oct 2026: "also" asking for a form in the same chat is a second
 * incident too, and must make its own draft; "one more CA" likewise. "She
 * also left the form unsigned" asks for nothing, so a create verb is needed.
 */
const FORM_WORD = String.raw`(?:ca|cas|corrective action|coaching|write[- ]?up|form|document)`;
const ALSO_A_FORM = new RegExp(
  String.raw`\balso\b[^.?!\n]*\b(?:create|make|start|do|write|draft|file|open|need|want)\b[^.?!\n]*\b${FORM_WORD}\b|\bone more\s+${FORM_WORD}\b`,
  "i",
);

function asksForAnotherDocument(text: string): boolean {
  return wantsSeparateDocument(text) || ALSO_A_FORM.test(text);
}

/**
 * Whether a manager turn after `lastTurnId` asked for another document. A
 * draft that recorded no turn is judged on every turn, as the any-chat guard
 * does. A recorded turn no longer in the window is older than every turn sent.
 */
export function separateAskedSince(turns: readonly ConversationTurn[], lastTurnId: string | null): boolean {
  const at = lastTurnId ? turns.findIndex((turn) => turn.id === lastTurnId) : -1;
  return turns
    .slice(at + 1)
    .some((turn) => turn.role === "user" && asksForAnotherDocument(turn.content));
}

/**
 * The newest draft this chat made for the same form and employee that a later
 * turn did not set aside. An "another" said after the newest draft was said
 * after every older one too, so the first draft not set aside is the answer,
 * however two drafts made in the same instant are ordered.
 */
export function pickConversationDraft(
  rows: readonly ConversationDraftRow[],
  wanted: ConversationDraftWanted,
): string | null {
  const kept = rows
    .filter(
      (row) =>
        row.conversation === wanted.conversationKey &&
        row.templateId === wanted.templateId &&
        sameEmployee(row.employeeName, wanted.employeeName),
    )
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .find((row) => !separateAskedSince(wanted.turns, row.lastTurnId));
  return kept?.id ?? null;
}

export async function findConversationDraft(input: {
  readonly createdBy: string;
  readonly templateKey: string;
  readonly employeeName: string;
  readonly conversationKey: string;
  readonly turns: readonly ConversationTurn[];
  readonly now?: Date;
}): Promise<{ instance: InstanceRow; lastTurnId: string | null } | null> {
  if (!input.conversationKey) return null;
  const supabase = getSupabaseAdmin();
  const { data: template, error: templateError } = await supabase
    .from("form_templates")
    .select("id")
    .eq("key", input.templateKey)
    .maybeSingle();
  if (templateError || !template) return null;

  const since = new Date((input.now ?? new Date()).getTime() - WINDOW_MS).toISOString();
  const { data, error } = await supabase
    .from("form_instances")
    .select("id, employee_name, template_id, created_at")
    .eq("created_by", input.createdBy)
    .eq("template_id", template.id)
    .eq("source", "ask_sunny")
    .eq("status", "draft")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(25);
  if (error || !Array.isArray(data) || data.length === 0) return null;

  const instances = data as { id: unknown; employee_name: unknown; template_id: unknown; created_at: unknown }[];
  const { data: events, error: eventsError } = await supabase
    .from("form_instance_events")
    .select("instance_id, detail")
    .in(
      "instance_id",
      instances.map((row) => String(row.id)),
    )
    .eq("kind", "created");
  if (eventsError || !Array.isArray(events)) return null;

  const recorded = new Map<string, { conversation: string | null; lastTurnId: string | null }>();
  for (const event of events as { instance_id: unknown; detail: unknown }[]) {
    const detail = (event.detail ?? {}) as { draftConversation?: unknown; draftTurn?: unknown };
    recorded.set(String(event.instance_id), {
      conversation: typeof detail.draftConversation === "string" ? detail.draftConversation : null,
      lastTurnId: typeof detail.draftTurn === "string" ? detail.draftTurn : null,
    });
  }

  const rows: ConversationDraftRow[] = instances.map((row) => ({
    id: String(row.id),
    employeeName: String(row.employee_name ?? ""),
    templateId: String(row.template_id ?? ""),
    createdAt: String(row.created_at ?? ""),
    conversation: recorded.get(String(row.id))?.conversation ?? null,
    lastTurnId: recorded.get(String(row.id))?.lastTurnId ?? null,
  }));

  const id = pickConversationDraft(rows, {
    templateId: String(template.id),
    employeeName: input.employeeName,
    conversationKey: input.conversationKey,
    turns: input.turns,
  });
  if (!id) return null;
  const loaded = await loadInstance(id);
  if (loaded?.instance.status !== "draft") return null;
  return { instance: loaded.instance, lastTurnId: rows.find((row) => row.id === id)?.lastTurnId ?? null };
}

/**
 * THE FACTS SAID SINCE THE DRAFT WAS MADE GO ONTO IT (QA, 24 Oct 2026).
 *
 * A reused draft that opened without "prior verbal 9-1-26, no payroll", said
 * between the two cards, would have the manager type it again (meeting M1).
 * Each manager turn after the draft's recorded turn is read, in order and
 * with the conversation up to it, by the readers that correct a form already
 * open in chat (`correctActiveForm`): an empty field is filled, a field the
 * manager named ("change the date to 10-22") is changed, and nothing the
 * manager did not say is written. A turn they find nothing in changes nothing.
 */
export async function applyTurnsSinceDraft(input: {
  readonly request: Request;
  readonly instanceId: string;
  readonly turns: readonly ConversationTurn[];
  readonly lastTurnId: string | null;
  readonly today: string;
}): Promise<void> {
  // A draft that recorded no turn has no "since": nothing is replayed onto it.
  if (!input.lastTurnId) return;
  // A recorded turn the window no longer holds is older than every turn sent.
  const at = input.turns.findIndex((turn) => turn.id === input.lastTurnId);
  for (let index = at + 1; index < input.turns.length; index += 1) {
    const turn = input.turns[index]!;
    if (turn.role !== "user") continue;
    const history = input.turns.slice(0, index);
    // The whole turn first ("no" answering the payroll question), then each clause.
    for (const question of [turn.content, ...clausesOf(turn.content)].map(withLevelNoun)) {
      await correctActiveForm({ request: input.request, instanceId: input.instanceId, question, today: input.today, history });
    }
  }
}

/*
 * "PRIOR VERBAL 9-1-26": the prior-step reader (`priorSteps`, in a module this
 * change may not edit) reads "prior coaching 9-1-26" and "had a verbal on
 * 9-1-26" but not a bare level after "prior" / "previous". The level is read
 * here as the warning it names — the label "had a verbal" already gets.
 */
export function withLevelNoun(text: string): string {
  return text.replace(/\b(prior|previous)\s+(final\s+written|written|verbal)\s+(?=(?:on\s+)?\d)/gi, "$1 $2 warning ");
}

/*
 * "PRIOR VERBAL 9-1-26, NO PAYROLL" IS TWO FACTS. The correction readers take
 * one fact a turn — the payroll answer here, and the prior action was lost —
 * so a turn that lists several is also read a clause at a time. Writing the
 * same fact twice changes nothing: a Prior Actions line already there is not
 * added again, and a Yes / No is the same Yes / No.
 */
export function clausesOf(text: string): string[] {
  const parts = text
    .split(/;\s*|\.\s+|,\s*(?=[a-z])|\s+and\s+(?=(?:no|yes|prior|previous|payroll|verbal|written|change|date)\b)/i)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length > 1 ? parts : [];
}

/**
 * Notes on the new draft's own `created` event which chat made it and that
 * chat's last manager turn, for `findConversationDraft`. Best effort: a draft
 * whose note could not be written is simply not matched later.
 */
export async function noteConversationDraft(
  instanceId: string,
  conversationKey: string,
  lastTurnId: string | null,
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("form_instance_events")
    .select("id, detail")
    .eq("instance_id", instanceId)
    .eq("kind", "created")
    .limit(1);
  if (error || !Array.isArray(data) || data.length === 0) return;
  const event = data[0] as { id: unknown; detail: unknown };
  const detail = (event.detail && typeof event.detail === "object" ? event.detail : {}) as Record<string, unknown>;
  await supabase
    .from("form_instance_events")
    .update({
      detail: { ...detail, draftConversation: conversationKey, ...(lastTurnId ? { draftTurn: lastTurnId } : {}) },
    })
    .eq("id", event.id);
}
