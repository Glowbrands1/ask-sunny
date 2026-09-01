import { METRICS_BY_CODE } from "./comp-sales/metric-map";
import { SALON_NUMBER_PATTERN } from "./comp-sales/parser";
import type { ParsedReport } from "./types";

/**
 * THE GATE BETWEEN PARSING AND PERSISTENCE.
 *
 * The parser's job is to read a workbook honestly; this is where we decide
 * whether what it read may be written. The two are separate because they fail
 * differently: a parse problem is about the FILE, a validation problem is about
 * whether the result is fit to become rows.
 *
 * Every rule here mirrors a constraint the database would enforce anyway. That
 * is deliberate duplication: reaching the database and being refused costs a
 * round trip, produces a Postgres error string no operator wants to read, and —
 * because the atomic write is one transaction — tells you only about the FIRST
 * offending row. Validating up front reports every problem at once, in language
 * that names the report rather than the schema.
 *
 * Nothing in a problem message carries a figure from the workbook.
 */

export interface ValidationProblem {
  code: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  problems: ValidationProblem[];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const SOURCE_COLUMN = /^[A-Z]{1,3}$/;

export function validateParsedReport(report: ParsedReport): ValidationResult {
  const problems: ValidationProblem[] = [];
  const add = (code: string, message: string) => problems.push({ code, message });

  // ---- the report as a whole ----
  if (report.salons.length === 0) add("no_salons", "The report contains no salons.");
  if (report.facts.length === 0) add("no_facts", "The report produced no facts.");

  // A finding the parser could not resolve on its own must not be written past.
  if (report.diagnostics.requiresReview) {
    add(
      "requires_review",
      "The parser found a duplicate measure column it could not resolve and marked the " +
        "report for review. Ingestion is refused until the source is corrected or the " +
        "mapping is confirmed.",
    );
  }

  // ---- period ----
  const { period } = report;
  if (!ISO_DATE.test(period.periodEnd)) add("bad_period_end", "The period end is not a plain date.");
  if (!ISO_DATE.test(period.periodStart)) add("bad_period_start", "The period start is not a plain date.");
  if (period.periodStart > period.periodEnd) {
    add("period_inverted", "The period starts after it ends.");
  }
  if (period.fiscalYear !== Number(period.periodEnd.slice(0, 4))) {
    add("fiscal_year_mismatch", "The fiscal year does not match the period end's year.");
  }
  if (period.labelRaw.trim().length === 0) {
    add("period_label_blank", "The period label from the workbook is blank.");
  }

  // ---- salons ----
  const salonNumbers = new Set<string>();
  for (const salon of report.salons) {
    if (!SALON_NUMBER_PATTERN.test(salon.salonNumber)) {
      add("bad_salon_number", `Salon number "${salon.salonNumber}" does not fit the salon key.`);
    }
    if (salon.storeName.trim().length === 0) {
      add("blank_store_name", `Salon ${salon.salonNumber} has no store name.`);
    }
    if (salonNumbers.has(salon.salonNumber)) {
      // The parser fails closed on this, so reaching here means a caller built
      // a ParsedReport by hand. Still refused.
      add("duplicate_salon", `Salon number ${salon.salonNumber} appears more than once.`);
    }
    salonNumbers.add(salon.salonNumber);
  }

  // ---- attributes ----
  const attributeSalons = new Set<string>();
  for (const attributes of report.salonPeriodAttributes) {
    if (!salonNumbers.has(attributes.salonNumber)) {
      add(
        "orphan_attributes",
        `Period attributes reference salon ${attributes.salonNumber}, which the report does not list.`,
      );
    }
    if (attributeSalons.has(attributes.salonNumber)) {
      add("duplicate_attributes", `Salon ${attributes.salonNumber} has more than one attribute row.`);
    }
    attributeSalons.add(attributes.salonNumber);
  }

  // ---- facts ----
  const liveKeys = new Set<string>();
  for (const fact of report.facts) {
    const mapping = METRICS_BY_CODE.get(fact.metricCode);
    if (!mapping) {
      add("unknown_metric", `Metric code "${fact.metricCode}" is not in the seeded catalogue.`);
      continue;
    }
    if (!salonNumbers.has(fact.salonNumber)) {
      add("orphan_fact", `A fact references salon ${fact.salonNumber}, which the report does not list.`);
    }
    if (fact.metricBasisYearRequired !== mapping.basisYearRequired) {
      add(
        "basis_year_flag_mismatch",
        `"${mapping.label}" carries a basis-year flag that disagrees with the catalogue.`,
      );
    }
    if (mapping.basisYearRequired !== (fact.basisYear !== null)) {
      add(
        "basis_year_rule",
        `"${mapping.label}" ${mapping.basisYearRequired ? "needs a basis year and has none" : "has a basis year but takes none"}.`,
      );
    }
    if (fact.basisYear !== null && (fact.basisYear < 1990 || fact.basisYear > 2100)) {
      add("basis_year_range", `A "${mapping.label}" fact names an implausible basis year.`);
    }
    if (!Number.isFinite(fact.value)) {
      add("non_finite_value", `A "${mapping.label}" fact holds a value that is not a finite number.`);
    }
    if (!SOURCE_COLUMN.test(fact.sourceColumn)) {
      add("bad_source_column", `A "${mapping.label}" fact has no valid source column.`);
    }
    if (fact.sourceSheet.trim().length === 0) {
      add("bad_source_sheet", `A "${mapping.label}" fact has no source sheet.`);
    }

    // The live business key. Violating it would be refused by the unique index
    // mid-transaction, taking the whole ingestion down with a Postgres message.
    const key = `${fact.salonNumber}|${fact.metricCode}|${fact.basisYear ?? -1}`;
    if (liveKeys.has(key)) {
      add(
        "duplicate_fact_key",
        `More than one "${mapping.label}" fact for salon ${fact.salonNumber} and the same basis year.`,
      );
    }
    liveKeys.add(key);
  }

  // Every salon should have said something, or its row was pointless.
  for (const salonNumber of salonNumbers) {
    if (!report.facts.some((fact) => fact.salonNumber === salonNumber)) {
      add("salon_without_facts", `Salon ${salonNumber} produced no facts.`);
    }
  }

  // De-duplicate: one message per distinct problem, however many rows hit it.
  const seen = new Set<string>();
  const unique = problems.filter((problem) => {
    const key = `${problem.code}|${problem.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { ok: unique.length === 0, problems: unique };
}
