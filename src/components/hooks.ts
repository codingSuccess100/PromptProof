"use client";

import { useEffect, useState } from "react";

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

/** Counts from 0 to target whenever `trigger` changes. Jumps straight there with reduced motion. */
export function useCountUp(target: number, trigger: unknown, duration = 700): number {
  const reduced = useReducedMotion();
  const [value, setValue] = useState(target);
  useEffect(() => {
    if (reduced || target === 0) {
      setValue(target);
      return;
    }
    let frame = 0;
    const started = performance.now();
    setValue(0);
    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / duration);
      setValue(Math.round(target * (1 - Math.pow(1 - t, 3))));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, trigger, reduced]);
  return value;
}
