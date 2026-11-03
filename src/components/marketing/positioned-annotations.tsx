"use client";

import { useLayoutEffect, type RefObject } from "react";

/** Align notes with evidence while preserving their column and reading order. */
export function PositionedAnnotations({ stageRef, mode }: { stageRef: RefObject<HTMLDivElement | null>; mode: "aligned" | "docked" }) {
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const narrow = window.matchMedia("(max-width: 640px)");
    let frame = 0;
    const clear = () => {
      stage.querySelectorAll<HTMLElement>(".conversation-analysis__insight").forEach(note => {
        note.style.removeProperty("--dock-x");
        note.style.removeProperty("--dock-y");
      });
    };
    const update = () => {
      if (narrow.matches) {
        clear();
        stage.dataset.dockLayout = "stacked";
        return;
      }
      const bounds = stage.getBoundingClientRect();
      const topLimit = bounds.top + 12;
      const bottomLimit = bounds.bottom + 24;
      const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
      const placements: { note: HTMLElement; left: number; top: number; height: number; baseLeft: number; baseTop: number; obstacles: DOMRect[] }[] = [];
      stage.querySelectorAll(".conversation-turn").forEach(row => {
        const evidence = row.querySelector(".conversation-evidence");
        const voice = row.querySelector(".conversation-voice");
        const note = row.querySelector<HTMLElement>(".conversation-analysis__insight");
        // Keep the outgoing note at its old position throughout its fade-out.
        if (!evidence || !voice || !note) return;
        const fragments = Array.from(evidence.getClientRects()).filter(rect => rect.width && rect.height);
        if (!fragments.length) return;
        const source = voice.getBoundingClientRect();
        fragments.sort((a, b) => Math.abs(source.right - a.right) - Math.abs(source.right - b.right));
        const nearest = fragments[0];
        const target = note.getBoundingClientRect();
        const oldX = parseFloat(note.style.getPropertyValue("--dock-x")) || 0;
        const oldY = parseFloat(note.style.getPropertyValue("--dock-y")) || 0;
        const top = clamp((nearest.top + nearest.bottom - target.height) / 2, topLimit, bottomLimit - target.height);
        const obstacles = Array.from(row.querySelectorAll(".conversation-caption, .conversation-voice__label, .conversation-waveform, .conversation-recording"))
          .map(element => element.getBoundingClientRect());
        placements.push({ note, left: mode === "aligned" ? target.left - oldX : source.right - 8, top, height: target.height, baseLeft: target.left - oldX, baseTop: target.top - oldY, obstacles });
      });
      if (!placements.length) return;
      // Solve both notes together so a long explanation cannot collide with the
      // next one. Leave room below the card for the final annotation and controls.
      let cursor = topLimit;
      for (const placement of placements) {
        placement.top = Math.max(placement.top, cursor);
        cursor = placement.top + placement.height + 16;
      }
      cursor = bottomLimit;
      for (const placement of [...placements].reverse()) {
        placement.top = Math.min(placement.top, cursor - placement.height);
        cursor = placement.top - 16;
      }
      if (placements[0].top < topLimit) {
        // Unusually tall notes keep the ordinary paired-column layout.
        clear();
        stage.dataset.dockLayout = "paired";
        return;
      }
      stage.dataset.dockLayout = mode;
      for (const { note, left, top, height, baseLeft, baseTop, obstacles } of placements) {
        // Recheck after the vertical solve, which can move a long note past a
        // different part of the voice. Empty border margin is the only overlap.
        const safeLeft = mode === "aligned" ? left : obstacles.reduce((x, obstacle) => top < obstacle.bottom + 2 && top + height > obstacle.top - 2 ? Math.max(x, obstacle.right + 2) : x, left);
        note.style.setProperty("--dock-x", `${(safeLeft - baseLeft).toFixed(2)}px`);
        note.style.setProperty("--dock-y", `${(top - baseTop).toFixed(2)}px`);
      }
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(update); };
    const resize = new ResizeObserver(schedule);
    resize.observe(stage);
    stage.querySelectorAll(".conversation-voice, .conversation-analysis__insight").forEach(element => resize.observe(element));
    // Evidence and review contents change independently of the speech canvas.
    const contents = new MutationObserver(schedule);
    contents.observe(stage, { childList: true, subtree: true });
    let disposed = false;
    void document.fonts.ready.then(() => { if (!disposed) schedule(); });
    document.fonts.addEventListener("loadingdone", schedule);
    window.addEventListener("resize", schedule);
    narrow.addEventListener("change", schedule);
    update();
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      resize.disconnect();
      contents.disconnect();
      document.fonts.removeEventListener("loadingdone", schedule);
      window.removeEventListener("resize", schedule);
      narrow.removeEventListener("change", schedule);
      clear();
    };
  }, [stageRef, mode]);
  return null;
}
