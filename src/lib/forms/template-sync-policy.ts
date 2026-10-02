/**
 * ============================================================================
 * WHERE THE CODE'S TEMPLATES MAY BE WRITTEN INTO THE DATABASE
 * ============================================================================
 *
 * `ensureTemplateLibrary` installs missing templates, publishes a newer seed
 * revision of a form, and renames a template — all from the TEMPLATE LIBRARY
 * THIS BUILD SHIPS, not from anything a person authored. It runs when an
 * administrator opens Forms → Form Templates, and on `POST /api/forms/templates`.
 *
 * PREVIEW AND PRODUCTION READ ONE SUPABASE DATABASE (see
 * `docs/production-demo-posture.md`). So a Preview deployment running a PR's
 * code could publish that PR's template revision into Production's library
 * before Production runs the code that revision is written for — new forms
 * would be filled against a document Production does not know how to draft or
 * print. Found in the PR #84 pre-merge review, where opening Form Templates on
 * the Preview would have published Corrective Action revision 5 early.
 *
 * THE RULE, decided from `VERCEL_ENV` (set by Vercel on every deployment), not
 * from a hostname:
 *
 *   production                  allowed — the deployment whose code the
 *                               shared database is meant to match.
 *   preview, development, or    refused. Fails CLOSED: a Vercel deployment
 *   on Vercel with no readable  that cannot say it is Production is treated
 *   environment                 as not Production. No switch overrides it.
 *   not on Vercel, under test   allowed — the suite runs against an in-memory
 *                               fake, never a real database.
 *   not on Vercel, otherwise    refused unless `FORMS_TEMPLATE_SYNC_ENABLED`
 *   (`next dev`, `next start`)  is on. The only Supabase project is
 *                               Production's, so a local build pointed at it
 *                               must opt in on purpose.
 *
 * WHAT THIS DOES NOT GOVERN. Publishing a draft a person authored — the
 * template editor's Publish, an uploaded document's proposal — publishes that
 * person's document, which does not depend on which build is running, and is
 * an explicit act reviewed by whoever clicks it. It is unchanged.
 *
 * Pure: reads only the environment it is handed.
 */

type Env = Readonly<Record<string, string | undefined>>;

/** The local opt-in. Never consulted on a Vercel deployment. */
export const TEMPLATE_SYNC_ENABLED_ENV = "FORMS_TEMPLATE_SYNC_ENABLED";

export type TemplateSyncDecision =
  | { allowed: true; environment: string }
  | { allowed: false; environment: string; reason: string };

function read(env: Env, name: string): string {
  return (env[name] ?? "").trim().toLowerCase();
}

function flag(env: Env, name: string): boolean {
  return ["true", "1", "yes", "on"].includes(read(env, name));
}

export function templateSyncDecision(env: Env = process.env): TemplateSyncDecision {
  /*
   * The server-side variable first; the browser-exposed twin is a fallback for
   * a project that exposes only that one. Both are set by Vercel itself.
   */
  const vercelEnv = read(env, "VERCEL_ENV") || read(env, "NEXT_PUBLIC_VERCEL_ENV");
  const onVercel = vercelEnv !== "" || read(env, "VERCEL") === "1";

  if (onVercel) {
    if (vercelEnv === "production") return { allowed: true, environment: "production" };
    const environment = vercelEnv || "unknown";
    return {
      allowed: false,
      environment,
      reason: `Template sync is off on this ${environment === "preview" ? "Preview" : `"${environment}"`} deployment. Preview and Production share one database, so only the Production deployment installs or publishes the template library. Nothing was installed, published or renamed.`,
    };
  }

  if (read(env, "NODE_ENV") === "test") return { allowed: true, environment: "test" };
  if (flag(env, TEMPLATE_SYNC_ENABLED_ENV)) return { allowed: true, environment: "local" };
  return {
    allowed: false,
    environment: "local",
    reason: `Template sync is off outside the Production deployment. Set ${TEMPLATE_SYNC_ENABLED_ENV}=true to sync a local build — only against a database that is not Production's. Nothing was installed, published or renamed.`,
  };
}
