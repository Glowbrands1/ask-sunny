import type { DashboardMetric } from "@/types";

/**
 * Reporting demo data — DEMO CONTENT.
 * Figures are illustrative and do not represent real Sun Tan City performance.
 */

export const DAILY_STATS_METRICS: DashboardMetric[] = [
  {
    id: "traffic",
    label: "Guests served",
    value: "486",
    helper: "Yesterday, all salons",
    changeLabel: "+6.2% vs same weekday",
    trend: "up",
  },
  {
    id: "conversion",
    label: "Membership conversion",
    value: "24.6%",
    helper: "Share of eligible guests",
    changeLabel: "-1.4 pts vs last week",
    trend: "down",
  },
  {
    id: "ticket",
    label: "Average ticket",
    value: "$41.80",
    helper: "Across all transactions",
    changeLabel: "+$1.35 vs last week",
    trend: "up",
  },
  {
    id: "upgrades",
    label: "Upgrades",
    value: "63",
    helper: "Tier moves, yesterday",
    changeLabel: "+9 vs same weekday",
    trend: "up",
  },
];

export const DAILY_TRAFFIC_SERIES = [
  { label: "Mon", guests: 412, lastWeek: 398 },
  { label: "Tue", guests: 438, lastWeek: 421 },
  { label: "Wed", guests: 461, lastWeek: 455 },
  { label: "Thu", guests: 502, lastWeek: 468 },
  { label: "Fri", guests: 578, lastWeek: 561 },
  { label: "Sat", guests: 604, lastWeek: 612 },
  { label: "Sun", guests: 486, lastWeek: 458 },
];

export const CONVERSION_SERIES = [
  { label: "Wk 1", conversion: 22.4, target: 25 },
  { label: "Wk 2", conversion: 23.1, target: 25 },
  { label: "Wk 3", conversion: 24.8, target: 25 },
  { label: "Wk 4", conversion: 26.2, target: 25 },
  { label: "Wk 5", conversion: 25.4, target: 25 },
  { label: "Wk 6", conversion: 26.9, target: 25 },
  { label: "Wk 7", conversion: 25.8, target: 25 },
  { label: "Wk 8", conversion: 24.6, target: 25 },
];

export const SALON_PERFORMANCE = [
  { salon: "Harborview Landing", district: "District 3", revenue: 68420, conversion: 28.4, ticket: 44.1, guests: 1512 },
  { salon: "Stonebridge Market", district: "District 3", revenue: 61250, conversion: 27.1, ticket: 43.2, guests: 1418 },
  { salon: "Riverbend Commons", district: "District 1", revenue: 58940, conversion: 26.8, ticket: 42.6, guests: 1383 },
  { salon: "Cedar Point Plaza", district: "District 2", revenue: 55310, conversion: 25.9, ticket: 41.8, guests: 1322 },
  { salon: "Lakeshore Terrace", district: "District 4", revenue: 52180, conversion: 24.7, ticket: 41.2, guests: 1266 },
  { salon: "Summit Row", district: "District 4", revenue: 49640, conversion: 24.1, ticket: 40.9, guests: 1214 },
  { salon: "Maple Crossing", district: "District 1", revenue: 46870, conversion: 23.6, ticket: 40.1, guests: 1168 },
  { salon: "Sandalwood Corner", district: "District 3", revenue: 44120, conversion: 22.9, ticket: 39.6, guests: 1114 },
  { salon: "Northgate Square", district: "District 2", revenue: 41380, conversion: 22.2, ticket: 39.1, guests: 1058 },
  { salon: "Hillcrest Station", district: "District 1", revenue: 38940, conversion: 21.4, ticket: 38.4, guests: 1012 },
  { salon: "Brookside Village", district: "District 4", revenue: 36210, conversion: 20.8, ticket: 37.9, guests: 954 },
  { salon: "Willow Park", district: "District 2", revenue: 33580, conversion: 19.6, ticket: 37.2, guests: 902 },
];

export const SALES_METRICS: DashboardMetric[] = [
  {
    id: "revenue",
    label: "Revenue, month to date",
    value: "$586,840",
    helper: "All salons",
    changeLabel: "+8.4% vs last month",
    trend: "up",
  },
  {
    id: "product",
    label: "Product attachment",
    value: "31.2%",
    helper: "Transactions including product",
    changeLabel: "+2.1 pts",
    trend: "up",
  },
  {
    id: "upgrade-rate",
    label: "Upgrade rate",
    value: "12.9%",
    helper: "Members moving tier",
    changeLabel: "flat vs last month",
    trend: "flat",
  },
  {
    id: "returns",
    label: "Refund rate",
    value: "1.1%",
    helper: "Of transactions",
    changeLabel: "-0.3 pts",
    trend: "up",
  },
];

export const REVENUE_SERIES = [
  { label: "Mar", revenue: 498200, product: 128400 },
  { label: "Apr", revenue: 512700, product: 134100 },
  { label: "May", revenue: 534900, product: 141800 },
  { label: "Jun", revenue: 561300, product: 149200 },
  { label: "Jul", revenue: 572100, product: 154600 },
  { label: "Aug", revenue: 586840, product: 163900 },
];

export const MEMBERSHIP_METRICS: DashboardMetric[] = [
  {
    id: "active",
    label: "Active memberships",
    value: "18,412",
    helper: "All salons",
    changeLabel: "+412 this month",
    trend: "up",
  },
  {
    id: "new",
    label: "New memberships",
    value: "1,046",
    helper: "Month to date",
    changeLabel: "+7.8% vs last month",
    trend: "up",
  },
  {
    id: "cancel",
    label: "Cancellations",
    value: "634",
    helper: "Month to date",
    changeLabel: "+4.1% vs last month",
    trend: "down",
  },
  {
    id: "net",
    label: "Net member growth",
    value: "+412",
    helper: "New less cancellations",
    changeLabel: "+118 vs last month",
    trend: "up",
  },
];

export const MEMBERSHIP_MIX = [
  { label: "Base", members: 7412 },
  { label: "Plus", members: 5286 },
  { label: "Premier", members: 3608 },
  { label: "Elite", members: 2106 },
];

export const MEMBERSHIP_TREND = [
  { label: "Mar", joined: 892, cancelled: 604 },
  { label: "Apr", joined: 934, cancelled: 621 },
  { label: "May", joined: 968, cancelled: 588 },
  { label: "Jun", joined: 1012, cancelled: 640 },
  { label: "Jul", joined: 970, cancelled: 609 },
  { label: "Aug", joined: 1046, cancelled: 634 },
];

export const PEOPLE_METRICS: DashboardMetric[] = [
  {
    id: "coaching",
    label: "Coaching conversations",
    value: "84",
    helper: "Documented this month",
    changeLabel: "+12 vs last month",
    trend: "up",
  },
  {
    id: "followups",
    label: "Follow-ups completed on time",
    value: "78%",
    helper: "Of follow-ups due",
    changeLabel: "+6 pts",
    trend: "up",
  },
  {
    id: "certification",
    label: "Certifications current",
    value: "91%",
    helper: "Team members up to date",
    changeLabel: "+3 pts",
    trend: "up",
  },
  {
    id: "turnover",
    label: "Rolling 90-day turnover",
    value: "18.4%",
    helper: "All salons",
    changeLabel: "-2.2 pts",
    trend: "up",
  },
];

export const COACHING_BY_DISTRICT = [
  { label: "District 1", coaching: 26, followUps: 21 },
  { label: "District 2", coaching: 18, followUps: 13 },
  { label: "District 3", coaching: 24, followUps: 20 },
  { label: "District 4", coaching: 16, followUps: 12 },
];

/** Site-usage figures — the one thing the reference platform's analytics showed. */
export const PLATFORM_ACTIVITY = {
  questionsThisMonth: 1284,
  leadersUsingTool: 34,
  totalLeaders: 41,
  formsCreatedThisMonth: 62,
  documentsOpenedThisMonth: 418,
  videosWatchedThisMonth: 197,
};

export const PLATFORM_ACTIVITY_SERIES = [
  { label: "Wk 1", questions: 246, forms: 11 },
  { label: "Wk 2", questions: 288, forms: 14 },
  { label: "Wk 3", questions: 312, forms: 16 },
  { label: "Wk 4", questions: 438, forms: 21 },
];
