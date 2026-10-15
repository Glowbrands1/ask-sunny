/**
 * District corrections applied while a workbook is ingested.
 *
 * The reporting workbook names each salon's district by its manager, and it
 * still lists KS Manhattan (0462) under Patterson, Madeline. Rachael Dugan runs
 * Manhattan, so every import would write `Patterson, Madeline` back over a
 * corrected `salon_period_attributes.district_label`. This table is applied on
 * the way in so the correction survives the next import.
 *
 * Each entry is a CORRECTION, not a rename: it applies only when the workbook
 * still carries the value in `reportedLabel`. Once the workbook is fixed at the
 * source the entry stops matching, changes nothing, and can be deleted.
 */

interface DistrictOverride {
  readonly salonNumber: string;
  readonly storeName: string;
  /** What the workbook says today, which is wrong. */
  readonly reportedLabel: string;
  /** What reporting should say. */
  readonly correctLabel: string;
}

export const DISTRICT_OVERRIDES: readonly DistrictOverride[] = [
  {
    salonNumber: "0462",
    storeName: "KS Manhattan",
    reportedLabel: "Patterson, Madeline",
    correctLabel: "Dugan, Rachael",
  },
];

function sameLabel(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** The district to store for a salon, identified by its number. */
export function correctedDistrictLabel(
  salonNumber: string | null | undefined,
  label: string | null,
): string | null {
  if (!salonNumber || label === null) return label;
  const override = DISTRICT_OVERRIDES.find((entry) => entry.salonNumber === salonNumber.trim());
  return override && sameLabel(label, override.reportedLabel) ? override.correctLabel : label;
}

/** Same correction for a feed that identifies the salon by store name only. */
export function correctedDistrictLabelByStoreName(
  storeName: string | null | undefined,
  label: string | null,
): string | null {
  if (!storeName || label === null) return label;
  const override = DISTRICT_OVERRIDES.find((entry) => sameLabel(entry.storeName, storeName));
  return override && sameLabel(label, override.reportedLabel) ? override.correctLabel : label;
}
