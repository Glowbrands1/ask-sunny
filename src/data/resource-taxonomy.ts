/**
 * Resource category labels — production vocabulary, not seeded content.
 *
 * Split out of `data/demo/resources.ts` so the Resources screen can label a
 * real tile without also shipping the ten seeded ones, eight of which point
 * at `example.com`.
 */

export const RESOURCE_CATEGORY_LABEL: Record<string, string> = {
  meetings: "Meetings",
  reporting: "Reporting",
  documents: "Documents",
  training: "Training",
  people: "People",
  support: "Support",
  other: "Other",
};
