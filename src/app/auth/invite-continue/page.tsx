import type { Metadata } from "next";
import { cookies } from "next/headers";

import { AuthPanel } from "@/features/auth/auth-panel";
import { InviteContinueForm } from "@/features/auth/invite-continue-form";
import { inviteLinkHoldEnabled } from "@/lib/auth/invite-hold-flag";
import { INVITE_TOKEN_COOKIE, heldInviteToken } from "@/lib/auth/invite-token";

export const metadata: Metadata = { title: "Set up your account" };

/**
 * WHERE `/auth/invite-start` SENDS A GET, once the token is out of the URL.
 * Rendering never spends the token: it only asks whether the HttpOnly cookie
 * holds one and shows Continue if so. Off (INVITE_LINK_HOLD_ENABLED), it never
 * reports a held link.
 */
export const dynamic = "force-dynamic";

export default async function InviteContinuePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const store = await cookies();
  const hasLink =
    inviteLinkHoldEnabled() && heldInviteToken(store.get(INVITE_TOKEN_COOKIE)?.value) !== null;
  const { retry } = await searchParams;

  return (
    <AuthPanel title="Set up your account" subtitle="One more step before you choose your password.">
      <InviteContinueForm hasLink={hasLink} retry={hasLink && retry === "1"} />
    </AuthPanel>
  );
}
