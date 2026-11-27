import Link from "next/link";
import { Search, X } from "lucide-react";

import { Badge, type BadgeTone } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils/date";

import { FormPreviewButton } from "./form-preview-dialog";
import { LOCATION_NOUN, REGISTER_HREF } from "./words";

/**
 * FIND AN EMPLOYEE'S FORMS — the search box on the forms list, for HR and administrators only (leadership meeting,
 * 24 Nov 2026). Same component in both apps; the page decides who sees it and does the read
 * (`src/lib/forms/employee-form-search.ts`).
 *
 * A plain GET form: `?employee=<name>` is the whole state, so a search survives a refresh, can be linked to, and works
 * before any script has loaded.
 */

export interface EmployeeSearchRow {
  id: string;
  employeeName: string;
  formName: string;
  variantKey: string | null;
  status: "draft" | "finalized" | "revised";
  hrNote: string | null;
  formDate: string;
  createdAt: string;
  locationName: string | null;
  createdByName: string;
}

const STATUS_WORDS: Record<EmployeeSearchRow["status"], string> = {
  draft: "Draft",
  finalized: "Finalized",
  revised: "Revised",
};

const STATUS_TONE: Record<EmployeeSearchRow["status"], BadgeTone> = {
  draft: "neutral",
  finalized: "ready",
  revised: "outline",
};

export type EmployeeSearchStatusFilter = "all" | "draft" | "finalized" | "hr_approved";

const FILTERS: { value: EmployeeSearchStatusFilter; label: string }[] = [
  { value: "all", label: "All forms" },
  { value: "draft", label: "Drafts" },
  { value: "finalized", label: "Finalized" },
  { value: "hr_approved", label: "Approved by HR" },
];

export function EmployeeFormSearchBox({
  query,
  status = "all",
  className = "mb-4",
}: {
  query: string;
  status?: EmployeeSearchStatusFilter;
  /** Spacing around the box; empty where the surrounding list already spaces its parts. */
  className?: string;
}) {
  return (
    <form
      action={REGISTER_HREF}
      method="get"
      role="search"
      aria-label="Find an employee's forms"
      className={`flex flex-wrap items-center gap-2 ${className}`}
    >
      <label className="relative min-w-0 flex-1 basis-64">
        <span className="sr-only">Employee name</span>
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle-foreground" />
        <input
          type="search"
          name="employee"
          defaultValue={query}
          placeholder="Search by employee name — every form, drafts included"
          autoComplete="off"
          maxLength={120}
          className="h-9.5 w-full rounded-full border border-border-strong bg-surface pr-3 pl-9 text-sm text-foreground placeholder:text-subtle-foreground focus:ring-2 focus:ring-selected focus:outline-none"
        />
      </label>
      <label className="shrink-0">
        <span className="sr-only">Show</span>
        <select
          name="status"
          defaultValue={status}
          className="h-9.5 rounded-full border border-border-strong bg-surface px-3 text-sm text-foreground focus:ring-2 focus:ring-selected focus:outline-none"
        >
          {FILTERS.map((filter) => (
            <option key={filter.value} value={filter.value}>
              {filter.label}
            </option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        className="inline-flex h-9.5 items-center justify-center rounded-full bg-selected px-4 text-sm font-medium text-selected-foreground shadow-soft hover:bg-hover-surface hover:text-hover-surface-foreground hover:ring-1 hover:ring-selected"
      >
        Search
      </button>
      {query ? (
        <Link
          href={REGISTER_HREF}
          className="inline-flex h-9.5 items-center gap-1 rounded-full px-3 text-sm text-muted-foreground hover:bg-hover-surface hover:text-foreground"
        >
          <X aria-hidden className="size-4" />
          Clear
        </Link>
      ) : null}
    </form>
  );
}

export function EmployeeFormSearchResults({
  query,
  searchable,
  rows,
  capped,
  failure = null,
  filtered = false,
}: {
  query: string;
  /** False when nothing searchable was typed (one letter, digits only). */
  searchable: boolean;
  rows: EmployeeSearchRow[];
  capped: boolean;
  failure?: string | null;
  /** A status filter other than All forms is on. */
  filtered?: boolean;
}) {
  return (
    <section aria-label={`Forms for ${query}`} data-testid="employee-form-search-results" className="mb-6">
      {failure ? (
        <p role="alert" className="rounded-[var(--radius-sm)] border border-border bg-surface px-4 py-3 text-sm text-foreground">
          The search could not be read: {failure}
        </p>
      ) : !searchable ? (
        <p className="text-sm text-muted-foreground">Type at least two letters of the employee&apos;s name.</p>
      ) : rows.length === 0 && filtered ? (
        <p className="text-sm text-muted-foreground">
          No forms for &ldquo;{query}&rdquo; match this filter. Choose All forms to see every one.
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No forms on file for &ldquo;{query}&rdquo;. Check the spelling, or try just the first or last name.
        </p>
      ) : (
        <>
          <p className="mb-2 text-sm text-muted-foreground">
            {rows.length} {rows.length === 1 ? "form" : "forms"} for &ldquo;{query}&rdquo;, newest first
            {capped ? ". Only the newest matches are listed — type the full name to narrow it." : "."}
          </p>
          <div className="relative min-w-0 overflow-x-auto rounded-[var(--radius-sm)] border border-border bg-surface">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-border">
                  {["Employee", "Form", "Status", "Form date", "Created", LOCATION_NOUN, "Created by", ""].map((heading, index) => (
                    <th key={index} className="eyebrow px-2.5 py-2 text-left whitespace-nowrap">
                      {heading ? heading.charAt(0).toUpperCase() + heading.slice(1) : <span className="sr-only">Open</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-border last:border-0">
                    <td className="px-2.5 py-2 whitespace-nowrap text-foreground">{row.employeeName}</td>
                    <td className="px-2.5 py-2 whitespace-nowrap text-foreground">
                      {row.formName}
                      {row.variantKey ? <span className="ml-1.5 text-[11px] text-subtle-foreground">{row.variantKey}</span> : null}
                    </td>
                    <td className="px-2.5 py-2 whitespace-nowrap">
                      <Badge tone={STATUS_TONE[row.status]}>{STATUS_WORDS[row.status]}</Badge>
                      {row.hrNote ? <span className="ml-1.5 text-[11px] text-subtle-foreground">{row.hrNote}</span> : null}
                    </td>
                    <td className="px-2.5 py-2 whitespace-nowrap tabular-nums">{formatDate(row.formDate)}</td>
                    <td className="px-2.5 py-2 whitespace-nowrap tabular-nums text-muted-foreground">{formatDate(row.createdAt)}</td>
                    <td className="max-w-[140px] truncate px-2.5 py-2 text-muted-foreground" title={row.locationName ?? undefined}>
                      {row.locationName ?? "—"}
                    </td>
                    <td className="max-w-[140px] truncate px-2.5 py-2 text-muted-foreground">{row.createdByName}</td>
                    <td className="px-2.5 py-2 text-right whitespace-nowrap">
                      {/* A pop-up over the list, not another page (Pau, 26 Nov 2026). */}
                      <FormPreviewButton
                        instanceId={row.id}
                        title={`${row.formName} — ${row.employeeName}, ${formatDate(row.formDate)}`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
