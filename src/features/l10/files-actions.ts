"use server";

import { fileOp } from "@/features/l10/data.server";
import { isMeetingKey } from "@/features/l10/lib/config";
import { ISSUE_ID, fail, parseNewPath, parseOpenPath, validateL10Upload, type L10Reply } from "@/features/l10/lib/files";
import type { IssueFile } from "@/features/l10/lib/types";

/**
 * The issue files' Server Functions: the same names and inputs as the Leadership Hub's src/app/meetings/files-actions.ts.
 * The Hub does the work (its own prepareUpload / finishUpload / openFile, for this person, after its database allows
 * this partner + person for the meeting); Storage stays in the Hub and Ask Sunny never sees a Storage key. Server
 * Functions can be called directly, so the inputs are checked here first with the Hub's own rules (lib/files.ts).
 */
export type Prepared = { mode: "storage"; path: string; signedUrl: string; contentType: string } | { mode: "fixture"; path: string; contentType: string };
export type Opened = { kind: "url"; url: string } | { kind: "inline"; name: string; mime: string; base64: string };

const unreadable = () => fail("validation", "That file could not be read. Reload the page and try again.");

export async function prepareL10Upload(input: { key: string; issueId: string; name: string; size: number }): Promise<L10Reply<Prepared>> {
  if (typeof input?.key !== "string" || !isMeetingKey(input.key) || typeof input.issueId !== "string" || !ISSUE_ID.test(input.issueId)) return unreadable();
  const bad = validateL10Upload(input.name, input.size);
  if (bad) return { ok: false, error: bad };
  return (await fileOp<Prepared>("file-prepare", { key: input.key, issueId: input.issueId, name: input.name, size: input.size })) as L10Reply<Prepared>;
}

export async function finishL10Upload(input: { key: string; issueId: string; path: string; name: string }): Promise<L10Reply<IssueFile>> {
  const parsed = parseNewPath(input?.path);
  if (!parsed || parsed.key !== input.key || parsed.issueId !== input.issueId || typeof input.name !== "string") return unreadable();
  return (await fileOp<IssueFile>("file-finish", { key: input.key, issueId: input.issueId, path: input.path, name: input.name })) as L10Reply<IssueFile>;
}

export async function openL10File(input: { key: string; path: string; name?: string }): Promise<L10Reply<Opened>> {
  const parsed = parseOpenPath(input?.path);
  if (typeof input?.key !== "string" || !parsed || parsed.key !== input.key) return unreadable();
  return (await fileOp<Opened>("file-open", { key: input.key, path: input.path, ...(typeof input.name === "string" ? { name: input.name.slice(0, 300) } : {}) })) as L10Reply<Opened>;
}

/** The Hub's fixture-mode upload. Ask Sunny has no fixture storage: always refused (the Hub never answers "fixture" here). */
export async function putFixtureL10File(form: FormData): Promise<L10Reply<{ path: string }>> {
  void form;
  return fail("unavailable", "File storage is not available here. Nothing was uploaded.");
}
