import type { Metadata } from "next";

import { ResourcesScreen } from "@/features/resources/resources-screen";
import { requirePagePermission } from "@/lib/auth/page";

export const metadata: Metadata = {
  title: "Manager Resources",
};

export const dynamic = "force-dynamic";

export default async function ResourcesPage() {
  await requirePagePermission("view_manager_resources");

  return <ResourcesScreen />;
}
