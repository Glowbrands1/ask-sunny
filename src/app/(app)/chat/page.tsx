import { Suspense } from "react";
import type { Metadata } from "next";

import { PermissionGate } from "@/components/permission-gate";
import { ChatScreen } from "@/features/chat/chat-screen";

export const metadata: Metadata = {
  title: "Ask Sunny",
};

export default function ChatPage() {
  return (
    <PermissionGate permission="ask_questions">
      <Suspense fallback={null}>
        <ChatScreen />
      </Suspense>
    </PermissionGate>
  );
}
