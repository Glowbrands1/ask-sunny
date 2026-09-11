import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ACTIVE_BRAND, BCS_BRAND_DRAFT } from "@/lib/brand";
import { DEFAULT_PERMISSION_MATRIX } from "@/lib/permissions";

/**
 * ============================================================================
 * THE BROWSER DOES NOT CHOOSE WHICH COMPANY'S KNOWLEDGE IT IS TOUCHING
 * ============================================================================
 *
 * SIX ROUTES TOOK THE CORPUS FROM THE REQUEST and validated it with
 * `requireScopeId`, which checks the SHAPE of a scope id and nothing else.
 * `bcs-core` passes that check because it is a real corpus: `src/lib/brand`
 * defines Buff City Soap alongside Sun Tan City.
 *
 * So an authenticated Sun Tan City manager, holding every permission they are
 * meant to hold, could name another company's corpus and have the server use
 * it — to LIST it, SEARCH it, UPLOAD into it, RE-INDEX it, DOWNLOAD from it or
 * DELETE from it. `authorizeRequest` proves who the caller is and what they may
 * do; it says nothing about which company this build serves.
 *
 * ============================================================================
 * WHY EACH TEST SEEDS BOTH CORPORA
 * ============================================================================
 *
 * The first version of the file-route suite seeded only the Sun Tan City row,
 * so a foreign document id matched nothing WHATEVER the route did with the
 * scope — and its "cross-scope" test passed against a route that was reading the
 * caller's corpus. A cross-corpus test that cannot express the attack proves
 * nothing.
 *
 * So every fixture here holds real foreign data, and each group asserts the
 * foreign data is genuinely reachable when the corpus asks for it, before
 * asserting the browser cannot make the corpus ask.
 */

const STC = ACTIVE_BRAND.knowledgeScopeId;
const BCS = BCS_BRAND_DRAFT.knowledgeScopeId;

const STC_DOC = "8f14e45f-ceea-4e78-b2a7-1c1b1a2b3c4d";
const BCS_DOC = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";

const ORIGINAL = { ...process.env };

/** Every corpus-bearing route's source, comments stripped. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const ROUTES = {
  list: "src/app/api/knowledge/documents/route.ts",
  delete: "src/app/api/knowledge/documents/[id]/route.ts",
  reindex: "src/app/api/knowledge/documents/[id]/reindex/route.ts",
  search: "src/app/api/knowledge/search/route.ts",
  upload: "src/app/api/knowledge/upload/route.ts",
  file: "src/app/api/knowledge/documents/[id]/file/route.ts",
  chat: "src/app/api/chat/route.ts",
} as const;

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
  for (const mod of [
    "@/lib/auth/server",
    "@/lib/knowledge/providers/supabase",
    "@/lib/ingestion/lifecycle",
    "@/lib/ingestion/pipeline",
    "@/lib/ai/server-ask",
  ]) {
    vi.doUnmock(mod);
  }
  vi.resetModules();
});

/** A signed-in Sun Tan City manager holding everything they legitimately hold. */
function mockAuth(role = "district_manager") {
  vi.doMock("@/lib/auth/server", async () => {
    const { AuthError } = await import("@/lib/auth/types");
    return {
      authorizeRequest: async (_request: Request, permission: string) => {
        const granted =
          DEFAULT_PERMISSION_MATRIX[role as keyof typeof DEFAULT_PERMISSION_MATRIX];
        if (!granted?.includes(permission as never)) {
          throw new AuthError("forbidden", "Your role does not have permission to do that.");
        }
        /*
         * `displayName` is part of `AuthenticatedIdentity` and the upload route
         * reads it to attribute a document to the person who uploaded it. A
         * double missing it is a double that lies about the contract.
         */
        return {
          identity: { role, subject: "u1", displayName: "Test Uploader" },
          permission,
          provider: "supabase",
        };
      },
    };
  });
}

/* ======================================================= the two corpora == */

describe("the fixture's two corpora are real and different", () => {
  it("names Buff City Soap, not some invented brand", () => {
    // The Phase 1.1 write-up called `bcs` "Beach Comber Suns". It is Buff City
    // Soap, and the corpus id in these tests is read from the brand config
    // rather than typed, so the two cannot drift again.
    expect(BCS_BRAND_DRAFT.brandName).toBe("Buff City Soap");
    expect(BCS).toBe("bcs-core");
    expect(STC).toBe("stc-core");
    expect(BCS).not.toBe(STC);
  });
});

/* =============================================================== listing == */

describe("listing cannot be pointed at another corpus", () => {
  async function load() {
    vi.resetModules();
    mockAuth();
    const listed: (string | undefined)[] = [];

    vi.doMock("@/lib/knowledge/providers/supabase", () => ({
      SupabaseKnowledgeProvider: class {
        async listDocuments(scopeId?: string) {
          listed.push(scopeId);
          // A REAL TWO-CORPUS LIBRARY. Ask for Buff City Soap's corpus and you
          // get Buff City Soap's document — which is what makes the refusal
          // below meaningful rather than vacuous.
          return scopeId === BCS
            ? [{ id: BCS_DOC, title: "Buff City Soap Handbook" }]
            : [{ id: STC_DOC, title: "Sun Tan City Safety Binder" }];
        }
      },
    }));

    const route = await import("./documents/route");
    return { route, listed };
  }

  it("returns Buff City Soap's document when its corpus is asked for", async () => {
    // The guard on the guard: the fixture can express the attack.
    const { listed } = await load();
    const { SupabaseKnowledgeProvider } = await import("@/lib/knowledge/providers/supabase");
    const rows = await new SupabaseKnowledgeProvider().listDocuments(BCS);

    expect(listed).toEqual([BCS]);
    expect(rows[0]!.title).toContain("Buff City Soap");
  });

  it("lists this build's corpus however the scope query is set", async () => {
    for (const query of ["", `?scope=${BCS}`, "?scope=stc-core", "?scope="]) {
      const { route, listed } = await load();
      const response = await route.GET(
        new Request(`https://app.test/api/knowledge/documents${query}`),
      );
      const payload = (await response.json()) as { documents: { title: string }[] };

      expect(listed, `query "${query}"`).toEqual([STC]);
      expect(payload.documents[0]!.title, `query "${query}"`).toContain("Sun Tan City");
    }
  });

  it("reads no scope from the request", () => {
    expect(code(ROUTES.list)).not.toMatch(/searchParams\.get\(\s*["']scope["']/);
    expect(code(ROUTES.list)).toContain("activeKnowledgeCorpus()");
  });

  it("authorizes the permission the Knowledge Base page requires", async () => {
    /*
     * This route backed a `view_knowledge` page while asking only for
     * `ask_questions`. Every role holds both today so no access changes — the
     * route now states the permission it actually implements.
     */
    expect(code(ROUTES.list)).toContain('authorizeRequest(request, "view_knowledge")');

    vi.resetModules();
    mockAuth("employee");
    vi.doMock("@/lib/knowledge/providers/supabase", () => ({
      SupabaseKnowledgeProvider: class {
        async listDocuments() {
          return [];
        }
      },
    }));
    const route = await import("./documents/route");
    expect(
      (await route.GET(new Request("https://app.test/api/knowledge/documents"))).status,
    ).toBe(200);
  });
});

/* ================================================================ delete == */

describe("deleting cannot be pointed at another corpus", () => {
  async function load() {
    vi.resetModules();
    mockAuth();
    const deleted: { documentId: string; scopeId: string }[] = [];

    vi.doMock("@/lib/ingestion/lifecycle", () => ({
      deleteDocument: async (input: { documentId: string; scopeId: string }) => {
        // The real one refuses a document outside the scope it is given. This
        // fake records the corpus the ROUTE chose, which is the thing on trial.
        deleted.push(input);
        return { deletedObjects: 1 };
      },
    }));

    const route = await import("./documents/[id]/route");
    return { route, deleted };
  }

  it("never asks to delete from the foreign corpus, whatever the query says", async () => {
    // DESTRUCTIVE, so this is the highest-priority of the six.
    for (const query of [`?scope=${BCS}`, "", `?scope=${BCS}&scope=${STC}`]) {
      const { route, deleted } = await load();
      await route.DELETE(
        new Request(`https://app.test/api/knowledge/documents/${BCS_DOC}${query}`, {
          method: "DELETE",
          headers: { "x-forwarded-for": "10.0.0.9" },
        }),
        { params: Promise.resolve({ id: BCS_DOC }) },
      );

      expect(deleted.map((entry) => entry.scopeId), `query "${query}"`).toEqual([STC]);
    }
  });

  it("reads no scope from the request", () => {
    expect(code(ROUTES.delete)).not.toMatch(/searchParams\.get\(\s*["']scope["']/);
    expect(code(ROUTES.delete)).toContain("activeKnowledgeCorpus()");
  });
});

/* =============================================================== reindex == */

describe("re-indexing cannot be pointed at another corpus", () => {
  async function load() {
    vi.resetModules();
    mockAuth();
    const calls: { documentId: string; scopeId: string; force?: boolean }[] = [];

    vi.doMock("@/lib/ingestion/lifecycle", () => ({
      reindexDocument: async (input: { documentId: string; scopeId: string; force?: boolean }) => {
        calls.push(input);
        return { document: { id: input.documentId }, chunkCount: 3, reusedExistingEmbeddings: false };
      },
    }));

    const route = await import("./documents/[id]/reindex/route");
    return { route, calls };
  }

  function post(body: unknown, id = BCS_DOC) {
    return new Request(`https://app.test/api/knowledge/documents/${id}/reindex`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "10.0.0.11" },
      body: JSON.stringify(body),
    });
  }

  it("processes only this build's corpus, even when the body names the real other one", async () => {
    const { route, calls } = await load();
    await route.POST(post({ scopeId: BCS, force: true }), {
      params: Promise.resolve({ id: BCS_DOC }),
    });

    expect(calls[0]!.scopeId).toBe(STC);
  });

  it("still lets the caller choose force", async () => {
    // The corpus is not the caller's. `force` is.
    for (const force of [true, false]) {
      const { route, calls } = await load();
      await route.POST(post({ scopeId: BCS, force }), {
        params: Promise.resolve({ id: STC_DOC }),
      });
      expect(calls[0]!.force, String(force)).toBe(force);
      expect(calls[0]!.scopeId).toBe(STC);
    }
  });

  it("reads no scope from the body", () => {
    expect(code(ROUTES.reindex)).not.toMatch(/body\.scopeId/);
    expect(code(ROUTES.reindex)).toContain("activeKnowledgeCorpus()");
  });
});

/* ================================================================ search == */

describe("search cannot be pointed at another corpus", () => {
  async function load() {
    vi.resetModules();
    mockAuth();
    const queried: { scopeId: string; query: string }[] = [];

    // The route constructs this provider directly, so this is the module the
    // corpus actually reaches.
    vi.doMock("@/lib/knowledge/providers/supabase", () => ({
      SupabaseKnowledgeProvider: class {
        async match(input: { query: string; scopeId: string }) {
          queried.push(input);
          /*
           * REAL FOREIGN CONTENT, retrievable when its corpus is queried. A
           * fixture that returned nothing for `bcs-core` would let this pass
           * against a route that searched it.
           */
          return input.scopeId === BCS
            ? [{ chunkId: "bcs-1", documentId: "d-bcs", documentTitle: "Buff City Soap Handbook", locator: "Page 1", content: "BCS CONFIDENTIAL soap policy", similarity: 0.99, category: "policies", page: 1, section: null }]
            : [{ chunkId: "stc-1", documentId: "d-stc", documentTitle: "Sun Tan City Safety Binder", locator: "Page 1", content: "Bed sanitising standard", similarity: 0.95, category: "policies", page: 1, section: null }];
        }
      },
    }));

    const route = await import("./search/route");
    return { route, queried };
  }

  function post(body: unknown) {
    return new Request("https://app.test/api/knowledge/search", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "10.0.0.12" },
      body: JSON.stringify(body),
    });
  }

  it("retrieves Buff City Soap content when its corpus is queried", async () => {
    // The guard on the guard.
    const { queried } = await load();
    const { SupabaseKnowledgeProvider } = await import("@/lib/knowledge/providers/supabase");
    const rows = await new SupabaseKnowledgeProvider().match({
      query: "soap",
      scopeId: BCS,
      limit: 3,
    });

    expect(queried[0]!.scopeId).toBe(BCS);
    expect(rows[0]!.content).toContain("BCS CONFIDENTIAL");
  });

  it("searches only this build's corpus and returns no foreign text", async () => {
    const { route, queried } = await load();
    const response = await route.POST(post({ query: "soap policy", scopeId: BCS }));
    const body = await response.text();

    expect(queried.map((entry) => entry.scopeId)).toEqual([STC]);
    expect(body).not.toContain("BCS CONFIDENTIAL");
    expect(body).not.toContain("Buff City Soap");
  });

  it("reads no scope from the body", () => {
    expect(code(ROUTES.search)).not.toMatch(/body\.scopeId/);
    expect(code(ROUTES.search)).toContain("activeKnowledgeCorpus()");
  });
});

/* ================================================================ upload == */

describe("upload cannot be pointed at another corpus", () => {
  async function load() {
    vi.resetModules();
    mockAuth();
    const ingested: { scopeId: string; title: string }[] = [];

    vi.doMock("@/lib/ingestion/pipeline", () => ({
      ingestDocument: async (input: { scopeId: string; title: string }) => {
        ingested.push(input);
        return { document: { id: STC_DOC, title: input.title }, chunkCount: 4, reusedExistingEmbeddings: false };
      },
    }));

    const route = await import("./upload/route");
    return { route, ingested };
  }

  function upload(scopeId?: string) {
    const form = new FormData();
    form.set("file", new File(["%PDF-1.4 fixture"], "policy.pdf", { type: "application/pdf" }));
    form.set("title", "Uploaded Policy");
    form.set("category", "policies");
    if (scopeId !== undefined) form.set("scopeId", scopeId);
    return new Request("https://app.test/api/knowledge/upload", {
      method: "POST",
      headers: { "x-forwarded-for": "10.0.0.13" },
      body: form,
    });
  }

  it("writes into this build's corpus even when the form names another", async () => {
    // A WRITE. A caller-chosen corpus here puts this company's document into
    // another company's knowledge base.
    const { route, ingested } = await load();
    await route.POST(upload(BCS));

    expect(ingested).toHaveLength(1);
    expect(ingested[0]!.scopeId).toBe(STC);
  });

  it("writes into this build's corpus when no scope is sent at all", async () => {
    const { route, ingested } = await load();
    await route.POST(upload());
    expect(ingested[0]!.scopeId).toBe(STC);
  });

  it("reads no scope from the form", () => {
    expect(code(ROUTES.upload)).not.toMatch(/form\.get\(\s*["']scopeId["']/);
    expect(code(ROUTES.upload)).toContain("activeKnowledgeCorpus()");
  });
});

/* ================================================================== chat == */

describe("chat cannot be pointed at another corpus", () => {
  async function load() {
    vi.resetModules();
    mockAuth();
    const asked: { scopeId: string; question: string }[] = [];

    vi.doMock("@/lib/ai/server-ask", () => ({
      answerQuestion: async (request: { scopeId: string; question: string }) => {
        asked.push(request);
        return { content: "answer", citations: [], coverage: "grounded" };
      },
    }));

    const route = await import("../chat/route");
    return { route, asked };
  }

  function ask(body: Record<string, unknown>) {
    return new Request("https://app.test/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "10.0.0.14" },
      body: JSON.stringify({ question: "what is the soap policy?", ...body }),
    });
  }

  it("grounds on this build's corpus even when the body names the real other one", async () => {
    /*
     * THE MOST IMPORTANT OF THE SIX. Chat retrieves without the caller naming a
     * document, so a caller-chosen corpus turns a question into a search of
     * another company's policies with the answer quoting them back.
     */
    const { route, asked } = await load();
    await route.POST(ask({ scopeId: BCS }));

    expect(asked).toHaveLength(1);
    expect(asked[0]!.scopeId).toBe(STC);
  });

  it("grounds on this build's corpus with no scope sent", async () => {
    const { route, asked } = await load();
    await route.POST(ask({}));
    expect(asked[0]!.scopeId).toBe(STC);
  });

  it("leaves the rest of the request the caller's", async () => {
    // Only the corpus authority moved. Mode, history and context are unchanged.
    const { route, asked } = await load();
    await route.POST(ask({ scopeId: BCS, mode: "detailed" }));

    const request = asked[0] as unknown as { mode: string; question: string };
    expect(request.mode).toBe("detailed");
    expect(request.question).toBe("what is the soap policy?");
  });

  it("reads no scope from the body", () => {
    expect(code(ROUTES.chat)).not.toMatch(/body\.scopeId/);
    expect(code(ROUTES.chat)).toContain("activeKnowledgeCorpus()");
  });
});

/* ============================================================== the sweep == */

describe("no knowledge route reads a corpus from the request", () => {
  it.each(Object.entries(ROUTES))("%s", (_name, path) => {
    const source = code(path);
    expect(source).not.toMatch(/searchParams\.get\(\s*["']scope["']/);
    expect(source).not.toMatch(/body\.scopeId/);
    expect(source).not.toMatch(/form\.get\(\s*["']scopeId["']/);
    expect(source).not.toMatch(/requireScopeId/);
  });

  /**
   * ==========================================================================
   * THE CORPUS IS THE BRAND'S. AN ACCESSSCOPE IS SOMETHING ELSE ENTIRELY.
   * ==========================================================================
   *
   * This assertion used to be "the string `identity.scope` appears nowhere in
   * any of these routes", which was a proxy for the real rule and has now been
   * outgrown: `/api/chat` reads `identity.scope` legitimately, to decide which
   * SALON a form proposal may name — a question about the caller's assignment,
   * not about which company's documents get searched.
   *
   * So the rule is asserted directly instead of by proximity. EVERY assignment
   * of a corpus, in every one of these routes, must read the brand helper; a
   * scope value reaching one would fail here whatever it was called and
   * wherever in the file it came from.
   *
   * `primaryAreaId` and `alsoCovers` stay banned outright. They are salon-roster
   * internals, and no knowledge route has any business touching them.
   */
  it("derives every corpus from the brand, never from the user's AccessScope", () => {
    for (const path of Object.values(ROUTES)) {
      const source = code(path);
      expect(source, path).toContain("activeKnowledgeCorpus()");
      expect(source, path).not.toMatch(/primaryAreaId|alsoCovers/);

      const assignments = source.match(/scopeId\s*[:=]\s*[^,;\n]+/g) ?? [];
      expect(assignments.length, `${path} assigns no corpus`).toBeGreaterThan(0);
      for (const assignment of assignments) {
        expect(assignment.trim(), path).toContain("activeKnowledgeCorpus()");
      }
    }
  });

  /**
   * The one route that reads a scope, and what it is allowed to do with it.
   *
   * Named explicitly rather than covered by a blanket ban, so that a future
   * edit which starts reading a scope in a SECOND knowledge route has to come
   * back here and say why.
   */
  it("reads an AccessScope in chat only, and never near the corpus", () => {
    for (const [name, path] of Object.entries(ROUTES)) {
      const source = code(path);
      if (name === "chat") continue;
      expect(source, path).not.toMatch(/identity\.scope/);
    }

    const chat = code(ROUTES.chat);
    // It exists, and it goes to the answer's ACTOR — the argument that decides
    // which salon a form proposal may name.
    expect(chat).toMatch(/scope:\s*context\.identity\.scope/);
    // And the corpus argument beside it still comes from the brand.
    expect(chat).toMatch(/scopeId:\s*activeKnowledgeCorpus\(\)/);
  });
});
