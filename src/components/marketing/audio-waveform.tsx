"use client";

import { useEffect, useRef } from "react";

type Speaker = "tutor" | "student";
const STRAND_COUNT = 30;

// Both voices share a clock, with a short pause between conversational turns.
function speechLevel(time: number, speaker: Speaker) {
  const cycle = time % 10;
  const start = speaker === "tutor" ? 0.3 : 5.1;
  const end = speaker === "tutor" ? 4.5 : 9.3;
  const ease = (n: number) => { const v = Math.max(0, Math.min(1, n)); return v * v * (3 - 2 * v); };
  return ease((cycle - start) / 0.6) * ease((end - cycle) / 0.7);
}

export function AudioWaveform({ speaker, startedAt }: { speaker: Speaker; startedAt: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let visible = true;
    let lastFrame = 0;
    let width = 1;
    let height = 1;
    let color = "";
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      color = speaker === "tutor" ? "190, 239, 126" : "182, 163, 255";
    };
    const paint = (now: number) => {
      const time = motion.matches ? 2 : Math.max(0, now - startedAt) / 1000;
      const level = motion.matches ? 0.85 : speechLevel(time, speaker);
      canvas.closest(".conversation-voice")?.setAttribute("data-speaking", String(level > 0.35));
      context.clearRect(0, 0, width, height);
      const phase = speaker === "tutor" ? 0 : 1.8;
      const amplitude = height * (0.065 + level * 0.31);
      // Closely spaced contours form a translucent, sculptural voice ribbon.
      for (let strand = 0; strand <  STRAND_COUNT; strand++) {
        const depth = strand / (STRAND_COUNT - 1);
        const gradient = context.createLinearGradient(0, 0, width, 0);
        const alpha = 0.12 + Math.pow(Math.abs(depth - 0.5) * 2, 3) * 0.6;
        gradient.addColorStop(0, `rgba(${color},0)`);
        gradient.addColorStop(0.18, `rgba(${color},${alpha})`);
        gradient.addColorStop(0.8, `rgba(${color},${alpha})`);
        gradient.addColorStop(1, `rgba(${color},0)`);
        context.strokeStyle = gradient;
        context.lineWidth = strand === 0 || strand === STRAND_COUNT - 1 ? 1.5 : 0.8;
        context.beginPath();
        for (let point = 0; point <= 240; point++) {
          const x = point / 240;
          const envelope = Math.pow(Math.sin(Math.PI * x), 1.4);
          const syllable = 0.65 + 0.35 * Math.sin(time * 3.8 + x * 8 + phase);
          const wave = Math.sin(x * Math.PI * 5 - time * 2.3 + depth * 2.5 + phase)
            * 0.65 + Math.sin(x * Math.PI * 9 + time * 1.4 + depth * 1.8) * 0.22;
          const y = height / 2 + envelope * (wave * amplitude * syllable + (depth - 0.5) * amplitude * 0.9);
          if (point === 0) context.moveTo(x * width, y);
          else context.lineTo(x * width, y);
        }
        context.stroke();
      }
    };
    const tick = (now: number) => {
      if (!visible || document.hidden) return;
      if (now - lastFrame >= 1000 / 30) { paint(now); lastFrame = now; }
      if (!motion.matches) frame = requestAnimationFrame(tick);
    };
    const restart = () => { cancelAnimationFrame(frame); lastFrame = 0; if (visible && !document.hidden) { paint(performance.now()); if (!motion.matches) frame = requestAnimationFrame(tick); } };
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; restart(); });
    const sizes = new ResizeObserver(() => { resize(); restart(); });
    observer.observe(canvas);
    sizes.observe(canvas);
    document.addEventListener("visibilitychange", restart);
    motion.addEventListener("change", restart);
    resize();
    restart();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); sizes.disconnect(); document.removeEventListener("visibilitychange", restart); motion.removeEventListener("change", restart); };
  }, [speaker, startedAt]);

  return <canvas ref={canvasRef} className={`conversation-waveform conversation-waveform--${speaker}`} aria-hidden="true" />;
}

