/**
 * The dashboard read layer's public surface.
 *
 * `reporting-read-repository` is intentionally NOT re-exported here: it is
 * `server-only`, and re-exporting it from a barrel that also carries the pure
 * filter and formatting helpers would drag the server guard into any client
 * component that wanted `formatMetricValue`. Import it by its own path.
 */

export * from "./types";
export * from "./aggregation";
export * from "./filters";
export * from "./dashboard";
