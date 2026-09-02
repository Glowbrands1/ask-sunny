/**
 * APPROVED SOURCE ARTIFACTS, BY CONTENT DIGEST.
 *
 * This is the gate on the controlled-ingestion endpoint, and it is a deliberate
 * choice of mechanism.
 *
 * DEFENCE IN DEPTH, NOT THE FRONT DOOR. The front door is the machine
 * credential in `ingest-credential.ts`: `REPORTING_INGEST_SECRET` is required
 * on every call, in every environment, and is production-capable on its own.
 * This list narrows what an already-authorized caller may file.
 *
 * It earns its place because the two gates fail differently. A leaked
 * credential still cannot file an arbitrary workbook while this list is
 * populated; a leaked workbook cannot be filed at all without the credential.
 *
 * A hash reveals nothing about the file it names, so these are safe to commit.
 *
 * ENFORCED ONLY WHILE IT IS POPULATED. During controlled checkpoint ingestion
 * it names the exact reviewed artifacts. For recurring production ingestion,
 * where next month's workbook cannot be known in advance, the list is emptied —
 * `allowlistEnforced()` then returns false and the credential is the whole
 * gate, which is what it was built to be. Emptying it is a configuration
 * decision, not a code change.
 */

export interface ApprovedSource {
  /** Lowercase hex SHA-256 of the artifact's bytes. */
  sha256: string;
  /** What the artifact is, for the audit trail. Never the contents. */
  description: string;
  /** `report_sources.code` this artifact arrives through. */
  sourceCode: string;
}

export const APPROVED_SOURCES: ApprovedSource[] = [
  {
    sha256: "e002b99d35603d32f1b8239c0a4b164dc976672190877c9ef10dce94fa105216",
    description: "Comp Report 2026 08 30 — checkpoint 5 controlled first ingestion",
    sourceCode: "comp_report_email",
  },
];

/**
 * The `report_sources.code` a workbook is filed under when the allowlist is not
 * enforcing (and so cannot name one).
 *
 * A constant rather than a caller-supplied field: letting a request choose its
 * own source code would let an authorized pipeline file a workbook against a
 * source it has nothing to do with, and the source is what supersession and the
 * audit trail are organised by.
 */
export const DEFAULT_SOURCE_CODE = "comp_report_email";

/** True while the digest allowlist is narrowing what may be filed. */
export function allowlistEnforced(): boolean {
  return APPROVED_SOURCES.length > 0;
}

export function findApprovedSource(sha256: string): ApprovedSource | null {
  const normalized = sha256.trim().toLowerCase();
  return APPROVED_SOURCES.find((entry) => entry.sha256 === normalized) ?? null;
}
