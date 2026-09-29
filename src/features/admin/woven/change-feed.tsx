import Link from "next/link";

import { Badge, type BadgeTone } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/feedback";
import { ScrollTable } from "@/components/ui/layout";
import { CHANGE_KINDS } from "@/lib/employees/woven/types";
import type { ChangePage, ChangeQuery, ReviewStatus } from "@/lib/employees/woven/view-types";
import { cn } from "@/lib/utils/cn";
import { ChangeReviewButtons } from "./change-review-buttons";
import { day, describeValue, label, when } from "./format";

/**
 * THE CHANGE FEED — what moved, per sync, newest first.
 *
 * Every row is Woven's own evidence: before, after, the run that saw it, and
 * an effective date ONLY where Woven states one. A position change is
 * "unclassified" unless both positions are confirmed and ranked in Mappings.
 * Marking a change reviewed is the one thing a person can do here; it changes
 * nobody's access.
 */

const BASE = "/admin/integrations/woven/changes";

export function changesHref(query: ChangeQuery, change: Partial<ChangeQuery>): string {
  const next = { ...query, ...change };
  const params = new URLSearchParams();
  if (next.kind) params.set("kind", next.kind);
  if (next.review) params.set("review", next.review);
  if (next.page > 1) params.set("page", String(next.page));
  const qs = params.toString();
  return qs ? `${BASE}?${qs}` : BASE;
}

function classificationTone(value: string | null): BadgeTone {
  if (value === null) return "outline";
  if (value === "unclassified") return "attention";
  if (["promotion_confirmed", "new_hire", "rehire"].includes(value)) return "ready";
  if (value === "demotion_confirmed" || value === "expired") return "neutral";
  return "processing";
}

const REVIEW_TONE: Record<ReviewStatus, BadgeTone> = { unreviewed: "attention", acknowledged: "ready", dismissed: "neutral" };

function Chip({ href, on, children }: { href: string; on: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-pressed={on}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-3 py-1 text-[12px] font-semibold",
        on ? "border-foreground bg-foreground text-background" : "border-border bg-surface text-foreground",
      )}
    >
      {children}
    </Link>
  );
}

export function ChangeFeed({
  page,
  query,
  actionsDisabled,
}: {
  page: ChangePage;
  query: ChangeQuery;
  actionsDisabled: boolean;
}) {
  const total = Object.values(page.kindCounts).reduce((a, b) => a + b, 0);
  const lastPage = Math.max(1, Math.ceil(page.total / page.pageSize));

  return (
    <section aria-label="Change Feed" className="flex flex-col gap-4">
      <ul className="flex flex-wrap gap-1.5" aria-label="Change type">
        <li>
          <Chip href={changesHref(query, { kind: null, page: 1 })} on={query.kind === null}>
            All <span className="font-normal tabular-nums">{total}</span>
          </Chip>
        </li>
        {CHANGE_KINDS.map((kind) => (
          <li key={kind}>
            <Chip href={changesHref(query, { kind, page: 1 })} on={query.kind === kind}>
              <span className="font-mono text-[11.5px]">{kind}</span>
              <span className="font-normal tabular-nums">{page.kindCounts[kind]}</span>
            </Chip>
          </li>
        ))}
      </ul>
      <ul className="flex flex-wrap gap-1.5" aria-label="Review status">
        {([null, "unreviewed", "acknowledged", "dismissed"] as const).map((review) => (
          <li key={review ?? "any"}>
            <Chip href={changesHref(query, { review, page: 1 })} on={query.review === review}>
              {review ? label(review) : "Any review status"}
            </Chip>
          </li>
        ))}
      </ul>

      {page.rows.length === 0 ? (
        <EmptyState title="No changes to show" description="Changes appear after the second successful sync; the first records everyone as an initial load." />
      ) : (
        <ScrollTable>
          <table className="w-full text-left text-[12.5px]">
            <thead className="bg-surface-muted text-[11px] tracking-wide text-muted-foreground uppercase">
              <tr>
                {["Employee", "Change type", "Classification", "Old value", "New value", "Effective date", "Detected at", "Sync run", "Review"].map((h) => (
                  <th key={h} scope="col" className="px-3 py-2 font-semibold whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {page.rows.map((row) => (
                <tr key={row.id} className="align-top">
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className="font-semibold text-foreground">{row.employeeName}</span>
                    <br />
                    <span className="font-mono text-[11px] text-muted-foreground">{row.externalEmployeeId}</span>
                  </td>
                  <td className="px-3 py-2 font-mono text-[11.5px] whitespace-nowrap">{row.kind}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {row.classification ? (
                      <Badge tone={classificationTone(row.classification)} size="sm">
                        {row.classification}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="min-w-40 px-3 py-2">{describeValue(row.fromValue)}</td>
                  <td className="min-w-40 px-3 py-2">{describeValue(row.toValue)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {row.effectiveDate ? day(row.effectiveDate) : <span className="text-muted-foreground">Not stated by Woven</span>}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap tabular-nums">{when(row.detectedAt)}</td>
                  <td className="px-3 py-2 font-mono text-[11px] whitespace-nowrap text-muted-foreground">{row.syncRunId.slice(0, 12)}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-col gap-1">
                      <Badge tone={REVIEW_TONE[row.reviewStatus]} size="sm" className="self-start">
                        {row.reviewStatus}
                      </Badge>
                      <ChangeReviewButtons changeId={row.id} status={row.reviewStatus} disabled={actionsDisabled} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollTable>
      )}

      <nav aria-label="Pages" className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-muted-foreground">
        <span>
          {page.total} change{page.total === 1 ? "" : "s"} · page {page.page} of {lastPage}
        </span>
        <span className="flex gap-3">
          {page.page > 1 ? <Link href={changesHref(query, { page: page.page - 1 })}>Previous</Link> : null}
          {page.page < lastPage ? <Link href={changesHref(query, { page: page.page + 1 })}>Next</Link> : null}
        </span>
      </nav>
      <p className="text-[12px] text-muted-foreground">
        Effective dates are only the dates Woven states: a hire or start date, a termination date, an access ExpiresOn. Woven
        states none for a position or location move, so those show when the change was detected.
      </p>
    </section>
  );
}
