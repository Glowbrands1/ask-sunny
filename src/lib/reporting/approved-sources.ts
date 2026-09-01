/**
 * APPROVED SOURCE ARTIFACTS, BY CONTENT DIGEST.
 *
 * This is the gate on the controlled-ingestion endpoint, and it is a deliberate
 * choice of mechanism.
 *
 * No identity provider is configured yet, so `authorizeRequest` cannot protect
 * a reporting route: in live mode it refuses everything, which is correct for
 * the knowledge base and useless for a checkpoint that has to ingest one
 * reviewed workbook. The alternatives were a new shared secret (another
 * credential to distribute and rotate) or an unauthenticated upload route
 * (unacceptable).
 *
 * A digest allowlist needs neither. The endpoint will ingest ONLY bytes whose
 * SHA-256 already appears below, so it cannot become a general upload path
 * however it is called: an attacker who does not have the exact approved file
 * can do nothing with it, and one who does have it can only re-trigger an
 * ingestion that is idempotent anyway.
 *
 * A hash reveals nothing about the file it names, so these are safe to commit.
 *
 * THIS LIST IS TEMPORARY. It exists for controlled checkpoint ingestion and
 * should be emptied once authentication ships and the real ingest route is
 * protected by `authorizeRequest` plus a Power Automate service identity.
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

export function findApprovedSource(sha256: string): ApprovedSource | null {
  const normalized = sha256.trim().toLowerCase();
  return APPROVED_SOURCES.find((entry) => entry.sha256 === normalized) ?? null;
}
