import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";
import { activeKnowledgeCorpus } from "./corpus";
import {
  EMPLOYEE_PERFORMANCE_FRAMEWORK,
  PERFORMANCE_MANAGEMENT_FRAMEWORK,
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
  /**
   * Every rule group the role REQUIRES.
   *
   * Reported alongside what was found so the report is self-describing: "6 of
   * 12 groups present" is an operational fact, and it cannot be read off
   * `presentGroups` alone without also having the role definition to hand.
   */
  readonly requiredGroups: readonly string[];
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
  /**
   * Pinned chunks that do not point at the resolved document. Must be zero:
   * grounding attributed to the wrong document is grounding a citation cannot
   * be trusted from.
   */
  readonly strayProvenanceCount: number;
  /** Pinned chunks missing a document title or a locator. Must be zero. */
  readonly incompleteProvenanceCount: number;
  /** True when every pinned chunk carries complete, correct provenance. */
  readonly provenanceOk: boolean;
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
      requiredGroups: role.ruleGroups.map((group) => group.id),
      presentGroups: [],
      missingGroups: result.failure.missingGroups ?? role.ruleGroups.map((group) => group.id),
      claimingDocuments: await countClaimingDocuments(role, scopeId),
      staleChunkCount: 0,
      staleSelected: false,
      /*
       * NOTHING RESOLVED, SO NOTHING IS VOUCHED FOR. Zero stray chunks out of
       * zero chunks is not clean provenance — there is no provenance — so this
       * reports false rather than a vacuous pass.
       */
      strayProvenanceCount: 0,
      incompleteProvenanceCount: 0,
      provenanceOk: false,
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
  const incompleteProvenance = grounding.rows.filter(
    (row) => !row.document_title || !row.locator,
  );
  if (incompleteProvenance.length > 0) {
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
    requiredGroups: role.ruleGroups.map((group) => group.id),
    presentGroups: grounding.presentGroups,
    missingGroups,
    claimingDocuments,
    staleChunkCount: staleIds.size,
    staleSelected,
    strayProvenanceCount: strayProvenance.length,
    incompleteProvenanceCount: incompleteProvenance.length,
    provenanceOk:
      grounding.rows.length > 0 &&
      strayProvenance.length === 0 &&
      incompleteProvenance.length === 0,
    problems,
    advisories,
  };
}

/* ================================================================ */
/*  THE COMBINED CHECK                                              */
/* ================================================================ */

/**
 * ============================================================================
 * TWO FRAMEWORKS, AND THREE DIFFERENT QUESTIONS ABOUT THEM
 * ============================================================================
 *
 * `checkFrameworkReadiness` answers "is this role healthy?" one role at a time,
 * which is the right shape for the check and the wrong shape for the decision.
 * A deployment does not need "the Employee Performance Framework is healthy";
 * it needs to know which KINDS OF ANSWER it can serve, and those depend on
 * different combinations:
 *
 *   EMPLOYEE PERFORMANCE ANALYSIS needs BOTH. "Who should I coach from this
 *   report?" reads metrics through the Employee Performance Framework and then
 *   recommends a management response, which is the Performance Management
 *   Framework's territory. The routing was changed to require both together
 *   precisely because identifying the right person and then recommending an
 *   ungoverned response is the worse half of the answer.
 *
 *   PERFORMANCE MANAGEMENT ALONE is enough for the rest: a corrective-action
 *   question, the approved progression, drafting a form that records a rung.
 *   Those never touch a metric, and requiring the metrics framework for them
 *   would refuse them for want of an unrelated document.
 *
 *   EITHER FRAMEWORK ALONE tells an operator which upload to fix first.
 *
 * SO THE COMBINED VERDICTS ARE STATED RATHER THAN LEFT TO BE DERIVED. An
 * operator reading two green reports and concluding the product works has done
 * the derivation in their head; a deploy check that does it in code cannot get
 * it wrong on a Friday.
 *
 * READ-ONLY, like everything else here. Safe to point at Production.
 */
export interface CombinedFrameworkReadinessReport {
  readonly scopeId: string;
  readonly employeePerformance: FrameworkReadinessReport;
  readonly performanceManagement: FrameworkReadinessReport;
  /**
   * Both frameworks healthy. What an employee-performance turn requires, since
   * such a turn needs the metrics framework AND the management framework.
   */
  readonly employeePerformanceAnalysisReady: boolean;
  /**
   * The Performance Management Framework alone. What a corrective-action
   * question and a governed form draft require.
   */
  readonly performanceManagementOnlyReady: boolean;
  /** Every problem from either report, prefixed with which role it came from. */
  readonly problems: readonly string[];
  /** Every advisory from either report, likewise prefixed. */
  readonly advisories: readonly string[];
}

/** Runs both role checks and states the combined verdicts. */
export async function checkCombinedFrameworkReadiness(
  scopeId: string = activeKnowledgeCorpus(),
): Promise<CombinedFrameworkReadinessReport> {
  /*
   * TOGETHER, because neither depends on the other and a deploy check that
   * takes twice as long gets run half as often.
   */
  const [employeePerformance, performanceManagement] = await Promise.all([
    checkFrameworkReadiness(EMPLOYEE_PERFORMANCE_FRAMEWORK, scopeId),
    checkFrameworkReadiness(PERFORMANCE_MANAGEMENT_FRAMEWORK, scopeId),
  ]);

  const label = (report: FrameworkReadinessReport, line: string) =>
    `[${report.roleId}] ${line}`;

  return {
    scopeId,
    employeePerformance,
    performanceManagement,
    employeePerformanceAnalysisReady:
      employeePerformance.ready && performanceManagement.ready,
    performanceManagementOnlyReady: performanceManagement.ready,
    problems: [
      ...employeePerformance.problems.map((line) => label(employeePerformance, line)),
      ...performanceManagement.problems.map((line) =>
        label(performanceManagement, line),
      ),
    ],
    advisories: [
      ...employeePerformance.advisories.map((line) => label(employeePerformance, line)),
      ...performanceManagement.advisories.map((line) =>
        label(performanceManagement, line),
      ),
    ],
  };
}

/**
 * Renders the combined report as text an operator can read.
 *
 * WHY A RENDERER AND NOT JUST JSON. The audience is a person deciding whether
 * to approve a deployment, and the facts that decide it — how identity was
 * established, which rule groups are missing, whether a superseded chunk was
 * selected — are buried in a nested object. This is the same data with the
 * question it answers next to each line.
 */
export function formatCombinedReadiness(
  report: CombinedFrameworkReadinessReport,
): string {
  const section = (title: string, one: FrameworkReadinessReport): string[] => [
    `${title}`,
    `  role identity          ${one.roleId}`,
    `  resolved              ${one.documentTitle ?? "NOT RESOLVED"}`,
    `  matched by            ${one.matchedBy ?? "nothing"}`,
    `  claiming documents    ${one.claimingDocuments} (exactly 1 required)`,
    `  document version      ${one.documentVersion ?? "unknown"}`,
    `  mandatory chunks      ${one.mandatoryChunkCount}`,
    `  rule groups           ${one.presentGroups.length} of ${one.requiredGroups.length} present`,
    `  missing groups        ${one.missingGroups.length === 0 ? "none" : one.missingGroups.join(", ")}`,
    `  stale chunks present  ${one.staleChunkCount}`,
    `  stale chunk selected  ${one.staleSelected ? "YES - blocking" : "no"}`,
    `  provenance            ${one.provenanceOk ? "complete" : `INCOMPLETE (${one.strayProvenanceCount} stray, ${one.incompleteProvenanceCount} missing title/locator)`}`,
    `  advisories            ${one.advisories.length === 0 ? "none" : one.advisories.join(" | ")}`,
    `  verdict               ${one.ready ? "READY" : "NOT READY"}`,
  ];

  return [
    `KNOWLEDGE FRAMEWORK READINESS - corpus ${report.scopeId}`,
    "",
    ...section("EMPLOYEE PERFORMANCE FRAMEWORK", report.employeePerformance),
    "",
    ...section("PERFORMANCE MANAGEMENT FRAMEWORK", report.performanceManagement),
    "",
    "COMBINED",
    `  EMPLOYEE PERFORMANCE ANALYSIS READINESS   ${report.employeePerformanceAnalysisReady ? "READY" : "NOT READY"} (requires both)`,
    `  PERFORMANCE MANAGEMENT ONLY READINESS     ${report.performanceManagementOnlyReady ? "READY" : "NOT READY"}`,
    "",
    report.problems.length === 0
      ? "No problems."
      : `PROBLEMS\n${report.problems.map((line) => `  - ${line}`).join("\n")}`,
  ].join("\n");
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
