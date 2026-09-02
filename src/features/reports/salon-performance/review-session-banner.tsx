import { Button } from "@/components/ui/button";
import { endReviewSession } from "@/app/(review)/reports/review/actions";

/**
 * A one-line reminder that this is a review session, with the way out.
 *
 * SHOWN ONLY WHEN THE GATE IS ACTIVE, so the ordinary local and Preview
 * experience is unchanged when no review password is configured.
 *
 * It says what the session is out loud for two reasons. A reviewer on a shared
 * or borrowed machine should be able to see that they are signed in to
 * something and end it; and anybody looking at this dashboard should know they
 * are looking at a review deployment reading a development database, not at
 * production reporting.
 *
 * TEMPORARY, and removed with the rest of the gate once employee login ships.
 */
export function ReviewSessionBanner() {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-border bg-surface-muted px-3 py-2">
      <p className="text-[11px] leading-snug text-muted-foreground">
        <span className="font-medium text-foreground">Stakeholder review session.</span>{" "}
        Temporary shared-password access to a review deployment reading the development
        database. Not production, and not an Ask Sunny account.
      </p>
      <form action={endReviewSession}>
        <Button type="submit" variant="ghost" className="h-7 px-2 text-[11px]">
          End review session
        </Button>
      </form>
    </div>
  );
}
