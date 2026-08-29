import { Suspense } from "react";
import type { Metadata } from "next";

import { PermissionGate } from "@/components/permission-gate";
import { VideosScreen } from "@/features/videos/videos-screen";

export const metadata: Metadata = {
  title: "Videos",
};

export default function VideosPage() {
  return (
    <PermissionGate permission="view_videos">
      <Suspense fallback={null}>
        <VideosScreen />
      </Suspense>
    </PermissionGate>
  );
}
