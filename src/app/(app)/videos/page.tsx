import { Suspense } from "react";
import type { Metadata } from "next";

import { PermissionGate } from "@/components/permission-gate";
import { VideosScreen } from "@/features/videos/videos-screen";
import { requirePagePermission } from "@/lib/auth/page";

export const metadata: Metadata = {
  title: "Videos",
};

export const dynamic = "force-dynamic";

export default async function VideosPage() {
  await requirePagePermission("view_videos");

  return (
    <PermissionGate permission="view_videos">
      <Suspense fallback={null}>
        <VideosScreen />
      </Suspense>
    </PermissionGate>
  );
}
