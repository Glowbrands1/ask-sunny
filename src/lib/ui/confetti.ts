/**
 * A SHORT CONFETTI BURST, for a 5-star rating.
 *
 * No dependency: one full-screen canvas laid over the page for about five
 * seconds, then removed. It never takes pointer events, so nothing under it
 * stops working while it falls.
 *
 * It does nothing at all when the viewer has asked for reduced motion, when
 * there is no DOM (server render, tests) or when the browser gives no 2D
 * canvas — a celebration is never worth an error.
 */

/**
 * The Sunny palette, read from the design tokens rather than written here —
 * colours live in globals.css. Brand yellow and coral twice, so the burst
 * reads as sunshine first. No white: it disappears on the cream canvas.
 */
const COLOUR_TOKENS = [
  "--brand-yellow",
  "--brand-yellow",
  "--measure-goal",
  "--highlight",
  "--highlight",
  "--topbar",
];

function palette(): string[] {
  const style = getComputedStyle(document.documentElement);
  return COLOUR_TOKENS.map((token) => style.getPropertyValue(token).trim()).filter(Boolean);
}

/** Long enough to watch it fall: about five seconds, the last one fading. */
const DURATION_MS = 5200;
const FADE_MS = 1000;
const PIECES = 160;

type Piece = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  colour: string;
  spin: number;
  angle: number;
  /** Each piece sways on its own rhythm, like paper falling through air. */
  swayPhase: number;
  swaySpeed: number;
  swayWidth: number;
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

  // A RAIN FROM THE TOP, not a cannon. Pieces start just above the screen,
  // spread across its width and staggered in height so they arrive over the
  // first second or so, then drift down slowly enough to be seen as confetti.
  const pieces: Piece[] = Array.from({ length: PIECES }, () => ({
    x: Math.random() * width,
    y: -20 - Math.random() * height * 0.6,
    vx: (Math.random() - 0.5) * 1.2,
    vy: 1.2 + Math.random() * 1.6,
    size: 13 + Math.random() * 9,
    colour: colours[Math.floor(Math.random() * colours.length)],
    spin: (Math.random() - 0.5) * 0.12,
    angle: Math.random() * Math.PI * 2,
    round: Math.random() < 0.25,
    swayPhase: Math.random() * Math.PI * 2,
    swaySpeed: 0.8 + Math.random() * 1.2,
    swayWidth: 0.6 + Math.random() * 1.2,
  }));

  const start = performance.now();
  let last = start;
  const frame = (now: number) => {
    const elapsed = now - start;
    // TIME-BASED, in 60fps steps: on a 120Hz screen a per-frame step ran the
    // whole animation at double speed. Capped so a stalled tab does not jump.
    const step = Math.min(3, (now - last) / (1000 / 60));
    last = now;
    ctx.clearRect(0, 0, width, height);
    ctx.globalAlpha = Math.min(1, Math.max(0, (DURATION_MS - elapsed) / FADE_MS));
    for (const p of pieces) {
      // Gentle gravity toward a slow terminal speed, so pieces float down.
      p.vy = Math.min(p.vy + 0.035 * step, 3.2);
      p.x += (p.vx + Math.sin(elapsed / 1000 * p.swaySpeed * Math.PI + p.swayPhase) * p.swayWidth) * step;
      p.y += p.vy * step;
      p.angle += p.spin * step;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.fillStyle = p.colour;
      if (p.round) {
        ctx.beginPath();
        ctx.arc(0, 0, p.size / 2.6, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // A paper strip that tumbles: its height foreshortens as it turns,
        // which is what makes it read as confetti rather than a dot.
        const tumble = Math.abs(Math.cos(elapsed / 1000 * p.swaySpeed * 2 + p.swayPhase));
        ctx.fillRect(-p.size / 2, -(p.size * 0.3 * tumble) - 1, p.size, p.size * 0.6 * tumble + 2);
      }
      ctx.restore();
    }
    if (elapsed < DURATION_MS) requestAnimationFrame(frame);
    else canvas.remove();
  };
  requestAnimationFrame(frame);
}
