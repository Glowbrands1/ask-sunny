import type { Metadata } from "next";

import { AuthPanel } from "@/features/auth/auth-panel";
import { ForgotPasswordForm } from "@/features/auth/forgot-password-form";

export const metadata: Metadata = { title: "Reset your password" };

export default function ForgotPasswordPage() {
  return (
    <AuthPanel title="Reset your password">
      <ForgotPasswordForm />
    </AuthPanel>
  );
}
