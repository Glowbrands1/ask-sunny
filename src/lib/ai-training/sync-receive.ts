import { createHash, timingSafeEqual } from "node:crypto";

import { parseImportFiles, type ImportTable, type ParsedImport } from "./import";
import type { SyncConfig } from "./sync";

/**
 * RECEIVING AN AI TRAINING CHANGE PUBLISHED FROM THE OTHER APP.
 *
 * Checks, in order, before anything is written: sync is set up here (else it
 * is not there at all), the shared key matches, the editor is on THIS app's
 * editor list, and the rows pass the importer's own validation. Then upserts
 * parents before children. Pure apart from the injected writer, so it is
 * tested without Next or a database.
 */

export interface ReceiveDeps {
  config: SyncConfig | null;
  /** This app's editors (lower-case emails). */
  editors: readonly string[];
  importRows: (table: ImportTable, rows: ParsedImport[ImportTable]) => Promise<number>;
}

export type ReceiveResult =
  | { status: 200; body: { ok: true; counts: Record<ImportTable, number> } }
  | { status: 400 | 401 | 403 | 404 | 409 | 413 | 500; body: { error: string } };

export const MAX_SYNC_BYTES = 1_000_000;
const ORDER: ImportTable[] = ["tracks", "modules", "lessons", "pages"];

const digest = (value: string) => createHash("sha256").update(value).digest();

function keyMatches(headers: Headers, key: string): boolean {
  const presented = /^Bearer\s+(.+)$/i.exec(headers.get("authorization") ?? "")?.[1]?.trim() ?? "";
  // Comparing fixed-length digests keeps the comparison constant-time whatever was presented.
  return presented.length > 0 && timingSafeEqual(digest(presented), digest(key));
}

const refuse = (status: 400 | 401 | 403 | 404 | 409 | 413 | 500, error: string): ReceiveResult => ({ status, body: { error } });

export async function receiveSync(req: { headers: Headers; text(): Promise<string> }, deps: ReceiveDeps): Promise<ReceiveResult> {
  if (!deps.config) return refuse(404, "not found");
  if (!keyMatches(req.headers, deps.config.key)) return refuse(401, "the sync key was not accepted");

  const text = await req.text();
  if (Buffer.byteLength(text, "utf8") > MAX_SYNC_BYTES) return refuse(413, "the change is too large to publish");
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return refuse(400, "the change could not be read");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return refuse(400, "the change could not be read");

  const actor = (payload as { actorEmail?: unknown }).actorEmail;
  const email = typeof actor === "string" ? actor.trim().toLowerCase() : "";
  if (!email || !deps.editors.includes(email)) return refuse(403, "you are not an AI Training editor in this app");

  const parsed = parseImportFiles([{ name: "sync.json", text }]);
  if (parsed.problems.length) return refuse(400, parsed.problems.join(" "));

  const counts = { tracks: 0, modules: 0, lessons: 0, pages: 0 } as Record<ImportTable, number>;
  for (const table of ORDER) {
    try {
      counts[table] = await deps.importRows(table, parsed[table]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (/duplicate key|23505/i.test(message)) {
        if (table === "lessons") return refuse(409, "another lesson in this track already uses that web address");
        if (table === "modules") return refuse(409, "a module with that name already exists");
        return refuse(409, "a track with that name already exists");
      }
      return refuse(500, "the change could not be saved there");
    }
  }
  return { status: 200, body: { ok: true, counts } };
}
