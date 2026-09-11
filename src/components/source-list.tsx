import Link from "next/link";

import type { SourceCitation } from "@/types";
import { cn } from "@/lib/utils/cn";

/**
 * =============================================================================
 * THE DOCUMENTS BEHIND AN ANSWER — A RULE, NUMBERED ROWS, AND EACH ONE OPENS
 * =============================================================================
 *
 * The Marquee Chat artifact's sixth item, verbatim: "A SOURCES label over a 3px
 * rule, then numbered rows with yellow numeral chips. Today they are three
 * white cards competing with the answer they support."
 *
 * ONE COMPONENT, BECAUSE THERE ARE THREE PLACES AN ANSWER LANDS. The chat
 * thread, the Overview's answer sheet and now the report tabs' inline answer all
 * render the same object, and they had drifted: the answer sheet's rows were
 * links and carried the excerpt, the chat's were neither. That is how the
 * clickable sources went missing from the chat tab.
 *
 * EVERY ROW IS A LINK, AND THAT IS THE POINT OF SHOWING THEM AT ALL.
 *
 * REPORTED: "why did you remove clickable sources?" — and it was a real
 * regression. A citation a manager cannot open is a claim they have to take on
 * trust, which is the opposite of what a source is for. This product's answers
 * get quoted in coaching and disciplinary conversations, so "page 14 of the
 * Attendance policy" has to be one click from the actual page 14.
 *
 * THE YELLOW NUMERAL IS A LABEL, NOT A VALUE. Brand yellow measures 1.47:1 on a
 * light ground and the direction forbids it as a fill that encodes anything —
 * but a 17px chip with the near-black ink on it is one of the sanctioned filled
 * labels, and the numeral is legible because of the ink rather than the fill.
 *
 * THE EXCERPT IS ONE CLAMPED LINE. The artifact draws a short descriptor after
 * the title — "Attendance & Dress Code Policy — ready to work at the start of
 * the scheduled shift" — which is what makes a row worth reading rather than a
 * filename. Clamped to a single line because a retrieval excerpt has no length
 * contract, and three unclamped ones are how this block became taller than the
 * answer the first time round.
 */
export function SourceList({
  citations,
  className,
}: {
  citations: readonly SourceCitation[];
  className?: string;
}) {
  if (citations.length === 0) return null;

  return (
    <div className={cn("border-t-[3px] border-border-strong pt-3", className)}>
      <p className="eyebrow mb-2 tracking-[0.14em]">Sources</p>
      <ul>
        {citations.map((citation, index) => (
          <li key={`${citation.documentId}-${citation.locator}-${index}`}>
            <Link
              href={`/knowledge?document=${citation.documentId}`}
              className="flex items-baseline gap-2.5 rounded-[var(--radius-xs)] py-1.5 text-[12.5px] transition-colors hover:bg-surface-muted"
            >
              {/*
                Decorative to a screen reader: the document title is the row's
                accessible content, and "1" announced before it adds nothing.
              */}
              <span
                aria-hidden
                className="mt-px grid size-[17px] shrink-0 place-items-center rounded-[var(--radius-xs)] bg-brand-yellow text-[9.5px] font-black text-brand-yellow-foreground"
              >
                {index + 1}
              </span>
              <span className="min-w-0 flex-1 truncate">
                <span className="font-bold text-foreground">
                  {citation.documentTitle}
                </span>
                {citation.excerpt ? (
                  <span className="text-muted-foreground"> — {citation.excerpt}</span>
                ) : null}
              </span>
              {citation.locator ? (
                <span className="shrink-0 pl-1 text-[10.5px] whitespace-nowrap text-muted-foreground">
                  {citation.locator}
                </span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
