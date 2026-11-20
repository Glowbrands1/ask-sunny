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
  /** QA (16 Nov 2026, production): a one-way key of the manager's message, to find it when the history's id does not match. */
  readonly questionKey?: string | null;
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
   * QA (16 Nov 2026; c022): the payroll answer the card held, kept on the manager's evidence, and its amount (digits), so a
   * rebuild of the same card keeps them, as the level. Values of the form, never a name. Null when none.
   */
  readonly payroll?: "yes" | "no" | null;
  readonly payrollAmount?: string | null;
  /**
   * QA (16 Nov 2026; c163): a one-way key of the card's account (`accountKey`), never the text. A rebuild that keeps this
   * account is the same card, so it keeps the card's payroll after a reply with no card; a new account is a new card.
   */
  readonly accountKey?: string | null;
  /**
   * QA (16 Nov 2026, c219 live: "That change isn't on the card yet: policy (…)"): the policy line the card cited, a line of
   * the manual (never a name), so a later turn's card check compares the reply with the card on screen. Null when none or
   * for an older record.
   */
  readonly policyLine?: string | null;
  /**
   * QA (20 Nov 2026; Runner 2's c263): the card's incident date (ISO), a date of the form, never a name, so a request for
   * the same CA asked again about the same incident keeps the level the card held. Null when none or for an older record.
   */
  readonly incidentDate?: string | null;
}

/** What a turn writes into `slots.agent_loop.card`. */
export type CardSlot = Omit<CardRecord, "messageId" | "asked" | "level" | "policyLine" | "payroll" | "payrollAmount" | "accountKey" | "incidentDate"> & { readonly asked?: readonly string[]; readonly level?: "verbal" | "written"; readonly policyLine?: string; readonly payroll?: "yes" | "no"; readonly payrollAmount?: string; readonly accountKey?: string; readonly incidentDate?: string };

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
  /** QA (16 Nov 2026, production): a one-way key of the manager's message, to find it when the history's id does not match. */
  readonly questionKey?: string | null;
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
  /** QA (16 Nov 2026, production): a one-way key of the manager's message, to find it when the history's id does not match. */
  readonly questionKey?: string | null;
}

/*
 * THE EXIT OFFER RECORD (QA, 20 Nov 2026; #1055's follow-up): a turn whose tools offered the Employee Exit Form for a
 * person (the exit refusals' "Want the … for <name>?", or a termination card, after which the rules book offers it)
 * writes `slots.agent_loop.exit_offer = { employeeKey, nameKey }`, one-way keys only. The next turn's "yes" is a yes to
 * that offer only when the reply right before it carries this record for that person, never by turn order alone.
 */
export interface ExitOfferSlot {
  /** `personKey` of the person's roster id; null for a name not on the roster. */
  readonly employeeKey: string | null;
  /** `personKey` of the person's name as the card holds it. */
  readonly nameKey: string;
}

export interface ExitOfferRecord extends ExitOfferSlot {
  readonly messageId: string | null;
  readonly questionKey?: string | null;
}

/*
 * THE TEAM CONFIRMATION RECORD (QA's code audit, coach_team C, 20 Nov 2026): a turn whose coach_team asked "create all?"
 * for an open Coaching draft writes `slots.agent_loop.team_confirm = { sourceKey }`, a one-way key of that draft's id. The
 * next turn reads the manager's answer against this record, never against the reply's wording.
 */
export interface TeamConfirmSlot {
  readonly sourceKey: string;
}

export interface TeamConfirmRecord extends TeamConfirmSlot {
  readonly messageId: string | null;
  readonly questionKey?: string | null;
}

type TraceRow = { message_id: string | null; slots: { agent_loop?: { card?: unknown; name_question?: unknown; person_asked?: unknown; exit_offer?: unknown; team_confirm?: unknown; steps?: unknown; question_key?: unknown } } | null };

/** The turn's one-way key of the manager's message (`question_key`), to find that message when its id does not match. */
const questionKeyOf = (row: TraceRow): string | null => (typeof row.slots?.agent_loop?.question_key === "string" ? row.slots.agent_loop.question_key : null);

/**
 * QA's review of #1062 (16 Nov 2026): what each loop turn finished, from its own trace (never the reply's text): whether
 * any step saved a field (`saved_fields`) and whether it made a card. A turn that did neither left its request open
 * (it asked "Which one?", "Who is it for?"…), so the manager's next message continues that request.
 */
export interface TurnRecord {
  /** The manager's message the turn answered (the trace's message_id). */
  readonly messageId: string | null;
  /** QA (16 Nov 2026, production): a one-way key of the manager's message, to find it when the history's id does not match. */
  readonly questionKey?: string | null;
  readonly saved: boolean;
  readonly card: boolean;
}

type LoopRecords = { cards: CardRecord[]; nameQuestions: NameQuestionRecord[]; personAsked: PersonAskedRecord[]; exitOffers: ExitOfferRecord[]; teamConfirms: TeamConfirmRecord[]; turns: TurnRecord[] };
const NO_RECORDS = (): LoopRecords => ({ cards: [], nameQuestions: [], personAsked: [], exitOffers: [], teamConfirms: [], turns: [] });

/** This user's loop records in this conversation, oldest first, from one read. Empty without a conversation id, or if the read fails. */
export async function readLoopRecords(conversationId: string | undefined, userId: string, historyMessageIds: readonly string[] = []): Promise<LoopRecords> {
  /*
   * QA (16 Nov 2026, production chat_traces): the FIRST message of a new chat was traced with conversation_id NULL, so a
   * read by conversation never fetched it, and turn 1's records (the Did-you-mean, the which-person question, the card)
   * were invisible from turn 2 on ("no" was asked again every turn). This user's rows are read by this conversation OR by
   * the message ids of this request's own history (ids are the client's, unique per browser; the user check stays).
   */
  const ids = [...new Set(historyMessageIds.filter((id) => /^[A-Za-z0-9_-]{1,80}$/.test(id)))];
  if (!conversationId && ids.length === 0) return NO_RECORDS();
  try {
    const admin = getSupabaseAdmin();
    const read = async (by: "conversation" | "messages") => {
      const query = admin.from("chat_traces").select("message_id, slots, created_at, conversation_id").eq("user_id", userId);
      const filtered = by === "conversation" ? query.eq("conversation_id", conversationId!) : query.in("message_id", ids);
      return filtered.order("created_at", { ascending: true });
    };
    const results = await Promise.all([...(conversationId ? [read("conversation")] : []), ...(ids.length > 0 ? [read("messages")] : [])]);
    if (results.some((result) => result.error)) return NO_RECORDS();
    const seen = new Set<string>();
    /*
     * QA's rule: a row read by message id counts only when its conversation_id is null (turn 1 from the home ask bar) or
     * this conversation; another conversation's row with the same message id is never this chat's.
     */
    const rows = (results.flatMap((result) => (result.data ?? []) as (TraceRow & { created_at?: string; conversation_id?: string | null })[]))
      .filter((row) => !row.conversation_id || !conversationId || row.conversation_id === conversationId)
      .filter((row) => {
        const key = `${row.message_id ?? ""}\u0000${row.created_at ?? ""}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""))) as TraceRow[];
    return {
      cards: rows.flatMap((row) => {
        const card = row.slots?.agent_loop?.card;
        return isCardSlot(card)
          ? [{ proposalId: card.proposalId, employeeKey: card.employeeKey ?? null, nameKey: card.nameKey ?? null, templateKey: card.templateKey, templateName: card.templateName ?? null, messageId: row.message_id, questionKey: questionKeyOf(row), asked: Array.isArray(card.asked) ? card.asked.filter((field): field is string => typeof field === "string") : [], level: card.level === "verbal" || card.level === "written" ? card.level : null, policyLine: typeof card.policyLine === "string" ? card.policyLine : null, payroll: card.payroll === "yes" || card.payroll === "no" ? card.payroll : null, payrollAmount: typeof card.payrollAmount === "string" && /^\d+(?:\.\d+)?$/.test(card.payrollAmount) ? card.payrollAmount : null, accountKey: typeof card.accountKey === "string" && /^[0-9a-f]{16}$/.test(card.accountKey) ? card.accountKey : null, incidentDate: typeof card.incidentDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(card.incidentDate) ? card.incidentDate : null }]
          : [];
      }),
      nameQuestions: rows.flatMap((row) => {
        const asked = row.slots?.agent_loop?.name_question;
        return isNameQuestionSlot(asked)
          ? [{ offeredKeys: [...asked.offeredKeys], typedKey: asked.typedKey, ...(Array.isArray(asked.offeredNameKeys) ? { offeredNameKeys: asked.offeredNameKeys.filter((key): key is string => typeof key === "string") } : {}), ...(asked.asksFullName === true ? { asksFullName: true } : {}), messageId: row.message_id, questionKey: questionKeyOf(row) }]
          : [];
      }),
      turns: rows.flatMap((row) => {
        const loop = row.slots?.agent_loop;
        if (!loop) return [];
        const steps = Array.isArray(loop.steps) ? (loop.steps as { saved_fields?: unknown }[]) : [];
        return [{ messageId: row.message_id, questionKey: questionKeyOf(row), saved: steps.some((step) => Array.isArray(step.saved_fields) && step.saved_fields.length > 0), card: isCardSlot(loop.card) }];
      }),
      personAsked: rows.flatMap((row) => {
        const asked = row.slots?.agent_loop?.person_asked as Partial<PersonAskedSlot> | undefined;
        return asked && typeof asked.templateKey === "string" ? [{ templateKey: asked.templateKey, messageId: row.message_id, questionKey: questionKeyOf(row) }] : [];
      }),
      teamConfirms: rows.flatMap((row) => {
        const asked = row.slots?.agent_loop?.team_confirm as Partial<TeamConfirmSlot> | undefined;
        return asked && typeof asked.sourceKey === "string" ? [{ sourceKey: asked.sourceKey, messageId: row.message_id, questionKey: questionKeyOf(row) }] : [];
      }),
      exitOffers: rows.flatMap((row) => {
        const offer = row.slots?.agent_loop?.exit_offer as Partial<ExitOfferSlot> | undefined;
        return offer && typeof offer.nameKey === "string"
          ? [{ employeeKey: typeof offer.employeeKey === "string" ? offer.employeeKey : null, nameKey: offer.nameKey, messageId: row.message_id, questionKey: questionKeyOf(row) }]
          : [];
      }),
    };
  } catch {
    return NO_RECORDS();
  }
}

/** The cards this user's loop made in this conversation, oldest first. None without a conversation id, or if the read fails. */
export async function readCardRecords(conversationId: string | undefined, userId: string, historyMessageIds: readonly string[] = []): Promise<CardRecord[]> {
  return (await readLoopRecords(conversationId, userId, historyMessageIds)).cards;
}

/**
 * The history's assistant replies that showed a card, by the record: the reply right after the manager's message the
 * card's turn answered. Keyed by the reply's index in `history`.
 */
export function cardTurns(history: readonly ChatMessage[], records: readonly CardRecord[]): Map<number, CardRecord> {
  return replyTurns(history, records);
}

/** The history's assistant replies a record's turn wrote: the reply right after the manager's message that turn answered. */
export function replyTurns<T extends { readonly messageId: string | null; readonly questionKey?: string | null }>(history: readonly ChatMessage[], records: readonly T[]): Map<number, T> {
  const byMessage = new Map(records.filter((record) => record.messageId).map((record) => [record.messageId!, record]));
  /*
   * QA (16 Nov 2026, keep-as-typed on production: the manager's "no" was asked again on every turn although each turn's
   * record was written): a history whose message ids do not match the trace's message_id never found its records. A
   * record not found by id is found by its question_key (a one-way key of the manager's message), each record once, in
   * order, so a repeated message ("no", "no") takes the next record, never an earlier one twice.
   */
  const byId = new Set(history.filter((message) => message.role === "user" && byMessage.has(message.id)).map((message) => message.id));
  const unmatched = records.filter((record) => !(record.messageId && byId.has(record.messageId)) && record.questionKey);
  const used = new Set<T>();
  const shown = new Map<number, T>();
  history.forEach((message, index) => {
    if (message.role !== "user") return;
    const record = byMessage.get(message.id) ?? (() => {
      const key = personKey(String(message.content ?? ""));
      const next = unmatched.find((candidate) => !used.has(candidate) && candidate.questionKey === key);
      if (next) used.add(next);
      return next;
    })();
    if (!record) return;
    const reply = history.findIndex((later, at) => at > index && later.role === "assistant");
    const nextUser = history.findIndex((later, at) => at > index && later.role === "user");
    if (reply > index && (nextUser < 0 || reply < nextUser) && !history[reply]!.error) shown.set(reply, record);
  });
  return shown;
}

/** A one-way key of a roster id or a name (case and spacing aside): the trace tells two cards' people apart without either. */
/** A one-way key of a card's account (QA, c163): letters and digits only, any case, so a rebuild's same words match. */
export function accountKey(account: string): string {
  return createHash("sha256").update(account.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()).digest("hex").slice(0, 16);
}

export function personKey(name: string): string {
  return createHash("sha256").update(name.trim().toLowerCase().replace(/\s+/g, " ")).digest("hex").slice(0, 16);
}
