/**
 * ============================================================================
 * TEMPLATE_SEED_OVERRIDE: ONE NAMED REVISION MAY BE PUBLISHED OVER A VERSION A
 * PERSON AUTHORED (Pau, 5 Nov 2026; default off)
 * ============================================================================
 *
 * The template sync never publishes over a version an administrator authored
 * (`seed_revision` 0): it reports the template under `heldBack`
 * (`repository.ts` publishSeedRevision). Production's Corrective Action Form
 * is such a version (v7, published 22 Oct 2026), so revision 8 — the Type of
 * Offense HR approved — was held back, and the editor has no way to apply a
 * seed revision to a draft.
 *
 * This is the deliberate, one-shot way through: an environment variable that
 * names the template key and the revision, e.g. `TEMPLATE_SEED_OVERRIDE=dpoa:8`
 * (several: `dpoa:8,coaching:3`). Only that key at exactly that revision is
 * published over an authored version; the old version is archived, never
 * edited or deleted, so every form filed on it keeps its document. An open
 * draft still holds the publish back. Unset, nothing changes.
 *
 * It is read where the sync runs (the Production deployment only, see
 * `template-sync-policy.ts`), and it is meant to be set for one visit to Forms
 * → Form Templates and then removed. Once the revision is stored, a second
 * visit publishes nothing (the stored revision is the seed's).
 */
export const TEMPLATE_SEED_OVERRIDE_ENV = "TEMPLATE_SEED_OVERRIDE";

/** Whether the environment names exactly this template key at exactly this revision. */
export function seedOverrideAllows(
  key: string,
  revision: number,
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  const raw = env[TEMPLATE_SEED_OVERRIDE_ENV];
  if (typeof raw !== "string" || raw.trim() === "") return false;
  return raw.split(",").some((entry) => {
    const match = /^\s*([a-z0-9_-]+)\s*:\s*(\d+)\s*$/i.exec(entry);
    return match !== null && match[1] === key && Number(match[2]) === revision;
  });
}
