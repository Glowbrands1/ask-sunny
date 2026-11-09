import { useId } from "react";

import { cn } from "@/lib/utils/cn";
import styles from "./sunny-mascot.module.css";

/**
 * SunnyMascot
 * ---------------------------------------------------------------------------
 * The smiling sun with a cloud, drawn in SVG so it needs no image asset. It
 * bobs, its rays turn slowly, and its cheeks and smile pulse; the motion is in
 * `sunny-mascot.module.css` and stops under `prefers-reduced-motion`.
 *
 * Size it from outside with a width (or `className`); it keeps its 200×180
 * proportions. Decorative: it is hidden from assistive technology.
 */
export function SunnyMascot({ className }: { className?: string }) {
  const id = useId();
  const body = `${id}-body`;
  const cloud = `${id}-cloud`;

  return (
    <svg
      className={cn(styles.root, className)}
      viewBox="0 0 200 180"
      fill="none"
      aria-hidden
      focusable="false"
    >
      <defs>
        <radialGradient id={body} cx="35%" cy="28%" r="80%">
          <stop offset="0" stopColor="#fff0a0" />
          <stop offset=".45" stopColor="#ffd83a" />
          <stop offset="1" stopColor="#f2b200" />
        </radialGradient>
        <radialGradient id={cloud} cx="35%" cy="25%" r="85%">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#ddd6ef" />
        </radialGradient>
      </defs>
      <g className={styles.rays} fill="#ffcf2a" stroke="#e8a800" strokeWidth="2">
        <ellipse cx="100" cy="14" rx="11" ry="17" />
        <ellipse cx="40" cy="40" rx="11" ry="17" transform="rotate(-45 40 40)" />
        <ellipse cx="160" cy="40" rx="11" ry="17" transform="rotate(45 160 40)" />
        <ellipse cx="14" cy="88" rx="17" ry="11" />
        <ellipse cx="186" cy="88" rx="17" ry="11" />
        <ellipse cx="38" cy="140" rx="11" ry="17" transform="rotate(45 38 140)" />
        <ellipse cx="162" cy="140" rx="11" ry="17" transform="rotate(-45 162 140)" />
        <ellipse cx="100" cy="162" rx="11" ry="17" />
      </g>
      <circle cx="100" cy="88" r="58" fill={`url(#${body})`} />
      <ellipse cx="78" cy="58" rx="20" ry="11" fill="#fff" opacity=".55" transform="rotate(-25 78 58)" />
      <path d="M72 84q8-9 16 0M112 84q8-9 16 0" stroke="#7a4a12" strokeWidth="5" strokeLinecap="round" />
      <ellipse className={styles.cheek} cx="66" cy="104" rx="11" ry="8" fill="#ff9aa8" opacity=".75" />
      <ellipse className={styles.cheek} cx="134" cy="104" rx="11" ry="8" fill="#ff9aa8" opacity=".75" />
      <path className={styles.smile} d="M88 104q12 14 24 0" stroke="#7a4a12" strokeWidth="5" strokeLinecap="round" />
      <g className={styles.cloud}>
        <ellipse cx="62" cy="152" rx="38" ry="20" fill={`url(#${cloud})`} />
        <ellipse cx="96" cy="148" rx="26" ry="18" fill={`url(#${cloud})`} />
        <ellipse cx="46" cy="146" rx="20" ry="14" fill={`url(#${cloud})`} />
      </g>
    </svg>
  );
}
