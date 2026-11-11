import "server-only";

import { PRODUCTION_SALONS } from "@/data/salons";
import { demoStateMap } from "./demo-state";
import { BUSINESS_TIMEZONE, businessToday } from "@/lib/business-date";
import type {
  ExtractionRow,
  FeedbackItem,
  FeedbackPage,
  FeedbackSnapshot,
  FeedbackSummary,
  SurfaceRow,
  TopicRow,
  WhenRow,
} from "@/lib/analytics/feedback-queries";
import {
  FEEDBACK_PAGE_SIZE,
  statusesFor,
  type FeedbackFilters,
} from "@/lib/analytics/feedback-filters";
import { bucketFor, resolveWindow, type AnalyticsFilters } from "@/lib/analytics/filters";
import type {
  AnalyticsSnapshot,
  AnalyticsTotals,
  BreakdownRow,
  LeaderRow,
  LocationRow,
  TrendPoint,
} from "@/lib/analytics/queries";
import {
  CATEGORY_FEATURE,
  type ActivityCategory,
  type ActivitySurface,
} from "@/lib/analytics/taxonomy";
import type { FeedbackOutcome, FeedbackStatus } from "@/lib/feedback/types";
import type { Role } from "@/types";

/**
 * ============================================================================
 * ADOPTION ANALYTICS IN A DEMO DEPLOYMENT — INVENTED, AND COMPUTED HONESTLY
 * ============================================================================
 *
 * A demo deployment never holds the Supabase key, so `/admin/analytics` used to
 * throw `MissingConfigurationError` on render. In demo mode the loader asks this
 * module instead.
 *
 * Rather than hand-writing every panel's numbers (which would disagree with
 * each other the moment a filter was applied), this generates one invented
 * EVENT LOG — who used Ask Sunny, from which salon, when, and for what — from a
 * fixed seed, and then answers the same questions the SQL functions answer by
 * counting it. So a filter narrows every panel together, the prior period is a
 * real prior period, and totals add up.
 *
 * Every person here is fictional. The salons are the production roster, the
 * same fifteen the seeded Google Reviews screen uses.
 */

/* ------------------------------------------------------------ the people -- */

interface DemoLeader {
  id: string;
  name: string;
  role: Role;
  salonNumber: string | null;
  /** Average events per active day. */
  pace: number;
  /** Chance of using the product on a given working day. */
  presence: number;
  status: "active" | "invited";
  /** Which kind of work this person mostly brings to Ask Sunny. */
  focus: "floor" | "coaching" | "reporting" | "admin";
}

function leaderId(n: number): string {
  return `1eade700-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

export function demoSalonUuid(salonNumber: string): string {
  return `5a100000-0000-4000-8000-${salonNumber.padStart(12, "0")}`;
}

/*
 * Salon accounts sign in under the salon's own address, so they are named after
 * the salon — the same convention the seeded User Management roster uses.
 */
const SALON_PACE: Record<string, [number, number]> = {
  "0306": [4.2, 0.92],
  "0307": [3.6, 0.88],
  "0309": [2.4, 0.7],
  "0310": [3.1, 0.84],
  "0311": [2.2, 0.66],
  "0312": [1.2, 0.38],
  "0313": [3.4, 0.86],
  "0314": [3.9, 0.9],
  "0394": [2.6, 0.74],
  "0410": [0.6, 0.12],
  "0462": [4.4, 0.94],
  "0463": [2.9, 0.8],
  "0468": [3.2, 0.83],
  "0476": [2.1, 0.6],
  "0495": [0, 0],
};

function buildLeaders(): DemoLeader[] {
  const leaders: DemoLeader[] = [];
  let n = 1;
  for (const salon of PRODUCTION_SALONS) {
    const [pace, presence] = SALON_PACE[salon.salonNumber] ?? [2, 0.6];
    leaders.push({
      id: leaderId(n++),
      name: salon.name,
      role: "salon_director",
      salonNumber: salon.salonNumber,
      pace,
      presence,
      status: salon.salonNumber === "0495" ? "invited" : "active",
      focus: "floor",
    });
  }
  const people: Omit<DemoLeader, "id">[] = [
    { name: "Jordan Beckley", role: "assistant_salon_director", salonNumber: "0306", pace: 2.6, presence: 0.7, status: "active", focus: "floor" },
    { name: "Nia Okafor", role: "assistant_salon_director", salonNumber: "0314", pace: 2.3, presence: 0.66, status: "active", focus: "floor" },
    { name: "Tessa Lindqvist", role: "assistant_salon_director", salonNumber: "0462", pace: 2.0, presence: 0.62, status: "active", focus: "floor" },
    { name: "Marcus Delacroix", role: "assistant_salon_director", salonNumber: "0307", pace: 1.6, presence: 0.5, status: "active", focus: "floor" },
    { name: "Hailey Strand", role: "assistant_salon_director", salonNumber: "0468", pace: 1.2, presence: 0.42, status: "active", focus: "floor" },
    { name: "Owen Pritchard", role: "assistant_salon_director", salonNumber: "0410", pace: 0, presence: 0, status: "invited", focus: "floor" },
    { name: "Alicia Moreno", role: "district_manager", salonNumber: null, pace: 5.4, presence: 0.95, status: "active", focus: "coaching" },
    { name: "Corey Vandenberg", role: "district_manager", salonNumber: null, pace: 4.1, presence: 0.88, status: "active", focus: "coaching" },
    { name: "Renata Silva", role: "district_manager", salonNumber: null, pace: 4.6, presence: 0.9, status: "active", focus: "coaching" },
    { name: "Dana Whitfield", role: "regional_manager", salonNumber: null, pace: 3.2, presence: 0.8, status: "active", focus: "reporting" },
    { name: "Marguerite Ellis", role: "owner", salonNumber: null, pace: 1.8, presence: 0.6, status: "active", focus: "reporting" },
    { name: "Priya Raghunathan", role: "developer", salonNumber: null, pace: 2.2, presence: 0.7, status: "active", focus: "admin" },
  ];
  for (const person of people) leaders.push({ id: leaderId(n++), ...person });
  return leaders;
}

const LEADERS = buildLeaders();

/* ------------------------------------------------------- the event log -- */

interface DemoEvent {
  at: number;
  /** Business-zone calendar day, `YYYY-MM-DD`. */
  day: string;
  dow: number;
  hour: number;
  leader: number;
  category: ActivityCategory;
  surface: ActivitySurface | null;
  succeeded: boolean;
  /** Index into `feedback`, when the person rated the answer. */
  feedback: number | null;
}

interface DemoFeedback {
  id: string;
  event: number;
  rating: 1 | 2 | 3 | 4 | 5;
  outcome: FeedbackOutcome | null;
  comment: string;
  status: FeedbackStatus;
  hidden: boolean;
  resolutionNote: string | null;
}

/** Deterministic, so every render of the demo shows the same history. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(random: () => number, weighted: readonly (readonly [T, number])[]): T {
  const total = weighted.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = random() * total;
  for (const [value, weight] of weighted) {
    roll -= weight;
    if (roll <= 0) return value;
  }
  return weighted[weighted.length - 1][0];
}

const FOCUS_MIX: Record<DemoLeader["focus"], readonly (readonly [ActivityCategory, number])[]> = {
  floor: [
    ["policy_question", 16],
    ["salon_operations", 14],
    ["membership_sales", 12],
    ["equipment_maintenance", 9],
    ["daily_stats", 8],
    ["coaching_guidance", 7],
    ["training", 6],
    ["training_video", 7],
    ["document_search", 6],
    ["coaching_form", 4],
    ["corrective_action", 2],
    ["pay_bonus", 3],
    ["safety_hr", 2],
    ["hiring_onboarding", 3],
    ["hiring_form", 2],
    ["general_guidance", 3],
    ["unclassified", 1],
  ],
  coaching: [
    ["coaching_guidance", 16],
    ["coaching_form", 12],
    ["corrective_action", 9],
    ["epp", 8],
    ["policy_question", 12],
    ["policy_review", 5],
    ["report_analysis", 9],
    ["daily_stats", 7],
    ["hiring_onboarding", 4],
    ["hiring_form", 4],
    ["pay_bonus", 4],
    ["safety_hr", 3],
    ["document_search", 4],
    ["form_request", 2],
    ["general_guidance", 2],
  ],
  reporting: [
    ["report_analysis", 22],
    ["daily_stats", 16],
    ["report_upload", 8],
    ["membership_sales", 8],
    ["policy_question", 8],
    ["coaching_guidance", 6],
    ["document_search", 6],
    ["pay_bonus", 4],
    ["general_guidance", 3],
  ],
  admin: [
    ["document_upload", 18],
    ["report_upload", 14],
    ["document_search", 10],
    ["policy_question", 8],
    ["report_analysis", 8],
    ["training_video", 4],
    ["general_guidance", 4],
    ["unclassified", 2],
  ],
};

function surfaceFor(category: ActivityCategory, random: () => number): ActivitySurface | null {
  const feature = CATEGORY_FEATURE[category];
  if (feature !== "chat") return null;
  if (category === "daily_stats") {
    return pick(random, [
      ["salon_performance", 4],
      ["sales_totals", 3],
      ["bed_usage", 2],
      ["main_chat", 2],
    ] as const);
  }
  return pick(random, [
    ["main_chat", 14],
    ["overview", 3],
    ["google_reviews", 1],
    ["spa_wellness", 1],
    ["spa_engagement", 1],
  ] as const);
}

/** Ask Sunny went live to salons here; before it the log is empty, honestly. */
const LAUNCH = "2026-06-01";

const DAY_MS = 24 * 60 * 60 * 1000;

const localParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: BUSINESS_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
  weekday: "short",
});

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function localFacts(at: number): { day: string; hour: number; dow: number } {
  const parts = localParts.formatToParts(new Date(at));
  const get = (type: string) => parts.find((entry) => entry.type === type)?.value ?? "";
  return {
    day: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")),
    dow: WEEKDAY.indexOf(get("weekday")),
  };
}

const POSITIVE_COMMENTS = [
  "Demo content. Exactly the policy wording I needed for the conversation.",
  "Demo content. Saved me a call to my DM — clear and quick.",
  "Demo content. The coaching form draft was nearly ready to sign.",
  "Demo content. Helpful breakdown of last week's bed usage.",
  "",
  "",
];
const MIXED_COMMENTS = [
  "Demo content. Right answer, but I had to ask twice to get the page number.",
  "Demo content. Good start on the form; the follow-up date was missing.",
  "Demo content. Would like it to include the membership upgrade steps too.",
];
const NEGATIVE_COMMENTS = [
  "Demo content. It did not know the new bonus schedule yet.",
  "Demo content. Answered about the wrong salon's numbers.",
  "Demo content. The equipment answer referenced an older lamp model.",
];

interface DemoLog {
  events: DemoEvent[];
  feedback: DemoFeedback[];
}

let cached: { today: string; log: DemoLog } | null = null;

function demoLog(today: string): DemoLog {
  if (cached?.today === today) return cached.log;

  const random = mulberry32(20261111);
  const events: DemoEvent[] = [];
  const feedback: DemoFeedback[] = [];
  const start = Date.parse(`${LAUNCH}T12:00:00Z`);
  const end = Date.parse(`${today}T12:00:00Z`);
  const totalDays = Math.max(1, Math.round((end - start) / DAY_MS));

  for (let d = 0; d <= totalDays; d++) {
    const noon = start + d * DAY_MS;
    const dow = new Date(noon).getUTCDay();
    /* Adoption grows from the pilot to today; weekends are quieter. */
    const ramp = 0.35 + 0.65 * Math.min(1, d / 120);
    const weekday = dow === 0 ? 0.35 : dow === 6 ? 0.7 : 1;

    LEADERS.forEach((leader, index) => {
      if (leader.status !== "active") return;
      if (random() > leader.presence * weekday * (0.6 + 0.4 * ramp)) return;
      const count = Math.max(1, Math.round(leader.pace * ramp * (0.5 + random())));
      for (let k = 0; k < count; k++) {
        /* Salons open mid-morning; questions cluster before and after the rush. */
        const hour = pick(random, [
          [8, 2], [9, 5], [10, 8], [11, 9], [12, 6], [13, 7], [14, 8],
          [15, 7], [16, 6], [17, 5], [18, 4], [19, 3], [20, 2], [21, 1],
        ] as const);
        const minute = Math.floor(random() * 60);
        /* Central time: 6 hours behind UTC in winter, 5 in summer — close enough to pick the hour. */
        const at = Date.parse(`${new Date(noon).toISOString().slice(0, 10)}T00:00:00Z`) +
          (hour + 6) * 60 * 60 * 1000 + minute * 60 * 1000;
        if (at > Date.now()) continue;
        const category = pick(random, FOCUS_MIX[leader.focus]);
        const surface = surfaceFor(category, random);
        const succeeded = random() > 0.022;
        const facts = localFacts(at);
        const event: DemoEvent = {
          at,
          day: facts.day,
          dow: facts.dow,
          hour: facts.hour,
          leader: index,
          category,
          surface,
          succeeded,
          feedback: null,
        };

        if (surface && random() < 0.075) {
          const rating = pick(random, [[5, 46], [4, 30], [3, 12], [2, 7], [1, 5]] as const);
          const outcome: FeedbackOutcome | null =
            random() < 0.12 ? null : rating >= 4 ? "yes" : rating === 3 ? "partially" : "no";
          const pool = rating >= 4 ? POSITIVE_COMMENTS : rating === 3 ? MIXED_COMMENTS : NEGATIVE_COMMENTS;
          const comment = pool[Math.floor(random() * pool.length)];
          const age = (end - at) / DAY_MS;
          /* Praise is dismissed once read (nothing to fix); the last three weeks are still queued. */
          const status: FeedbackStatus =
            rating >= 4
              ? age < 21
                ? "pending"
                : "dismissed"
              : age < 6
                ? pick(random, [["pending", 3], ["in_review", 1]] as const)
                : pick(random, [["resolved", 5], ["dismissed", 2], ["in_review", 1]] as const);
          event.feedback = feedback.length;
          feedback.push({
            id: `fb000000-0000-4000-8000-${String(feedback.length + 1).padStart(12, "0")}`,
            event: events.length,
            rating,
            outcome,
            comment,
            status,
            hidden: random() < 0.01,
            resolutionNote:
              status === "resolved" && rating < 4
                ? "Demo content. Knowledge Base updated with the current document."
                : status === "dismissed" && rating < 4
                  ? "Demo content. Answer was correct; the policy changed after the question."
                  : null,
          });
        }
        events.push(event);
      }
    });
  }

  events.sort((a, b) => a.at - b.at);
  /* Re-point feedback at the sorted positions. */
  events.forEach((event, position) => {
    if (event.feedback !== null) feedback[event.feedback].event = position;
  });

  const log = { events, feedback };
  cached = { today, log };
  return log;
}

/* ------------------------------------------------ moderation, in memory -- */

/*
 * THE FEEDBACK QUEUE'S BUTTONS WORK IN THE DEMO. Start review, Resolve,
 * Dismiss, Hide and Delete are kept here, in this server process, so the list
 * and the counts above it move when somebody works the queue. Nothing is
 * written anywhere; a restart puts the seeded queue back.
 */
const moderation = demoStateMap<
  { status?: FeedbackStatus; hidden?: boolean; resolutionNote?: string | null; deleted?: boolean }
>("analytics.feedback-moderation");

function feedbackAt(log: DemoLog, index: number): DemoFeedback | null {
  const item = log.feedback[index];
  const change = moderation.get(item.id);
  if (!change) return item;
  if (change.deleted) return null;
  return {
    ...item,
    status: change.status ?? item.status,
    hidden: change.hidden ?? item.hidden,
    resolutionNote: change.resolutionNote !== undefined ? change.resolutionNote : item.resolutionNote,
  };
}

export function isDemoFeedbackId(id: string): boolean {
  return /^fb000000-0000-4000-8000-\d{12}$/.test(id);
}

export function demoModerateFeedback(
  id: string,
  change: { status?: FeedbackStatus; hidden?: boolean; resolutionNote?: string | null },
): void {
  const current = moderation.get(id) ?? {};
  moderation.set(id, {
    ...current,
    ...(change.status !== undefined ? { status: change.status } : {}),
    ...(change.hidden !== undefined ? { hidden: change.hidden } : {}),
    ...(change.resolutionNote !== undefined ? { resolutionNote: change.resolutionNote } : {}),
  });
}

export function demoDeleteFeedback(id: string): void {
  moderation.set(id, { ...(moderation.get(id) ?? {}), deleted: true });
}

/* ------------------------------------------------------- the questions -- */

function salonOf(leader: DemoLeader) {
  return leader.salonNumber
    ? PRODUCTION_SALONS.find((salon) => salon.salonNumber === leader.salonNumber) ?? null
    : null;
}

/** District-level people are attributed to no salon, as in the live tables. */
function leaderMatches(leader: DemoLeader, filters: AnalyticsFilters): boolean {
  const salon = salonOf(leader);
  if (filters.role && leader.role !== filters.role) return false;
  if (filters.actorId && leaderId(LEADERS.indexOf(leader) + 1) !== filters.actorId) return false;
  if (filters.salonId && (!salon || demoSalonUuid(salon.salonNumber) !== filters.salonId)) return false;
  if (filters.district && (!salon || salon.districtName !== filters.district)) return false;
  return true;
}

function eventsIn(log: DemoLog, filters: AnalyticsFilters, from: string, to: string): DemoEvent[] {
  const lo = Date.parse(from);
  const hi = Date.parse(to);
  return log.events.filter(
    (event) => event.at >= lo && event.at < hi && leaderMatches(LEADERS[event.leader], filters),
  );
}

function totalsOf(events: DemoEvent[]): AnalyticsTotals {
  const users = new Set<number>();
  const salons = new Set<string>();
  const totals: AnalyticsTotals = {
    events: events.length,
    activeUsers: 0,
    activeSalons: 0,
    forms: 0,
    documents: 0,
    reports: 0,
    chatEvents: 0,
    failures: 0,
  };
  for (const event of events) {
    const leader = LEADERS[event.leader];
    users.add(event.leader);
    if (leader.salonNumber) salons.add(leader.salonNumber);
    const feature = CATEGORY_FEATURE[event.category];
    if (feature === "forms") totals.forms += 1;
    if (feature === "reports") totals.reports += 1;
    if (feature === "chat") totals.chatEvents += 1;
    if (event.category === "document_upload") totals.documents += 1;
    if (!event.succeeded) totals.failures += 1;
  }
  totals.activeUsers = users.size;
  totals.activeSalons = salons.size;
  return totals;
}

function breakdown(events: DemoEvent[], keyOf: (event: DemoEvent) => string): BreakdownRow[] {
  const rows = new Map<string, { events: number; users: Set<number>; salons: Set<string> }>();
  for (const event of events) {
    const key = keyOf(event);
    const row = rows.get(key) ?? { events: 0, users: new Set(), salons: new Set() };
    row.events += 1;
    row.users.add(event.leader);
    const salon = LEADERS[event.leader].salonNumber;
    if (salon) row.salons.add(salon);
    rows.set(key, row);
  }
  return [...rows.entries()]
    .map(([key, row]) => ({
      key,
      events: row.events,
      activeUsers: row.users.size,
      activeSalons: row.salons.size,
    }))
    .sort((a, b) => b.events - a.events);
}

function topCategory(events: DemoEvent[]): string | null {
  return breakdown(events, (event) => event.category)[0]?.key ?? null;
}

function weekStart(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  const shift = (date.getUTCDay() + 6) % 7;
  return new Date(date.getTime() - shift * DAY_MS).toISOString().slice(0, 10);
}

function trendOf(events: DemoEvent[], from: string, to: string, days: number): TrendPoint[] {
  const bucket = bucketFor(days);
  const keyOf = (day: string) =>
    bucket === "day" ? day : bucket === "week" ? weekStart(day) : `${day.slice(0, 7)}-01`;
  const points = new Map<string, { events: number; users: Set<number> }>();
  /* Every bucket in the window is present, so a quiet day reads as zero, not as a gap. */
  for (let at = Date.parse(from) + 12 * 60 * 60 * 1000; at < Date.parse(to); at += DAY_MS) {
    const key = keyOf(localFacts(at).day);
    if (!points.has(key)) points.set(key, { events: 0, users: new Set() });
  }
  for (const event of events) {
    const point = points.get(keyOf(event.day)) ?? { events: 0, users: new Set<number>() };
    point.events += 1;
    point.users.add(event.leader);
    points.set(keyOf(event.day), point);
  }
  return [...points.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, point]) => ({ date, events: point.events, activeUsers: point.users.size }));
}

export function demoAnalyticsSnapshot(
  filters: AnalyticsFilters,
  today: string = businessToday(),
): AnalyticsSnapshot {
  const log = demoLog(today);
  const window = resolveWindow(filters, today);
  const current = eventsIn(log, filters, window.from, window.to);
  const previous = eventsIn(log, filters, window.previousFrom, window.previousTo);

  const leaders: LeaderRow[] = LEADERS.filter((leader) => leaderMatches(leader, filters)).map((leader) => {
    const index = LEADERS.indexOf(leader);
    const mine = current.filter((event) => event.leader === index);
    const salon = salonOf(leader);
    const lastEver = [...log.events].reverse().find((event) => event.leader === index);
    return {
      userId: leaderId(index + 1),
      displayName: leader.name,
      role: leader.role,
      status: leader.status,
      salonId: salon ? demoSalonUuid(salon.salonNumber) : null,
      storeName: salon?.name ?? null,
      district: salon?.districtName ?? null,
      events: mine.length,
      forms: mine.filter((event) => CATEGORY_FEATURE[event.category] === "forms").length,
      documents: mine.filter((event) => event.category === "document_upload").length,
      chatEvents: mine.filter((event) => CATEGORY_FEATURE[event.category] === "chat").length,
      topCategory: topCategory(mine),
      lastActive: lastEver ? new Date(lastEver.at).toISOString() : null,
    };
  }).sort((a, b) => b.events - a.events || a.displayName.localeCompare(b.displayName));

  const locations: LocationRow[] = PRODUCTION_SALONS.filter((salon) => {
    if (filters.salonId && demoSalonUuid(salon.salonNumber) !== filters.salonId) return false;
    if (filters.district && salon.districtName !== filters.district) return false;
    return true;
  }).map((salon) => {
    const members = LEADERS.map((leader, index) => ({ leader, index })).filter(
      ({ leader }) => leader.salonNumber === salon.salonNumber && leaderMatches(leader, filters),
    );
    const ids = new Set(members.map(({ index }) => index));
    const mine = current.filter((event) => ids.has(event.leader));
    const lastEver = [...log.events].reverse().find((event) => ids.has(event.leader));
    return {
      salonId: demoSalonUuid(salon.salonNumber),
      salonNumber: salon.salonNumber,
      storeName: salon.name,
      district: salon.districtName,
      events: mine.length,
      activeLeaders: new Set(mine.map((event) => event.leader)).size,
      assignedLeaders: members.length,
      forms: mine.filter((event) => CATEGORY_FEATURE[event.category] === "forms").length,
      reports: mine.filter((event) => CATEGORY_FEATURE[event.category] === "reports").length,
      topCategory: topCategory(mine),
      lastActive: lastEver ? new Date(lastEver.at).toISOString() : null,
    };
  }).sort((a, b) => b.events - a.events || a.storeName.localeCompare(b.storeName));

  return {
    window,
    totals: totalsOf(current),
    previous: totalsOf(previous),
    trend: trendOf(current, window.from, window.to, window.days),
    byRole: breakdown(current, (event) => LEADERS[event.leader].role),
    byCategory: breakdown(current, (event) => event.category),
    byFeature: breakdown(current, (event) => CATEGORY_FEATURE[event.category]),
    leaders,
    locations,
    districts: [...new Set(PRODUCTION_SALONS.map((salon) => salon.districtName))].sort(),
    salons: [...PRODUCTION_SALONS]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((salon) => ({
        id: demoSalonUuid(salon.salonNumber),
        name: salon.name,
        district: salon.districtName,
      })),
    roster: LEADERS.map((leader, index) => ({
      id: leaderId(index + 1),
      name: leader.name,
      role: leader.role,
    })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/* ------------------------------------------------------------ feedback -- */

function summaryOf(log: DemoLog, events: DemoEvent[]): FeedbackSummary {
  const summary: FeedbackSummary = {
    responses: 0,
    averageRating: null,
    distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    outcomes: { yes: 0, partially: 0, no: 0 },
    queue: { pending: 0, in_review: 0, resolved: 0, dismissed: 0 },
    hidden: 0,
  };
  let sum = 0;
  for (const event of events) {
    if (event.feedback === null) continue;
    const item = feedbackAt(log, event.feedback);
    if (!item) continue;
    if (item.hidden) {
      summary.hidden += 1;
      continue;
    }
    summary.queue[item.status] += 1;
    /* Like the SQL: resolved and dismissed ratings leave the average and the split. */
    if (item.status !== "pending" && item.status !== "in_review") continue;
    summary.responses += 1;
    sum += item.rating;
    summary.distribution[item.rating] += 1;
    if (item.outcome) summary.outcomes[item.outcome] += 1;
  }
  summary.averageRating = summary.responses > 0 ? sum / summary.responses : null;
  return summary;
}

function topicsOf(events: DemoEvent[]): TopicRow[] {
  const chat = events.filter((event) => CATEGORY_FEATURE[event.category] === "chat");
  return breakdown(chat, (event) => event.category).map((row) => {
    const last = [...chat].reverse().find((event) => event.category === row.key);
    return {
      category: row.key as ActivityCategory,
      events: row.events,
      activeUsers: row.activeUsers,
      acknowledgements: Math.round(row.events * 0.04),
      lastAsked: last ? new Date(last.at).toISOString() : null,
    };
  });
}

const PARSERS: readonly { key: string; perWeek: number; salons: number; facts: number }[] = [
  { key: "sales_totals_daily", perWeek: 7, salons: 15, facts: 15 },
  { key: "comp_sales_mtd", perWeek: 1, salons: 15, facts: 30 },
  { key: "bed_usage_monthly", perWeek: 0.25, salons: 15, facts: 210 },
  { key: "spa_engagement_unique_tanner", perWeek: 1, salons: 14, facts: 28 },
];

function extractionOf(windowDays: number, to: string): ExtractionRow[] {
  return PARSERS.map((parser, index) => {
    const runs = Math.max(1, Math.round((parser.perWeek * windowDays) / 7));
    const failed = runs > 8 ? 1 : 0;
    const withWarnings = Math.floor(runs / 9);
    return {
      parserKey: parser.key,
      runs,
      succeeded: runs - failed,
      failed,
      withWarnings,
      facts: (runs - failed) * parser.facts,
      salons: parser.salons,
      lastRun: new Date(Date.parse(to) - (index + 1) * 5 * 60 * 60 * 1000 - DAY_MS).toISOString(),
    };
  });
}

export function demoFeedbackSnapshot(
  filters: AnalyticsFilters,
  today: string = businessToday(),
): FeedbackSnapshot {
  const log = demoLog(today);
  const window = resolveWindow(filters, today);
  const current = eventsIn(log, filters, window.from, window.to);
  const previous = eventsIn(log, filters, window.previousFrom, window.previousTo);

  const surfaces = new Map<ActivitySurface, { events: number; users: Set<number>; rated: number; sum: number }>();
  for (const event of current) {
    if (!event.surface) continue;
    const row = surfaces.get(event.surface) ?? { events: 0, users: new Set(), rated: 0, sum: 0 };
    row.events += 1;
    row.users.add(event.leader);
    const rated = event.feedback === null ? null : feedbackAt(log, event.feedback);
    if (rated && !rated.hidden) {
      row.rated += 1;
      row.sum += rated.rating;
    }
    surfaces.set(event.surface, row);
  }
  const surfaceRows: SurfaceRow[] = [...surfaces.entries()]
    .map(([surface, row]) => ({
      surface,
      events: row.events,
      activeUsers: row.users.size,
      rated: row.rated,
      averageRating: row.rated > 0 ? row.sum / row.rated : null,
    }))
    .sort((a, b) => b.events - a.events);

  const when = new Map<string, WhenRow>();
  for (const event of current) {
    const key = `${event.dow}:${event.hour}`;
    const row = when.get(key) ?? { dayOfWeek: event.dow, hourOfDay: event.hour, events: 0 };
    row.events += 1;
    when.set(key, row);
  }

  return {
    window,
    summary: summaryOf(log, current),
    previousSummary: summaryOf(log, previous),
    surfaces: surfaceRows,
    when: [...when.values()],
    topics: topicsOf(current),
    previousTopics: topicsOf(previous),
    extraction: extractionOf(window.days, window.to),
  };
}

export function demoFeedbackPage(
  filters: AnalyticsFilters,
  queue: FeedbackFilters,
  today: string = businessToday(),
): FeedbackPage {
  const log = demoLog(today);
  const window = resolveWindow(filters, today);
  const statuses = statusesFor(queue.status);
  const search = queue.search.trim().toLowerCase();

  const matching = eventsIn(log, filters, window.from, window.to)
    .filter((event) => event.feedback !== null)
    .map((event) => ({ event, item: feedbackAt(log, event.feedback as number) }))
    .filter((entry): entry is { event: DemoEvent; item: DemoFeedback } => entry.item !== null)
    .filter(({ event, item }) => {
      if (item.hidden && !queue.includeHidden) return false;
      if (statuses && !statuses.includes(item.status)) return false;
      if (queue.outcome && item.outcome !== queue.outcome) return false;
      if (queue.rating && item.rating !== queue.rating) return false;
      if (queue.surface && event.surface !== queue.surface) return false;
      if (search && !item.comment.toLowerCase().includes(search)) return false;
      return true;
    })
    .reverse();

  const offset = (queue.page - 1) * FEEDBACK_PAGE_SIZE;
  const items: FeedbackItem[] = matching
    .slice(offset, offset + FEEDBACK_PAGE_SIZE)
    .map(({ event, item }) => {
      const leader = LEADERS[event.leader];
      const salon = salonOf(leader);
      const occurredAt = new Date(event.at).toISOString();
      const settled = item.status === "resolved" || item.status === "dismissed";
      const settledAt = new Date(event.at + 2 * DAY_MS).toISOString();
      return {
        id: item.id,
        turnId: `ae000000-0000-4000-8000-${String(item.event + 1).padStart(12, "0")}`,
        rating: item.rating,
        gotWhatNeeded: item.outcome,
        comment: item.comment,
        status: item.status,
        resolutionNote: settled ? item.resolutionNote : null,
        resolvedAt: settled ? settledAt : null,
        resolvedByName: settled ? "Priya Raghunathan" : null,
        hiddenAt: item.hidden ? settledAt : null,
        hiddenByName: item.hidden ? "Priya Raghunathan" : null,
        createdAt: occurredAt,
        updatedAt: settled ? settledAt : occurredAt,
        occurredAt,
        surface: event.surface,
        category: event.category,
        succeeded: event.succeeded,
        role: leader.role,
        displayName: leader.name,
        storeName: salon?.name ?? null,
        district: salon?.districtName ?? null,
      };
    });

  return { items, total: matching.length, page: queue.page, pageSize: FEEDBACK_PAGE_SIZE };
}
