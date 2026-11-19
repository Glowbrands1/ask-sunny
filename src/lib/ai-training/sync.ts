/**
 * PUBLISHING AN AI TRAINING CHANGE TO THE OTHER APP (Ask Sunny <-> Ask Bubbles).
 *
 * Both apps carry the same training content with the same ids. When an editor
 * ticks "Also publish to <other app>", the saved rows are sent to the other
 * app's `/api/ai-training/sync`, which upserts them by id. Opt-in per save;
 * deletes, reordering and submissions never cross.
 *
 * The bundle uses the database's own column names, the shape the importer
 * (`parseImportFiles`) already validates, so the receiver reuses it.
 */

type Raw = Record<string, unknown>;

export interface SyncBundle {
  /** The editor who made the change; the receiver checks it against its own editor list. */
  actorEmail: string;
  tracks: Raw[];
  modules: Raw[];
  lessons: Raw[];
  content_pages: Raw[];
}

export interface SyncConfig {
  /** The other app's base address, without a trailing slash. */
  url: string;
  /** Shared secret, the same in both apps. */
  key: string;
  /** "Ask Bubbles" in Ask Sunny, "Ask Sunny" in Ask Bubbles. */
  otherAppName: string;
}

export type PushResult = { ok: true } | { ok: false; reason: string };

export const SYNC_PATH = "/api/ai-training/sync";
export const MIN_SYNC_KEY_LENGTH = 24;
const PUSH_TIMEOUT_MS = 10_000;

type Env = Record<string, string | undefined>;

/** Null (the feature is off) unless both the address and a long enough key are set. */
export function syncConfig(env: Env = process.env): SyncConfig | null {
  const url = (env.AI_TRAINING_SYNC_URL ?? "").trim().replace(/\/+$/, "");
  const key = (env.AI_TRAINING_SYNC_KEY ?? "").trim();
  if (!/^https?:\/\//.test(url) || key.length < MIN_SYNC_KEY_LENGTH) return null;
  return { url, key, otherAppName: (env.AI_TRAINING_SYNC_APP_NAME ?? "").trim() || "the other app" };
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** Sends the bundle. Never throws: a failure comes back as a reason the editor can read. */
export async function pushToOtherApp(bundle: SyncBundle, cfg: SyncConfig, fetchImpl: FetchLike = fetch): Promise<PushResult> {
  let response: Response;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PUSH_TIMEOUT_MS);
  try {
    response = await fetchImpl(`${cfg.url}${SYNC_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify(bundle),
      signal: controller.signal,
      cache: "no-store",
    });
  } catch {
    return { ok: false, reason: "it could not be reached" };
  } finally {
    clearTimeout(timer);
  }
  if (response.ok) return { ok: true };
  let reason = `HTTP ${response.status}`;
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body?.error === "string" && body.error.trim()) reason = body.error.trim();
  } catch {
    // not JSON: keep the status
  }
  return { ok: false, reason };
}

/**
 * THE STEP AFTER A SUCCESSFUL LOCAL SAVE. Returns a warning for the editor, or
 * nothing. Never throws: the change is already saved in this app, and a problem
 * with the other app must not read as the save having failed.
 */
export async function publishAfterSave(input: {
  publish: boolean | undefined;
  cfg: SyncConfig | null;
  actorEmail: string;
  load: () => Promise<Omit<SyncBundle, "actorEmail">>;
  push?: (bundle: SyncBundle, cfg: SyncConfig) => Promise<PushResult>;
}): Promise<string | undefined> {
  const { cfg } = input;
  if (input.publish !== true || !cfg) return undefined;
  const warn = (reason: string) => `Saved here, but not published to ${cfg.otherAppName}: ${reason}`;
  let rows: Omit<SyncBundle, "actorEmail">;
  try {
    rows = await input.load();
  } catch {
    return warn("the saved change could not be read back");
  }
  const result = await (input.push ?? pushToOtherApp)({ actorEmail: input.actorEmail, ...rows }, cfg);
  return result.ok ? undefined : warn(result.reason);
}
