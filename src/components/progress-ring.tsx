"use client";

import { motion, useReducedMotion } from "framer-motion";

export function ProgressRing({
  value,
  size = 112,
  stroke = 2,
  label,
  color = "var(--saffron)",
  track = "var(--hairline)",
}: {
  value: number;
  size?: number;
  stroke?: number;
  label?: string;
  color?: string;
  /** Colour of the unfilled arc — override when the ring sits on a colour block. */
  track?: string;
}) {
  const reduceMotion = useReducedMotion();
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.min(Math.max(value, 0), 100) / 100);

  return (
    <figure className="flex flex-col items-center gap-4">
      <div
        className="relative inline-flex items-center justify-center"
        style={{ width: size, height: size }}
        role="img"
        aria-label={label ? `${label}: ${Math.round(value)}% covered` : `${Math.round(value)}%`}
      >
        <svg width={size} height={size} className="-rotate-90" aria-hidden>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={track}
            strokeWidth={stroke}
          />
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeDasharray={circumference}
            // same initial on server and client; only the transition branches
            initial={{ strokeDashoffset: circumference }}
            whileInView={{ strokeDashoffset: offset }}
            viewport={{ once: true }}
            transition={{ duration: reduceMotion ? 0 : 1.2, ease: [0.19, 1, 0.22, 1] }}
          />
        </svg>
        <span
          aria-hidden
          className="absolute font-heading text-3xl leading-none tabular-nums"
          style={{ color }}
        >
          {Math.round(value)}
        </span>
      </div>
      {label && <figcaption className="eyebrow">{label}</figcaption>}
    </figure>
  );
}
