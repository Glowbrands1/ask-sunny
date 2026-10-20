import "server-only";

import { samePerson } from "@/lib/forms/proposal";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import {
  MAX_CONVERSATIONS_PER_PERSON,
  MAX_FORMS_PER_PERSON,
  excerptFor,
  isAboutPerson,
  mentionsPerson,
  namesToRecall,
  rememberedDate,
  renderMemoryBlock,
  type PersonCandidate,
  type PersonRecollection,
  type RememberedForm,
  type RememberedTurn,
} from "./person-memory";

/**
 * ============================================================================
 * READING WHAT A MANAGER TOLD SUNNY BEFORE — THEIR OWN ROWS, AND NOBODY ELSE'S
 * ============================================================================
 *
 * The same rule `store.ts` rests on: every statement carries the caller's own
 * `user_id`, taken from the validated session by the route. There is no
 * argument through which another person's history could be read, and no
 * cross-user read is added here.
 *
 * WHAT IS NEVER RECALLED:
 *
 *   a deleted conversation      `deleted_at` is a tombstone, and the person
 *                               asked for it to be gone
 *   anything before a clear     the account's `history_cleared_at` boundary,
 *                               compared on the conversation's creation, the
 *                               way every other history read compares it
 *   the current conversation    it is already in the prompt as history
 *   a form somebody else filed  `created_by` is the asking person, always
 *   an archived form            archived is "not shown", and memory is shown
 *
 * IT NEVER COSTS THE MANAGER THEIR ANSWER. Memory is a convenience: a failed or
 * slow read degrades to no memory, and the answer goes ahead without it. The
 * swallow lives here rather than in `server-ask.ts`, which must stay free of
 * error-swallowing around grounding.
 */

/** How long the answer waits for memory before going ahead without it. */
export const RECALL_BUDGET_MS = 2_500;

/** Earlier turns that mention one name, read before narrowing. */
const MAX_MATCHED_TURNS = 100;
/** Earlier conversations considered per person before checking who they are about. */
const CANDIDATE_CONVERSATIONS_PER_PERSON = 4;
/** A ceiling on the turns read back for those conversations. */
const MAX_TURNS_READ = 1_000;

interface MatchedTurnRow {
  conversation_id: string;
  client_message_id: string;
  content: string;
}

interface ConversationRow {
  id: string;
  client_conversation_id: string;
  title: string | null;
  created_at: string;
}

interface TurnRow {
  conversation_id: string;
  content: string;
  created_at: string;
  position: number;
}

interface FormRow {
  employee_name: string;
  status: string;
  form_date: string | null;
  form_templates: { name: string } | { name: string }[] | null;
}

export interface RecallInput {
  /** The validated session's subject. Never from the request body. */
  readonly userId: string;
  readonly question: string;
  readonly history: readonly { id?: string; role: string; content: string }[];
  /** The browser's `conv_*` id for this conversation, if it sent one. */
  readonly conversationId?: string;
  readonly userName: string;
}

/**
 * The memory block for this turn, or null — never a rejection.
 */
export async function recallPeople(input: RecallInput): Promise<string | null> {
  const candidates = namesToRecall(input);
  if (candidates.length === 0) return null;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), RECALL_BUDGET_MS);
  });

  try {
    return await Promise.race([readMemory(input, candidates), budget]);
  } catch (error) {
    // The reason only: the rows carry the manager's own words.
    console.warn(
      JSON.stringify({
        event: "memory.recall.failed",
        reason: error instanceof Error ? error.message.slice(0, 200) : "unknown",
      }),
    );
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** The ILIKE pattern for a name's first word. Name words carry no wildcards. */
function containsPattern(name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? "";
  return `%${first.replace(/[\\%_]/g, "")}%`;
}

async function readMemory(
  input: RecallInput,
  candidates: readonly PersonCandidate[],
): Promise<string | null> {
  const supabase = getSupabaseAdmin();
  const { userId } = input;

  const [boundary, matchedByPerson, formsByPerson] = await Promise.all([
    supabase
      .from("chat_history_boundaries")
      .select("history_cleared_at")
      .eq("user_id", userId)
      .maybeSingle(),
    Promise.all(
      candidates.map((person) =>
        supabase
          .from("chat_messages")
          .select("conversation_id, client_message_id, content")
          .eq("user_id", userId)
          .eq("role", "user")
          .ilike("content", containsPattern(person.name))
          .order("created_at", { ascending: false })
          .limit(MAX_MATCHED_TURNS),
      ),
    ),
    Promise.all(
      candidates.map((person) =>
        supabase
          .from("form_instances")
          .select("employee_name, status, form_date, form_templates(name)")
          .eq("created_by", userId)
          .is("archived_at", null)
          .neq("status", "revised")
          .ilike("employee_name", containsPattern(person.name))
          .order("created_at", { ascending: false })
          .limit(MAX_FORMS_PER_PERSON * 4),
      ),
    ),
  ]);

  if (boundary.error) throw new Error(boundary.error.message);
  const clearedAt = (boundary.data as { history_cleared_at?: string } | null)?.history_cleared_at;
  const clearedMs = clearedAt ? Date.parse(clearedAt) : Number.NEGATIVE_INFINITY;

  /* THE CURRENT CONVERSATION, recognised by its turns as well as by its id. */
  const currentTurnIds = new Set(
    input.history.map((turn) => turn.id).filter((id): id is string => Boolean(id)),
  );

  /* Per person: conversation ids, most recently mentioned first. */
  const conversationsByPerson: string[][] = [];
  const currentConversations = new Set<string>();
  matchedByPerson.forEach((result, index) => {
    if (result.error) throw new Error(result.error.message);
    const person = candidates[index]!;
    const ordered: string[] = [];
    for (const row of (result.data ?? []) as MatchedTurnRow[]) {
      if (currentTurnIds.has(row.client_message_id)) currentConversations.add(row.conversation_id);
      // ILIKE is a substring match: "%Sam%" also finds "same".
      if (!mentionsPerson(row.content, person.name)) continue;
      if (!ordered.includes(row.conversation_id)) ordered.push(row.conversation_id);
    }
    conversationsByPerson.push(ordered);
  });

  const forms: RememberedForm[][] = formsByPerson.map((result, index) => {
    if (result.error) throw new Error(result.error.message);
    const person = candidates[index]!;
    return ((result.data ?? []) as FormRow[])
      .filter((row) => samePerson(row.employee_name, person.name))
      .slice(0, MAX_FORMS_PER_PERSON)
      .map((row) => {
        const template = Array.isArray(row.form_templates) ? row.form_templates[0] : row.form_templates;
        return {
          employeeName: row.employee_name,
          templateName: template?.name ?? "Form",
          formDate: row.form_date,
          status: row.status,
        };
      });
  });

  const consideredIds = [
    ...new Set(
      conversationsByPerson.flatMap((ids) =>
        ids.filter((id) => !currentConversations.has(id)).slice(0, CANDIDATE_CONVERSATIONS_PER_PERSON),
      ),
    ),
  ];

  const conversations = new Map<string, ConversationRow>();
  const turnsByConversation = new Map<string, RememberedTurn[]>();

  if (consideredIds.length > 0) {
    const { data: conversationRows, error: conversationError } = await supabase
      .from("chat_conversations")
      .select("id, client_conversation_id, title, created_at")
      .eq("user_id", userId)
      .in("id", consideredIds)
      .is("deleted_at", null)
      .is("archived_at", null);
    if (conversationError) throw new Error(conversationError.message);

    for (const row of (conversationRows ?? []) as ConversationRow[]) {
      if (row.client_conversation_id === input.conversationId) continue;
      if (Date.parse(row.created_at) <= clearedMs) continue;
      conversations.set(row.id, row);
    }

    if (conversations.size > 0) {
      const { data: turnRows, error: turnError } = await supabase
        .from("chat_messages")
        .select("conversation_id, content, created_at, position")
        .eq("user_id", userId)
        .eq("role", "user")
        .in("conversation_id", [...conversations.keys()])
        .limit(MAX_TURNS_READ);
      if (turnError) throw new Error(turnError.message);

      const rows = ((turnRows ?? []) as TurnRow[]).sort(
        (a, b) => a.position - b.position || Date.parse(a.created_at) - Date.parse(b.created_at),
      );
      for (const row of rows) {
        const bucket = turnsByConversation.get(row.conversation_id) ?? [];
        bucket.push({ content: row.content, createdAt: row.created_at });
        turnsByConversation.set(row.conversation_id, bucket);
      }
    }
  }

  const recollections: PersonRecollection[] = candidates.map((person, index) => {
    const personForms = forms[index]!;
    const recalled: PersonRecollection["conversations"][number][] = [];

    for (const id of conversationsByPerson[index]!) {
      if (recalled.length === MAX_CONVERSATIONS_PER_PERSON) break;
      const conversation = conversations.get(id);
      const turns = turnsByConversation.get(id);
      if (!conversation || !turns) continue;
      if (!isAboutPerson(person, turns, personForms.length > 0)) continue;

      const excerpt = excerptFor(person, turns);
      if (excerpt.length === 0) continue;
      const lastMention = [...turns].reverse().find((turn) => mentionsPerson(turn.content, person.name));
      recalled.push({
        title: conversation.title ?? "Untitled conversation",
        date: rememberedDate(lastMention?.createdAt ?? conversation.created_at) ?? "an earlier day",
        excerpt,
      });
    }

    return { name: person.name, conversations: recalled, forms: personForms };
  });

  return renderMemoryBlock(recollections, input.userName);
}
