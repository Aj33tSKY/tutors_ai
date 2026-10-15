"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Maximize, Minimize } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Wraps the session recording in a card whose own container (not just the
 * video element) can go full screen — the lesson player's screen-share video
 * has no native controls of its own, so the browser's native per-<video>
 * full-screen button isn't available for it.
 */
export function RecordingCard({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  function toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void containerRef.current?.requestFullscreen();
  }

  return (
    <div ref={containerRef} className={fullscreen ? "flex h-full w-full bg-background p-4" : undefined}>
      <Card className={fullscreen ? "flex h-full w-full flex-col" : undefined}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {icon} {title}
          </CardTitle>
          <CardAction>
            <Button type="button" variant="ghost" size="sm" onClick={toggleFullscreen} aria-label={fullscreen ? "Exit full screen" : "Full screen"} title={fullscreen ? "Exit full screen" : "Full screen"}>
              {fullscreen ? <Minimize className="size-4" /> : <Maximize className="size-4" />}
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className={fullscreen ? "min-h-0 flex-1 overflow-y-auto" : undefined}>{children}</CardContent>
      </Card>
    </div>
  );
}
