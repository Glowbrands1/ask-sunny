import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseAdmin } from "@/lib/supabase/server";
import type { ReportPeriodGrain } from "../types";
import type { ReportFilters } from "./filters";
import type { FactRow } from "./dashboard";
import type {
  FacetName,
  FacetOption,
  FilterOptions,
  MetricDescriptor,
  PeriodOption,
  ReportScope,
  ReportSourceQuality,
  SalonPeriodDescriptors,
} from "./types";
import type { SourceViewRow } from "./views";

/**
 * THE DASHBOARD READ LAYER.
 *
 * Server-only, and that is the whole security model for 6A. There is no
 * identity provider yet, so `authenticated` is a role nobody holds and a
 * browser client would read zero rows through RLS. Reads therefore run
 * server-side under the secret key, and `import "server-only"` makes a client
 * component importing this file a BUILD failure rather than a review comment.
 *
 * This is explicitly an interim posture for the internal/Preview environment.
 * When authentication ships, the queries move to a browser client under RLS and
 * the policies narrow from `using (true)` to a district/region scope — which
 * needs stable district and region CODES, because the columns this source fills
 * hold manager names.
 *
 * Every method returns a typed contract from `./types`, never a raw row: the
 * shapes the charts consume are settled here so no component reaches for a
 * column that might be renamed.
 */

/** Rows as the three read views return them. Kept private to this module. */
interface ScopeRow {
  ingestion_id: string;
  period_id: string;
  grain: ReportPeriodGrain;
  period_start: string;
  period_end: string;
  period_label: string;
  fiscal_year: number;
  parser_key: string;
  parser_version: number;
  ingested_at: string | null;
  warnings: string[] | null;
  warning_count: number;
  source_sheet_names: string[] | null;
  live_salon_count: number;
  live_fact_count: number;
  live_metric_count: number;
  file_id: string;
  original_filename: string;
  file_sha256: string;
  storage_bucket: string;
  storage_path: string;
  size_bytes: number;
  received_at: string | null;
  source_code: string;
  source_name: string;
  source_kind: string;
  report_family: string;
}

interface FacetRow {
  period_id: string;
  facet: FacetName;
  value: string;
  salon_count: number;
}

interface MetricRow {
  period_id: string;
  code: string;
  label: string;
  family: string;
  unit: MetricDescriptor["unit"];
  higher_is_better: boolean | null;
  basis_year_required: boolean;
  comparison_of_code: string | null;
  description: string;
  available_basis_years: number[] | null;
  fact_count: number;
  salon_count: number;
}

interface SalonAttributeRow {
  salon_number: string;
  store_name: string;
  district_label: string | null;
  region_label: string | null;
  company: string | null;
  ownership_group: string | null;
  dma: string | null;
  pricing_plan: string | null;
  is_comp_salon: boolean | null;
  quintile_group: string | null;
  revenue_rank: number | null;
  salon_age_years: number | null;
  avg_client_age: number | null;
  spa_pieces: number | null;
}

function toScope(row: ScopeRow): ReportScope {
  return {
    ingestionId: row.ingestion_id,
    periodId: row.period_id,
    grain: row.grain,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    periodLabel: row.period_label,
    fiscalYear: row.fiscal_year,
    // Derived from the live facts by the view, so the banner is a measurement.
    salonCount: Number(row.live_salon_count),
    factCount: Number(row.live_fact_count),
    metricCount: Number(row.live_metric_count),
    ingestedAt: row.ingested_at,
    parserKey: row.parser_key,
    parserVersion: row.parser_version,
    companyWide: false,
  };
}

export class ReportingReadRepository {
  private readonly client: SupabaseClient;

  constructor(client: SupabaseClient = getSupabaseAdmin()) {
    this.client = client;
  }

  /**
   * The scope of the report being displayed.
   *
   * With no `periodEnd` it returns the most recently ingested period. When a
   * period has been re-ingested, the latest succeeded ingestion wins — the
   * corrected figures are the live ones, so its scope is the honest one.
   */
  async getScope(periodEnd?: string | null): Promise<ReportScope | null> {
    let query = this.client
      .from("comp_sales_report_scope")
      .select("*")
      .order("ingested_at", { ascending: false })
      .limit(1);

    if (periodEnd) query = query.eq("period_end", periodEnd);

    const { data, error } = await query;
    if (error) throw new Error(`Could not read the report scope: ${error.message}`);
    const row = (data as ScopeRow[] | null)?.[0];
    return row ? toScope(row) : null;
  }

  /**
   * Which source sheets have live facts, and for which periods.
   *
   * The View selector is built from this, so it describes the database rather
   * than a list of intentions: a sheet appears because its figures are loaded.
   */
  async listSourceViews(): Promise<SourceViewRow[]> {
    const { data, error } = await this.client
      .from("comp_sales_source_views")
      .select(
        "period_id, grain, period_end, source_sheet, fact_count, salon_count," +
          " metric_count, ingested_at",
      )
      .order("period_end", { ascending: false });
    if (error) throw new Error(`Could not read source views: ${error.message}`);

    interface Row {
      period_id: string;
      grain: ReportPeriodGrain;
      period_end: string;
      source_sheet: string;
      fact_count: number;
      salon_count: number;
      metric_count: number;
      ingested_at: string | null;
    }

    return ((data ?? []) as unknown as Row[]).map((row) => ({
      periodId: row.period_id,
      grain: row.grain,
      periodEnd: row.period_end,
      sourceSheet: row.source_sheet,
      factCount: Number(row.fact_count),
      salonCount: Number(row.salon_count),
      metricCount: Number(row.metric_count),
      ingestedAt: row.ingested_at,
    }));
  }

  /** Periods available to select. Newest first. */
  async listPeriods(): Promise<PeriodOption[]> {
    const { data, error } = await this.client
      .from("comp_sales_report_scope")
      .select("period_id, grain, period_end, period_label, live_salon_count, ingested_at")
      .order("period_end", { ascending: false });
    if (error) throw new Error(`Could not list reporting periods: ${error.message}`);

    // One entry per period even if a period was ingested more than once.
    const seen = new Set<string>();
    const periods: PeriodOption[] = [];
    for (const row of (data ?? []) as Partial<ScopeRow>[]) {
      const id = row.period_id as string;
      if (seen.has(id)) continue;
      seen.add(id);
      periods.push({
        periodId: id,
        grain: row.grain as ReportPeriodGrain,
        periodEnd: row.period_end as string,
        periodLabel: row.period_label as string,
        salonCount: Number(row.live_salon_count ?? 0),
      });
    }
    return periods;
  }

  /**
   * Facet values present in the period.
   *
   * A facet with no values is absent from the result rather than empty, so the
   * UI cannot render a filter whose only possible outcome is nothing. In the
   * audited workbook that is why `pricing_plan` and `market_consolidation` do
   * not appear: every salon reported them as `n/a`, or the column is not in the
   * descriptor band at all.
   */
  async getFilterOptions(periodId: string): Promise<FilterOptions> {
    const { data, error } = await this.client
      .from("comp_sales_filter_options")
      .select("period_id, facet, value, salon_count")
      .eq("period_id", periodId)
      .order("facet", { ascending: true })
      .order("value", { ascending: true });
    if (error) throw new Error(`Could not read filter options: ${error.message}`);

    const options: FilterOptions = {};
    for (const row of (data ?? []) as FacetRow[]) {
      const bucket: FacetOption[] = options[row.facet] ?? [];
      bucket.push({ value: row.value, salonCount: Number(row.salon_count) });
      options[row.facet] = bucket;
    }
    return options;
  }

  /** The supported metrics, with the basis years this period actually holds. */
  async getMetricCatalogue(periodId: string): Promise<MetricDescriptor[]> {
    const { data, error } = await this.client
      .from("comp_sales_metric_catalogue")
      .select("*")
      .eq("period_id", periodId)
      .order("family", { ascending: true })
      .order("code", { ascending: true });
    if (error) throw new Error(`Could not read the metric catalogue: ${error.message}`);

    return ((data ?? []) as MetricRow[]).map((row) => ({
      code: row.code,
      label: row.label,
      family: row.family,
      unit: row.unit,
      higherIsBetter: row.higher_is_better,
      basisYearRequired: row.basis_year_required,
      comparisonOfCode: row.comparison_of_code,
      description: row.description,
      availableBasisYears: [...(row.available_basis_years ?? [])].sort((a, b) => a - b),
      factCount: Number(row.fact_count),
      salonCount: Number(row.salon_count),
    }));
  }

  /**
   * Provenance for the "Data source & quality" drawer.
   *
   * Warnings are grouped by code, so seventeen of them read as "7 stale
   * headers, 10 duplicate columns" instead of a wall of text.
   */
  async getSourceQuality(ingestionId: string): Promise<ReportSourceQuality | null> {
    const { data, error } = await this.client
      .from("comp_sales_report_scope")
      .select("*")
      .eq("ingestion_id", ingestionId)
      .limit(1);
    if (error) throw new Error(`Could not read source quality: ${error.message}`);
    const row = (data as ScopeRow[] | null)?.[0];
    if (!row) return null;

    const grouped = new Map<string, string[]>();
    for (const warning of row.warnings ?? []) {
      // Stored as `code: message`.
      const separator = warning.indexOf(":");
      const code = separator === -1 ? "warning" : warning.slice(0, separator).trim();
      const message = separator === -1 ? warning : warning.slice(separator + 1).trim();
      grouped.set(code, [...(grouped.get(code) ?? []), message]);
    }

    return {
      ingestionId: row.ingestion_id,
      sourceCode: row.source_code,
      sourceName: row.source_name,
      sourceKind: row.source_kind,
      reportFamily: row.report_family,
      originalFilename: row.original_filename,
      fileSha256: row.file_sha256,
      storageBucket: row.storage_bucket,
      storagePath: row.storage_path,
      sizeBytes: Number(row.size_bytes),
      receivedAt: row.received_at,
      ingestedAt: row.ingested_at,
      sourceSheetNames: row.source_sheet_names ?? [],
      warningCount: Number(row.warning_count),
      warningsByCode: [...grouped.entries()]
        .map(([code, messages]) => ({ code, count: messages.length, messages }))
        .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code)),
      // Not persisted by the current schema. Null, not zero: "none were
      // skipped" and "we did not record it" are different facts.
      skippedRowsByReason: null,
    };
  }

  /**
   * Fact rows for exactly the metric codes asked for.
   *
   * Read from `comp_sales_current_facts`, which already excludes superseded
   * rows — so a corrected report's replacements are what the dashboard shows,
   * and the history stays available to an audit without leaking into a chart.
   *
   * NO CODES ARE ADDED HERE. An earlier version quietly fetched the
   * `% change` counterpart of every requested metric, which was convenient
   * until performance windows arrived: which comparison metric a view needs now
   * depends on the selected window, and a repository guessing at it would
   * sometimes fetch the wrong one and always fetch some it did not need.
   * `windowMetricCodeList` names them, this method fetches them.
   */
  async getFactRows(input: {
    periodId: string;
    metricCodes: string[];
    /** Restricts to the salons the filters admitted. Empty means no restriction. */
    salonNumbers?: string[];
    /**
     * Restricts to one sheet of the source workbook.
     *
     * The selected View names a sheet, and figures from a different sheet must
     * never appear under it: the sheets have different period anchors (the YTD
     * sheet is marked `YTD 07 2026` while the MTD sheets are `08/30/2026`), so
     * mixing them would put one period's numbers under another's heading.
     */
    sourceSheet?: string | null;
  }): Promise<FactRow[]> {
    const wanted = [...new Set(input.metricCodes)];
    if (wanted.length === 0) return [];

    let query = this.client
      .from("comp_sales_current_facts")
      .select(
        "salon_number, store_name, metric_code, basis_year, value, source_sheet, source_column",
      )
      .eq("period_id", input.periodId)
      .in("metric_code", wanted);

    if (input.salonNumbers && input.salonNumbers.length > 0) {
      query = query.in("salon_number", input.salonNumbers);
    }
    if (input.sourceSheet) query = query.eq("source_sheet", input.sourceSheet);

    const { data, error } = await query;
    if (error) throw new Error(`Could not read reporting facts: ${error.message}`);

    interface Row {
      salon_number: string;
      store_name: string;
      metric_code: string;
      basis_year: number | null;
      value: number | string;
      source_sheet: string;
      source_column: string;
    }

    return ((data ?? []) as Row[]).map((row) => ({
      salonNumber: row.salon_number,
      storeName: row.store_name,
      metricCode: row.metric_code,
      basisYear: row.basis_year,
      // `numeric` arrives as a string; coerced once, here.
      value: typeof row.value === "string" ? Number(row.value) : row.value,
      sourceSheet: row.source_sheet,
      sourceColumn: row.source_column,
    }));
  }

  /**
   * Salon descriptors for the period, narrowed by the active filters.
   *
   * The filter fields are applied here rather than in the caller so that every
   * view narrows identically — the "shared filters" guarantee is a property of
   * this method, not a convention between components.
   */
  async listSalons(
    periodId: string,
    filters: ReportFilters,
  ): Promise<SalonPeriodDescriptors[]> {
    let query = this.client
      .from("salon_period_attributes")
      .select(
        "district_label, region_label, company, ownership_group, dma, pricing_plan," +
          " is_comp_salon, quintile_group, revenue_rank, salon_age_years, avg_client_age," +
          " spa_pieces, salons!inner(salon_number, store_name)",
      )
      .eq("period_id", periodId)
      .is("superseded_by_ingestion_id", null);

    if (filters.districts.length > 0) query = query.in("district_label", filters.districts);
    if (filters.regions.length > 0) query = query.in("region_label", filters.regions);
    if (filters.companies.length > 0) query = query.in("company", filters.companies);
    if (filters.ownershipGroups.length > 0) {
      query = query.in("ownership_group", filters.ownershipGroups);
    }
    if (filters.dmas.length > 0) query = query.in("dma", filters.dmas);
    if (filters.quintiles.length > 0) query = query.in("quintile_group", filters.quintiles);
    if (filters.compSalonOnly !== null) {
      query = query.eq("is_comp_salon", filters.compSalonOnly);
    }
    if (filters.salonNumbers.length > 0) {
      query = query.in("salons.salon_number", filters.salonNumbers);
    }

    const { data, error } = await query;
    if (error) throw new Error(`Could not list salons: ${error.message}`);

    type Joined = Omit<SalonAttributeRow, "salon_number" | "store_name"> & {
      salons: { salon_number: string; store_name: string } | null;
    };

    return ((data ?? []) as unknown as Joined[])
      .filter((row) => row.salons !== null)
      .map((row) => ({
        // Text throughout: '0468' is never coerced on the way out either.
        salonNumber: row.salons!.salon_number,
        storeName: row.salons!.store_name,
        districtLabel: row.district_label,
        regionLabel: row.region_label,
        company: row.company,
        ownershipGroup: row.ownership_group,
        dma: row.dma,
        pricingPlan: row.pricing_plan,
        isCompSalon: row.is_comp_salon,
        quintileGroup: row.quintile_group,
        revenueRank: row.revenue_rank,
        salonAgeYears: row.salon_age_years === null ? null : Number(row.salon_age_years),
        avgClientAge: row.avg_client_age === null ? null : Number(row.avg_client_age),
        spaPieces: row.spa_pieces,
      }))
      .sort((a, b) => a.salonNumber.localeCompare(b.salonNumber));
  }
}
