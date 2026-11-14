"use client";

import { useEffect, useRef } from "react";

// The signature background: slow spectral waves drawn on a small canvas and scaled up,
// so the browser's own smoothing does most of the blurring. Cheap enough for phones.
// Layers (back to front): dark base, radial glows, waves, dot field, grain.

const COLORS = ["#ff4fa3", "#9b6bff", "#3d8bff", "#2fd6f0", "#3ddc97", "#ff9f45"];

interface Band {
  y: number; // vertical centre, 0 to 1
  amp: number;
  f1: number;
  f2: number;
  s1: number;
  s2: number;
  phase: number;
  width: number;
  shift: number; // colour offset
}

const BANDS: Band[] = [
  { y: 0.3, amp: 0.13, f1: 1.3, f2: 2.9, s1: 0.07, s2: 0.045, phase: 0.0, width: 0.2, shift: 0.0 },
  { y: 0.46, amp: 0.16, f1: 0.9, f2: 2.3, s1: 0.05, s2: 0.062, phase: 1.7, width: 0.17, shift: 0.33 },
  { y: 0.62, amp: 0.12, f1: 1.7, f2: 3.4, s1: 0.06, s2: 0.038, phase: 3.1, width: 0.15, shift: 0.62 },
  { y: 0.2, amp: 0.1, f1: 2.1, f2: 1.2, s1: 0.04, s2: 0.07, phase: 4.4, width: 0.1, shift: 0.8 },
  { y: 0.76, amp: 0.1, f1: 1.1, f2: 2.6, s1: 0.055, s2: 0.03, phase: 5.2, width: 0.12, shift: 0.15 },
];

function draw(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, bands: Band[]) {
  ctx.clearRect(0, 0, w, h);
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const band of bands) {
    // Colours drift along the band over time, so no stripe ever sits still.
    const offset = (band.shift + t * 0.012) % 1;
    const gradient = ctx.createLinearGradient(-w * offset, 0, w * (2 - offset), 0);
    for (let i = 0; i <= COLORS.length * 2; i++) {
      gradient.addColorStop(i / (COLORS.length * 2), COLORS[i % COLORS.length]);
    }
    ctx.strokeStyle = gradient;
    ctx.globalAlpha = 0.42;
    ctx.lineWidth = h * band.width * (0.8 + 0.2 * Math.sin(t * 0.05 + band.phase));
    ctx.beginPath();
    for (let x = -10; x <= w + 10; x += 4) {
      const u = x / w;
      const y =
        h *
        (band.y +
          band.amp * Math.sin(u * band.f1 * Math.PI * 2 + t * band.s1 * Math.PI * 2 + band.phase) +
          band.amp * 0.5 * Math.sin(u * band.f2 * Math.PI * 2 - t * band.s2 * Math.PI * 2 + band.phase * 1.7));
      if (x === -10) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
}

/** `calm` is for working pages: a dim, even backdrop that stays out of the way of text. */
export default function WaveField({ calm = false }: { calm?: boolean }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current;
    const holder = wrap.current;
    if (!el || !holder) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const finePointer = window.matchMedia("(pointer: fine)").matches;
    let small = window.innerWidth < 760;
    let w = 0;
    let h = 0;
    let frame = 0;
    let last = 0;
    // Start partway into the motion so the first frame is already composed.
    const origin = performance.now() - 40_000;

    const resize = () => {
      small = window.innerWidth < 760;
      const scale = small ? 10 : 7;
      w = Math.max(60, Math.ceil(window.innerWidth / scale));
      h = Math.max(40, Math.ceil(window.innerHeight / scale));
      el.width = w;
      el.height = h;
      draw(ctx, w, h, (performance.now() - origin) / 1000, small ? BANDS.slice(0, 3) : BANDS);
    };

    const loop = (now: number) => {
      frame = requestAnimationFrame(loop);
      // 30 frames a second is plenty for motion this slow.
      if (now - last < 33) return;
      last = now;
      draw(ctx, w, h, (now - origin) / 1000, small ? BANDS.slice(0, 3) : BANDS);
    };
    let paused = false;
    try {
      paused = localStorage.getItem("promptproof:motion") === "paused";
    } catch {
      // Storage may be unavailable.
    }
    const start = () => {
      cancelAnimationFrame(frame);
      if (!reduced.matches && !document.hidden && !paused) frame = requestAnimationFrame(loop);
    };
    const onMotion = (event: Event) => {
      paused = !!(event as CustomEvent<boolean>).detail;
      start();
    };

    // Waves are strongest behind the hero and the closing call to action, and recede behind dense text.
    const onScroll = () => {
      if (calm) {
        holder.style.opacity = "0.16";
        return;
      }
      const y = window.scrollY;
      const vh = window.innerHeight;
      const max = document.documentElement.scrollHeight - vh;
      const hero = Math.max(0, 1 - y / (vh * 0.9));
      const end = Math.max(0, 1 - (max - y) / (vh * 0.8));
      holder.style.opacity = String(0.3 + 0.7 * Math.max(hero, end * 0.9));
    };

    const onMove = (event: PointerEvent) => {
      if (reduced.matches || paused || calm) return;
      const dx = (event.clientX / window.innerWidth - 0.5) * -22;
      const dy = (event.clientY / window.innerHeight - 0.5) * -16;
      el.style.transform = `translate3d(${dx.toFixed(1)}px, ${dy.toFixed(1)}px, 0) scale(1.06)`;
    };

    resize();
    onScroll();
    start();
    window.addEventListener("resize", resize);
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("visibilitychange", start);
    reduced.addEventListener("change", start);
    window.addEventListener("promptproof:motion", onMotion);
    if (finePointer) window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("visibilitychange", start);
      reduced.removeEventListener("change", start);
      window.removeEventListener("promptproof:motion", onMotion);
      window.removeEventListener("pointermove", onMove);
    };
  }, [calm]);

  return (
    <div className={`backdrop${calm ? " calm" : ""}`} aria-hidden="true">
      <div className="backdrop-glow" />
      <div className="backdrop-waves" ref={wrap}>
        <canvas ref={canvas} />
      </div>
      <div className="backdrop-dots" />
      <div className="backdrop-grain" />
    </div>
  );
}
