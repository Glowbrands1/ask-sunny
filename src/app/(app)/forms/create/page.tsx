import { Suspense } from "react";
import type { Metadata } from "next";

import { CreateFormScreen } from "@/features/forms/create-form-screen";

export const metadata: Metadata = {
  title: "Create a Form",
};

export default function CreateFormPage() {
  return (
    <Suspense fallback={null}>
      <CreateFormScreen />
    </Suspense>
  );
}
