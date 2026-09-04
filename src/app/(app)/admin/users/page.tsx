import type { Metadata } from "next";

import { PermissionGate } from "@/components/permission-gate";
import { UsersScreen } from "@/features/admin/users-screen";
import { requirePagePermission } from "@/lib/auth/page";

export const metadata: Metadata = {
  title: "User Management",
};

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  await requirePagePermission("manage_users");

  return (
    <PermissionGate permission="manage_users" adminOnly>
      <UsersScreen />
    </PermissionGate>
  );
}
