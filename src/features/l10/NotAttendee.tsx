import { NOT_ATTENDEE } from "@/features/l10/lib/access";
import { Card } from "@/features/l10/ui/ui";

/**
 * A meeting this person may not open (not an attendee, not an admin): the owner's exact words and nothing about the
 * meeting (src/features/l10/lib/access.ts). The Leadership Hub already refused the read; this only says so.
 */
export function NotAttendee() {
  return (
    <Card role="alert" aria-label="Not an attendee">
      <p className="m-0 text-sm font-semibold">{NOT_ATTENDEE}</p>
    </Card>
  );
}
