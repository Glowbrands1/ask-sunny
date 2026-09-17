import type { Metadata } from "next";

import { AuthPanel } from "@/features/auth/auth-panel";
import { ResetPasswordForm } from "@/features/auth/reset-password-form";

export const metadata: Metadata = { title: "Create a new password" };

/**
 * WHERE A PASSWORD RECOVERY LINK LANDS, and where the password is chosen.
 *
 * Both, in one page, because the page is what consumes the link. Supabase
 * returns a recovery session either as `?code=` (PKCE, from the browser's own
 * `resetPasswordForEmail`) or as `#access_token=` (implicit, from anything sent
 * server-side) — and a fragment is never transmitted to a server, so only a
 * client page can read the second. Pointing recovery at a route handler is what
 * dropped implicit links onto the sign-in screen with a live session in the
 * address bar. See `features/auth/reset-password-form.tsx`.
 *
 * NOT GUARDED, and it must not be. A person arriving here holds a recovery
 * session and no application profile decision has been made about them yet —
 * requiring a permission would lock out exactly the person who is trying to
 * regain access. The form checks that a session exists and Supabase Auth
 * enforces the rest.
 *
 * `force-dynamic` so the shell is never served from a cache alongside somebody
 * else's render; everything that matters happens in the client component, which
 * reads the URL the browser actually holds.
 */
export const dynamic = "force-dynamic";

export default function ResetPasswordPage() {
  return (
    <AuthPanel
      title="Create a new password"
      subtitle="Choose a password you have not used elsewhere."
    >
      <ResetPasswordForm />
    </AuthPanel>
  );
}
