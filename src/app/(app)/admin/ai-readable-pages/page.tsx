import type { Metadata } from "next";

import { AI_READABLE_PAGES } from "@/config/ai-readable-pages";
import { AiReadablePagesScreen } from "@/features/admin/ai-readable-pages-screen";
import { requireAdminConsolePage } from "@/lib/auth/page";

export const metadata: Metadata = {
  title: "AI-readable pages",
};

export const dynamic = "force-dynamic";

/**
 * THE PAGES THE AI CAN READ, SHOWN TO ADMINS (QA, 24 Nov 2026: "the list of every page the AI can read" could not be
 * found in the app). Rendered straight from `src/config/ai-readable-pages.ts`, the list its test holds to the real
 * pages, so the screen cannot drift from what the AI reads.
 */
export default async function AiReadablePagesPage() {
  await requireAdminConsolePage("view_ai_usage");
  return <AiReadablePagesScreen pages={AI_READABLE_PAGES} />;
}
