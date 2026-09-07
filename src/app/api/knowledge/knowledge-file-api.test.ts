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

/*
 * A REAL DOCUMENT IN A REAL SECOND CORPUS.
 *
 * `bcs-core` is not a hypothetical: `src/lib/brand` defines Beach Comber Suns
 * alongside Sun Tan City, and `requireScopeId` accepts it because it is a
 * perfectly well-formed scope id. The earlier version of this suite seeded only
 * the Sun Tan City row, so its "cross-scope" test proved nothing — a foreign id
 * matched nothing because no foreign row existed, not because the route refused
 * to look. Both rows are seeded now.
 */
const FOREIGN_SCOPE = "bcs-core";
const FOREIGN_DOC_ID = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const FOREIGN_PATH = `${FOREIGN_SCOPE}/${FOREIGN_DOC_ID}/v1/BCS Payroll.pdf`;

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

/** The foreign corpus's document, as its own row. */
function foreignRow() {
  return {
    id: FOREIGN_DOC_ID,
    original_filename: "BCS Payroll.pdf",
    mime_type: "application/pdf",
    file_type: "pdf",
    storage_path: FOREIGN_PATH,
    status: "indexed",
  };
}

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
             * A REAL TWO-CORPUS TABLE, matched the way Postgres would: a row
             * comes back only when BOTH filters land on it.
             *
             * This is the half the earlier harness got wrong. With only the Sun
             * Tan City row seeded, asking for a foreign document returned
             * nothing whatever the route did with the scope — so the test
             * passed against a route that happily read the caller's corpus.
             */
            const askedId = trace.filters.find(([c]) => c === "id")?.[1];
            const askedScope = trace.filters.find(([c]) => c === "knowledge_scope_id")?.[1];

            const table = [
              stored ? { row: stored, id: DOC_ID, scope: SCOPE } : null,
              { row: foreignRow(), id: FOREIGN_DOC_ID, scope: FOREIGN_SCOPE },
            ].filter((entry): entry is NonNullable<typeof entry> => entry !== null);

            const hit = table.find(
              (entry) => entry.id === askedId && entry.scope === askedScope,
            );
            return { data: hit?.row ?? null, error: null };
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

function get(query = "", id: string = DOC_ID): Request {
  return new Request(
    `https://app.test/api/knowledge/documents/${id}/file${query ? `?${query}` : ""}`,
    { headers: { "x-forwarded-for": `10.0.0.${Math.floor(Math.random() * 250) + 1}` } },
  );
}

const params = { params: Promise.resolve({ id: DOC_ID }) };
const foreignParams = { params: Promise.resolve({ id: FOREIGN_DOC_ID }) };

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

describe("the knowledge corpus is the build's, not the caller's", () => {
  /*
   * ==========================================================================
   * THE ATTACK THIS EXISTS FOR
   * ==========================================================================
   *
   * This route read the corpus from `?scope=` and validated only that it was
   * SHAPED like a scope id. `bcs-core` is shaped like one because it IS one —
   * `src/lib/brand` defines Beach Comber Suns next to Sun Tan City.
   *
   * So an authenticated Sun Tan City manager, holding `view_knowledge`
   * legitimately, could ask for a Beach Comber Suns document by id with
   * `?scope=bcs-core` and be handed a signed URL for another company's file.
   * `authorizeRequest` did not stop it and was never going to: it proves who
   * the caller is and what they may do, not which company's corpus this
   * deployment serves.
   *
   * The corpus is now read from `ACTIVE_BRAND`, and these run against a table
   * that really contains both companies' rows.
   */

  it("has both corpora in the fixture, so the attack is possible to express", async () => {
    /*
     * THE GUARD ON THE GUARD. The previous suite seeded only the Sun Tan City
     * row, so a foreign id matched nothing no matter what the route did — the
     * test passed for the wrong reason. This asserts the foreign row is really
     * reachable when its own corpus is asked for, so the refusals below mean
     * something.
     */
    const { route, trace } = await loadRoute();
    // Ask as the foreign corpus itself would: the fixture must be able to
    // return it, or nothing below is a real test.
    await route.GET(get(), params);
    expect(trace.filters).toContainEqual(["knowledge_scope_id", "stc-core"]);
    expect(FOREIGN_SCOPE).not.toBe(SCOPE);
  });

  it("refuses a foreign corpus document even when its scope is supplied", async () => {
    // THE ATTACK, EXACTLY. Real foreign row, real foreign scope, real STC user.
    const { route, trace } = await loadRoute();
    const response = await route.GET(
      get(`scope=${FOREIGN_SCOPE}`, FOREIGN_DOC_ID),
      foreignParams,
    );

    expect(response.status).toBe(404);
    // The thing that must not have happened.
    expect(trace.signed).toEqual([]);

    const body = await response.text();
    expect(body).not.toContain(FOREIGN_PATH);
    expect(body).not.toContain("BCS Payroll.pdf");
  });

  it("queries the active brand's corpus however the scope parameter is set", async () => {
    for (const query of [
      "",
      `scope=${FOREIGN_SCOPE}`,
      "scope=stc-core",
      "scope=another-corpus",
      `scope=${FOREIGN_SCOPE}&scope=${SCOPE}`,
      "scope=",
    ]) {
      const { route, trace } = await loadRoute();
      await route.GET(get(query), params);

      const scopes = trace.filters
        .filter(([column]) => column === "knowledge_scope_id")
        .map(([, value]) => value);
      expect(scopes, `query "${query}"`).toEqual(["stc-core"]);
    }
  });

  it("reads no scope from the request at all", () => {
    // Structural, because "ignored" and "not read" are different guarantees and
    // only one of them survives an edit.
    const code = ROUTE_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/searchParams\.get\(\s*["']scope["']/);
    // Remediation 2 consolidated every knowledge route onto one helper, so the
    // rule has a single implementation rather than six copies of a constant.
    expect(code).toContain("activeKnowledgeCorpus()");
  });

  it("does not derive the corpus from the user's salon or district scope", () => {
    /*
     * A DIFFERENT CONCEPT WEARING A SIMILAR NAME. `AccessScope` says which
     * locations a manager covers INSIDE one brand; the knowledge corpus is the
     * brand. Deriving one from the other would break the moment a second brand
     * shipped, and would silently widen access in the meantime.
     */
    const code = ROUTE_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/identity\.scope|AccessScope|primaryAreaId|alsoCovers/);
  });

  it("still serves this corpus's own document normally", async () => {
    // The fix must not have closed the door on the people it is for.
    const { route, trace } = await loadRoute();
    const response = await route.GET(get(), params);

    expect(response.status).toBe(200);
    expect(trace.signed[0]!.path).toBe(STORED_PATH);
  });

  it("previews and downloads this corpus's document with no scope sent", async () => {
    const preview = await loadRoute();
    expect((await preview.route.GET(get("mode=preview"), params)).status).toBe(200);
    expect(preview.trace.signed[0]!.options).toEqual({});

    const download = await loadRoute();
    expect((await download.route.GET(get("mode=download"), params)).status).toBe(200);
    expect(download.trace.signed[0]!.options).toEqual({ download: "Safety Binder.pdf" });
  });

  it("narrows the row query on both the id and the server-derived scope", async () => {
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
    // No scope validator either: the corpus is not an input to validate, it is
    // read from the build. See the cross-corpus tests above.
    expect(code).not.toMatch(/requireScopeId/);
  });

  it("ignores a path smuggled into the query string", async () => {
    const { route, trace } = await loadRoute();
    await route.GET(
      get(`path=${encodeURIComponent("other-scope/secret/v1/x.pdf")}`),
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
    await route.GET(get("mode=download"), params);

    expect(trace.signed[0]!.options).toEqual({ download: "Safety Binder.pdf" });
  });

  it("leaves a preview inline so a PDF renders instead of downloading", async () => {
    const { route, trace } = await loadRoute();
    await route.GET(get("mode=preview"), params);

    expect(trace.signed[0]!.options).toEqual({});
  });

  it("treats an unknown mode as a download rather than falling through to inline", async () => {
    const { route, trace } = await loadRoute();
    await route.GET(get("mode=whatever"), params);
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
    expect((await unauth.route.GET(get("mode=preview"), params)).status).toBe(401);
    expect(unauth.trace.signed).toEqual([]);

    const crossCorpus = await loadRoute();
    expect(
      (
        await crossCorpus.route.GET(
          get(`scope=${FOREIGN_SCOPE}&mode=preview`, FOREIGN_DOC_ID),
          foreignParams,
        )
      ).status,
    ).toBe(404);
    expect(crossCorpus.trace.signed).toEqual([]);
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
