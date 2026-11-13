// Copied from the Leadership Hub (src/components/assistant/Markdown.tsx: proseClass, noImages); keep in step with it. See src/features/l10/README.md.
// The Hub's streaming renderer is assistant-ui's; only its typography and the image rule are needed here (the document pane).
import remarkGfm from "remark-gfm";

/** Typography for streamed answers. Scoped here so globals.css (locked tokens) stays untouched. */
export const proseClass = [
  "text-[15px] leading-relaxed break-words",
  "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
  "[&_p]:my-2.5 [&_ul]:my-2.5 [&_ol]:my-2.5 [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5 [&_li]:my-1 [&_li]:pl-0.5",
  "[&_h1]:mt-5 [&_h1]:mb-2 [&_h1]:text-lg [&_h1]:font-bold [&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-bold [&_h3]:mt-4 [&_h3]:mb-1.5 [&_h3]:text-[15px] [&_h3]:font-bold",
  "[&_a]:font-semibold [&_a]:text-bronze-deep [&_a]:underline",
  "[&_blockquote]:my-3 [&_blockquote]:rounded-xl [&_blockquote]:bg-sunny/70 [&_blockquote]:px-3.5 [&_blockquote]:py-2",
  "[&_hr]:my-4 [&_hr]:border-line/60",
  "[&_:not(pre)>code]:rounded-md [&_:not(pre)>code]:bg-ink/8 [&_:not(pre)>code]:px-1.5 [&_:not(pre)>code]:py-0.5 [&_:not(pre)>code]:font-mono [&_:not(pre)>code]:text-[13px]",
  "[&_pre]:overflow-x-auto [&_pre]:rounded-b-xl [&_pre]:bg-white/70 [&_pre]:p-3 [&_pre]:ring-1 [&_pre]:ring-white/70",
  // Tables scroll inside their own wrapper so the panel never overflows horizontally.
  "[&_table]:my-3 [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto [&_table]:border-separate [&_table]:border-spacing-0 [&_table]:text-sm",
  "[&_th]:whitespace-nowrap [&_th]:bg-ink [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:text-[11px] [&_th]:font-semibold [&_th]:tracking-wider [&_th]:text-gold-head [&_th]:uppercase",
  "[&_td]:min-w-[7.5rem] [&_td]:border-t [&_td]:border-line/50 [&_td]:bg-white/40 [&_td]:px-3 [&_td]:py-2 [&_td]:align-top [&_td]:tabular-nums",
].join(" ");

/**
 * Model output is untrusted (web pages can carry prompt injection). A markdown image would make the
 * browser request an attacker-chosen URL, which can leak report data in the query string, so images
 * are never rendered: they show as their alt text only.
 */
export const noImages = { img: ({ alt }: { alt?: string }) => (alt ? <span>{alt}</span> : null) };

export { remarkGfm };
