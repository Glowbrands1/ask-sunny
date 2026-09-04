import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * NO EXTERNAL IDENTITY PROVIDER IS A FOUNDATIONAL DEPENDENCY.
 *
 * The constraint: Ask Sunny must work fully without Microsoft Entra ID, and
 * Entra access may never be available. Reporting, the dashboard, report
 * ingestion, knowledge/RAG and automation all run with no identity provider
 * configured at all.
 *
 * This is a lint over the source, and it is here because the failure mode is
 * WORDING rather than code. Nobody is going to add an Entra SDK by accident.
 * What happens instead is that a comment says "when Entra lands" or "replaced
 * by Entra", somebody reads it as a commitment, and a plan gets built on a
 * dependency that may never exist. The words are the defect, so the words are
 * what is checked.
 *
 * It also pins the two positive claims — that the machine credential is the
 * ingestion gate, and that Supabase Auth is the named default — because a
 * constraint with no stated alternative gets resolved by whoever is in the room.
 */

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

/**
 * Collapses comment wrapping so a phrase split across two lines still matches.
 *
 * Without this the guard passes or fails on where a line happened to wrap,
 * which is the kind of test that gets deleted rather than fixed.
 */
function flatten(text: string): string {
  return text.replace(/\n\s*\*\s?/g, " ").replace(/\s+/g, " ");
}

function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      found.push(...sourceFiles(path));
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry)) found.push(path);
  }
  return found;
}

/**
 * Wording that treats an external provider as a prerequisite.
 *
 * Phrased as "X is coming / X is required" patterns rather than the provider's
 * name, because naming Entra is fine — saying the system waits for it is not.
 */
const DEPENDENCY_PHRASINGS = [
  /when\s+(microsoft\s+)?entra\s+(id\s+)?(lands|arrives|ships)/i,
  /once\s+(microsoft\s+)?entra\s+(id\s+)?(lands|arrives|ships|is\s+available)/i,
  /replaced\s+(wholesale\s+)?by\s+(microsoft\s+)?entra/i,
  /requires?\s+(microsoft\s+)?entra\s+(id\s+)?(client\s+credentials|to\s+function)/i,
  /(depends?|dependent)\s+on\s+(microsoft\s+)?entra/i,
  /entra\s+is\s+required/i,
];

describe("no wording implies an external identity provider is required", () => {
  const files = sourceFiles(SRC);

  it("scans the source tree", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("carries no phrasing that makes Entra a prerequisite", () => {
    const offenders: string[] = [];
    for (const file of files) {
      // This file quotes the patterns it forbids, so it excludes itself.
      if (file.endsWith("provider-agnostic.test.ts")) continue;
      const text = flatten(readFileSync(file, "utf8"));
      for (const pattern of DEPENDENCY_PHRASINGS) {
        if (pattern.test(text)) {
          offenders.push(`${file.replace(ROOT + "/", "")}: ${pattern.source}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("says out loud, where Entra is mentioned at all, that it is optional", () => {
    /*
     * Three files may name it: the auth seam (as one candidate adapter), the
     * ingestion route (denying it is assumed), and the SharePoint stub (which
     * genuinely would need Graph access). Each must carry the qualification,
     * so a reader who lands on one of them cannot come away with the wrong
     * impression.
     */
    const mentions = files.filter(
      (file) =>
        !file.endsWith("provider-agnostic.test.ts") &&
        /Entra/.test(readFileSync(file, "utf8")),
    );
    expect(mentions.length).toBeGreaterThan(0);

    for (const file of mentions) {
      const text = flatten(readFileSync(file, "utf8"));
      expect(
        /optional|not\s+assumed|never\s+be\s+available|does\s+not\s+depend|additive/i.test(text),
        `${file.replace(ROOT + "/", "")} names Entra without qualifying it as optional`,
      ).toBe(true);
    }
  });
});

describe("the subsystems that must not need a provider", () => {
  it("authenticates report ingestion with a machine credential, not authorizeRequest", () => {
    const route = readFileSync(
      join(SRC, "app", "api", "admin", "reporting", "ingest", "route.ts"),
      "utf8",
    );
    expect(route).toContain("authorizeIngestRequest");
    expect(route).toContain("REPORTING_INGEST_SECRET");
    // The person-shaped guard has no answer for a scheduled pipeline.
    expect(route).not.toMatch(/\bawait\s+authorizeRequest\s*\(/);
  });

  it("keeps the ingestion credential off the client", () => {
    const credential = readFileSync(
      join(SRC, "lib", "reporting", "ingest-credential.ts"),
      "utf8",
    );
    // A client component importing this is a BUILD failure, not a review note.
    expect(credential).toMatch(/^import "server-only";/m);
    // It must not READ a browser-inlined variable. The prose above it says the
    // words "NEXT_PUBLIC_" on purpose, so the check is on the access, not the
    // string.
    expect(credential).not.toMatch(/process\.env\.NEXT_PUBLIC/);
    expect(credential).not.toMatch(/process\.env\[\s*["'`]NEXT_PUBLIC/);
  });

  it("reads reporting data server-side, so no caller identity is involved", () => {
    const repository = readFileSync(
      join(SRC, "lib", "reporting", "read", "reporting-read-repository.ts"),
      "utf8",
    );
    expect(repository).toMatch(/^import "server-only";/m);
  });

  it("selects a knowledge provider that needs no external identity provider", () => {
    /*
     * Retrieval runs on Supabase pgvector; SharePoint is additive, not the
     * index. Checked on the SELECTION rather than on whether the stub is
     * re-exported — the barrel exporting it is how the seam is published, and
     * proves nothing either way. What matters is that nothing can choose it.
     */
    const index = readFileSync(join(SRC, "lib", "knowledge", "index.ts"), "utf8");
    const selection = /getKnowledgeProvider\(\)[\s\S]*?\n}/.exec(index)?.[0] ?? "";
    expect(selection).not.toContain("SharePoint");
    expect(selection).toContain("RemoteKnowledgeProvider");
  });
});

describe("the named default for employee login", () => {
  it("names Supabase Auth as the IMPLEMENTED provider in the provider seam", () => {
    /*
     * This assertion used to look for "the default choice", which was the right
     * claim while no provider existed. Supabase Auth is now built, so the seam
     * has to say the stronger thing — and the assertion has to move with it,
     * or it would keep passing on a sentence that had become out of date.
     */
    const seam = flatten(readFileSync(join(SRC, "lib", "auth", "index.ts"), "utf8"));
    expect(seam).toMatch(/supabase auth is the implemented provider/i);
    // And still an ADAPTER, not a dependency: the constraint outlives the gap.
    expect(seam).toMatch(/any other provider is an optional adapter/i);
  });

  it("keeps the real provider's identification free of the privileged key", () => {
    /*
     * THE ASYMMETRIC MISTAKE. Identifying a caller with the secret-key client
     * would work perfectly and would read every row in the database for
     * whoever asked, because that client bypasses row level security. The real
     * provider must therefore reach only for the session client.
     */
    const provider = readFileSync(join(SRC, "lib", "auth", "supabase-provider.ts"), "utf8");
    expect(provider).not.toMatch(/getSupabaseAdmin/);
    expect(provider).not.toMatch(/SUPABASE_SECRET_KEY|SERVICE_ROLE/);
    expect(provider).toMatch(/getSupabaseSessionClientFor/);
    // getUser() validates with the auth server; getSession() only decodes.
    expect(provider).toMatch(/auth\.getUser\(\)/);
    expect(provider).not.toMatch(/auth\.getSession\(\)/);
  });

  it("lists supabase ahead of any optional adapter in the provider kinds", () => {
    // Order in a union is documentation. The default belongs first.
    const types = readFileSync(join(SRC, "lib", "auth", "types.ts"), "utf8");
    expect(types.indexOf('"supabase"')).toBeGreaterThan(-1);
    expect(types.indexOf('"supabase"')).toBeLessThan(types.indexOf('"entra_id"'));
  });

  it("states the constraint in the architecture documentation", () => {
    const doc = readFileSync(
      join(ROOT, "docs", "architecture-constraints.md"),
      "utf8",
    ).replace(/\s+/g, " ");
    expect(doc).toMatch(/must work fully without Microsoft Entra ID/i);
    expect(doc).toMatch(/may never be available/i);
    expect(doc).toMatch(/optional adapter/i);
    expect(doc).toMatch(/REPORTING_INGEST_SECRET/);
    expect(doc).toMatch(/Supabase Auth is the default choice/i);
  });
});
