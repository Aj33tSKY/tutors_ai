"use client";

import { useEffect, useRef } from "react";
import { frameSeconds } from "./data/lesson-speech.json";
import { SPEECH_SPEED } from "./lesson-timing";

type Speaker = "tutor" | "student";
const STRAND_COUNT = 30;

export type SpeechProfile = {
  text: string;
  duration: number;
  words: number[][];
  frames: number[][];
};

function sampleSpeech(profile: SpeechProfile, time: number) {
  if (time < 0 || time >= profile.duration) return { level: 0, pitch: 0 };
  const position = time / frameSeconds;
  const index = Math.floor(position);
  const a = profile.frames[index] ?? [0, 0];
  const b = profile.frames[index + 1] ?? a;
  const blend = position - index;
  return { level: a[0] + (b[0] - a[0]) * blend, pitch: a[1] || b[1] };
}

// Speech measurements drive broad motion rather than the geometry at each point.
// A Gaussian window removes analysis-frame edges and bridges short consonant gaps.
function smoothProfile(profile: SpeechProfile): SpeechProfile {
  const radius = Math.ceil(0.2 / frameSeconds);
  const frames = profile.frames.map((_, index) => {
    let energy = 0;
    let weight = 0;
    let pitch = 0;
    let pitchWeight = 0;
    for (let offset = -radius; offset <= radius; offset++) {
      const frame = profile.frames[index + offset];
      const w = Math.exp(-0.5 * (offset / (radius / 2)) ** 2);
      weight += w;
      if (!frame) continue;
      energy += frame[0] * w;
      if (frame[1] > 0) {
        const voicedWeight = w * frame[0];
        pitch += frame[1] * voicedWeight;
        pitchWeight += voicedWeight;
      }
    }
    return [energy / weight, pitchWeight ? pitch / pitchWeight : 0];
  });
  const peak = Math.max(0.01, ...frames.map(([level]) => level));
  return { ...profile, frames: frames.map(([level, pitch]) => [level / peak, pitch]) };
}

export function AudioWaveform({ speaker, startedAt, profile, turnStart }: {
  speaker: Speaker;
  startedAt: number;
  profile: SpeechProfile;
  turnStart: number;
}) {
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
    const smoothedProfile = smoothProfile(profile);
    let visualLevel = 0;
    let visualPitch = 160;
    let lastPaint = 0;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      color = getComputedStyle(canvas).color.match(/[\d.]+/g)?.slice(0, 3).join(", ") ?? "190, 239, 126";
    };
    const paint = (now: number) => {
      const time = motion.matches ? profile.duration * 0.45 : (Math.max(0, now - startedAt) / 1000 - turnStart) * SPEECH_SPEED;
      const signal = sampleSpeech(smoothedProfile, time);
      const delta = lastPaint ? Math.min(0.1, Math.max(0, (now - lastPaint) / 1000)) : 1 / 30;
      lastPaint = now;
      const response = signal.level > visualLevel ? 0.12 : 0.26;
      visualLevel += (signal.level - visualLevel) * (1 - Math.exp(-delta / response));
      if (signal.pitch > 0) visualPitch += (signal.pitch - visualPitch) * (1 - Math.exp(-delta / 0.35));
      const level = motion.matches ? 0.8 : Math.pow(Math.max(0, visualLevel), 0.65);
      const flow = now / 1000;
      const voice = canvas.closest<HTMLElement>(".conversation-voice");
      voice?.setAttribute("data-speaking", String(time >= 0 && time < profile.duration));
      voice?.style.setProperty("--speech-energy", level.toFixed(3));
      context.clearRect(0, 0, width, height);
      const phase = speaker === "tutor" ? 0 : 1.8;
      const amplitude = height * (0.065 + level * 0.34);
      // Pitch subtly changes the whole ribbon; it never changes abruptly across x.
      const frequency = 5 + Math.max(-0.35, Math.min(0.35, (visualPitch - 160) / 300));
      // Closely spaced contours form a translucent, sculptural voice ribbon.
      for (let strand = 0; strand < STRAND_COUNT; strand++) {
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
          const syllable = 0.72 + 0.28 * Math.sin(flow * 2.6 + x * 8 + phase);
          const wave = Math.sin(x * Math.PI * frequency - flow * 2.3 + depth * 2.5 + phase)
            * 0.65 + Math.sin(x * Math.PI * 9 + flow * 1.4 + depth * 1.8) * 0.22;
          const y = height / 2 + envelope * (wave * amplitude * syllable + (depth - 0.5) * amplitude * 0.9);
          if (point === 0) context.moveTo(x * width, y);
          else context.lineTo(x * width, y);
        }
        context.stroke();
      }
    };
    const tick = (now: number) => {
      if (!visible || document.hidden) return;
      if (now - lastFrame >= 1000 / 60) { paint(now); lastFrame = now; }
      if (!motion.matches) frame = requestAnimationFrame(tick);
    };
    const restart = () => { cancelAnimationFrame(frame); canvas.closest(".conversation-voice")?.setAttribute("data-animating", String(visible && !document.hidden)); lastFrame = 0; if (visible && !document.hidden) { paint(performance.now()); if (!motion.matches) frame = requestAnimationFrame(tick); } };
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; restart(); });
    const sizes = new ResizeObserver(() => { resize(); restart(); });
    const themeObserver = new MutationObserver(() => { resize(); restart(); });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    observer.observe(canvas);
    sizes.observe(canvas);
    document.addEventListener("visibilitychange", restart);
    motion.addEventListener("change", restart);
    resize();
    restart();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); sizes.disconnect(); themeObserver.disconnect(); document.removeEventListener("visibilitychange", restart); motion.removeEventListener("change", restart); };
  }, [speaker, startedAt, profile, turnStart]);

  return <canvas ref={canvasRef} className={`conversation-waveform conversation-waveform--${speaker}`} aria-hidden="true" />;
}

