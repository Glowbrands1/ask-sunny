import type { Metadata } from "next";

import { PermissionGate } from "@/components/permission-gate";
import { UsersScreen } from "@/features/admin/users-screen";

export const metadata: Metadata = {
  title: "User Management",
};

export default function UsersPage() {
  return (
    <PermissionGate permission="manage_users" adminOnly>
      <UsersScreen />
    </PermissionGate>
  );
}
