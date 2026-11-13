"use client";
// Copied from the Leadership Hub (src/app/meetings/_components/PrintButton.tsx); keep in step with it. See src/features/l10/README.md.

import "../print.css";
import { Button } from "@/features/l10/ui/ui";

/** Export PDF: opens the browser's print window, where "Save as PDF" is one of the choices. No file leaves the page. */
export function PrintButton({ label = "Export PDF" }: { label?: string }) {
  return (
    <Button variant="outline" className="print:hidden" title="Opens your browser's print window: choose Save as PDF" onClick={() => window.print()}>
      {label}
    </Button>
  );
}
