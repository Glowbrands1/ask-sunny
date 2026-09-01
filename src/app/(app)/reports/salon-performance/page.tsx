import type { Metadata } from "next";

import { PermissionGate } from "@/components/permission-gate";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState, Notice } from "@/components/ui/feedback";
import { PageHeader, PageShell, SectionHeader } from "@/components/ui/layout";
import {
  SUPABASE_URL_ENV,
  supabaseSecretKeyConfigured,
} from "@/lib/config/server-env";
import {
  BASELINE_LABELS,
  hasActiveFilters,
  parseReportFilters,
  serializeReportFilters,
  unitPolicy,
  type FacetName,
} from "@/lib/reporting/read";
import { ReportingReadRepository } from "@/lib/reporting/read/reporting-read-repository";
import {
  ScopeBanner,
  SourceFreshness,
} from "@/features/reports/salon-performance/scope-banner";

/**
 * Salon Performance — the real, Supabase-backed reporting surface.
 *
 * CHECKPOINT 6A: the data layer and its contracts, wired end to end and visible,
 * with no charts yet. What is on this page is what 6B will draw from — the
 * scope, the freshness, the filters actually available, and the metric
 * catalogue with the basis years each metric really has.
 *
 * The seeded `/reports` screen is untouched and remains the demo experience.
 *
 * `force-dynamic` because this reads the database per request. Without it Next
 * would try to prerender at build time, where no Supabase credentials exist and
 * the build would fail for the wrong reason.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Salon Performance",
};

function ConfigurationNeeded() {
  return (
    <PageShell>
      <PageHeader
        eyebrow="Reporting"
        title="Salon Performance"
        description="Comparable-store sales from the ingested Comp Report."
      />
      <Notice tone="attention" title="Supabase is not configured in this runtime">
        This view reads ingested reporting data directly, so it needs the server-side
        Supabase configuration. It is available in the Preview and internal
        environments.
      </Notice>
    </PageShell>
  );
}

export default async function SalonPerformancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!process.env[SUPABASE_URL_ENV] || !supabaseSecretKeyConfigured()) {
    return <ConfigurationNeeded />;
  }

  const params = await searchParams;
  const { filters, ignored } = parseReportFilters(params);

  const repository = new ReportingReadRepository();
  const scope = await repository.getScope(filters.periodEnd);

  if (!scope) {
    return (
      <PageShell>
        <PageHeader
          eyebrow="Reporting"
          title="Salon Performance"
          description="Comparable-store sales from the ingested Comp Report."
        />
        <EmptyState
          title="No report has been ingested yet"
          description="Once a Comp Report workbook has been ingested, its salons, metrics and period appear here."
        />
      </PageShell>
    );
  }

  const [options, metrics, salons] = await Promise.all([
    repository.getFilterOptions(scope.periodId),
    repository.getMetricCatalogue(scope.periodId),
    repository.listSalons(scope.periodId, filters),
  ]);

  const ingestedLabel = scope.ingestedAt
    ? new Date(scope.ingestedAt).toLocaleString("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "UTC",
      }) + " UTC"
    : "unknown";

  const selected = filters.metricCodes
    .map((code) => metrics.find((metric) => metric.code === code))
    .filter((metric): metric is (typeof metrics)[number] => Boolean(metric));

  const facetOrder: FacetName[] = [
    "district",
    "region",
    "company",
    "ownership_group",
    "dma",
    "quintile_group",
    "comp_salon",
    "pricing_plan",
    "market_consolidation",
  ];

  return (
    <PermissionGate permission="view_reports">
      <PageShell className="space-y-6">
        <PageHeader
          eyebrow="Reporting"
          title="Salon Performance"
          description="Comparable-store (same-store) sales. Not compensation, payroll or bonuses."
        />

        {/* Non-negotiable, on every view. */}
        <ScopeBanner scope={scope} />
        <SourceFreshness scope={scope} ingestedLabel={ingestedLabel} />

        {ignored.length > 0 ? (
          <Notice tone="neutral" title="Some filters in this link were ignored">
            {ignored.length} value{ignored.length === 1 ? "" : "s"} could not be applied
            because they are not available in this report.
          </Notice>
        ) : null}

        <section className="space-y-3">
          <SectionHeader
            title="Active view"
            description="Filters live in the URL, so this link reproduces exactly what you are looking at."
          />
          <Card>
            <CardContent className="space-y-2 text-sm">
              <p className="text-muted-foreground">
                Comparison baseline:{" "}
                <span className="text-foreground">
                  {BASELINE_LABELS[filters.baselineYear] ?? `vs ${filters.baselineYear}`}
                </span>
              </p>
              <p className="text-muted-foreground">
                Salons matching filters:{" "}
                <span className="text-foreground">
                  {salons.length} of {scope.salonCount}
                </span>
                {hasActiveFilters(filters) ? null : " (no filters applied)"}
              </p>
              <p className="break-all text-xs text-subtle-foreground">
                ?{serializeReportFilters(filters).toString() || "(defaults)"}
              </p>
            </CardContent>
          </Card>
        </section>

        <section className="space-y-3">
          <SectionHeader
            title="Selected metrics"
            description="Aggregation is decided by the metric's unit, not by the chart."
          />
          <div className="grid gap-3 sm:grid-cols-2">
            {selected.map((metric) => {
              const policy = unitPolicy(metric.unit);
              return (
                <Card key={metric.code}>
                  <CardContent className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-medium">{metric.label}</span>
                      <Badge tone="neutral">{metric.unit}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Basis years available: {metric.availableBasisYears.join(", ")}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {policy.preferred
                        ? `Default aggregation: ${policy.preferred}`
                        : "Not aggregated"}
                      {metric.higherIsBetter === null
                        ? " · direction undefined, never coloured"
                        : null}
                    </p>
                    {policy.refusalNote ? (
                      <p className="text-xs text-subtle-foreground">{policy.refusalNote}</p>
                    ) : null}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>

        <section className="space-y-3">
          <SectionHeader
            title="Filters available in this report"
            description="Only values present in the data appear, so a filter can never return nothing."
          />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {facetOrder.map((facet) => {
              const values = options[facet];
              if (!values || values.length === 0) return null;
              return (
                <Card key={facet}>
                  <CardContent className="space-y-1">
                    <p className="text-sm font-medium">{facet.replace(/_/g, " ")}</p>
                    <p className="text-xs text-muted-foreground">
                      {values.length} value{values.length === 1 ? "" : "s"}
                    </p>
                    {facet === "district" || facet === "region" ? (
                      <p className="text-xs text-subtle-foreground">
                        Manager name as reported for this period — descriptive, not an
                        identifier.
                      </p>
                    ) : null}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>

        <section className="space-y-3">
          <SectionHeader
            title="Metric catalogue"
            description={`${metrics.length} supported metrics with facts in this period.`}
          />
          <Card>
            <CardContent>
              <ul className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                {metrics.map((metric) => (
                  <li key={metric.code} className="flex items-baseline justify-between gap-3">
                    <span className="text-foreground">{metric.label}</span>
                    <span>
                      {metric.availableBasisYears.join("/")} · {metric.factCount}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </section>
      </PageShell>
    </PermissionGate>
  );
}
