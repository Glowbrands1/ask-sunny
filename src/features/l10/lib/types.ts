// Copied from the Leadership Hub (src/lib/meetings/types.ts); keep in step with it. See src/features/l10/README.md.
/**
 * The shape of one meeting's saved document, as the Lovable L10 app wrote it
 * (l10.meeting_state.data). Every object keeps unknown fields: the adapter spreads
 * instead of rebuilding, so anything Lovable stored that the hub does not show yet
 * is written back unchanged.
 */
export type MetricFormat = "percent" | "currency" | "number";

export interface ScorecardRow {
  id: string;
  metric: string;
  owner: string;
  admin?: string;
  /** Goal text, e.g. "≥ 7%" or "> $14". */
  goal: string;
  goalValue: number;
  higherIsBetter: boolean;
  format: MetricFormat;
  bidirectional?: boolean;
  weeks: (number | null)[];
  [extra: string]: unknown;
}

export type RockStatus = "on-track" | "off-track" | "done";

export interface Milestone {
  id: string;
  text: string;
  done: boolean;
  dueDate?: string;
  [extra: string]: unknown;
}

export interface Rock {
  id: string;
  title: string;
  /** A person's full name, or "Company". */
  owner: string;
  status: RockStatus;
  milestones: Milestone[];
  dueDate?: string;
  archived?: boolean;
  lead?: string;
  notes?: string;
  [extra: string]: unknown;
}

export interface Headline {
  id: string;
  kind: "customer" | "employee";
  text: string;
  author: string;
  [extra: string]: unknown;
}

export interface Todo {
  id: string;
  text: string;
  owner: string;
  due?: string;
  dueDate?: string;
  done: boolean;
  carryCount?: number;
  escalated?: boolean;
  [extra: string]: unknown;
}

export interface IssueFile {
  path: string;
  name: string;
  size?: number;
  uploadedBy?: string;
  /** Set to "l10-files" on every file the hub stored. A reference without it came from the previous app (Lovable) and cannot be opened here. */
  bucket?: string;
}

/** One person's rank on one issue. The name is kept so everyone can see who voted, even without a people list. */
export interface IssueVote {
  rank: 1 | 2 | 3;
  name: string;
}

export interface Issue {
  id: string;
  title: string;
  notes: string;
  /**
   * The shared top-three number from before per-person ranking (1, 2 or 3). Kept, never removed silently: it orders the
   * list only while nobody has voted, and is shown as the "previous shared order".
   */
  rank?: number;
  /** Per-person ranking: each person's own 1, 2 or 3 on this issue, keyed by their user id (see doc.ts voting). */
  votes?: Record<string, IssueVote>;
  resolved: boolean;
  addedBy?: string;
  resolvedSession?: string | null;
  files?: IssueFile[];
  [extra: string]: unknown;
}

export interface Attendee {
  id: string;
  name: string;
  role: string;
  shared: boolean;
  rating: number | null;
  [extra: string]: unknown;
}

export interface VtoItem {
  id: string;
  text: string;
}

/** One brand's marketing strategy (the Quarterly Tracker's "Marketing by brand"). */
export interface BrandCard {
  id: string;
  brand: string;
  /** Who we're for. */
  target: string;
  /** Why us: usually four. */
  differentiators: string[];
  /** Proven process. */
  process: string;
  /** Our guarantee. */
  guarantee: string;
}

export interface Vto {
  vision?: string;
  /** Shown as "Mission (purpose)". */
  purpose?: string;
  /** When the plan was last revised (YYYY-MM-DD or as typed). */
  revised?: string;
  brands?: BrandCard[];
  niche?: string;
  tenYear?: string;
  marketingStrategy?: string;
  threeYear?: VtoItem[];
  oneYear?: VtoItem[];
  coreValues?: { id: string; name: string; desc: string }[];
  [extra: string]: unknown;
}

export interface MeetingDoc {
  scorecard: ScorecardRow[];
  /** One MM/DD/YYYY string per scorecard week, oldest first. */
  weekEndings: string[];
  rocks: Rock[];
  headlines: Headline[];
  todos: Todo[];
  issues: Issue[];
  attendees: Attendee[];
  cascade: string;
  vto: Vto;
  seats: unknown[];
  weekCount?: number;
  /** The shared meeting clock (see timer.ts). */
  timer?: unknown;
  [extra: string]: unknown;
}

/** A loaded meeting: its document and the version it was loaded at (0 = nothing saved yet). */
export interface LoadedMeeting {
  version: number;
  updatedAt: string | null;
  doc: Record<string, unknown>;
}

export interface MeetingInfo {
  key: string;
  name: string;
  team: string;
  cadence: string;
  description: string;
}

/** A saved recap row (l10.meeting_recaps). */
export interface RecapRow {
  id: string;
  meeting_key: string;
  session_id: string;
  held_at: string;
  rating_avg: number | null;
  attendee_count: number;
  duration_seconds: number;
  cascade: string | null;
  attendees: { name: string; rating: number | null }[];
  open_todos: { text?: string; owner?: string; due?: string; dueDate?: string }[];
  resolved_issues: string[];
  /** Saved by the scheduled auto-save because nobody pressed End (database column l10.meeting_recaps.auto_saved). */
  auto_saved?: boolean;
  /** Set when a hub admin deleted the recap (soft delete: hidden everywhere, restorable). */
  deleted_at?: string | null;
}

/** What the page sends when a meeting ends. */
export interface RecapInput {
  sessionId: string;
  cascade: string;
  ratingAvg: number | null;
  durationSeconds: number;
  attendees: { name: string; rating: number | null }[];
  openTodos: unknown[];
  resolvedIssues: string[];
}
