import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";
import { businessToday, BUSINESS_TIMEZONE } from "@/lib/business-date";
import type {
  FeedbackOutcome,
  FeedbackStatus,
} from "@/lib/feedback/types";
import type { Role } from "@/types";
import {
  FEEDBACK_PAGE_SIZE,
  statusesFor,
  type FeedbackFilters,
} from "./feedback-filters";
import { resolveWindow, type AnalyticsFilters, type ResolvedWindow } from "./filters";
import type { ActivityCategory, ActivitySurface } from "./taxonomy";

/**
 * READING THE FEEDBACK AND THE USAGE SHAPE.
 *
 * EVERY AGGREGATE IS COMPUTED IN POSTGRES, same rule as `queries.ts` next door:
 * this module calls functions and receives small results; it never selects
 * feedback rows and averages them here. A year of comments must not cross the
 * wire so a browser can count the fours.
 *
 * SERVER ONLY. It holds the secret key and it answers "which named leader said
 * Sunny was useless, and what did they write", which is management information
 * and not a browser's business.
 */

export interface FeedbackSummary {
  responses: number;
  /** Null when nothing in the window was rated. Never zero — see the SQL. */
  averageRating: number | null;
  distribution: Record<1 | 2 | 3 | 4 | 5, number>;
  outcomes: Record<FeedbackOutcome, number>;
  queue: Record<FeedbackStatus, number>;
  hidden: number;
}

export interface FeedbackItem {
  id: string;
  turnId: string;
  rating: number;
  gotWhatNeeded: FeedbackOutcome;
  comment: string;
  status: FeedbackStatus;
  resolutionNote: string | null;
  resolvedAt: string | null;
  resolvedByName: string | null;
  hiddenAt: string | null;
  hiddenByName: string | null;
  createdAt: string;
  updatedAt: string;
  occurredAt: string;
  surface: ActivitySurface | null;
  category: ActivityCategory | null;
  succeeded: boolean;
  role: Role | null;
  displayName: string | null;
  storeName: string | null;
  district: string | null;
}

export interface FeedbackPage {
  items: FeedbackItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface SurfaceRow {
  surface: ActivitySurface;
  events: number;
  activeUsers: number;
  rated: number;
  averageRating: number | null;
}

export interface WhenRow {
  dayOfWeek: number;
  hourOfDay: number;
  events: number;
}

export interface TopicRow {
  category: ActivityCategory;
  events: number;
  activeUsers: number;
  acknowledgements: number;
  lastAsked: string | null;
}

export interface ExtractionRow {
  parserKey: string;
  runs: number;
  succeeded: number;
  failed: number;
  withWarnings: number;
  facts: number;
  salons: number;
  lastRun: string | null;
}

export interface FeedbackSnapshot {
  window: ResolvedWindow;
  summary: FeedbackSummary;
  previousSummary: FeedbackSummary;
  surfaces: SurfaceRow[];
  when: WhenRow[];
  topics: TopicRow[];
  previousTopics: TopicRow[];
  extraction: ExtractionRow[];
}

const EMPTY_SUMMARY: FeedbackSummary = {
  responses: 0,
  averageRating: null,
  distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
  outcomes: { yes: 0, partially: 0, no: 0 },
  queue: { pending: 0, in_review: 0, resolved: 0, dismissed: 0 },
  hidden: 0,
};

function toNumber(value: unknown): number {
  /* Postgres `bigint` arrives as text — see `queries.ts`. Coerced once, here. */
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : 0;
}

/**
 * `numeric` arrives as text too, and a null average must STAY null.
 *
 * `toNumber` would turn it into 0, and a dashboard printing "0.0 stars" for a
 * period nobody rated reports a catastrophe that did not happen. The screen
 * renders "No data yet" against a null, which is the truth.
 */
function toAverage(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : null;
}

function filterArgs(filters: AnalyticsFilters, window: ResolvedWindow) {
  return {
    p_from: window.from,
    p_to: window.to,
    p_district: filters.district,
    p_salon: filters.salonId,
    p_role: filters.role,
    p_actor: filters.actorId,
  };
}

/**
 * Everything the feedback and usage-shape panels need, in one set of parallel
 * calls.
 *
 * `Promise.all` rejects on the first failure, which is what we want: a page
 * showing five real panels and one silently empty one is worse than one that
 * says it could not load.
 */
export async function loadFeedbackAnalytics(
  filters: AnalyticsFilters,
): Promise<FeedbackSnapshot> {
  const supabase = getSupabaseAdmin();
  const window = resolveWindow(filters, businessToday());
  const args = filterArgs(filters, window);
  const previousArgs = {
    ...args,
    p_from: window.previousFrom,
    p_to: window.previousTo,
  };

  const [summary, previousSummary, surfaces, when, topics, previousTopics, extraction] =
    await Promise.all([
      supabase.rpc("analytics_feedback_summary", args),
      supabase.rpc("analytics_feedback_summary", previousArgs),
      supabase.rpc("analytics_surfaces", args),
      supabase.rpc("analytics_when", {
        ...args,
        /*
         * THE ZONE COMES FROM THE APPLICATION, not from a constant in the SQL.
         * `business-date.ts` is the one answer this product has to "what time
         * is it where the salons are", and a second copy inside a function
         * would be two parts of one product disagreeing about it — each
         * internally consistent, which is what makes that failure so hard to
         * see.
         */
        p_timezone: BUSINESS_TIMEZONE,
      }),
      supabase.rpc("analytics_topics", args),
      supabase.rpc("analytics_topics", previousArgs),
      supabase.rpc("analytics_extraction_runs", {
        p_from: window.from,
        p_to: window.to,
      }),
    ]);

  const failure =
    summary.error ??
    previousSummary.error ??
    surfaces.error ??
    when.error ??
    topics.error ??
    previousTopics.error ??
    extraction.error;
  if (failure) {
    throw new Error(`Feedback analytics could not be loaded: ${failure.message}`);
  }

  return {
    window,
    summary: readSummary(summary.data),
    previousSummary: readSummary(previousSummary.data),
    surfaces: (surfaces.data ?? []).map((row: Record<string, unknown>) => ({
      surface: row.surface as ActivitySurface,
      events: toNumber(row.events),
      activeUsers: toNumber(row.active_users),
      rated: toNumber(row.rated),
      averageRating: toAverage(row.average_rating),
    })),
    when: (when.data ?? []).map((row: Record<string, unknown>) => ({
      dayOfWeek: toNumber(row.day_of_week),
      hourOfDay: toNumber(row.hour_of_day),
      events: toNumber(row.events),
    })),
    topics: readTopics(topics.data),
    previousTopics: readTopics(previousTopics.data),
    extraction: (extraction.data ?? []).map((row: Record<string, unknown>) => ({
      parserKey: String(row.parser_key ?? ""),
      runs: toNumber(row.runs),
      succeeded: toNumber(row.succeeded),
      failed: toNumber(row.failed),
      withWarnings: toNumber(row.with_warnings),
      facts: toNumber(row.facts),
      salons: toNumber(row.salons),
      lastRun: (row.last_run as string | null) ?? null,
    })),
  };
}

/**
 * One page of the moderation queue.
 *
 * FETCHED SEPARATELY FROM THE SUMMARY, because the two answer different
 * questions and take different filters: the summary describes the window and
 * the page describes what is in front of the administrator right now. Folding
 * them together would mean re-computing the average every time somebody turned
 * a page.
 */
export async function loadFeedbackPage(
  filters: AnalyticsFilters,
  queue: FeedbackFilters,
): Promise<FeedbackPage> {
  const supabase = getSupabaseAdmin();
  const window = resolveWindow(filters, businessToday());

  const { data, error } = await supabase.rpc("analytics_feedback_list", {
    ...filterArgs(filters, window),
    p_surface: queue.surface,
    /*
     * AN ARRAY, because the default view is a SET — pending and in_review, the
     * work that is still somebody's. `statusesFor` is the one place "open" is
     * defined; null means every status.
     */
    p_statuses: statusesFor(queue.status),
    p_outcome: queue.outcome,
    p_rating: queue.rating,
    p_include_hidden: queue.includeHidden,
    p_search: queue.search.trim() || null,
    p_limit: FEEDBACK_PAGE_SIZE,
    p_offset: (queue.page - 1) * FEEDBACK_PAGE_SIZE,
  });

  if (error) {
    throw new Error(`Feedback could not be listed: ${error.message}`);
  }

  const rows = (data ?? []) as Record<string, unknown>[];

  return {
    items: rows.map((row) => ({
      id: String(row.id),
      turnId: String(row.activity_event_id),
      rating: toNumber(row.rating),
      gotWhatNeeded: row.got_what_needed as FeedbackOutcome,
      comment: String(row.comment ?? ""),
      status: row.status as FeedbackStatus,
      resolutionNote: (row.resolution_note as string | null) ?? null,
      resolvedAt: (row.resolved_at as string | null) ?? null,
      resolvedByName: (row.resolved_by_name as string | null) ?? null,
      hiddenAt: (row.hidden_at as string | null) ?? null,
      hiddenByName: (row.hidden_by_name as string | null) ?? null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      occurredAt: String(row.occurred_at),
      surface: (row.surface as ActivitySurface | null) ?? null,
      category: (row.category as ActivityCategory | null) ?? null,
      succeeded: row.succeeded !== false,
      role: (row.role as Role | null) ?? null,
      displayName: (row.display_name as string | null) ?? null,
      storeName: (row.store_name as string | null) ?? null,
      district: (row.district_label as string | null) ?? null,
    })),
    /*
     * THE TOTAL RIDES ON EVERY ROW, so it is read off the first. An empty page
     * carries no rows and therefore no total — which is correct, because the
     * filtered set really is empty.
     */
    total: rows.length > 0 ? toNumber(rows[0].total_count) : 0,
    page: queue.page,
    pageSize: FEEDBACK_PAGE_SIZE,
  };
}

function readSummary(data: unknown): FeedbackSummary {
  /* The function returns a one-row table, so supabase-js hands back an array. */
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") return EMPTY_SUMMARY;
  const record = row as Record<string, unknown>;

  return {
    responses: toNumber(record.responses),
    averageRating: toAverage(record.average_rating),
    distribution: {
      1: toNumber(record.rating_1),
      2: toNumber(record.rating_2),
      3: toNumber(record.rating_3),
      4: toNumber(record.rating_4),
      5: toNumber(record.rating_5),
    },
    outcomes: {
      yes: toNumber(record.outcome_yes),
      partially: toNumber(record.outcome_partially),
      no: toNumber(record.outcome_no),
    },
    queue: {
      pending: toNumber(record.pending),
      in_review: toNumber(record.in_review),
      resolved: toNumber(record.resolved),
      dismissed: toNumber(record.dismissed),
    },
    hidden: toNumber(record.hidden),
  };
}

function readTopics(data: unknown): TopicRow[] {
  if (!Array.isArray(data)) return [];
  return data.map((row: Record<string, unknown>) => ({
    category: row.category as ActivityCategory,
    events: toNumber(row.events),
    activeUsers: toNumber(row.active_users),
    acknowledgements: toNumber(row.acknowledgements),
    lastAsked: (row.last_asked as string | null) ?? null,
  }));
}
