import type { Metadata } from "next";

import { OverviewScreen } from "@/features/dashboard/overview";

export const metadata: Metadata = {
  title: "Overview",
};

export default function OverviewPage() {
  return <OverviewScreen />;
}
