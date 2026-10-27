import { modelCallDailyCapEnabled, monthlyBudgetGuardEnabled } from "@/lib/config/chat-quality-flags";

import { usageCostUsd, type TokenUsage } from "./model-prices";
import type { AskResponse } from "./types";

/**
 * ============================================================================
 * THE CHAT STOPS BEFORE THE MODEL WHEN THE SPEND LIMIT IS REACHED
 * ============================================================================
 *
 * Pau, 27 Oct 2026: live model spend stays inside a monthly cap, after a night
 * of near-identical scripted questions ran up the bill from one account. Two
 * default-off flags, read by the chat route before any step that can call the
 * model:
 *
 *   MODEL_CALL_DAILY_CAP_ENABLED — one user's traced model calls this UTC day
 *   (chat_traces rows with a model) against MODEL_CALL_DAILY_CAP (default
 *   40). Admins and owners are not counted against it.
 *
 *   MONTHLY_BUDGET_GUARD_ENABLED — this calendar month's traced tokens at list
 *   prices (`model-prices.ts`) against MONTHLY_BUDGET_USD (default 10). At
 *   80% a warning is logged; at 100% nobody's question reaches the model.
 *   The month's total is read at most once a minute per server instance.
 *
 * Over either, the reply is one plain sentence and no model is called. A
 * failed read lets the question through and logs why: the guard never takes
 * the chat down on its own.
 */
export const DAILY_CAP_REPLY = "You've reached today's limit for questions. Try again tomorrow, or ask an admin.";
export const MONTHLY_BUDGET_REPLY = "Questions are paused for the month. Ask an admin.";

const DEFAULT_DAILY_CAP = 40;
const DEFAULT_MONTHLY_BUDGET_USD = 10;
const REFRESH_MS = 60_000;
const EXEMPT_FROM_DAILY_CAP = new Set(["admin", "owner"]);

export interface SpendGuardStore {
  modelCallsSince(userId: string, sinceIso: string): Promise<number>;
  modelUsageSince(sinceIso: string): Promise<TokenUsage[]>;
}

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  const value = raw === undefined || raw.trim() === "" ? Number.NaN : Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function reply(content: string): AskResponse {
  return { content, citations: [], coverage: "not_applicable", recommendedVideoIds: [] };
}

function utcDayStart(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

function utcMonthStart(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

let monthCache: { month: string; costUsd: number; readAt: number } | null = null;

/** For tests: the next guard reads the month's total afresh. */
export function resetSpendGuardCache(): void {
  monthCache = null;
}

async function monthCostUsd(store: SpendGuardStore, now: Date): Promise<number> {
  const month = utcMonthStart(now);
  if (monthCache && monthCache.month === month && now.getTime() - monthCache.readAt < REFRESH_MS) {
    return monthCache.costUsd;
  }
  const usage = await store.modelUsageSince(month);
  const costUsd = usage.reduce((sum, row) => sum + usageCostUsd(row), 0);
  monthCache = { month, costUsd, readAt: now.getTime() };
  return costUsd;
}

async function defaultStore(): Promise<SpendGuardStore> {
  return import("./spend-guard-store");
}

/**
 * The reply that replaces the answer when a limit is reached, or null when the
 * question may go on to the model. Off, always null and nothing is read.
 */
export async function modelSpendGuard(
  input: { userId: string; role: string; now?: Date },
  store?: SpendGuardStore,
): Promise<AskResponse | null> {
  const monthly = monthlyBudgetGuardEnabled();
  const daily = modelCallDailyCapEnabled() && !EXEMPT_FROM_DAILY_CAP.has(input.role);
  if (!monthly && !daily) return null;
  const now = input.now ?? new Date();
  try {
    const read = store ?? (await defaultStore());
    if (monthly) {
      const budget = envNumber("MONTHLY_BUDGET_USD", DEFAULT_MONTHLY_BUDGET_USD);
      const spent = await monthCostUsd(read, now);
      if (spent >= budget) return reply(MONTHLY_BUDGET_REPLY);
      if (spent >= budget * 0.8) {
        console.warn(`spend.guard: $${spent.toFixed(2)} of the $${budget} monthly model budget used (80% or more)`);
      }
    }
    if (daily) {
      const cap = envNumber("MODEL_CALL_DAILY_CAP", DEFAULT_DAILY_CAP);
      if ((await read.modelCallsSince(input.userId, utcDayStart(now))) >= cap) return reply(DAILY_CAP_REPLY);
    }
  } catch (error) {
    console.warn(`spend.guard: read failed, question let through: ${error instanceof Error ? error.message : String(error)}`);
  }
  return null;
}
