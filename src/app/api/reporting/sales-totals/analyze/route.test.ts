import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_PERMISSION_MATRIX } from "@/lib/permissions";

/**
 * ============================================================================
 * WHO MAY ASK ASK SUNNY ABOUT A SALES TOTALS REPORT
 * ============================================================================
 *
 * The defect this endpoint could easily have shipped with: Employee holds
 * `ask_questions` and does NOT hold `view_reports`. An analysis endpoint gated
 * only on "may this person use Ask Sunny" would therefore return salon-level
 * sales figures to every frontline employee in the company — figures they
 * cannot open the dashboard to see. The assistant would have become a way
 * around the reporting permission.
 *
 * So the first thing asserted here is that Employee's permission set really is
 * that shape (if the matrix changes, these tests must be reconsidered, not
 * quietly kept passing), and everything after it is about the gate.
 *
 * ORDER IS ASSERTED, NOT ASSUMED. The route must refuse before it reads report
 * rows and before it spends money at Anthropic, so the fakes below RECORD every
 * call and the tests check that the recording is empty on a refusal. A gate
 * that returns 403 after paying for the answer is not a gate.
 */

const ROUTE_SOURCE = readFileSync(
  "src/app/api/reporting/sales-totals/analyze/route.ts",
  "utf8",
);

const ORIGINAL = { ...process.env };

/** Everything the request touched. Empty is what a refusal must leave behind. */
interface Trace {
  authorized: string[];
  reportReads: number;
  claudeCalls: { system: string; grounding: string; question: string }[];
}

beforeEach(() => {
  vi.resetModules();
  process.env.NEXT_PUBLIC_DEMO_MODE = "false";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
  process.env.SUPABASE_SECRET_KEY = "sb_secret_test";
  process.env.ANTHROPIC_API_KEY = "test";
});

afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.doUnmock("@/lib/auth/server");
  vi.doUnmock("@/lib/ai/call-claude");
  vi.doUnmock("@/lib/reporting/read/sales-totals-read");
  vi.resetModules();
});

const SNAPSHOT = {
  reportDate: "2026-09-02",
  reportDateRaw: "09-02-2026",
  monthStart: "2026-09-01",
  window: "daily" as const,
  windowLabel: "Previous Day",
  windowDescription: "The single day the report covers.",
  summaries: [
    {
      kind: "summary" as const,
      key: "all_salons",
      label: "All Salons",
      salonNumber: null,
      salonCount: 249,
      figures: [
        {
          metricCode: "grand_total",
          metricLabel: "Grand Total",
          unit: "currency" as const,
          aggregation: "sum" as const,
          summaryIsAverage: true,
          note: "",
          value: 818.45,
        },
      ],
    },
  ],
  salons: [
    {
      kind: "salon" as const,
      key: "1001",
      label: "Aurora",
      salonNumber: "1001",
      salonCount: null,
      figures: [
        {
          metricCode: "grand_total",
          metricLabel: "Grand Total",
          unit: "currency" as const,
          aggregation: "sum" as const,
          summaryIsAverage: true,
          note: "",
          // A distinctive figure. If this string ever appears in a refusal
          // response, restricted report data escaped through an error.
          value: 4242.42,
        },
      ],
    },
  ],
  lineage: { parserKey: "sales_totals_v1", parserVersion: 1, ingestedAt: null },
};

/**
 * The route with a fake identity, a fake read layer and a fake Claude.
 *
 * `role` drives a REAL permission check against DEFAULT_PERMISSION_MATRIX — the
 * matrix is not faked, because the whole question is what the real matrix says
 * about Employee.
 */
async function loadRoute(options: { role?: string | null } = {}) {
  vi.resetModules();

  const trace: Trace = { authorized: [], reportReads: 0, claudeCalls: [] };
  const role = options.role === undefined ? "district_manager" : options.role;

  vi.doMock("@/lib/auth/server", async () => {
    const { AuthError } = await import("@/lib/auth/types");
    return {
      authorizeRequest: async (_request: Request, permission: string) => {
        trace.authorized.push(permission);
        if (role === null) throw new AuthError("unauthenticated", "You are not signed in.");
        const granted = DEFAULT_PERMISSION_MATRIX[
          role as keyof typeof DEFAULT_PERMISSION_MATRIX
        ];
        if (!granted?.includes(permission as never)) {
          throw new AuthError("forbidden", "Your role does not have permission to do that.");
        }
        return { identity: { role }, permission, provider: "supabase" };
      },
    };
  });

  vi.doMock("@/lib/reporting/read/sales-totals-read", async () => {
    const actual = await vi.importActual<
      typeof import("@/lib/reporting/read/sales-totals-read")
    >("@/lib/reporting/read/sales-totals-read");
    return {
      ...actual,
      listSalesTotalsDates: async () => [
        {
          reportDate: "2026-09-02",
          reportDateRaw: "09-02-2026",
          monthStart: "2026-09-01",
          label: "Wed, Sep 2, 2026",
          ingestedAt: null,
        },
      ],
      loadSalesTotals: async () => {
        trace.reportReads += 1;
        return SNAPSHOT;
      },
    };
  });

  vi.doMock("@/lib/ai/call-claude", () => ({
    callClaude: async (input: { system: string; grounding: string; question: string }) => {
      trace.claudeCalls.push(input);
      return "Aurora took $4,242.42 on this date.";
    },
  }));

  const { POST } = await import("./route");
  return { POST, trace };
}

function post(body: unknown): Request {
  return new Request("https://app.test/api/reporting/sales-totals/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": `10.0.0.${Math.floor(Math.random() * 250) + 1}` },
    body: JSON.stringify(body),
  });
}

/* ------------------------------------------------------------- the matrix -- */

describe("the permission shape this gate is built around", () => {
  it("Employee can ask Ask Sunny questions", () => {
    expect(DEFAULT_PERMISSION_MATRIX.employee).toContain("ask_questions");
  });

  it("Employee cannot view reports", () => {
    expect(DEFAULT_PERMISSION_MATRIX.employee).not.toContain("view_reports");
  });
});

/* ---------------------------------------------------------------- the gate -- */

describe("both permissions are required, and neither implies the other", () => {
  it("refuses Employee, who holds ask_questions but not view_reports", async () => {
    const { POST, trace } = await loadRoute({ role: "employee" });
    const response = await POST(post({ question: "Summarise this report." }));

    expect(response.status).toBe(403);
    expect(trace.authorized).toEqual(["ask_questions", "view_reports"]);
  });

  it("refuses an unauthenticated caller", async () => {
    const { POST } = await loadRoute({ role: null });
    const response = await POST(post({ question: "Summarise this report." }));
    expect(response.status).toBe(401);
  });

  it("checks ask_questions and view_reports independently, in that order", async () => {
    const { POST, trace } = await loadRoute();
    await POST(post({ question: "Summarise this report." }));
    expect(trace.authorized).toEqual(["ask_questions", "view_reports"]);
  });

  it("admits a role that holds both", async () => {
    const { POST } = await loadRoute({ role: "district_manager" });
    const response = await POST(post({ question: "Summarise this report." }));
    expect(response.status).toBe(200);
  });
});

/* ------------------------------------------- authorization comes first -- */

describe("nothing is read and nothing is paid for before the gate clears", () => {
  it("does not call Claude for a refused caller", async () => {
    const { POST, trace } = await loadRoute({ role: "employee" });
    await POST(post({ question: "Summarise this report." }));
    expect(trace.claudeCalls).toEqual([]);
  });

  it("does not read the report for a refused caller", async () => {
    const { POST, trace } = await loadRoute({ role: "employee" });
    await POST(post({ question: "Summarise this report." }));
    expect(trace.reportReads).toBe(0);
  });

  it("does not call Claude for an unauthenticated caller", async () => {
    const { POST, trace } = await loadRoute({ role: null });
    await POST(post({ question: "Summarise this report." }));
    expect(trace.claudeCalls).toEqual([]);
    expect(trace.reportReads).toBe(0);
  });

  it("puts both authorization calls ahead of the rate limiter in the source", () => {
    // Sliced to the handler body: the import block names the same helpers, and
    // matching against the whole file compares an import position with a call
    // position, which proves nothing about the order things run in.
    const stripped = ROUTE_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const code = stripped.slice(stripped.indexOf("export async function POST"));
    const askQuestions = code.indexOf('authorizeRequest(request, "ask_questions")');
    const viewReports = code.indexOf('authorizeRequest(request, "view_reports")');
    const rateLimit = code.indexOf("assertWithinRateLimit");
    const analyse = code.indexOf("analyzeSalesTotals(");

    expect(askQuestions).toBeGreaterThan(-1);
    expect(viewReports).toBeGreaterThan(askQuestions);
    expect(rateLimit).toBeGreaterThan(viewReports);
    expect(analyse).toBeGreaterThan(rateLimit);
  });

  it("spends its own rate-limit budget rather than the chat budget", () => {
    expect(ROUTE_SOURCE).toContain('assertWithinRateLimit(request, "reportAnalysis")');
    expect(ROUTE_SOURCE).not.toContain('assertWithinRateLimit(request, "chat")');
  });
});

/* ---------------------------------------------- errors disclose nothing -- */

describe("a refusal discloses no report data", () => {
  it("returns no salon name, salon number or figure to a refused Employee", async () => {
    const { POST } = await loadRoute({ role: "employee" });
    const response = await POST(post({ question: "What did Aurora take?" }));
    const text = await response.text();

    expect(text).not.toContain("4242.42");
    expect(text).not.toContain("4,242.42");
    expect(text).not.toContain("Aurora");
    expect(text).not.toContain("1001");
    expect(text).not.toContain("818.45");
  });

  it("returns no report data when the view cannot be resolved", async () => {
    vi.resetModules();
    const trace: Trace = { authorized: [], reportReads: 0, claudeCalls: [] };

    vi.doMock("@/lib/auth/server", () => ({
      authorizeRequest: async (_request: Request, permission: string) => {
        trace.authorized.push(permission);
        return { identity: { role: "district_manager" }, permission, provider: "supabase" };
      },
    }));
    vi.doMock("@/lib/reporting/read/sales-totals-read", async () => {
      const actual = await vi.importActual<
        typeof import("@/lib/reporting/read/sales-totals-read")
      >("@/lib/reporting/read/sales-totals-read");
      return { ...actual, listSalesTotalsDates: async () => [], loadSalesTotals: async () => null };
    });
    vi.doMock("@/lib/ai/call-claude", () => ({ callClaude: async () => "unused" }));

    const { POST } = await import("./route");
    const response = await POST(post({ question: "Summarise this report." }));
    const payload = (await response.json()) as { error: string };

    expect(response.status).toBe(404);
    expect(payload.error).toMatch(/No Sales Totals report has been received yet/);
    expect(payload.error).not.toMatch(/\d[\d,]*\.\d\d/);
  });

  it("does not echo a rejected filter value back to the caller", async () => {
    const { POST } = await loadRoute();
    const response = await POST(
      post({ question: "Summarise this report.", metric: "x".repeat(200) }),
    );
    const text = await response.text();

    expect(response.status).toBe(400);
    expect(text).not.toContain("x".repeat(50));
  });
});

/* -------------------------------------- the browser cannot assert a figure -- */

describe("the request carries pointers at rows, never values", () => {
  it("ignores any figure-shaped field a caller invents", async () => {
    const { POST, trace } = await loadRoute();
    await POST(
      post({
        question: "Summarise this report.",
        // None of these exist on the request type. If any of them could reach
        // the model, the browser would be able to tell the server what the
        // report says.
        grandTotal: 999999,
        figures: [{ salon: "1001", value: 1 }],
        grounding: "Aurora took $1.00",
        salonRows: "Aurora 1.00",
      }),
    );

    const call = trace.claudeCalls[0];
    expect(call).toBeDefined();
    expect(call.grounding).not.toContain("999999");
    expect(call.grounding).not.toContain("$1.00");
    expect(call.grounding).toContain("$4,242.42");
  });

  it("drops an unknown salon number while keeping the valid ones", async () => {
    const { POST, trace } = await loadRoute();
    await POST(post({ question: "Summarise this report.", salonIds: ["1001", "9999"] }));

    const call = trace.claudeCalls[0];
    expect(call.grounding).not.toContain("9999");
    expect(call.grounding).toContain("Aurora");
  });

  it("refuses a selection of only unknown salons instead of widening to all", async () => {
    const { POST, trace } = await loadRoute();
    const response = await POST(
      post({ question: "Summarise this report.", salonIds: ["9999"] }),
    );

    expect(response.status).toBe(404);
    const payload = (await response.json()) as { error: string };
    expect(payload.error).toMatch(/None of the selected salons are in this Sales Totals delivery/);

    // The point of the fix: an empty explicit selection must NOT become every
    // salon in the delivery, so nothing about Aurora ever reaches the model.
    expect(trace.claudeCalls).toEqual([]);
  });

  it("requires a question", async () => {
    const { POST } = await loadRoute();
    const response = await POST(post({ salonIds: ["1001"] }));
    expect(response.status).toBe(400);
  });
});

/* ------------------------------------------------- no upload, no retrieval -- */

describe("a snapshot already on the dashboard is analysable as it stands", () => {
  /**
   * THE EXPLICIT REGRESSION THIS MILESTONE REQUIRES.
   *
   * The request below carries no file, no attachment, no document id and no
   * knowledge-base reference — only the filters the dashboard already had in
   * its URL. The report was ingested when the morning email arrived, and that
   * is enough: a full answer comes back, grounded in figures read from the
   * reporting tables during this request.
   */
  it("answers from an ingested snapshot with no upload and no attachment", async () => {
    const { POST, trace } = await loadRoute();
    const response = await POST(
      post({
        question: "Summarise this report.",
        reportDate: "2026-09-02",
        window: "daily",
        estateSummaryKey: "all_salons",
        metric: "grand_total",
        salonIds: [],
      }),
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      content: string;
      provenance: { reportType: string; reportDate: string };
    };

    expect(payload.content).toContain("4,242.42");
    expect(payload.provenance).toMatchObject({
      reportType: "Sales Totals",
      reportDate: "2026-09-02",
    });

    // The figures reached the model from the database read, in this request.
    expect(trace.reportReads).toBe(1);
    expect(trace.claudeCalls[0].grounding).toContain("$4,242.42");
  });

  it("returns provenance rather than document citations", async () => {
    const { POST } = await loadRoute();
    const response = await POST(post({ question: "Summarise this report." }));
    const payload = (await response.json()) as Record<string, unknown>;

    expect(payload).toHaveProperty("provenance");
    expect(payload).not.toHaveProperty("citations");
  });

  it("never touches uploads, attachments or the knowledge base", () => {
    const code = ROUTE_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/upload/i);
    expect(code).not.toMatch(/attach/i);
    expect(code).not.toMatch(/knowledge/i);
  });
});

/* --------------------------------------------- the known scope limitation -- */

describe("the reach of view_reports, stated as it actually is", () => {
  /**
   * NOT AN ASSERTION THAT THIS IS RIGHT — an assertion that it is DOCUMENTED.
   *
   * Sales Totals has no per-area row filtering anywhere in its read layer, so
   * `view_reports` is a door rather than a filter and every holder sees the
   * whole delivery. Preview QA runs as global Admin, where that is correct. It
   * would not be correct for a Salon Director, and this test exists so that
   * enabling those roles has to walk past a statement of the prerequisite.
   */
  it("grants view_reports to manager roles whose area scope is not yet enforced", () => {
    for (const role of ["salon_director", "district_manager", "regional_manager"] as const) {
      expect(DEFAULT_PERMISSION_MATRIX[role]).toContain("view_reports");
    }
  });

  it("keeps Employee outside the endpoint entirely", () => {
    expect(DEFAULT_PERMISSION_MATRIX.employee).not.toContain("view_reports");
  });

  it("says in the route itself that per-area scope is a prerequisite", () => {
    expect(ROUTE_SOURCE).toMatch(/no per-user area scoping|NO per-area row filtering/i);
    expect(ROUTE_SOURCE).toMatch(/PREREQUISITE for those roles/);
    expect(ROUTE_SOURCE).toMatch(/the dashboard has exactly the same reach/);
  });
});
