import { SUN_TAN_CITY_LOGO } from "./sun-tan-city-logo";

/**
 * ============================================================================
 * THE APPROVED IMAGE ASSETS, AND THE ONLY WAY A DOCUMENT REACHES ONE
 * ============================================================================
 *
 * A template version names a logo by KEY. This registry is what a key resolves
 * to, and it is a closed list: the only images a printed form can ever carry
 * are the ones committed here, having come from an authoritative source
 * document. There is no path from stored template JSON — which an administrator
 * can edit — to arbitrary bytes on a signed HR record, and no path to the
 * network at render time either.
 *
 * BUNDLED RATHER THAN FETCHED, DELIBERATELY. The alternative was a row in
 * `form_template_assets` plus a Storage read on every download. That buys
 * nothing here and costs a network round trip inside PDF generation, plus a new
 * failure mode whose symptom is a corporate document printing without its logo.
 * These bytes ship with the deployment, so Preview and Production render the
 * same mark with no fetch and nothing to go wrong. `form_template_assets`
 * continues to do its own job — holding the official REFERENCE COPY of each
 * form — and is not repurposed.
 *
 * ADDING AN ASSET IS ADDING A ROW HERE. Nothing about this file is specific to
 * one brand or one template: the renderer asks for a key, and a version decides
 * which key. No code in the render path names a template.
 */

export interface ImageAsset {
  key: string;
  label: string;
  sha256: string;
  width: number;
  height: number;
  source: string;
  base64: string;
}

const REGISTRY: Record<string, ImageAsset> = {
  [SUN_TAN_CITY_LOGO.key]: SUN_TAN_CITY_LOGO,
};

/** Every approved asset, for tests and for an administrator's picker. */
export function imageAssets(): ImageAsset[] {
  return Object.values(REGISTRY);
}

/**
 * Resolves a key to an approved asset, or `null`.
 *
 * NULL RATHER THAN THROWING. A logo that cannot be resolved must not stop a
 * manager downloading a disciplinary record; the form prints without the mark
 * and the rest of the page is unchanged. A missing asset is a deployment
 * mistake to fix, not a reason to withhold the document.
 */
export function resolveImageAsset(key: string): ImageAsset | null {
  return REGISTRY[key] ?? null;
}

/** The decoded PNG bytes. Cached, because a PDF download should not re-decode. */
const decoded = new Map<string, Uint8Array>();

export function imageAssetBytes(asset: ImageAsset): Uint8Array {
  const cached = decoded.get(asset.key);
  if (cached) return cached;
  const binary = Buffer.from(asset.base64, "base64");
  const bytes = Uint8Array.from(binary);
  decoded.set(asset.key, bytes);
  return bytes;
}
