import { L10_MEETINGS_PATH } from "@/lib/config/l10-link";
import type { ExternalResource } from "@/types";

/**
 * Manager Resources — the external tools a manager otherwise hunts for.
 *
 * Modelled as data rather than hard-coded links so the list becomes database
 * managed later (an admin edits tiles; no deploy required). The URLs are
 * placeholders until those tools are connected.
 *
 * ============================================================================
 * L10 IS THE ONE ENTRY THAT NAMES NO DESTINATION AT ALL
 * ============================================================================
 *
 * It used to carry `https://preview--leadership-sync-tool.lovable.app/`, and
 * that address was compiled into the client JavaScript of every demo build —
 * which is the build the client's Teams pilot was running. Filtering the tile
 * at render would have hidden a control and published the address anyway, which
 * is not what "restricted to admin accounts only for now" asks for.
 *
 * So the entry points at `L10_MEETINGS_PATH`. That route reads the real
 * destination server-side and applies `view_l10_meetings` before it redirects,
 * so no build of this application contains the address and no unauthorized
 * caller can obtain it. See `lib/config/l10-link.ts`.
 */
export const DEMO_RESOURCES: ExternalResource[] = [
  {
    id: "res-l10",
    name: "L10 Meetings",
    description:
      "The weekly leadership meeting app the team built. Scorecard, rocks, to-dos, and issue list.",
    category: "meetings",
    url: L10_MEETINGS_PATH,
    openMode: "new_tab",
    owner: "JB & Associates",
    availability: "available",
    iconKey: "calendar-check",
  },
  {
    id: "res-powerbi",
    name: "Power BI",
    description:
      "The reporting workspace. Planned to be embedded directly inside Ask Sunny.",
    category: "reporting",
    url: "https://example.com/power-bi",
    openMode: "new_tab",
    owner: "Microsoft",
    availability: "available",
    iconKey: "bar-chart",
  },
  {
    id: "res-woven",
    name: "Woven",
    description:
      "Where company documents live today. Ask Sunny's knowledge library will sync from an approved subset.",
    category: "documents",
    url: "https://example.com/woven",
    openMode: "new_tab",
    owner: "Woven",
    availability: "available",
    iconKey: "library",
  },
  {
    id: "res-policies",
    name: "Company Policies",
    description:
      "The official policy manual. Always the authority — Sunny points to it, it does not replace it.",
    category: "documents",
    url: "https://example.com/policies",
    openMode: "new_tab",
    owner: "JB & Associates",
    availability: "available",
    iconKey: "book-open",
  },
  {
    id: "res-training",
    name: "Training Portal",
    description: "Certification tracking and assigned learning paths for every role.",
    category: "training",
    url: "https://example.com/training",
    openMode: "new_tab",
    owner: "JB & Associates",
    availability: "available",
    iconKey: "graduation-cap",
  },
  {
    id: "res-hr",
    name: "HR Resources",
    description: "Benefits, payroll questions, leave requests, and the HR contact directory.",
    category: "people",
    url: "https://example.com/hr",
    openMode: "new_tab",
    owner: "JB & Associates",
    availability: "available",
    iconKey: "users",
  },
  {
    id: "res-it",
    name: "IT Support",
    description: "Raise a ticket for hardware, network, or point-of-sale issues.",
    category: "support",
    url: "https://example.com/it-support",
    openMode: "new_tab",
    owner: "JB & Associates",
    availability: "available",
    iconKey: "life-buoy",
  },
  {
    id: "res-scheduling",
    name: "Scheduling",
    description: "Build and publish the salon schedule and approve time-off requests.",
    category: "people",
    url: "https://example.com/scheduling",
    openMode: "new_tab",
    owner: "JB & Associates",
    availability: "available",
    iconKey: "calendar-days",
  },
  {
    id: "res-maintenance",
    name: "Equipment Service Requests",
    description: "Log a service request and track open equipment issues by salon.",
    category: "support",
    url: "https://example.com/service-requests",
    openMode: "new_tab",
    owner: "JB & Associates",
    availability: "coming_soon",
    iconKey: "wrench",
  },
  {
    id: "res-marketing",
    name: "Local Marketing Toolkit",
    description: "Approved assets and templates for local salon promotion.",
    category: "other",
    url: "https://example.com/marketing",
    openMode: "new_tab",
    owner: "JB & Associates",
    availability: "coming_soon",
    iconKey: "megaphone",
  },
];

/* Labels live in `data/resource-taxonomy.ts`; re-exported for demo code. */
export { RESOURCE_CATEGORY_LABEL } from "@/data/resource-taxonomy";
