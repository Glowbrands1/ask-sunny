import { createHash } from "node:crypto";

import { getSupabaseAdmin } from "@/lib/supabase/server";
import type { ChatMessage } from "@/types";

/*
 * ============================================================================
 * THE CARD RECORD (the rebuild plan's PR 2; QA's design, 15 Nov 2026)
 * ============================================================================
 *
 * Each card propose_form or coach_team makes is written to that turn's chat_traces row (`slots.agent_loop.card`). It is
 * read back here by conversation id and user, so a later turn knows which earlier replies showed a card, and whose. The
 * browser's history copy is never trusted for it (parseHistory strips cards anyway). This replaces the reply-text
 * readers it took the place of: CARD_REPLY (a reply "reads as" a card) and the bold-name match (whose card it was).
 * There is no migration: `slots` is jsonb. The trace holds no names or ids (nov14-agent-loop-trace-steps-no-values): a
 * card's person is a one-way key (`personKey`) of its roster id, or of the typed name when it is not on the roster.
 */
export interface CardRecord {
  readonly proposalId: string;
  /** `personKey` of the card's person's roster id; null for a team card or a name not on the roster. */
  readonly employeeKey: string | null;
  /** `personKey` of the card's name: to compare a person not on the roster, never to read the name back. */
  readonly nameKey: string | null;
  readonly templateKey: string;
  readonly templateName: string | null;
  /** The manager's message the card's turn answered (the trace's message_id). */
  readonly messageId: string | null;
  /**
   * Fix batch item 7 (16 Nov 2026): the CA-only fields the card's reply asks about ("payroll_deduct", "warning_level"):
   * both after "Payroll deduct and warning level aren't set", payroll alone after a bare answer to that line. Field names
   * only, never values. Empty for an older record.
   */
  readonly asked: readonly string[];
  /**
   * QA (16 Nov 2026; c208, Pau's "every answer is used"): the warning level the card held, kept on the manager's evidence
   * ("verbal" / "written"), so a rebuild of the same card keeps it. A value of the form, never a name. Null when none.
   */
  readonly level?: "verbal" | "written" | null;
  /**
   * QA (16 Nov 2026, c219 live: "That change isn't on the card yet: policy (…)"): the policy line the card cited, a line of
   * the manual (never a name), so a later turn's card check compares the reply with the card on screen. Null when none or
   * for an older record.
   */
  readonly policyLine?: string | null;
}

/** What a turn writes into `slots.agent_loop.card`. */
export type CardSlot = Omit<CardRecord, "messageId" | "asked" | "level" | "policyLine"> & { readonly asked?: readonly string[]; readonly level?: "verbal" | "written"; readonly policyLine?: string };

function isCardSlot(value: unknown): value is CardSlot {
  const row = value as Partial<CardSlot> | null;
  return Boolean(row) && typeof row!.proposalId === "string" && typeof row!.templateKey === "string";
}

/*
 * THE NAME QUESTION RECORD (fix batch items 4 and 3; QA's review of #1051, 16 Nov 2026): a turn whose find_staff gave a
 * "Did you mean" writes which roster people it offered and what the manager had typed into `slots.agent_loop.name_question`,
 * beside the card. The next turn reads the manager's answer against this record, never against the reply's text (a
 * paraphrased question still counts). Like the card, it holds one-way keys only (`personKey`): of each offered person's
 * roster id, and of the typed name; the people are found again in the roster by key.
 */
export interface NameQuestionSlot {
  /** `personKey` of each offered roster person's id, in the order offered. */
  readonly offeredKeys: readonly string[];
  /** `personKey` of the name the manager typed (as find_staff was given it). */
  readonly typedKey: string;
  /**
   * Item 5 follow-up (Pau, 16 Nov 2026): `personKey` of each offered name that is nobody on the roster (the card's person
   * typed by the manager, beside a roster person with a near first name). Absent on older records.
   */
  readonly offeredNameKeys?: readonly string[];
  /** The answer bridge (QA, 16 Nov 2026): the question asked for the full name ("I can't find **<A'>** … give me the full name"). */
  readonly asksFullName?: boolean;
}

export interface NameQuestionRecord extends NameQuestionSlot {
  /** The manager's message the question's turn answered (the trace's message_id). */
  readonly messageId: string | null;
}

function isNameQuestionSlot(value: unknown): value is NameQuestionSlot {
  const row = value as Partial<NameQuestionSlot> | null;
  return Boolean(row) && Array.isArray(row!.offeredKeys) && row!.offeredKeys.every((key) => typeof key === "string") && typeof row!.typedKey === "string";
}

/*
 * THE PERSON ASKED RECORD (fix batch item 6; QA's review of #1051): a turn whose propose_form asked who the form is for
 * (no person yet) writes `slots.agent_loop.person_asked = { templateKey }`. The next turn is then told up front that the
 * manager's message answers it (`answering_who_question`), never by reading the reply. No names.
 */
export interface PersonAskedSlot {
  readonly templateKey: string;
}

export interface PersonAskedRecord extends PersonAskedSlot {
  readonly messageId: string | null;
}

type TraceRow = { message_id: string | null; slots: { agent_loop?: { card?: unknown; name_question?: unknown; person_asked?: unknown } } | null };

type LoopRecords = { cards: CardRecord[]; nameQuestions: NameQuestionRecord[]; personAsked: PersonAskedRecord[] };
const NO_RECORDS = (): LoopRecords => ({ cards: [], nameQuestions: [], personAsked: [] });

/** This user's loop records in this conversation, oldest first, from one read. Empty without a conversation id, or if the read fails. */
export async function readLoopRecords(conversationId: string | undefined, userId: string): Promise<LoopRecords> {
  if (!conversationId) return NO_RECORDS();
  try {
    const { data, error } = await getSupabaseAdmin()
      .from("chat_traces")
      .select("message_id, slots, created_at")
      .eq("conversation_id", conversationId)
      .eq("user_id", userId)
      .order("created_at", { ascending: true });
    if (error) return NO_RECORDS();
    const rows = (data ?? []) as TraceRow[];
    return {
      cards: rows.flatMap((row) => {
        const card = row.slots?.agent_loop?.card;
        return isCardSlot(card)
          ? [{ proposalId: card.proposalId, employeeKey: card.employeeKey ?? null, nameKey: card.nameKey ?? null, templateKey: card.templateKey, templateName: card.templateName ?? null, messageId: row.message_id, asked: Array.isArray(card.asked) ? card.asked.filter((field): field is string => typeof field === "string") : [], level: card.level === "verbal" || card.level === "written" ? card.level : null, policyLine: typeof card.policyLine === "string" ? card.policyLine : null }]
          : [];
      }),
      nameQuestions: rows.flatMap((row) => {
        const asked = row.slots?.agent_loop?.name_question;
        return isNameQuestionSlot(asked)
          ? [{ offeredKeys: [...asked.offeredKeys], typedKey: asked.typedKey, ...(Array.isArray(asked.offeredNameKeys) ? { offeredNameKeys: asked.offeredNameKeys.filter((key): key is string => typeof key === "string") } : {}), ...(asked.asksFullName === true ? { asksFullName: true } : {}), messageId: row.message_id }]
          : [];
      }),
      personAsked: rows.flatMap((row) => {
        const asked = row.slots?.agent_loop?.person_asked as Partial<PersonAskedSlot> | undefined;
        return asked && typeof asked.templateKey === "string" ? [{ templateKey: asked.templateKey, messageId: row.message_id }] : [];
      }),
    };
  } catch {
    return NO_RECORDS();
  }
}

/** The cards this user's loop made in this conversation, oldest first. None without a conversation id, or if the read fails. */
export async function readCardRecords(conversationId: string | undefined, userId: string): Promise<CardRecord[]> {
  return (await readLoopRecords(conversationId, userId)).cards;
}

/**
 * The history's assistant replies that showed a card, by the record: the reply right after the manager's message the
 * card's turn answered. Keyed by the reply's index in `history`.
 */
export function cardTurns(history: readonly ChatMessage[], records: readonly CardRecord[]): Map<number, CardRecord> {
  return replyTurns(history, records);
}

/** The history's assistant replies a record's turn wrote: the reply right after the manager's message that turn answered. */
export function replyTurns<T extends { readonly messageId: string | null }>(history: readonly ChatMessage[], records: readonly T[]): Map<number, T> {
  const byMessage = new Map(records.filter((record) => record.messageId).map((record) => [record.messageId!, record]));
  const shown = new Map<number, T>();
  history.forEach((message, index) => {
    if (message.role !== "user") return;
    const record = byMessage.get(message.id);
    if (!record) return;
    const reply = history.findIndex((later, at) => at > index && later.role === "assistant");
    const nextUser = history.findIndex((later, at) => at > index && later.role === "user");
    if (reply > index && (nextUser < 0 || reply < nextUser) && !history[reply]!.error) shown.set(reply, record);
  });
  return shown;
}

/** A one-way key of a roster id or a name (case and spacing aside): the trace tells two cards' people apart without either. */
export function personKey(name: string): string {
  return createHash("sha256").update(name.trim().toLowerCase().replace(/\s+/g, " ")).digest("hex").slice(0, 16);
}
