import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { sanitizeFileName } from "@/lib/ingestion/paths";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { REPORTING_BUCKET } from "./supabase-reporting-repository";

/**
 * THE PRIVATE SOURCE-FILE STORE.
 *
 * Raw comp reports carry salon-level financials and manager names, so the
 * `reporting-sources` bucket is private, has no `storage.objects` policies at
 * all, and every download is a short-lived signed URL minted server-side. This
 * module never mints one and never logs a byte of content.
 */

export interface ReportSourceStorage {
  upload(input: { path: string; bytes: Uint8Array; contentType: string }): Promise<void>;
  exists(path: string): Promise<boolean>;
}

/**
 * Collision-safe object key, derived entirely on the server.
 *
 * `<family>/<grain>-<periodEnd>/<sha16>/<safe name>`
 *
 * The content hash is in the path on purpose: the same bytes always resolve to
 * the same key, so a retry overwrites itself rather than accumulating copies,
 * and two genuinely different files for one period cannot collide however they
 * are named. The period is in the path so an operator can find a month's raw
 * artifacts without querying anything.
 */
export function buildReportStoragePath(input: {
  reportFamily: string;
  grain: string;
  periodEnd: string;
  sha256: string;
  originalFilename: string;
}): string {
  const family = input.reportFamily.replace(/[^a-z0-9_]/gi, "") || "report";
  const safeName = sanitizeFileName(input.originalFilename, "workbook.xlsx");
  return [
    family,
    `${input.grain}-${input.periodEnd}`,
    input.sha256.slice(0, 16),
    safeName,
  ].join("/");
}

export class SupabaseReportSourceStorage implements ReportSourceStorage {
  private readonly client: SupabaseClient;
  private readonly bucket: string;

  constructor(client: SupabaseClient = getSupabaseAdmin(), bucket = REPORTING_BUCKET) {
    this.client = client;
    this.bucket = bucket;
  }

  async upload(input: { path: string; bytes: Uint8Array; contentType: string }): Promise<void> {
    const { error } = await this.client.storage.from(this.bucket).upload(input.path, input.bytes, {
      contentType: input.contentType,
      // Idempotent: the path is derived from the content hash, so an overwrite
      // can only ever replace identical bytes.
      upsert: true,
    });
    if (error) {
      // The message may name the bucket and path; never the contents.
      throw new Error(`Could not store the source workbook: ${error.message}`);
    }
  }

  async exists(path: string): Promise<boolean> {
    const slash = path.lastIndexOf("/");
    const folder = slash === -1 ? "" : path.slice(0, slash);
    const leaf = slash === -1 ? path : path.slice(slash + 1);
    const { data, error } = await this.client.storage.from(this.bucket).list(folder, {
      search: leaf,
      limit: 100,
    });
    if (error) return false;
    return (data ?? []).some((entry) => entry.name === leaf);
  }
}
