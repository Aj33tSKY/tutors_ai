"use client";

import { motion, useReducedMotion, type Variants } from "framer-motion";

const variants: Variants = {
  hidden: { opacity: 0, y: 28 },
  visible: { opacity: 1, y: 0 },
};

export function Reveal({
  children,
  delay = 0,
  className,
  as = "div",
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
  as?: "div" | "li" | "section";
}) {
  const reduceMotion = useReducedMotion();
  const Comp = motion[as];

  return (
    <Comp
      // Marks the element for the <noscript> fallback in the root layout:
      // these server-render with an inline opacity:0 that only the in-view
      // observer clears, so without JS they would never appear.
      data-reveal=""
      className={className}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: "-60px" }}
      variants={variants}
      // Reduced motion may only affect the transition, never `variants` or
      // `initial`: those decide the server-rendered inline style, and
      // useReducedMotion() resolves differently on the server, so branching
      // them produces a hydration mismatch.
      // Reference easing: expo-out at 0.75s.
      transition={
        reduceMotion
          ? { duration: 0, delay: 0 }
          : { duration: 0.75, delay, ease: [0.19, 1, 0.22, 1] }
      }
    >
      {children}
    </Comp>
  );
}
