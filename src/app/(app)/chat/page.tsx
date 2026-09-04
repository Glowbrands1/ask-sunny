import { Suspense } from "react";
import type { Metadata } from "next";

import { PermissionGate } from "@/components/permission-gate";
import { ChatScreen } from "@/features/chat/chat-screen";
import { requirePagePermission } from "@/lib/auth/page";

export const metadata: Metadata = {
  title: "Ask Sunny",
};

export const dynamic = "force-dynamic";

export default async function ChatPage() {
  await requirePagePermission("ask_questions");

  return (
    <PermissionGate permission="ask_questions">
      <Suspense fallback={null}>
        <ChatScreen />
      </Suspense>
    </PermissionGate>
  );
}
