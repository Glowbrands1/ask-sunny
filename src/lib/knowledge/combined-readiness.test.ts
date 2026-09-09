import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  EMPLOYEE_PERFORMANCE_FRAMEWORK,
  PERFORMANCE_MANAGEMENT_FRAMEWORK,
} from "./document-roles";

/**
 * ============================================================================
 * WHICH KINDS OF ANSWER CAN THIS DEPLOYMENT SERVE?
 * ============================================================================
 *
 * `framework-readiness.test.ts` points the check at a real Supabase project and
 * is off unless credentials are supplied. That test answers "is the corpus this
 * environment points at healthy?", which is a question about an environment.
 *
 * THIS ONE ANSWERS A QUESTION ABOUT THE CODE, and therefore runs everywhere:
 * given two role verdicts, does the combined report draw the right conclusions?
 * The combination is the part with a decision in it — a deployment does not
 * need "the Employee Performance Framework is healthy", it needs to know
 * whether it can serve an employee-performance answer, and that requires BOTH
 * frameworks while a corrective-action answer requires only one.
 *
 * So Supabase is stubbed and the grounding results are dictated per role. What
 * is asserted is the derivation and the report, never a network call.
 */

const state = vi.hoisted(() => ({
  /** What `fetchRoleGrounding` returns, keyed by role id. */
  roleResults: {} as Record<string, unknown>,
  /** Superseded chunk rows the stub reports for the resolved document. */
  staleRows: [] as { id: string; version: number }[],
  /** Indexed documents the claimant count sees. */
  documents: [] as {
    id: string;
    title: string;
    original_filename: string;
    tags: string[] | null;
  }[],
  documentVersion: 3 as number | null,
}));

vi.mock("./corpus", () => ({
  activeKnowledgeCorpus: () => "sun-tan-city",
}));

vi.mock("./providers/supabase", () => ({
  SupabaseKnowledgeProvider: class {
    async fetchRoleGrounding(role: { id: string }) {
      const result = state.roleResults[role.id];
      if (!result) throw new Error(`no fixture for ${role.id}`);
      return result;
    }
  },
}));

/**
 * A chainable Supabase stub that answers by which columns were selected.
 *
 * Thenable rather than terminal-method-only, because the claimant count awaits
 * the builder itself while the version read calls `.single()`.
 */
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({
    from() {
      let selected = "";
      const builder = {
        select(columns: string) {
          selected = columns;
          return builder;
        },
        eq() {
          return builder;
        },
        neq() {
          return builder;
        },
        async single() {
          return { data: { version: state.documentVersion }, error: null };
        },
        then(
          resolve: (value: { data: unknown; error: null }) => unknown,
          reject?: (reason: unknown) => unknown,
        ) {
          const data = selected.includes("original_filename")
            ? state.documents
            : state.staleRows;
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  }),
}));

/* ------------------------------------------------------------- fixtures -- */

/** A healthy grounding result for one role, with every rule group present. */
function healthy(role: typeof EMPLOYEE_PERFORMANCE_FRAMEWORK, documentId: string) {
  return {
    ok: true as const,
    grounding: {
      role: { id: role.id },
      documentId,
      documentTitle: `${role.id.toUpperCase()} DOCUMENT`,
      matchedBy: "tag" as const,
      rows: role.ruleGroups.map((group, index) => ({
        chunk_id: `chunk-${role.id}-${index}`,
        document_id: documentId,
        document_title: `${role.id.toUpperCase()} DOCUMENT`,
        category: "leadership_coaching",
        locator: `SECTION ${index + 1}`,
        page: null,
        section: null,
        content: `Rule text for ${group.id}.`,
        similarity: 0,
      })),
      presentGroups: role.ruleGroups.map((group) => group.id),
    },
  };
}

/** A refusal, as `fetchRoleGrounding` reports one. */
function missing(role: typeof EMPLOYEE_PERFORMANCE_FRAMEWORK) {
  return {
    ok: false as const,
    failure: {
      code: "document_not_found" as const,
      detail: `No document claims the ${role.id} role.`,
      missingGroups: role.ruleGroups.map((group) => group.id),
    },
  };
}

/** One indexed document per role, tagged, so exactly one claimant is counted. */
function taggedDocuments() {
  return [
    {
      id: "doc-ep",
      title: "EMPLOYEE PERFORMANCE FRAMEWORK",
      original_filename: "ep.pdf",
      tags: [EMPLOYEE_PERFORMANCE_FRAMEWORK.tag],
    },
    {
      id: "doc-pm",
      title: "PERFORMANCE MANAGEMENT FRAMEWORK",
      original_filename: "pm.pdf",
      tags: [PERFORMANCE_MANAGEMENT_FRAMEWORK.tag],
    },
  ];
}

async function check() {
  const { checkCombinedFrameworkReadiness } = await import("./framework-readiness");
  return checkCombinedFrameworkReadiness();
}

beforeEach(() => {
  vi.resetModules();
  state.staleRows = [];
  state.documentVersion = 3;
  state.documents = taggedDocuments();
  state.roleResults = {
    [EMPLOYEE_PERFORMANCE_FRAMEWORK.id]: healthy(EMPLOYEE_PERFORMANCE_FRAMEWORK, "doc-ep"),
    [PERFORMANCE_MANAGEMENT_FRAMEWORK.id]: healthy(
      PERFORMANCE_MANAGEMENT_FRAMEWORK,
      "doc-pm",
    ),
  };
});

/* ==================================================================== */
/*  THE COMBINED VERDICTS                                               */
/* ==================================================================== */

describe("both frameworks healthy", () => {
  it("reports both role verdicts and both combined verdicts ready", async () => {
    const report = await check();

    expect(report.employeePerformance.ready).toBe(true);
    expect(report.performanceManagement.ready).toBe(true);
    expect(report.employeePerformanceAnalysisReady).toBe(true);
    expect(report.performanceManagementOnlyReady).toBe(true);
    expect(report.problems).toEqual([]);
  });

  it("reports every fact the deployment check asks for, per role", async () => {
    const report = await check();

    for (const one of [report.employeePerformance, report.performanceManagement]) {
      expect(one.roleId).toBeTruthy();
      expect(one.matchedBy).toBe("tag");
      expect(one.claimingDocuments).toBe(1);
      expect(one.documentId).toBeTruthy();
      expect(one.documentTitle).toBeTruthy();
      expect(one.documentVersion).toBe(3);
      expect(one.mandatoryChunkCount).toBeGreaterThan(0);
      expect(one.missingGroups).toEqual([]);
      expect(one.presentGroups).toHaveLength(one.requiredGroups.length);
      expect(one.staleChunkCount).toBe(0);
      expect(one.staleSelected).toBe(false);
      expect(one.provenanceOk).toBe(true);
      expect(one.advisories).toEqual([]);
    }
  });

  it("names the two roles it checked, so a renamed role cannot pass silently", async () => {
    const report = await check();

    expect(report.employeePerformance.roleId).toBe(EMPLOYEE_PERFORMANCE_FRAMEWORK.id);
    expect(report.performanceManagement.roleId).toBe(
      PERFORMANCE_MANAGEMENT_FRAMEWORK.id,
    );
    expect(report.scopeId).toBe("sun-tan-city");
  });
});

/* ==================================================================== */
/*  THE DERIVATION IS THE POINT                                         */
/* ==================================================================== */

describe("the Performance Management Framework alone is missing", () => {
  beforeEach(() => {
    state.roleResults[PERFORMANCE_MANAGEMENT_FRAMEWORK.id] = missing(
      PERFORMANCE_MANAGEMENT_FRAMEWORK,
    );
  });

  /*
   * THE CASE THE COMBINED CHECK EXISTS FOR. An operator looking only at the
   * Employee Performance report sees green and concludes the product can answer
   * "who should I coach?" — and it cannot, because such an answer recommends a
   * management response and nothing is governing which rung it may reach.
   */
  it("takes employee-performance analysis down with it", async () => {
    const report = await check();

    expect(report.employeePerformance.ready).toBe(true);
    expect(report.employeePerformanceAnalysisReady).toBe(false);
    expect(report.performanceManagementOnlyReady).toBe(false);
  });

  it("says which role the problem belongs to", async () => {
    const report = await check();

    expect(report.problems.length).toBeGreaterThan(0);
    expect(
      report.problems.every((line) =>
        line.startsWith(`[${PERFORMANCE_MANAGEMENT_FRAMEWORK.id}]`),
      ),
    ).toBe(true);
  });

  it("vouches for no provenance when nothing resolved", async () => {
    // Zero stray chunks out of zero chunks is not clean provenance.
    const report = await check();

    expect(report.performanceManagement.mandatoryChunkCount).toBe(0);
    expect(report.performanceManagement.provenanceOk).toBe(false);
  });
});

describe("the Employee Performance Framework alone is missing", () => {
  beforeEach(() => {
    state.roleResults[EMPLOYEE_PERFORMANCE_FRAMEWORK.id] = missing(
      EMPLOYEE_PERFORMANCE_FRAMEWORK,
    );
  });

  /*
   * NOT SYMMETRICAL, and deliberately so. A corrective-action question has
   * nobody in it and reads no metric; requiring the metrics framework for it
   * would refuse it for want of an unrelated document.
   */
  it("leaves performance-management answers available", async () => {
    const report = await check();

    expect(report.employeePerformanceAnalysisReady).toBe(false);
    expect(report.performanceManagementOnlyReady).toBe(true);
  });
});

describe("both frameworks missing", () => {
  beforeEach(() => {
    state.roleResults = {
      [EMPLOYEE_PERFORMANCE_FRAMEWORK.id]: missing(EMPLOYEE_PERFORMANCE_FRAMEWORK),
      [PERFORMANCE_MANAGEMENT_FRAMEWORK.id]: missing(PERFORMANCE_MANAGEMENT_FRAMEWORK),
    };
  });

  it("reports both combined verdicts not ready, and both roles' problems", async () => {
    const report = await check();

    expect(report.employeePerformanceAnalysisReady).toBe(false);
    expect(report.performanceManagementOnlyReady).toBe(false);
    expect(
      report.problems.some((line) =>
        line.startsWith(`[${EMPLOYEE_PERFORMANCE_FRAMEWORK.id}]`),
      ),
    ).toBe(true);
    expect(
      report.problems.some((line) =>
        line.startsWith(`[${PERFORMANCE_MANAGEMENT_FRAMEWORK.id}]`),
      ),
    ).toBe(true);
  });
});

/* ==================================================================== */
/*  THE THINGS THAT MAKE A GREEN REPORT WRONG                           */
/* ==================================================================== */

describe("a superseded chunk was selected", () => {
  beforeEach(() => {
    // The stub reports one stale chunk, and it is one the grounding pinned.
    state.staleRows = [
      { id: `chunk-${PERFORMANCE_MANAGEMENT_FRAMEWORK.id}-0`, version: 2 },
    ];
  });

  it("fails the role, and the combined verdicts with it", async () => {
    const report = await check();

    expect(report.performanceManagement.staleChunkCount).toBe(1);
    expect(report.performanceManagement.staleSelected).toBe(true);
    expect(report.performanceManagement.ready).toBe(false);
    expect(report.performanceManagementOnlyReady).toBe(false);
    expect(report.employeePerformanceAnalysisReady).toBe(false);
  });
});

describe("two documents claim one role", () => {
  beforeEach(() => {
    state.documents = [
      ...taggedDocuments(),
      {
        id: "doc-pm-old",
        title: "PERFORMANCE MANAGEMENT FRAMEWORK (2024)",
        original_filename: "pm-2024.pdf",
        tags: [PERFORMANCE_MANAGEMENT_FRAMEWORK.tag],
      },
    ];
  });

  it("is a problem even though the grounding resolved", async () => {
    /*
     * `fetchRoleGrounding` refuses on a genuine conflict, so a healthy result
     * with two claimants means the two disagree about what is indexed. The
     * count is reported rather than inferred for exactly this reason.
     */
    const report = await check();

    expect(report.performanceManagement.claimingDocuments).toBe(2);
    expect(report.performanceManagement.ready).toBe(false);
    expect(report.problems.join(" ")).toMatch(/exactly one must/i);
  });
});

describe("identity rests on the filename", () => {
  beforeEach(() => {
    const result = healthy(PERFORMANCE_MANAGEMENT_FRAMEWORK, "doc-pm") as {
      grounding: { matchedBy: string };
    };
    result.grounding.matchedBy = "fallback";
    state.roleResults[PERFORMANCE_MANAGEMENT_FRAMEWORK.id] = result;
  });

  it("advises the durable tag without failing the deployment", async () => {
    // A rename breaks fallback identity silently, so this is worth saying —
    // but it is working today, and refusing to deploy over it would be wrong.
    const report = await check();

    expect(report.performanceManagement.matchedBy).toBe("fallback");
    expect(report.performanceManagement.ready).toBe(true);
    expect(report.performanceManagementOnlyReady).toBe(true);
    expect(report.advisories.length).toBeGreaterThan(0);
    expect(report.advisories[0]).toContain(`[${PERFORMANCE_MANAGEMENT_FRAMEWORK.id}]`);
  });
});

describe("a rule group is missing from an otherwise healthy document", () => {
  beforeEach(() => {
    const result = healthy(PERFORMANCE_MANAGEMENT_FRAMEWORK, "doc-pm") as {
      grounding: { presentGroups: string[]; rows: unknown[] };
    };
    // A re-upload that dropped the final operating rule.
    result.grounding.presentGroups = result.grounding.presentGroups.slice(0, -1);
    state.roleResults[PERFORMANCE_MANAGEMENT_FRAMEWORK.id] = result;
  });

  it("names the missing group and fails, so a re-upload cannot lose it quietly", async () => {
    const report = await check();

    expect(report.performanceManagement.missingGroups).toHaveLength(1);
    expect(report.performanceManagement.ready).toBe(false);
    expect(report.problems.join(" ")).toMatch(/Missing required rules/i);
  });
});

describe("the grounding resolved but pinned nothing", () => {
  beforeEach(() => {
    const result = healthy(PERFORMANCE_MANAGEMENT_FRAMEWORK, "doc-pm") as {
      grounding: { rows: unknown[]; presentGroups: string[] };
    };
    result.grounding.rows = [];
    result.grounding.presentGroups = [];
    state.roleResults[PERFORMANCE_MANAGEMENT_FRAMEWORK.id] = result;
  });

  /*
   * ZERO STRAY CHUNKS OUT OF ZERO CHUNKS IS NOT CLEAN PROVENANCE.
   *
   * A count-based check passes vacuously here — nothing is stray and nothing is
   * missing a locator, because there is nothing. `provenanceOk` therefore
   * requires that something was actually pinned, and this is the case that
   * proves it does: an `ok` grounding with an empty row set, which is reachable
   * whenever a re-upload leaves the document indexed but unchunked.
   */
  it("vouches for no provenance, rather than passing on an empty set", async () => {
    const report = await check();

    expect(report.performanceManagement.mandatoryChunkCount).toBe(0);
    expect(report.performanceManagement.strayProvenanceCount).toBe(0);
    expect(report.performanceManagement.incompleteProvenanceCount).toBe(0);
    expect(report.performanceManagement.provenanceOk).toBe(false);
    expect(report.performanceManagement.ready).toBe(false);
  });

  it("says so as a problem, not only as a flag", async () => {
    const report = await check();

    expect(report.problems.join(" ")).toMatch(/No mandatory chunks were selected/i);
  });

  it("renders as incomplete provenance rather than complete", async () => {
    const { formatCombinedReadiness } = await import("./framework-readiness");
    const text = formatCombinedReadiness(await check());

    expect(text).toContain("INCOMPLETE");
  });
});

describe("a pinned chunk points at the wrong document", () => {
  beforeEach(() => {
    const result = healthy(PERFORMANCE_MANAGEMENT_FRAMEWORK, "doc-pm") as {
      grounding: { rows: { document_id: string }[] };
    };
    result.grounding.rows[0].document_id = "doc-somewhere-else";
    state.roleResults[PERFORMANCE_MANAGEMENT_FRAMEWORK.id] = result;
  });

  it("fails provenance, because a citation from it cannot be trusted", async () => {
    const report = await check();

    expect(report.performanceManagement.strayProvenanceCount).toBe(1);
    expect(report.performanceManagement.provenanceOk).toBe(false);
    expect(report.performanceManagement.ready).toBe(false);
  });
});

/* ==================================================================== */
/*  THE RENDERED REPORT                                                 */
/* ==================================================================== */

describe("the rendered report", () => {
  it("states both combined verdicts by the names the deployment check uses", async () => {
    const { formatCombinedReadiness } = await import("./framework-readiness");
    const text = formatCombinedReadiness(await check());

    expect(text).toContain("EMPLOYEE PERFORMANCE ANALYSIS READINESS");
    expect(text).toContain("PERFORMANCE MANAGEMENT ONLY READINESS");
    expect(text).toContain("EMPLOYEE PERFORMANCE FRAMEWORK");
    expect(text).toContain("PERFORMANCE MANAGEMENT FRAMEWORK");
  });

  it("carries every fact an operator needs to act on a failure", async () => {
    const { formatCombinedReadiness } = await import("./framework-readiness");
    const text = formatCombinedReadiness(await check());

    for (const label of [
      "role identity",
      "matched by",
      "claiming documents",
      "document version",
      "mandatory chunks",
      "rule groups",
      "missing groups",
      "stale chunks present",
      "stale chunk selected",
      "provenance",
      "advisories",
      "verdict",
    ]) {
      expect(text, `the report labels "${label}"`).toContain(label);
    }
  });

  it("says NOT READY where it is not ready, rather than only listing problems", async () => {
    state.roleResults[PERFORMANCE_MANAGEMENT_FRAMEWORK.id] = missing(
      PERFORMANCE_MANAGEMENT_FRAMEWORK,
    );

    const { formatCombinedReadiness } = await import("./framework-readiness");
    const text = formatCombinedReadiness(await check());

    expect(text).toContain("NOT READY");
    expect(text).toContain("PROBLEMS");
    expect(text).not.toContain("No problems.");
  });

  it("says so plainly when there is nothing wrong", async () => {
    const { formatCombinedReadiness } = await import("./framework-readiness");
    const text = formatCombinedReadiness(await check());

    expect(text).toContain("No problems.");
    expect(text).not.toContain("NOT READY");
  });
});
