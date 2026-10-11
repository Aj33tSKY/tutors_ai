"use client";

import { useCallback, useRef, useState } from "react";
import { MonitorUp } from "lucide-react";

export type ScreenSegment = {
  id: string;
  src: string;
  type: "video/mp4" | "video/webm";
  /** Wall-clock milliseconds, from the recording's own media timestamps. */
  startMs: number;
  endMs: number;
};

/** How far the screen video may drift from the audio before it is re-seeked. */
const MAX_DRIFT_SECONDS = 0.3;

function clock(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * Plays a lesson's audio with its screen shares alongside. The audio is the
 * whole lesson and is what the controls drive; each screen share is a separate,
 * silent video saved only while it was being shared, shown whenever the audio
 * reaches a moment it covers. They are lined up by start time rather than
 * stitched into one file, so seeking anywhere keeps the audio intact.
 */
export function LessonPlayer({
  audioSrc,
  audioStartMs,
  screens,
}: {
  audioSrc: string;
  audioStartMs: number;
  screens: ScreenSegment[];
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = screens.find((screen) => screen.id === activeId) ?? null;

  const sync = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const at = audioStartMs + audio.currentTime * 1000;
    const current = screens.find((screen) => at >= screen.startMs && at < screen.endMs) ?? null;
    setActiveId(current?.id ?? null);

    // Until React swaps the element in, the ref can still be the previous
    // share's video; never seek that one to this share's position.
    const video = videoRef.current;
    if (!current || !video || video.dataset.segment !== current.id) return;
    const target = (at - current.startMs) / 1000;
    if (Math.abs(video.currentTime - target) > MAX_DRIFT_SECONDS) video.currentTime = target;
    video.playbackRate = audio.playbackRate;
    if (audio.paused) video.pause();
    else void video.play().catch(() => {});
  }, [audioStartMs, screens]);

  // Recordings are stereo with the tutor hard-panned left and the student
  // right (that split is what transcription relies on), which sounds wrong in
  // headphones. Playback mixes both channels down to mono instead; the stored
  // file stays stereo.
  function downmixToMono() {
    const element = audioRef.current;
    if (!element) return;
    if (contextRef.current) {
      void contextRef.current.resume();
      return;
    }
    try {
      // Created on first play rather than on mount: browsers only allow an
      // AudioContext to start after a user gesture.
      const context = new AudioContext();
      const source = context.createMediaElementSource(element);
      const mono = context.createGain();
      mono.channelCount = 1;
      mono.channelCountMode = "explicit";
      mono.channelInterpretation = "speakers";
      // The standard downmix averages the channels, and each voice sits alone
      // on its own channel, so averaging halves everyone's volume. Doubling
      // restores each speaker to their recorded level.
      mono.gain.value = 2;
      source.connect(mono).connect(context.destination);
      contextRef.current = context;
    } catch (error) {
      console.warn("Could not mix the recording down to mono; playing it as recorded.", error);
    }
  }

  function jumpTo(screen: ScreenSegment) {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.max(0, (screen.startMs - audioStartMs) / 1000);
    sync();
  }

  return (
    <div className="space-y-3">
      {screens.length > 0 && (
        <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-black">
          {active ? (
            <video
              key={active.id}
              ref={videoRef}
              data-segment={active.id}
              muted
              playsInline
              preload="auto"
              className="h-full w-full object-contain"
              onLoadedMetadata={sync}
            >
              <source src={active.src} type={active.type} />
            </video>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-white/60">
              <MonitorUp className="size-6" />
              No screen was being shared at this point in the lesson.
            </div>
          )}
        </div>
      )}
      {/* crossOrigin is required for Web Audio to read a file from Supabase
          Storage's domain; without it the browser outputs silence. */}
      <audio
        ref={audioRef}
        controls
        preload="metadata"
        crossOrigin="anonymous"
        className="w-full"
        onPlay={() => {
          downmixToMono();
          sync();
        }}
        onPause={sync}
        onSeeked={sync}
        onTimeUpdate={sync}
        onRateChange={sync}
      >
        <source src={audioSrc} type="audio/ogg" />
        Your browser does not support session audio playback.
      </audio>
      {screens.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {screens.map((screen, index) => {
            const from = (screen.startMs - audioStartMs) / 1000;
            const to = (screen.endMs - audioStartMs) / 1000;
            return (
              <button
                key={screen.id}
                type="button"
                onClick={() => jumpTo(screen)}
                className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                Screen share {index + 1} · {clock(from)}–{clock(to)}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
