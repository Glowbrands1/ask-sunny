import type { Metadata } from "next";

import { AuthPanel } from "@/features/auth/auth-panel";
import { AcceptSessionForm } from "@/features/auth/accept-session-form";

export const metadata: Metadata = { title: "Accept your invitation" };

/**
 * WHERE AN INVITATION LANDS.
 *
 * Also where an administrator-sent sign-in link lands, because both are
 * generated on the SERVER and Supabase returns both as a URL fragment. The
 * route is not named for invitations for exactly that reason: a page called
 * `invite` that quietly also handles password resets is the same kind of
 * mismatch that made the first real invitation fail.
 *
 * NOT GUARDED, and it must not be. Somebody arriving here has no usable
 * application profile yet — that is the whole point of an invitation — so any
 * permission check would refuse precisely the person the page exists for.
 */
export const dynamic = "force-dynamic";

export default function AcceptSessionPage() {
  return (
    <AuthPanel
      title="Accept your invitation"
      subtitle="One moment while we open your account."
    >
      <AcceptSessionForm />
    </AuthPanel>
  );
}
