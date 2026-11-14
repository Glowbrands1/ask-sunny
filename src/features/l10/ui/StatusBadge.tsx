// Copied from the Leadership Hub (src/components/StatusBadge.tsx); keep in step with it. See src/features/l10/README.md.
import { cx } from "./ui";

export type BadgeState = "done" | "overdue" | "soon";

const TEXT: Record<BadgeState, string> = { done: "Done", overdue: "Overdue", soon: "Due soon" };
const GLYPH: Record<BadgeState, string> = { done: "✓", overdue: "!", soon: "◷" };
// Text colours are dark on a light tint (AA on the cream background). In print the tint drops out and the
// border and the words carry the meaning in black and white.
const TONE: Record<BadgeState, string> = {
  done: "border-[#1b5e2a] bg-[#e1f1e4] text-[#154a21]",
  overdue: "border-[#8a1c1c] bg-[#fbe4e4] text-[#7a1717]",
  soon: "border-[#8a4a00] bg-[#fdebd0] text-[#6b3a00]",
};

/** A status pill: always words plus a symbol plus colour, never colour alone. */
export function StatusBadge({ state, className }: { state: BadgeState; className?: string }) {
  return (
    <span data-status={state} className={cx("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] leading-none font-bold whitespace-nowrap print:border-black print:bg-white print:text-black", TONE[state], className)}>
      <span aria-hidden>{GLYPH[state]}</span>
      {TEXT[state]}
    </span>
  );
}
