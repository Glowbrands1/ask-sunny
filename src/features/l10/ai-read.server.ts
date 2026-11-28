import "server-only";

import { isMeetingKey } from "./lib/config";
import type { MeetingContentRead, MeetingVersionRow } from "./lib/for-model";
import type { RecapRow } from "./lib/types";
import { callHub, type HubAnswer } from "./partner/client.server";

/**
 * ============================================================================
 * AN L10 MEETING'S CONTENT FOR THE CHAT'S AI (Pau, 28 Nov 2026; CLAUDE.md §5)
 * ============================================================================
 *
 * The same partner API calls the meeting pages make (`data.server.ts`), signed for the asker's VERIFIED email, so the
 * Leadership Hub decides exactly as it does for the pages: a meeting's attendees and the Hub's admins get it, anyone else
 * gets a 404 and nothing of the meeting. Nothing is stored here and nothing is cached across people.
 *
 *   now      the meeting document ("load") and its recaps ("recaps"): the Meeting, Past meetings, Recaps and Report pages
 *   history  the saved versions ("history-list"): the Meeting history page
 *   version  one saved version's document ("history-get"): the Meeting version page
 */
const HISTORY_ROWS = 15;

function refusal(a: HubAnswer): MeetingContentRead {
  if (a.status === 0 && a.body.error === "not_configured") return { state: "off" };
  if (a.status === 404) return { state: "forbidden" };
  return { state: "failed" };
}

export async function meetingContentFromHub(
  email: string,
  key: string,
  part: "now" | "history" | "version",
  version: number | null = null,
  call: typeof callHub = callHub,
): Promise<MeetingContentRead> {
  if (!email || !isMeetingKey(key)) return { state: "forbidden" };

  if (part === "history") {
    const a = await call("history-list", email, { key, limit: HISTORY_ROWS });
    if (a.status !== 200 || !Array.isArray(a.body.rows)) return refusal(a);
    const rows = (a.body.rows as Record<string, unknown>[]).flatMap((r): MeetingVersionRow[] =>
      r && typeof r.version === "number" && typeof r.savedAt === "string"
        ? [{ version: r.version, savedAt: r.savedAt, savedByName: typeof r.savedByName === "string" ? r.savedByName : null, isCurrent: r.isCurrent === true, isImport: r.isImport === true }]
        : [],
    );
    return { state: "ok", part: "history", rows };
  }

  if (part === "version") {
    if (!version || !Number.isInteger(version) || version < 1) return { state: "ok", part: "version", version: version ?? 0, doc: null };
    const a = await call("history-get", email, { key, version });
    if (a.status !== 200) return refusal(a);
    const doc = a.body.doc;
    return { state: "ok", part: "version", version, doc: doc && typeof doc === "object" && !Array.isArray(doc) ? (doc as Record<string, unknown>) : null };
  }

  // The document first: a refusal here means nothing else is asked for.
  const loaded = await call("load", email, { key });
  if (loaded.status !== 200) return refusal(loaded);
  const body = loaded.body.loaded as { version?: unknown; updatedAt?: unknown; doc?: unknown } | undefined;
  const doc = body?.doc && typeof body.doc === "object" && !Array.isArray(body.doc) ? (body.doc as Record<string, unknown>) : {};
  const recapsAnswer = await call("recaps", email, { key });
  // Recaps the Hub would not give are left out, never guessed: the reply says the past meetings could not be read.
  if (recapsAnswer.status !== 200 || !Array.isArray(recapsAnswer.body.recaps)) {
    if (recapsAnswer.status === 404) return { state: "forbidden" };
    return { state: "failed" };
  }
  return {
    state: "ok",
    part: "now",
    version: typeof body?.version === "number" ? body.version : 0,
    updatedAt: typeof body?.updatedAt === "string" ? body.updatedAt : null,
    doc,
    recaps: recapsAnswer.body.recaps as RecapRow[],
  };
}
