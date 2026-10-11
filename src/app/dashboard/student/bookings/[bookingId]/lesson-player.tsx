"use client";

import { useCallback, useRef, useState, type PointerEvent } from "react";
import { MonitorUp, Pause, Play, Volume2, VolumeX } from "lucide-react";

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
const SPEEDS = [1, 1.25, 1.5, 2, 0.75];

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
 * stitched into one file, so seeking anywhere keeps the audio intact. The
 * timeline marks where each share falls in the lesson.
 */
export function LessonPlayer({
  audioSrc,
  audioStartMs,
  audioDurationMs,
  screens,
}: {
  audioSrc: string;
  audioStartMs: number;
  /** Used until the browser reports the file's own duration. */
  audioDurationMs?: number;
  screens: ScreenSegment[];
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [time, setTime] = useState(0);
  const [mediaDuration, setMediaDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [muted, setMuted] = useState(false);
  const [hover, setHover] = useState<{ fraction: number; seconds: number } | null>(null);

  const duration = mediaDuration || (audioDurationMs ?? 0) / 1000;
  const active = screens.find((screen) => screen.id === activeId) ?? null;
  // Where each share sits on the timeline, in seconds into the audio.
  const marks = screens.map((screen, index) => ({
    ...screen,
    index,
    from: Math.max(0, (screen.startMs - audioStartMs) / 1000),
    to: Math.max(0, (screen.endMs - audioStartMs) / 1000),
  }));
  const markAt = (seconds: number) => marks.find((mark) => seconds >= mark.from && seconds < mark.to) ?? null;
  const percent = (seconds: number) => (duration > 0 ? Math.min(100, Math.max(0, (seconds / duration) * 100)) : 0);

  const sync = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    setTime(audio.currentTime);
    setPlaying(!audio.paused);
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

  function seek(seconds: number) {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.min(Math.max(0, seconds), duration || seconds);
    sync();
  }

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play();
    else audio.pause();
  }

  function cycleSpeed() {
    const audio = audioRef.current;
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    setSpeed(next);
    if (audio) audio.playbackRate = next;
  }

  function toggleMute() {
    const audio = audioRef.current;
    if (!audio) return;
    audio.muted = !audio.muted;
    setMuted(audio.muted);
  }

  function trackHover(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    setHover({ fraction, seconds: fraction * duration });
  }

  const current = markAt(time);
  const hovered = hover ? markAt(hover.seconds) : null;

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
        preload="metadata"
        crossOrigin="anonymous"
        onPlay={() => {
          downmixToMono();
          sync();
        }}
        onPause={sync}
        onSeeked={sync}
        onTimeUpdate={sync}
        onRateChange={sync}
        onEnded={sync}
        onLoadedMetadata={(event) => setMediaDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
        onDurationChange={(event) => setMediaDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
      >
        <source src={audioSrc} type="audio/ogg" />
      </audio>

      <div className="flex items-center gap-3 rounded-lg border border-border px-3 py-2">
        <button
          type="button"
          onClick={togglePlay}
          aria-label={playing ? "Pause" : "Play"}
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-opacity hover:opacity-85"
        >
          {playing ? <Pause className="size-4" /> : <Play className="size-4 translate-x-px" />}
        </button>

        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {clock(time)} / {clock(duration)}
        </span>

        <div className="relative min-w-0 flex-1 py-2" onPointerMove={trackHover} onPointerLeave={() => setHover(null)}>
          <div className="relative h-1.5 rounded-full">
            {/* Unplayed: the track, with each screen share lightly marked. */}
            <div className="absolute inset-0 rounded-full bg-muted" />
            {marks.map((mark) => (
              <div
                key={mark.id}
                className="absolute inset-y-0 rounded-full bg-saffron/45"
                style={{ left: `${percent(mark.from)}%`, width: `${percent(mark.to) - percent(mark.from)}%` }}
              />
            ))}
            {/* Played: the same marks in full colour, clipped at the playhead. */}
            <div className="absolute inset-0" style={{ clipPath: `inset(0 ${100 - percent(time)}% 0 0)` }}>
              <div className="absolute inset-0 rounded-full bg-foreground/55" />
              {marks.map((mark) => (
                <div
                  key={mark.id}
                  className="absolute inset-y-0 rounded-full bg-saffron"
                  style={{ left: `${percent(mark.from)}%`, width: `${percent(mark.to) - percent(mark.from)}%` }}
                />
              ))}
            </div>
            <div
              className="pointer-events-none absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground shadow"
              style={{ left: `${percent(time)}%` }}
            />
          </div>

          {hover && duration > 0 && (
            <div
              className="pointer-events-none absolute bottom-full mb-1 -translate-x-1/2 whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-xs text-background shadow"
              style={{ left: `${hover.fraction * 100}%` }}
            >
              {clock(hover.seconds)}
              {hovered && ` · Screen share ${hovered.index + 1}`}
            </div>
          )}

          {/* A native range input on top gives clicking, dragging, keyboard
              arrows and screen-reader support; the bar underneath is the look. */}
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={Math.min(time, duration || 0)}
            onChange={(event) => seek(Number(event.target.value))}
            onKeyDown={(event) => {
              // The 0.1 s step keeps clicking precise; arrows jump 5 s instead.
              if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                event.preventDefault();
                seek(time + (event.key === "ArrowRight" ? 5 : -5));
              }
            }}
            aria-label="Seek"
            aria-valuetext={`${clock(time)} of ${clock(duration)}${current ? `, during screen share ${current.index + 1}` : ""}`}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </div>

        <button
          type="button"
          onClick={cycleSpeed}
          aria-label={`Playback speed ${speed}×`}
          className="shrink-0 rounded-md px-1.5 py-1 text-xs font-medium tabular-nums text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {speed}×
        </button>
        <button
          type="button"
          onClick={toggleMute}
          aria-label={muted ? "Unmute" : "Mute"}
          className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
        </button>
      </div>

      {screens.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="inline-block h-1.5 w-4 rounded-full bg-saffron" />
            Screen share
          </span>
          {marks.map((mark) => (
            <button
              key={mark.id}
              type="button"
              onClick={() => seek(mark.from)}
              className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              Screen share {mark.index + 1} · {clock(mark.from)}–{clock(mark.to)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
