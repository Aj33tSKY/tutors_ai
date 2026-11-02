"use client";

import { useLayoutEffect, useRef } from "react";

export function InsightConnector({ ready, revision }: { ready: boolean; revision: string }) {
  const ref = useRef<SVGSVGElement>(null);

  useLayoutEffect(() => {
    const svg = ref.current;
    const row = svg?.closest(".conversation-turn");
    if (!svg || !row) return;
    svg.setAttribute("data-connected", "false");
    if (!ready) return;

    const outside = row.closest<HTMLElement>("[data-notes=outside]");
    const origin = outside ?? row;
    const update = () => {
      const evidence = row.querySelector(".conversation-evidence");
      const note = row.querySelector(".conversation-analysis__insight");
      const voice = row.querySelector(".conversation-voice");
      if (!evidence || !note || !voice) {
        svg.setAttribute("data-connected", "false");
        return;
      }
      const transcript = row.querySelector(".conversation-caption > span[aria-hidden=true]");
      if (!transcript) return;
      const bounds = origin.getBoundingClientRect();
      const target = note.getBoundingClientRect();
      const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
      const words: DOMRect[] = [];
      const walker = document.createTreeWalker(transcript, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        for (const match of (node.textContent ?? "").matchAll(/\S+/g)) {
          const range = document.createRange();
          range.setStart(node, match.index!);
          range.setEnd(node, match.index! + match[0].length);
          words.push(...Array.from(range.getClientRects()).filter(rect => rect.width && rect.height));
        }
      }
      const highlights = Array.from(evidence.getClientRects()).filter(rect => rect.width && rect.height);
      const distanceToNote = (rect: DOMRect) => Math.hypot(
        Math.max(target.left - rect.right, rect.left - target.right, 0),
        Math.max(target.top - rect.bottom, rect.top - target.bottom, 0),
      );
      highlights.sort((a, b) => distanceToNote(a) - distanceToNote(b));
      const obstacles = [
        ...words, ...highlights, target,
        ...Array.from(origin.querySelectorAll(".conversation-voice, .conversation-analysis__insight"))
          .filter(element => element !== voice && element !== note)
          .map(element => element.getBoundingClientRect()),
      ];
      type Anchor = { x: number; y: number; nx: number; ny: number };
      const edgeAnchors = (rect: DOMRect, other: DOMRect, inset: number): Anchor[] => {
        const x = clamp((other.left + other.right) / 2, rect.left + inset, rect.right - inset);
        const y = clamp((other.top + other.bottom) / 2, rect.top + inset, rect.bottom - inset);
        return [
          { x: rect.right, y, nx: 1, ny: 0 },
          { x, y: rect.bottom, nx: 0, ny: 1 },
          { x, y: rect.top, nx: 0, ny: -1 },
          { x: rect.left, y, nx: -1, ny: 0 },
        ];
      };
      let chosen: { start: Anchor; end: Anchor; c1: Anchor; c2: Anchor; length: number } | undefined;
      // Prefer the nearest wrapped highlight fragment. Try its edges and gentle
      // handle lengths, selecting the shortest curve that clears every word.
      for (const highlight of highlights) {
        for (const start of edgeAnchors(highlight, target, 2)) {
          for (const end of edgeAnchors(target, highlight, 12)) {
            const distance = Math.hypot(end.x - start.x, end.y - start.y);
            for (const factor of [0.2, 0.35, 0.55, 0.8]) {
              const handle = Math.max(10, Math.min(140, distance * factor));
              const c1 = { ...start, x: start.x + start.nx * handle, y: start.y + start.ny * handle };
              const c2 = { ...end, x: end.x + end.nx * handle, y: end.y + end.ny * handle };
              const steps = Math.max(12, Math.ceil(distance + handle * 2));
              let length = 0;
              let px = start.x;
              let py = start.y;
              let blocked = false;
              for (let step = 1; step <= steps; step++) {
                const t = step / steps;
                const u = 1 - t;
                const x = u ** 3 * start.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t ** 3 * end.x;
                const y = u ** 3 * start.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t ** 3 * end.y;
                length += Math.hypot(x - px, y - py);
                px = x; py = y;
                if (step > 2 && step < steps - 2 && obstacles.some(rect => x > rect.left - 0.5 && x < rect.right + 0.5 && y > rect.top - 0.5 && y < rect.bottom + 0.5)) {
                  blocked = true;
                  break;
                }
              }
              if (!blocked && (!chosen || length < chosen.length)) chosen = { start, end, c1, c2, length };
            }
          }
        }
        if (chosen) break;
      }
      if (!chosen) { svg.setAttribute("data-connected", "false"); return; }
      const { start, end, c1, c2 } = chosen;
      const x1 = start.x - bounds.left;
      const y1 = start.y - bounds.top;
      const path = `M${x1} ${y1} C${c1.x - bounds.left} ${c1.y - bounds.top} ${c2.x - bounds.left} ${c2.y - bounds.top} ${end.x - bounds.left} ${end.y - bounds.top}`;
      svg.setAttribute("viewBox", `0 0 ${bounds.width} ${bounds.height}`);
      svg.querySelector("path")?.setAttribute("d", path);
      const dot = svg.querySelector("circle");
      dot?.setAttribute("cx", String(x1));
      dot?.setAttribute("cy", String(y1));
      svg.setAttribute("data-connected", "true");
    };
    update();
    const resize = new ResizeObserver(update);
    resize.observe(origin);
    const voice = row.querySelector(".conversation-voice");
    if (voice) resize.observe(voice);
    const note = row.querySelector(".conversation-analysis__insight");
    if (note) resize.observe(note);
    let disposed = false;
    void document.fonts.ready.then(() => { if (!disposed) update(); });
    window.addEventListener("resize", update);
    document.fonts.addEventListener("loadingdone", update);
    return () => {
      disposed = true;
      resize.disconnect();
      window.removeEventListener("resize", update);
      document.fonts.removeEventListener("loadingdone", update);
    };
  }, [ready, revision]);

  return (
    <svg ref={ref} className="conversation-insight-link" data-connected="false" fill="none" aria-hidden="true">
      <path pathLength="1" />
      <circle r="1.75" />
    </svg>
  );
}
