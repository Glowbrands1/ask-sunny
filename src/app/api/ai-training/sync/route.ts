import { aiTrainingEditorEmails } from "@/lib/ai-training/editors";
import { importRows } from "@/lib/ai-training/repository";
import { syncConfig } from "@/lib/ai-training/sync";
import { receiveSync } from "@/lib/ai-training/sync-receive";

/**
 * AI TRAINING CHANGES PUBLISHED FROM THE SIBLING APP (Ask Sunny <-> Ask Bubbles).
 *
 * Machine-to-machine: no cookie, so the middleware (which skips `/api`) does
 * not guard it. `receiveSync` does: shared key, then this app's own editor
 * list, then the importer's validation. With AI_TRAINING_SYNC_URL or
 * AI_TRAINING_SYNC_KEY unset it answers 404 as if it did not exist.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const result = await receiveSync(request, {
    config: syncConfig(),
    editors: aiTrainingEditorEmails(),
    importRows,
  });
  return Response.json(result.body, { status: result.status });
}
