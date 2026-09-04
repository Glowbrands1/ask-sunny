import type { Metadata } from "next";

import { AuthPanel } from "@/features/auth/auth-panel";
import { ResetPasswordForm } from "@/features/auth/reset-password-form";

export const metadata: Metadata = { title: "Set a new password" };

/**
 * Reached from a recovery link, via `/auth/callback`.
 *
 * NOT GUARDED, and it must not be. A person arriving here holds a recovery
 * session and no application profile decision has been made about them yet —
 * requiring a permission would lock out exactly the person who is trying to
 * regain access. The form checks that a session exists and Supabase Auth
 * enforces the rest.
 */
export default function ResetPasswordPage() {
  return (
    <AuthPanel
      title="Set a new password"
      subtitle="Choose a password you have not used elsewhere."
    >
      <ResetPasswordForm />
    </AuthPanel>
  );
}
