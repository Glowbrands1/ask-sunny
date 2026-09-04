"use client";

import * as React from "react";
import { Hand, PenLine, Zap } from "lucide-react";

import {
  RESPONSIBILITY_CHIP,
  RESPONSIBILITY_LABEL,
  type FieldResponsibility,
} from "@/lib/forms/document";
import { cn } from "@/lib/utils/cn";

/**
 * "AI FILLS: EMPLOYEE NAME" — the chips, and the rule about them.
 *
 * The reference forms mark every fillable area with who fills it, and that
 * marking is the single most useful thing on the page: it is how an
 * administrator sees at a glance that the DMIT EPP's self-review is filled by
 * hand while the SDIT EPP's is drafted.
 *
 * THEY ARE EDITOR OVERLAYS AND MUST NEVER PRINT. Nothing here is reachable from
 * `pdf-render.ts` — the PDF is drawn from the document's blocks and values, and
 * these chips are neither. `pdf-render.test.ts` asserts the absence, because a
 * chip printed onto a disciplinary record would be a defect nobody would think
 * to look for.
 */

const TONE: Record<FieldResponsibility, string> = {
  // Amber, as the reference shows, for everything Ask Sunny writes.
  ai: "bg-[#fdf0d5] text-[#7a4c00] ring-[#e8c88a]",
  system: "bg-[#fdf0d5] text-[#7a4c00] ring-[#e8c88a]",
  // Grey for the parts a person owns — a different job, so a different colour.
  manager: "bg-black/[0.055] text-black/65 ring-black/10",
  employee: "bg-black/[0.055] text-black/65 ring-black/10",
  manual: "bg-black/[0.055] text-black/65 ring-black/10",
  signature: "bg-black/[0.055] text-black/65 ring-black/10",
};

function Icon({ responsibility }: { responsibility: FieldResponsibility }) {
  if (responsibility === "ai" || responsibility === "system") {
    return <Zap className="size-2.5" strokeWidth={2.5} aria-hidden />;
  }
  if (responsibility === "signature") return <PenLine className="size-2.5" aria-hidden />;
  if (responsibility === "manual") return <Hand className="size-2.5" aria-hidden />;
  return null;
}

/**
 * How much of a field's label the chip will carry.
 *
 * Naming the field is what makes a chip useful — "AI FILLS: POLICY VIOLATED"
 * says something "AI FILLS" alone does not. But several fields on the DMIT EPP
 * are whole questions ("What do you feel is the most important skill for a
 * District Manager to possess?"), and a chip carrying one of those wraps to
 * three lines and swamps the field it is annotating. Past this length the label
 * is already right there on the page, so the chip drops it and says only who
 * fills it.
 */
const NAME_LIMIT = 26;

export function ResponsibilityChip({
  responsibility,
  name,
  className,
}: {
  responsibility: FieldResponsibility;
  /** The field's label, so the chip reads "AI FILLS: POLICY VIOLATED". */
  name?: string;
  className?: string;
}) {
  const shown = name && name.length <= NAME_LIMIT ? name : undefined;
  return (
    <span
      title={RESPONSIBILITY_LABEL[responsibility]}
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-[3px] text-[9px] leading-none font-semibold tracking-[0.06em] uppercase ring-1 ring-inset",
        TONE[responsibility],
        className,
      )}
    >
      <Icon responsibility={responsibility} />
      {RESPONSIBILITY_CHIP[responsibility]}
      {shown ? `: ${shown}` : null}
    </span>
  );
}
