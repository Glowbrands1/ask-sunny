import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";
import { activeKnowledgeCorpus } from "./corpus";
import {
  EMPLOYEE_PERFORMANCE_FRAMEWORK,
  missingGroupLabels,
  roleTagAdvice,
  type KnowledgeDocumentRole,
} from "./document-roles";
import { SupabaseKnowledgeProvider } from "./providers/supabase";

/**
 * ============================================================================
 * IS THE FRAMEWORK ACTUALLY READY IN THIS ENVIRONMENT?
 * ============================================================================
 *
 * The unit tests pin today's filename, today's locator strings and today's
 * chunk indices. That is the right thing for them to do — a re-upload that
 * changes what Sunny reasons with SHOULD break a test — but it means they can
 * only ever describe the corpus as it was when they were written. They cannot
 * see tomorrow's re-upload drifting away from them, because they never look at
 * a database.
 *
 * This does. It answers the operational question the unit tests structurally
 * cannot: against the corpus THIS deployment is pointed at, right now, is the
 * mandatory framework resolvable, unique, current and complete?
 *
 * WHY IT IS SOURCE AND NOT ONLY A TEST. The same question is worth asking from
 * an admin screen, a deploy check or a cron, not just from vitest — and a
 * failure needs a report an operator can act on rather than an assertion
 * diff. So the check lives here, returns a structured verdict, and the
 * env-gated test in `framework-readiness.test.ts` is one caller.
 *
 * READ-ONLY, ALWAYS. Two selects and no writes. It must be safe to run against
 * production on a whim, because a health check nobody dares run is not a health
 * check.
 */

export interface FrameworkReadinessReport {
  readonly ready: boolean;
  readonly scopeId: string;
  readonly roleId: string;
  /** How identity was established, or null when it could not be. */
  readonly matchedBy: "tag" | "fallback" | null;
  readonly documentId: string | null;
  readonly documentTitle: string | null;
  /** The document version the pinned chunks were read at. */
  readonly documentVersion: number | null;
  readonly mandatoryChunkCount: number;
  readonly presentGroups: readonly string[];
  readonly missingGroups: readonly string[];
  /** How many documents claimed the role. More than one is a failure. */
  readonly claimingDocuments: number;
  /**
   * Chunks of the resolved document at a SUPERSEDED version. Informational —
   * what matters is that none of them were selected, which `staleSelected`
   * reports.
   */
  readonly staleChunkCount: number;
  readonly staleSelected: boolean;
  /** Everything wrong, in the order it was found. Empty when ready. */
  readonly problems: readonly string[];
  /** Non-blocking advice, such as setting the durable tag. */
  readonly advisories: readonly string[];
}

/**
 * Runs the readiness check for one role against one corpus.
 *
 * Defaults to the Employee Performance Framework and the build's own corpus,
 * because those are what a deployment actually needs to be true.
 */
export async function checkFrameworkReadiness(
  role: KnowledgeDocumentRole = EMPLOYEE_PERFORMANCE_FRAMEWORK,
  scopeId: string = activeKnowledgeCorpus(),
): Promise<FrameworkReadinessReport> {
  const problems: string[] = [];
  const advisories: string[] = [];

  const provider = new SupabaseKnowledgeProvider();
  const result = await provider.fetchRoleGrounding(role, scopeId);

  if (!result.ok) {
    problems.push(`${result.failure.code}: ${result.failure.detail}`);
    return {
      ready: false,
      scopeId,
      roleId: role.id,
      matchedBy: null,
      documentId: null,
      documentTitle: null,
      documentVersion: null,
      mandatoryChunkCount: 0,
      presentGroups: [],
      missingGroups: result.failure.missingGroups ?? role.ruleGroups.map((group) => group.id),
      claimingDocuments: await countClaimingDocuments(role, scopeId),
      staleChunkCount: 0,
      staleSelected: false,
      problems,
      advisories,
    };
  }

  const { grounding } = result;
  const client = getSupabaseAdmin();

  /*
   * UNIQUENESS, ASKED INDEPENDENTLY. `fetchRoleGrounding` already refuses when
   * two documents claim the role, so reaching here means it found one — but the
   * count is worth reporting rather than inferring, because a report that says
   * "1 document claims this role" is the thing an operator wanted to know.
   */
  const claimingDocuments = await countClaimingDocuments(role, scopeId);
  if (claimingDocuments !== 1) {
    problems.push(
      `${claimingDocuments} documents claim the ${role.id} role; exactly one must.`,
    );
  }

  /* The document's current version, and whether anything older is lying around. */
  const { data: documentRow, error: documentError } = await client
    .from("knowledge_documents")
    .select("version")
    .eq("id", grounding.documentId)
    .single();

  if (documentError) {
    problems.push("The framework document's version could not be read.");
  }

  const documentVersion = (documentRow as { version: number } | null)?.version ?? null;

  const { data: staleRows, error: staleError } = await client
    .from("knowledge_chunks")
    .select("id, version")
    .eq("document_id", grounding.documentId)
    .neq("version", documentVersion ?? -1);

  if (staleError) {
    problems.push("Superseded chunk versions could not be checked.");
  }

  const staleIds = new Set(((staleRows ?? []) as { id: string }[]).map((row) => row.id));
  const staleSelected = grounding.rows.some((row) => staleIds.has(row.chunk_id));
  if (staleSelected) {
    problems.push("A superseded chunk version was selected as mandatory grounding.");
  }

  /* Completeness, restated from the grounding rather than trusted. */
  const missingGroups = role.ruleGroups
    .map((group) => group.id)
    .filter((id) => !grounding.presentGroups.includes(id));

  if (missingGroups.length > 0) {
    problems.push(
      `Missing required rules: ${missingGroupLabels(role, missingGroups).join(", ")}.`,
    );
  }

  if (grounding.rows.length === 0) {
    problems.push("No mandatory chunks were selected.");
  }

  /* Provenance: every pinned row must point at the resolved document. */
  const strayProvenance = grounding.rows.filter(
    (row) => row.document_id !== grounding.documentId,
  );
  if (strayProvenance.length > 0) {
    problems.push(
      `${strayProvenance.length} pinned chunks do not point at the framework document.`,
    );
  }
  if (grounding.rows.some((row) => !row.document_title || !row.locator)) {
    problems.push("A pinned chunk is missing its document title or locator.");
  }

  if (grounding.matchedBy === "fallback") {
    advisories.push(roleTagAdvice(role));
  }

  return {
    ready: problems.length === 0,
    scopeId,
    roleId: role.id,
    matchedBy: grounding.matchedBy,
    documentId: grounding.documentId,
    documentTitle: grounding.documentTitle,
    documentVersion,
    mandatoryChunkCount: grounding.rows.length,
    presentGroups: grounding.presentGroups,
    missingGroups,
    claimingDocuments,
    staleChunkCount: staleIds.size,
    staleSelected,
    problems,
    advisories,
  };
}

/** How many indexed documents claim the role, by tag or by fallback identity. */
async function countClaimingDocuments(
  role: KnowledgeDocumentRole,
  scopeId: string,
): Promise<number> {
  const { data, error } = await getSupabaseAdmin()
    .from("knowledge_documents")
    .select("id, title, original_filename, tags")
    .eq("knowledge_scope_id", scopeId)
    .eq("indexed", true)
    .eq("status", "indexed");

  if (error) return 0;

  const rows = (data ?? []) as {
    id: string;
    title: string;
    original_filename: string;
    tags: string[] | null;
  }[];

  const { hasRoleTag, matchesRoleFallback } = await import("./document-roles");
  const tagged = rows.filter((row) => hasRoleTag(row, role));
  // Tag wins outright, so once anything is tagged the fallback matches are not
  // claimants — counting them would report a conflict that resolution does not
  // actually have.
  return tagged.length > 0
    ? tagged.length
    : rows.filter((row) => matchesRoleFallback(row, role)).length;
}
