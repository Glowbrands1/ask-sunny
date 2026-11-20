import fixture from "./jba-manual-production-151.json";

/**
 * ============================================================================
 * THE WHOLE JBA POLICY MANUAL, AS THE AGENT LOOP READS IT (QA, 20 Nov 2026)
 * ============================================================================
 *
 * The replay pack's knowledge provider returns `JBA_MANUAL_CA_SECTIONS` (the Corrective Action sections, wording
 * invented). Runner 2's shadow and saved-form runs read it too, so a policy the production manual has and the fixture
 * lacks ("Time Records", "Dress Code", "Care and Cleaning …") came back not_a_heading and was reported as a wrong policy
 * (c259, c242, c091). These are the 151 production rows already in the repo (`jba-manual-production-151.json`, names in
 * the Reference List redacted), mapped exactly as `SupabaseKnowledgeProvider.fetchOfficialPolicyManual` maps them, for a
 * run that should read the manual production reads.
 */
type Row = { chunk_index: string | number; locator: string | null; page: string | number | null; section: string | null; content: string | null; metadata: Record<string, unknown> | null };

const asPage = (value: unknown): number | null => {
  const page = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isInteger(page) && page > 0 ? page : null;
};

function sectionsOf(metadata: Record<string, unknown> | null): { heading: string; page: number }[] {
  const value = metadata?.sections;
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const heading = typeof entry?.heading === "string" ? entry.heading.trim() : "";
    const page = asPage(entry?.page);
    return heading && page !== null ? [{ heading, page }] : [];
  });
}

/** The production manual's 151 chunks, in chunk order. */
export function fullPolicyManualChunks() {
  return (fixture.chunks as Row[])
    .map((row) => {
      const chunkIndex = Number(row.chunk_index);
      return {
        chunkIndex,
        chunkId: `jba-${chunkIndex}`,
        locator: row.locator ?? "",
        page: asPage(row.page),
        content: row.content ?? "",
        section: row.section,
        printedPage: asPage(row.metadata?.printedPage),
        sections: sectionsOf(row.metadata),
      };
    })
    .sort((a, b) => a.chunkIndex - b.chunkIndex);
}

/** REPLAY_FULL_POLICY_MANUAL=1: the replay pack reads the whole production manual instead of the CA sections. */
export function replayReadsFullPolicyManual(): boolean {
  return process.env.REPLAY_FULL_POLICY_MANUAL === "1" || process.env.REPLAY_FULL_POLICY_MANUAL === "true";
}
