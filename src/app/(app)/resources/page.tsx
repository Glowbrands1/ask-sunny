import type { Metadata } from "next";

import { ResourcesScreen } from "@/features/resources/resources-screen";

export const metadata: Metadata = {
  title: "Manager Resources",
};

export default function ResourcesPage() {
  return <ResourcesScreen />;
}
