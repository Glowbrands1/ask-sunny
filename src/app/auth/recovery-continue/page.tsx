import type { Metadata } from "next";
import { cookies } from "next/headers";

import { AuthPanel } from "@/features/auth/auth-panel";
import { RecoveryContinueForm } from "@/features/auth/recovery-continue-form";
import {
  RECOVERY_TOKEN_COOKIE,
  heldRecoveryToken,
} from "@/lib/auth/recovery-token";

export const metadata: Metadata = { title: "Reset your password" };

/**
 * WHERE `/auth/recovery-start` SENDS A GET, once the token is out of the URL.
 *
 * Rendering this page NEVER spends the token: it only asks whether the HttpOnly
 * cookie holds one, and shows the Continue button if so. The button POSTs back
 * to `/auth/recovery-start`, which is the only place verification happens. A
 * scanner that follows the redirect sees a button and stops.
 *
 * Not guarded, for the same reason `/reset-password` is not: the person here
 * is trying to regain access and has no session yet.
 */
export const dynamic = "force-dynamic";

export default async function RecoveryContinuePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const store = await cookies();
  const hasLink =
    heldRecoveryToken(store.get(RECOVERY_TOKEN_COOKIE)?.value) !== null;
  const { retry } = await searchParams;

  return (
    <AuthPanel
      title="Reset your password"
      subtitle="One more step before you choose a new password."
    >
      <RecoveryContinueForm hasLink={hasLink} retry={hasLink && retry === "1"} />
    </AuthPanel>
  );
}
