import { NextResponse } from "next/server";

import { assertLiveMode, errorResponse } from "@/lib/api/respond";
import { authorizeRequest } from "@/lib/auth/server";
import { KnowledgeSyncStoreError } from "@/lib/knowledge-sync/store";
import { readWovenKnowledgeContent } from "@/lib/knowledge-sync/woven/status";
import { getSupabaseAdmin } from "@/lib/supabase/server";

/**
 * GET /api/admin/knowledge-sync/woven/content — the Content view: every Woven
 * item the latest scan or sync found, one row each, with its parts and a plain
 * sync state. Before the initial sync it lists what the latest dry run found.
 *
 * `manage_integrations`. Titles, labels, dates and states only: no locator,
 * fingerprint, URL or document text is part of any row.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

async function documentTitles(ids: string[]): Promise<Map<string, string>> {
  const titles = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await getSupabaseAdmin().from("knowledge_documents").select("id, title").in("id", ids.slice(i, i + 200));
    for (const row of (data ?? []) as { id: string; title: string }[]) titles.set(row.id, row.title);
  }
  return titles;
}

export async function GET(request: Request) {
  try {
    assertLiveMode();
    await authorizeRequest(request, "manage_integrations");
    return NextResponse.json({ status: "ok", content: await readWovenKnowledgeContent({ documentTitles }) }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof KnowledgeSyncStoreError) {
      return NextResponse.json({ status: "failed", code: error.code, reason: error.message }, { status: 503, headers: NO_STORE });
    }
    return errorResponse(error, "admin/knowledge-sync/woven/content");
  }
}
