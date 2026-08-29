import type { ExternalResource } from "@/types";

/**
 * Manager Resources — the external tools a manager otherwise hunts for.
 *
 * Modelled as data rather than hard-coded links so the list becomes database
 * managed later (an admin edits tiles; no deploy required). URLs below are
 * placeholders — nothing is connected in this phase.
 */
export const DEMO_RESOURCES: ExternalResource[] = [
  {
    id: "res-l10",
    name: "L10 Meetings",
    description:
      "The weekly leadership meeting app the team built. Scorecard, rocks, to-dos, and issue list.",
    category: "meetings",
    url: "https://example.com/l10-meetings",
    openMode: "new_tab",
    owner: "JV & Associates",
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
    owner: "JV & Associates",
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
    owner: "JV & Associates",
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
    owner: "JV & Associates",
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
    owner: "JV & Associates",
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
    owner: "JV & Associates",
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
    owner: "JV & Associates",
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
    owner: "JV & Associates",
    availability: "coming_soon",
    iconKey: "megaphone",
  },
];

export const RESOURCE_CATEGORY_LABEL: Record<string, string> = {
  meetings: "Meetings",
  reporting: "Reporting",
  documents: "Documents",
  training: "Training",
  people: "People",
  support: "Support",
  other: "Other",
};
