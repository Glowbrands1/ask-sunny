import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_PERMISSION_MATRIX } from "@/lib/permissions";

/**
 * ============================================================================
 * GETTING THE ORIGINAL FILE BACK, WITHOUT OPENING THE BUCKET
 * ============================================================================
 *
 * THE GAP THIS ROUTE FILLS. A manager could upload a document and never get it
 * back: the detail panel's download was wired to a field only IndexedDB uploads
 * carry, so on a real Supabase-stored document it told them the file did not
 * exist.
 *
 * THE PROPERTIES THAT MATTER ARE THE REFUSALS.
 *
 *   THE BROWSER NAMES A DOCUMENT, NOT A PATH. There is no parameter through
 *   which an object path could be supplied, and the path read off the row is
 *   re-validated against the scope before it is signed.
 *
 *   AN ID ALONE DOES NOT CROSS A SCOPE. The row is selected on id AND
 *   knowledge_scope_id together, so editing the id in a URL returns nothing.
 *
 *   NOTHING INTERNAL LEAKS. Not the storage path, not the bucket layout, not a
 *   provider's error text — a Postgres or Storage message can name internal
 *   state, and this is a route a browser calls.
 */

const ROUTE_SOURCE = readFileSync(
  "src/app/api/knowledge/documents/[id]/file/route.ts",
  "utf8",
);
const SERVICE_SOURCE = readFileSync("src/lib/knowledge/original-file.ts", "utf8");

const ORIGINAL = { ...process.env };
const DOC_ID = "8f14e45f-ceea-4e78-b2a7-1c1b1a2b3c4d";
const SCOPE = "stc-core";
const STORED_PATH = `${SCOPE}/${DOC_ID}/v2/Safety Binder.pdf`;

interface Trace {
  authorized: string[];
  /** Column filters the row query was narrowed by. */
  filters: [string, unknown][];
  signed: { path: string; expiresIn: number; options: unknown }[];
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: DOC_ID,
    original_filename: "Safety Binder.pdf",
    mime_type: "application/pdf",
    file_type: "pdf",
    storage_path: STORED_PATH,
    status: "indexed",
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetModules();
  process.env.NEXT_PUBLIC_DEMO_MODE = "false";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
  process.env.SUPABASE_SECRET_KEY = ["sb", "secret", "TESTFIXTURE"].join("_");
  process.env.ANTHROPIC_API_KEY = "test";
});

afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.doUnmock("@/lib/auth/server");
  vi.doUnmock("@/lib/supabase/server");
  vi.resetModules();
});

async function loadRoute(
  options: {
    role?: string | null;
    row?: Record<string, unknown> | null;
    rowError?: { message: string } | null;
    signError?: { message: string } | null;
  } = {},
) {
  vi.resetModules();

  const trace: Trace = { authorized: [], filters: [], signed: [] };
  const role = options.role === undefined ? "salon_director" : options.role;
  const stored = options.row === undefined ? row() : options.row;

  vi.doMock("@/lib/auth/server", async () => {
    const { AuthError } = await import("@/lib/auth/types");
    return {
      authorizeRequest: async (_request: Request, permission: string) => {
        trace.authorized.push(permission);
        if (role === null) throw new AuthError("unauthenticated", "You are not signed in.");
        const granted =
          DEFAULT_PERMISSION_MATRIX[role as keyof typeof DEFAULT_PERMISSION_MATRIX];
        if (!granted?.includes(permission as never)) {
          throw new AuthError("forbidden", "Your role does not have permission to do that.");
        }
        return { identity: { role, subject: "u1" }, permission, provider: "supabase" };
      },
    };
  });

  vi.doMock("@/lib/supabase/server", () => ({
    KNOWLEDGE_BUCKET: "knowledge-documents",
    getSupabaseAdmin: () => ({
      from: () => {
        const builder: Record<string, unknown> = {};
        Object.assign(builder, {
          select: () => builder,
          eq: (column: string, value: unknown) => {
            trace.filters.push([column, value]);
            return builder;
          },
          maybeSingle: async () => {
            if (options.rowError) return { data: null, error: options.rowError };
            /*
             * The fake enforces the real scoping rule: a row is only returned
             * when BOTH filters match it. A harness that ignored the scope
             * filter would let the cross-scope test pass against a route that
             * never applied one.
             */
            const byId = trace.filters.some(([c, v]) => c === "id" && v === DOC_ID);
            const byScope = trace.filters.some(
              ([c, v]) => c === "knowledge_scope_id" && v === SCOPE,
            );
            return { data: byId && byScope ? stored : null, error: null };
          },
        });
        return builder;
      },
      storage: {
        from: () => ({
          createSignedUrl: async (path: string, expiresIn: number, opts: unknown) => {
            trace.signed.push({ path, expiresIn, options: opts });
            if (options.signError) return { data: null, error: options.signError };
            return {
              data: { signedUrl: `https://project.supabase.co/storage/v1/object/sign/x?token=t` },
              error: null,
            };
          },
        }),
      },
    }),
  }));

  const route = await import("./documents/[id]/file/route");
  return { route, trace };
}

function get(query = `scope=${SCOPE}`): Request {
  return new Request(`https://app.test/api/knowledge/documents/${DOC_ID}/file?${query}`, {
    headers: { "x-forwarded-for": `10.0.0.${Math.floor(Math.random() * 250) + 1}` },
  });
}

const params = { params: Promise.resolve({ id: DOC_ID }) };

/* ------------------------------------------------------------ refusals -- */

describe("who may obtain the original file", () => {
  it("refuses an unauthenticated caller", async () => {
    // L.
    const { route, trace } = await loadRoute({ role: null });
    const response = await route.GET(get(), params);

    expect(response.status).toBe(401);
    expect(trace.signed).toEqual([]);
  });

  it("records that every current role may read the knowledge base", () => {
    /*
     * NOT A REFUSAL TEST — A STATEMENT OF WHERE THE BOUNDARY ACTUALLY IS.
     *
     * Every role in the matrix today, Employee included, holds
     * `view_knowledge`: they can already open the Knowledge Base page, see
     * every document listed by name, and read the documents' own words quoted
     * back in a grounded answer. So choosing `view_knowledge` for this route
     * grants nobody anything they did not have.
     *
     * It also means permission is NOT what stops anyone here — authentication
     * and scope are, and both are tested below. If a role is ever added without
     * `view_knowledge`, this flips and the next test proves the refusal works.
     */
    const roles = Object.keys(DEFAULT_PERMISSION_MATRIX) as (keyof typeof DEFAULT_PERMISSION_MATRIX)[];
    for (const role of roles) {
      expect(DEFAULT_PERMISSION_MATRIX[role], role).toContain("view_knowledge");
    }
  });

  it("refuses a caller whose role does not carry view_knowledge", async () => {
    /*
     * L. Exercised with a role the matrix does not grant it to. No such role
     * exists today (see above), so this proves the ROUTE refuses rather than
     * proving something about the current matrix — which is the property that
     * has to survive a future role being added.
     */
    const { route, trace } = await loadRoute({ role: "future_restricted_role" });
    const response = await route.GET(get(), params);

    expect(response.status).toBe(403);
    expect(trace.signed).toEqual([]);
  });

  it("asks for view_knowledge, not manage_knowledge", async () => {
    // Reading a document you may already read through Sunny is not managing it.
    const { route, trace } = await loadRoute();
    await route.GET(get(), params);
    expect(trace.authorized).toEqual(["view_knowledge"]);
  });

  it("lets a role that may read the knowledge base open the file", async () => {
    const { route } = await loadRoute({ role: "employee" });
    expect((await route.GET(get(), params)).status).toBe(200);
  });
});

describe("an id alone cannot cross a knowledge scope", () => {
  it("returns nothing for a document in another scope", async () => {
    // M.
    const { route, trace } = await loadRoute();
    const response = await route.GET(get("scope=another-corpus"), params);

    expect(response.status).toBe(404);
    expect(trace.signed).toEqual([]);
  });

  it("narrows the row query on both the id and the scope", async () => {
    // The mechanism behind it, so a refactor that dropped one filter fails.
    const { route, trace } = await loadRoute();
    await route.GET(get(), params);

    expect(trace.filters).toContainEqual(["id", DOC_ID]);
    expect(trace.filters).toContainEqual(["knowledge_scope_id", SCOPE]);
  });
});

describe("the browser cannot name a storage path", () => {
  it("has no path parameter to supply one through", () => {
    // N. Structural: the route reads a document id, a scope and a mode.
    const code = ROUTE_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/searchParams\.get\(\s*["'](path|key|object|file)["']/);
    expect(code).toMatch(/requireDocumentId/);
    expect(code).toMatch(/requireScopeId/);
  });

  it("ignores a path smuggled into the query string", async () => {
    const { route, trace } = await loadRoute();
    await route.GET(
      get(`scope=${SCOPE}&path=${encodeURIComponent("other-scope/secret/v1/x.pdf")}`),
      params,
    );

    expect(trace.signed).toHaveLength(1);
    expect(trace.signed[0]!.path).toBe(STORED_PATH);
  });

  it("re-validates the row's own path against the scope before signing", () => {
    // A row edited outside this app must not become a way out of its scope.
    const code = SERVICE_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).toMatch(/assertPathWithinScope\(\s*row\.storage_path,\s*input\.scopeId\s*\)/);
  });

  it("refuses a stored path that points outside the scope", async () => {
    const { route, trace } = await loadRoute({
      row: row({ storage_path: "another-corpus/x/v1/leak.pdf" }),
    });
    const response = await route.GET(get(), params);

    expect(response.status).toBe(409);
    expect(trace.signed).toEqual([]);
    expect(await response.text()).not.toContain("another-corpus");
  });
});

/* ------------------------------------------------------------- success -- */

describe("the download is the stored original", () => {
  it("signs the path recorded on the row", async () => {
    // O.
    const { route, trace } = await loadRoute();
    await route.GET(get(), params);
    expect(trace.signed[0]!.path).toBe(STORED_PATH);
  });

  it("returns a short-lived link rather than bytes", async () => {
    // P.
    const { route } = await loadRoute();
    const response = await route.GET(get(), params);
    const payload = (await response.json()) as { url: string; expiresInSeconds: number };

    expect(response.status).toBe(200);
    expect(payload.url).toContain("/object/sign/");
    expect(payload.expiresInSeconds).toBeGreaterThan(0);
    expect(payload.expiresInSeconds).toBeLessThanOrEqual(300);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("saves under the name the manager uploaded", async () => {
    // Q. Without this the browser saves a storage key.
    const { route, trace } = await loadRoute();
    await route.GET(get(`scope=${SCOPE}&mode=download`), params);

    expect(trace.signed[0]!.options).toEqual({ download: "Safety Binder.pdf" });
  });

  it("leaves a preview inline so a PDF renders instead of downloading", async () => {
    const { route, trace } = await loadRoute();
    await route.GET(get(`scope=${SCOPE}&mode=preview`), params);

    expect(trace.signed[0]!.options).toEqual({});
  });

  it("treats an unknown mode as a download rather than falling through to inline", async () => {
    const { route, trace } = await loadRoute();
    await route.GET(get(`scope=${SCOPE}&mode=whatever`), params);
    expect(trace.signed[0]!.options).toEqual({ download: "Safety Binder.pdf" });
  });

  it("never reads extracted text or chunks", () => {
    // X. A preview built from extraction would not be the file.
    const code = SERVICE_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/knowledge_chunks|character_count|extractDocument|chunkSegments/);
  });
});

describe("what a preview says about the file type", () => {
  it("marks a PDF previewable", async () => {
    // T.
    const { route } = await loadRoute();
    const payload = (await (await route.GET(get(), params)).json()) as {
      previewable: boolean;
    };
    expect(payload.previewable).toBe(true);
  });

  it("does not pretend a Word document can be rendered", async () => {
    // V.
    const { route } = await loadRoute({
      row: row({ file_type: "docx", original_filename: "Handbook.docx", mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }),
    });
    const payload = (await (await route.GET(get(), params)).json()) as {
      previewable: boolean;
      url: string;
    };

    expect(payload.previewable).toBe(false);
    // W. And the file is still obtainable.
    expect(payload.url).toContain("/object/sign/");
  });

  it("enforces the same scope and authorization in preview mode", async () => {
    // U.
    const unauth = await loadRoute({ role: null });
    expect((await unauth.route.GET(get(`scope=${SCOPE}&mode=preview`), params)).status).toBe(401);
    expect(unauth.trace.signed).toEqual([]);

    const crossScope = await loadRoute();
    expect(
      (await crossScope.route.GET(get("scope=another-corpus&mode=preview"), params)).status,
    ).toBe(404);
    expect(crossScope.trace.signed).toEqual([]);
  });
});

/* ------------------------------------------------------------ failures -- */

describe("failures are safe and readable", () => {
  it("says the document is gone when there is no row", async () => {
    const { route } = await loadRoute({ row: null });
    const response = await route.GET(get(), params);

    expect(response.status).toBe(404);
    expect((await response.json()).error).toContain("no longer exists");
  });

  it("says so when the row records no stored object", async () => {
    // R.
    const { route, trace } = await loadRoute({ row: row({ storage_path: null }) });
    const response = await route.GET(get(), params);

    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("no stored file");
    expect(trace.signed).toEqual([]);
  });

  it("does not echo a database error", async () => {
    const { route } = await loadRoute({
      rowError: { message: 'column "knowledge_scope_id" of relation "x" does not exist' },
    });
    const text = await (await route.GET(get(), params)).text();

    expect(text).not.toContain("knowledge_scope_id");
    expect(text).not.toContain("relation");
  });

  it("does not echo a storage error or the path when signing fails", async () => {
    // S.
    const { route } = await loadRoute({
      signError: { message: `Object not found: ${STORED_PATH}` },
    });
    const response = await route.GET(get(), params);
    const text = await response.text();

    expect(response.status).toBe(502);
    expect(text).not.toContain(STORED_PATH);
    expect(text).not.toContain("Safety Binder.pdf");
    expect(text).not.toContain("knowledge-documents");
  });

  it("never puts the secret key in a response", async () => {
    const { route } = await loadRoute({ signError: { message: "boom" } });
    const text = await (await route.GET(get(), params)).text();
    expect(text).not.toContain(process.env.SUPABASE_SECRET_KEY);
  });
});
