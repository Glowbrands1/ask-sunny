import {
  isSmallSample,
  smallSampleNote,
  type ComparisonSample,
} from "@/lib/reporting/read/bed-spa/spa-wellness-analytics";

/**
 * ============================================================================
 * WHAT THE ASTERISK MEANS, ON THE PAGE RATHER THAN IN A TOOLTIP
 * ============================================================================
 *
 * THE 15 SEPTEMBER PRODUCTION QA. Rejuve and Ovation carried their `*` and the
 * band beside it, and the explanation existed only in a `title` attribute on
 * the marker. A `title` is not an explanation on a phone, where there is no
 * hover; it is not one for a screen reader driven by touch; and it is not one
 * for a manager who never discovers it is there. The qualification was the
 * whole point of the review item, and it was the part nobody could read.
 *
 * The marker stays in the table — it is what draws the eye to the row. This is
 * what it refers to, rendered underneath, always visible.
 *
 * ONLY WHEN SOMETHING IS QUALIFIED. An adequately sampled estate renders
 * nothing at all rather than an empty heading.
 */

export interface SmallSampleRow extends ComparisonSample {
  /** Stable key — the equipment code. */
  readonly key: string;
  /** What the row is called in the table above. */
  readonly label: string;
}

export function SmallSampleFootnote({
  rows,
  className,
}: {
  rows: readonly SmallSampleRow[];
  className?: string;
}) {
  const qualified = rows.filter(isSmallSample);
  if (qualified.length === 0) return null;

  return (
    <div
      className={
        className ??
        "mt-4 border-t border-border pt-3 text-xs text-muted-foreground"
      }
    >
      <p className="font-medium text-foreground">* Small comparison sample</p>
      <ul className="mt-1.5 space-y-1">
        {qualified.map((row) => (
          <li key={row.key}>
            <span className="font-medium text-foreground">{row.label}:</span>{" "}
            {smallSampleNote(row)}
          </li>
        ))}
      </ul>
    </div>
  );
}
