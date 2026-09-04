import type { Metadata } from "next";

import { PermissionGate } from "@/components/permission-gate";
import { UsersScreen } from "@/features/admin/users-screen";
import { pageAuthorizationEnforced, requirePagePermission } from "@/lib/auth/page";
import { DirectoryError, listUsers, type DirectoryUser } from "@/lib/admin/user-directory";

export const metadata: Metadata = {
  title: "User Management",
};

export const dynamic = "force-dynamic";

/**
 * THE DIRECTORY IS READ ON THE SERVER, not fetched on mount.
 *
 * This page already requires `manage_users` before it renders, so the same
 * request that proved the caller may see the directory can also read it. Three
 * things follow: the first paint is the real list rather than a skeleton, there
 * is no second round trip, and the screen needs no mount effect — which is
 * where the cascading-render problem came from when this was a client fetch.
 *
 * The API route still exists and is still the only way the list CHANGES. It
 * serves the Refresh button and every mutation, all of which are user actions
 * rather than renders.
 */
export default async function UsersPage() {
  await requirePagePermission("manage_users");

  let users: DirectoryUser[] | null = null;
  let directoryError: string | null = null;

  if (pageAuthorizationEnforced()) {
    try {
      users = await listUsers();
    } catch (error) {
      /*
       * A directory that cannot be read is not a reason to fail the page: an
       * administrator still needs the rest of this screen, and the message
       * belongs on it. `DirectoryError` messages are written for exactly this;
       * anything else gets a generic sentence rather than a raw error.
       */
      users = [];
      directoryError =
        error instanceof DirectoryError
          ? error.message
          : "The user list could not be read.";
    }
  }

  return (
    <PermissionGate permission="manage_users" adminOnly>
      <UsersScreen initialUsers={users} directoryError={directoryError} />
    </PermissionGate>
  );
}
