import { Suspense } from "react";
import type { Metadata } from "next";

import { PermissionGate } from "@/components/permission-gate";
import { ReviewsScreen } from "@/features/reviews/reviews-screen";
import { requirePagePermission } from "@/lib/auth/page";

export const metadata: Metadata = {
  title: "Google Reviews",
};

export const dynamic = "force-dynamic";

export default async function ReviewsPage() {
  await requirePagePermission("view_google_reviews");

  return (
    <PermissionGate permission="view_google_reviews">
      <Suspense fallback={null}>
        <ReviewsScreen />
      </Suspense>
    </PermissionGate>
  );
}
