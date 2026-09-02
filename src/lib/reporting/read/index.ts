/**
 * The dashboard read layer's public surface.
 *
 * `reporting-read-repository` and `report-context` are intentionally NOT
 * re-exported here: both are `server-only`, and re-exporting either from a
 * barrel that also carries the pure filter and formatting helpers would drag
 * the server guard into any client component that wanted `formatMetricValue`.
 * Import them by their own paths.
 */

export * from "./types";
export * from "./aggregation";
export * from "./filters";
export * from "./views";
export * from "./canonical";
export * from "./windows";
export * from "./dashboard";
export * from "./salon-detail";
