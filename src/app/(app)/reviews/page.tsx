import { Suspense } from "react";
import type { Metadata } from "next";

import { PermissionGate } from "@/components/permission-gate";
import { ReviewsScreen } from "@/features/reviews/reviews-screen";

export const metadata: Metadata = {
  title: "Google Reviews",
};

export default function ReviewsPage() {
  return (
    <PermissionGate permission="view_google_reviews">
      <Suspense fallback={null}>
        <ReviewsScreen />
      </Suspense>
    </PermissionGate>
  );
}
