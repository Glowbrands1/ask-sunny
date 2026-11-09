/**
 * A SHORT CONFETTI BURST, for a 5-star rating.
 *
 * No dependency: one full-screen canvas laid over the page for about three
 * seconds, then removed. It never takes pointer events, so nothing under it
 * stops working while it falls.
 *
 * It does nothing at all when the viewer has asked for reduced motion, when
 * there is no DOM (server render, tests) or when the browser gives no 2D
 * canvas — a celebration is never worth an error.
 */

/**
 * The Sunny palette, read from the design tokens rather than written here —
 * colours live in globals.css. Brand yellow twice, so the burst reads as
 * sunshine first.
 */
const COLOUR_TOKENS = [
  "--brand-yellow",
  "--brand-yellow",
  "--measure-goal",
  "--highlight",
  "--surface",
  "--topbar",
];

function palette(): string[] {
  const style = getComputedStyle(document.documentElement);
  return COLOUR_TOKENS.map((token) => style.getPropertyValue(token).trim()).filter(Boolean);
}

const DURATION_MS = 3200;
const PIECES = 170;

type Piece = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  colour: string;
  spin: number;
  angle: number;
  /** Round pieces read as little suns; strips read as confetti. */
  round: boolean;
};

export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  } catch {
    return false;
  }
}

export function burstConfetti(): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (prefersReducedMotion()) return;

  const colours = palette();
  if (colours.length === 0) return;

  const canvas = document.createElement("canvas");
  let context: CanvasRenderingContext2D | null = null;
  try {
    context = canvas.getContext("2d");
  } catch {
    context = null;
  }
  if (!context) return;
  const ctx = context;

  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = window.innerWidth;
  const height = window.innerHeight;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  canvas.setAttribute("aria-hidden", "true");
  canvas.dataset.confetti = "";
  Object.assign(canvas.style, {
    position: "fixed",
    inset: "0",
    width: `${width}px`,
    height: `${height}px`,
    pointerEvents: "none",
    zIndex: "9999",
  });
  document.body.appendChild(canvas);
  ctx.scale(ratio, ratio);

  // Two cannons from the lower corners, aimed up and inward, so the burst
  // fills the screen rather than spraying from one point.
  const pieces: Piece[] = Array.from({ length: PIECES }, (_, i) => {
    const fromLeft = i % 2 === 0;
    const angle = (fromLeft ? -60 : -120) + (Math.random() - 0.5) * 50;
    const speed = 11 + Math.random() * 9;
    const radians = (angle * Math.PI) / 180;
    return {
      x: fromLeft ? width * 0.08 : width * 0.92,
      y: height * 0.9,
      vx: Math.cos(radians) * speed,
      vy: Math.sin(radians) * speed,
      size: 6 + Math.random() * 7,
      colour: colours[Math.floor(Math.random() * colours.length)],
      spin: (Math.random() - 0.5) * 0.35,
      angle: Math.random() * Math.PI,
      round: Math.random() < 0.3,
    };
  });

  const start = performance.now();
  const frame = (now: number) => {
    const elapsed = now - start;
    ctx.clearRect(0, 0, width, height);
    // Fade out over the last 600ms rather than vanishing mid-air.
    ctx.globalAlpha = Math.min(1, Math.max(0, (DURATION_MS - elapsed) / 600));
    for (const p of pieces) {
      p.vy += 0.32; // gravity
      p.vx *= 0.985; // air
      p.vy *= 0.985;
      p.x += p.vx + Math.sin(elapsed / 220 + p.size) * 0.6; // a little flutter
      p.y += p.vy;
      p.angle += p.spin;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.fillStyle = p.colour;
      if (p.round) {
        ctx.beginPath();
        ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Strips foreshorten as they spin, which is what makes them flutter.
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, (p.size / 2) * Math.abs(Math.cos(p.angle)) + 1);
      }
      ctx.restore();
    }
    if (elapsed < DURATION_MS) requestAnimationFrame(frame);
    else canvas.remove();
  };
  requestAnimationFrame(frame);
}
