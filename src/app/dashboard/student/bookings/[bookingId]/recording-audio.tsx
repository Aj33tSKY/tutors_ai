"use client";

import { useRef } from "react";

/**
 * Recordings are stereo with the tutor hard-panned left and the student right
 * (that split is what transcription relies on), which sounds wrong in
 * headphones — each person in one ear. Playback mixes both channels down to
 * mono instead. Only playback changes; the stored file stays stereo.
 */
export function RecordingAudio({ src }: { src: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const contextRef = useRef<AudioContext | null>(null);

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

  return (
    // crossOrigin is required for Web Audio to read a file from Supabase
    // Storage's domain; without it the browser outputs silence.
    <audio ref={audioRef} controls preload="metadata" crossOrigin="anonymous" className="w-full" onPlay={downmixToMono}>
      <source src={src} type="audio/ogg" />
      Your browser does not support session audio playback.
    </audio>
  );
}
