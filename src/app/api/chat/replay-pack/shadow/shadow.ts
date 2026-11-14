import { appendFileSync, readFileSync } from "node:fs";

import { vi } from "vitest";

import type { DirectoryRow, ReplayCase, ReplayContext } from "../cases";
import { firstMatch, lastResult, loopStandIn, type LoopDecision, type LoopView } from "../loop-stand-in";

/**
 * ============================================================================
 * SHADOW REPLAY OF THE AGENT LOOP (QA, 14 Nov 2026; dev only, never CI; Pau approved)
 * ============================================================================
 *
 * Real managers' past chats, replayed through the loop offline: each conversation in the private JSON-lines file
 * `$SHADOW_IN` becomes one replay case (its roster, or the shared `$SHADOW_ROSTER`; its manager's role and scope; every
 * manager turn said in order),
 * and its turns, replies and final card are appended to `$SHADOW_OUT` for `scripts/agent-loop-shadow/summary.py`
 * to compare with what the manager actually created. Nothing is saved anywhere else: the replay pack's store is in
 * memory. NO REAL DATA IS EVER COMMITTED: the input and output live outside the repository.
 *
 * With `SHADOW_STANDIN=1` the loop's model is a scripted stand-in (`scriptedStandIn`), for the self-test; otherwise
 * the run uses the live model through the pack's AGENT_LOOP_LIVE / AGENT_LOOP_LIVE_ALL (`scripts/agent-loop-shadow/run.sh`).
 */

export interface ShadowScope {
  readonly role: string;
  readonly level: "salon" | "district" | "region" | "global";
  readonly salonIds: readonly string[];
}

export interface ShadowRosterRow {
  readonly id: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly preferredFirstName?: string | null;
  readonly salonIds: readonly string[];
  readonly positionName?: string | null;
}

export interface ShadowConversation {
  readonly conv: string;
  readonly scope: ShadowScope;
  /** This conversation's roster; absent, the shared one (`SHADOW_ROSTER`). */
  readonly roster: readonly ShadowRosterRow[];
  readonly turns: readonly string[];
  readonly truth: Record<string, unknown> | null;
  readonly rating: number | null;
  /** Optional: the conversation's own time (ISO), so "today" and relative dates read as they did. Absent, the pack's clock. */
  readonly at?: string;
}

/** The shared roster (`SHADOW_ROSTER`, QA 14 Nov 2026): a JSON array of roster rows, as a line's "roster". */
export function readShadowRoster(path: string | undefined): ShadowRosterRow[] | null {
  if (!path) return null;
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!Array.isArray(parsed)) throw new Error(`${path}: the shared roster must be a JSON array of roster rows`);
  return parsed as ShadowRosterRow[];
}

/**
 * The conversations in a JSON-lines file, in order; `limit` keeps the first n (SHADOW_LIMIT). A line with no "roster"
 * uses `shared` (SHADOW_ROSTER): production has one directory, and the manager's scope does the narrowing.
 */
export function readShadowInput(path: string, limit?: number, shared: readonly ShadowRosterRow[] | null = null): ShadowConversation[] {
  const lines = readFileSync(path, "utf8").split("\n").filter((line) => line.trim() !== "");
  const conversations = lines.map((line, index) => {
    const parsed = JSON.parse(line) as Omit<ShadowConversation, "roster"> & { roster?: ShadowRosterRow[] };
    const roster = Array.isArray(parsed.roster) ? parsed.roster : shared;
    if (!parsed.conv || !parsed.scope || !roster || !Array.isArray(parsed.turns)) {
      throw new Error(`${path}:${index + 1}: needs conv, scope, turns, and a roster (its own or SHADOW_ROSTER)`);
    }
    return { ...parsed, roster };
  });
  return limit && limit > 0 ? conversations.slice(0, limit) : conversations;
}

/** The pack's scope for the manager: their first salon is the primary one. */
export function packScope(scope: ShadowScope): { level: string; primaryAreaId: string | null; alsoCoversAreaIds: string[] } {
  return { level: scope.level, primaryAreaId: scope.salonIds[0] ?? null, alsoCoversAreaIds: scope.salonIds.slice(1) };
}

/** The pack's directory rows for a roster. */
export function packRoster(roster: readonly ShadowRosterRow[]): DirectoryRow[] {
  return roster.map((row) => ({
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    preferredFirstName: row.preferredFirstName ?? null,
    employmentStatus: "active",
    salonIds: [...row.salonIds],
    positionName: row.positionName ?? null,
  }));
}

/** A line of the reply, by its bold label ("Policy", "Observation of Offense", "Issue"), or null. */
export function replyLine(reply: string, label: string): string | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(String.raw`\*\*${escaped}:\*\*\s*([^\n]*)`).exec(reply);
  return match ? match[1]!.trim() : null;
}

/** The record one replayed conversation appends to `$SHADOW_OUT`. */
export interface ShadowRecord {
  readonly conv: string;
  readonly id: string;
  readonly error: string | null;
  readonly turns: { question: string; reply: string; card: Record<string, unknown> | null }[];
  /** The last card on screen when the conversation ended, or null when none was proposed. */
  readonly final: Record<string, unknown> | null;
  readonly truth: Record<string, unknown> | null;
  readonly rating: number | null;
  readonly roster: string[];
}

function cardOf(proposal: Record<string, unknown> | undefined, reply: string): Record<string, unknown> | null {
  if (!proposal) return null;
  return {
    template: proposal.templateKey ?? null,
    employee: proposal.employeeName ?? null,
    date: proposal.formDate ?? null,
    level: proposal.warningLevel ?? null,
    payroll: proposal.payrollDeduct ?? null,
    policy: replyLine(reply, "Policy"),
    observation: replyLine(reply, "Observation of Offense") ?? (proposal.issue as string | null | undefined) ?? replyLine(reply, "Issue"),
  };
}

/** The case id of a conversation. */
export function shadowCaseId(conv: string): string {
  return `shadow-${conv}`;
}

/**
 * SHADOW_STANDIN=1 (the self-test): a scripted model, so the harness runs with no live calls. It looks up the roster
 * person the turns name, proposes a form for them from the words alone, and answers; it never states a level or a
 * payroll answer that was not typed. It measures the harness, never the loop's judgement.
 */
export function scriptedStandIn(roster: readonly ShadowRosterRow[]): (view: LoopView) => LoopDecision {
  return (view) => {
    const said = view.turns.filter((turn) => turn.role === "user").map((turn) => turn.text).join("\n");
    const person = roster.find((row) => said.toLowerCase().includes(`${row.firstName} ${row.lastName}`.toLowerCase()));
    if (!person) return { text: "Who is this form for?" };
    const name = `${person.firstName} ${person.lastName}`;
    if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name } };
    if (!lastResult(view, "propose_form")) {
      const date = /(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(said);
      const level = /\bwritten\b/i.test(said) ? "written" : /\bverbal\b/i.test(said) ? "verbal" : undefined;
      return {
        tool: "propose_form",
        input: {
          template_key: /\bcoach/i.test(said) && !/\b(?:ca|corrective|warning|write[- ]?up)\b/i.test(said) ? "coaching" : "dpoa",
          employee_id: firstMatch(view)?.employee_id,
          what_happened: said.split("\n").at(-1),
          ...(date ? { incident_date: `${date[3]!.length === 2 ? `20${date[3]}` : date[3]}-${date[1]!.padStart(2, "0")}-${date[2]!.padStart(2, "0")}` } : {}),
          ...(level ? { warning_level: level } : {}),
        },
      };
    }
    return { text: `Here is the form for ${name} to review.` };
  };
}

/** One replay case per conversation in `$SHADOW_IN` (SHADOW_LIMIT keeps the first n). */
export function shadowCases(input: string, out: string | undefined, limit?: number, roster: string | undefined = process.env.SHADOW_ROSTER): ReplayCase[] {
  return readShadowInput(input, limit, readShadowRoster(roster)).map((conversation): ReplayCase => ({
    id: shadowCaseId(conversation.conv),
    title: `shadow replay of ${conversation.conv}`,
    report: "QA's shadow replay of the agent loop (dev only)",
    status: "fixed",
    async run(t: ReplayContext) {
      if (conversation.at) vi.setSystemTime(new Date(conversation.at));
      t.directory(packRoster(conversation.roster));
      t.as(conversation.scope.role, packScope(conversation.scope));
      if (process.env.SHADOW_STANDIN === "1" && t.loopOn?.()) t.loopModel!(loopStandIn(scriptedStandIn(conversation.roster)));
      const thread = t.thread();
      const turns: ShadowRecord["turns"] = [];
      let final: Record<string, unknown> | null = null;
      let error: string | null = null;
      try {
        for (const question of conversation.turns) {
          const answer = await thread.say(question);
          const card = cardOf(answer.formProposal as Record<string, unknown> | undefined, answer.content ?? "");
          if (card) final = card;
          turns.push({ question, reply: answer.content ?? "", card });
        }
      } catch (thrown) {
        // A turn that fails is recorded, never a failed case: the run measures, it does not gate.
        error = String((thrown as Error)?.message ?? thrown).split("\n")[0]!;
      }
      if (out) {
        const record: ShadowRecord = {
          conv: conversation.conv,
          id: shadowCaseId(conversation.conv),
          error,
          turns,
          final,
          truth: conversation.truth ?? null,
          rating: conversation.rating ?? null,
          roster: conversation.roster.map((row) => `${row.firstName} ${row.lastName}`),
        };
        appendFileSync(out, `${JSON.stringify(record)}\n`);
      }
    },
  }));
}
