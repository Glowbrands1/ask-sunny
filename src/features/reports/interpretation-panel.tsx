import type { ReportInterpretation } from "@/lib/reporting/read/bed-spa/interpretation";
import { cn } from "@/lib/utils/cn";

/**
 * ============================================================================
 * WHAT THIS PERIOD SAYS, IN SENTENCES
 * ============================================================================
 *
 * THE REVIEW: a report should land on "four headline metrics, one chart, one
 * plain-language interpretation of what the data means, and expandable detail".
 * The figures were already there; this is the sentence between them and the
 * reader.
 *
 * ALL OF THE THINKING IS IN `interpretation.ts`, none of it here. This renders
 * a headline and a list — no figure is computed, rounded, compared or
 * conditionally worded in this file. That split is what lets the wording a
 * manager acts on be asserted in a unit test rather than eyeballed, and it is
 * why a reading cannot quietly say something different on one page than it does
 * in the assistant's briefing.
 *
 * IT IS A `<section>` WITH A HEADING, not a `Notice`. A notice is an
 * interruption — something has gone wrong, or something needs attention. This
 * is ordinary content that happens to be prose, and dressing it as an alert
 * would make every report look like it had a problem.
 *
 * AND IT RENDERS NOTHING WHEN THERE IS NOTHING TO SAY. An empty reading with a
 * heading over it reads as a failure; the absence of the block does not.
 */
export function ReportInterpretationPanel({
  reading,
  title = "What this period shows",
  className,
}: {
  reading: ReportInterpretation;
  title?: string;
  className?: string;
}) {
  if (reading.unavailableReason !== null) {
    return (
      <section className={cn("rounded-[var(--radius-lg)] border border-border bg-surface p-5", className)}>
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{reading.unavailableReason}</p>
      </section>
    );
  }

  if (!reading.headline && reading.points.length === 0) return null;

  return (
    <section
      className={cn(
        "rounded-[var(--radius-lg)] border border-border bg-surface p-5",
        className,
      )}
    >
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      {reading.headline ? (
        <p className="mt-2 text-sm font-medium text-foreground">{reading.headline}</p>
      ) : null}
      {reading.points.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {reading.points.map((point) => (
            <li
              key={point}
              className="flex gap-2 text-sm text-muted-foreground"
            >
              {/*
                A MARKER THAT IS NOT READ ALOUD. `aria-hidden` keeps the bullet
                out of the accessible name; the list semantics already tell a
                screen reader these are separate points.
              */}
              <span aria-hidden className="select-none text-muted-foreground">
                •
              </span>
              <span>{point}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
