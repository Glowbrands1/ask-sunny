import { useId } from "react";

import { cn } from "@/lib/utils/cn";

/**
 * SUNNY, THE CLAY MASCOT: a smiling sun with closed happy eyes and blush,
 * resting on a small cloud. Drawn from the approved "clay web" mockup.
 *
 * `bob` floats it gently up and down (`.sunny-bob` in globals.css), and the
 * animation stops under `prefers-reduced-motion`. Decorative: hidden from
 * assistive tech, because every place it appears already names Ask Sunny in
 * text.
 *
 * Gradient ids come from `useId`, so two mascots on one screen (the Overview
 * band and an open chat, say) never share — and fight over — a gradient.
 */
export function SunnyMascot({
  className,
  bob = true,
}: {
  className?: string;
  bob?: boolean;
}) {
  const id = useId();
  const body = `${id}-body`;
  const cloud = `${id}-cloud`;
  return (
    <svg
      viewBox="0 0 200 180"
      className={cn("sunny-mascot", bob && "sunny-bob", className)}
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
      <g fill="#ffcf2a" stroke="#e8a800" strokeWidth="2">
        <ellipse cx="100" cy="14" rx="11" ry="17" />
        <ellipse cx="40" cy="40" rx="11" ry="17" transform="rotate(-45 40 40)" />
        <ellipse cx="160" cy="40" rx="11" ry="17" transform="rotate(45 160 40)" />
        <ellipse cx="14" cy="88" rx="17" ry="11" />
        <ellipse cx="186" cy="88" rx="17" ry="11" />
        <ellipse cx="38" cy="140" rx="11" ry="17" transform="rotate(45 38 140)" />
        <ellipse cx="162" cy="140" rx="11" ry="17" transform="rotate(-45 162 140)" />
      </g>
      <circle cx="100" cy="88" r="58" fill={`url(#${body})`} />
      <ellipse cx="78" cy="58" rx="20" ry="11" fill="#fff" opacity=".55" transform="rotate(-25 78 58)" />
      <path d="M72 84 q8 -9 16 0" fill="none" stroke="#7a4a12" strokeWidth="5" strokeLinecap="round" />
      <path d="M112 84 q8 -9 16 0" fill="none" stroke="#7a4a12" strokeWidth="5" strokeLinecap="round" />
      <ellipse cx="66" cy="104" rx="11" ry="8" fill="#ff9aa8" opacity=".75" />
      <ellipse cx="134" cy="104" rx="11" ry="8" fill="#ff9aa8" opacity=".75" />
      <path d="M88 104 q12 14 24 0" fill="none" stroke="#7a4a12" strokeWidth="5" strokeLinecap="round" />
      <g>
        <ellipse cx="62" cy="152" rx="38" ry="20" fill={`url(#${cloud})`} />
        <ellipse cx="96" cy="148" rx="26" ry="18" fill={`url(#${cloud})`} />
        <ellipse cx="46" cy="146" rx="20" ry="14" fill={`url(#${cloud})`} />
      </g>
    </svg>
  );
}
