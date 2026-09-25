"use client";

import { useEffect, useRef, useState } from "react";
import { LiveKitRoom, VideoConference, useRoomContext } from "@livekit/components-react";
import { ConnectionState, RoomEvent } from "livekit-client";
import "@livekit/components-styles";
import { Check, LoaderCircle, Maximize2, Minimize2, Play, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { consentToSessionRecording } from "./recording-consent-action";

export function VideoRoom({
  token,
  serverUrl,
  bookingId,
  subject,
  isTutor,
  tutorIdentity,
  recordingConsented: initiallyConsented,
}: {
  token: string;
  serverUrl: string;
  roomName: string;
  bookingId: string;
  subject: string;
  isTutor: boolean;
  tutorIdentity: string;
  recordingConsented: boolean;
}) {
  const roomRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [joined, setJoined] = useState(false);
  const [tutorPresent, setTutorPresent] = useState(isTutor);
  const [consentForRecording, setConsentForRecording] = useState(false);
  const [recordingConsented, setRecordingConsented] = useState(initiallyConsented);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  useEffect(() => {
    const updateFullscreenState = () => setIsFullscreen(document.fullscreenElement === roomRef.current);
    document.addEventListener("fullscreenchange", updateFullscreenState);
    return () => document.removeEventListener("fullscreenchange", updateFullscreenState);
  }, []);
  async function enterFullscreen() {
    if (isFullscreen) await document.exitFullscreen?.();
    else await roomRef.current?.requestFullscreen?.();
  }

  useEffect(() => {
    if (isTutor || joined) return;
    let active = true;
    const checkTutorPresence = async () => {
      try {
        const response = await fetch(`/api/session/${bookingId}/presence`, { cache: "no-store" });
        if (!response.ok) return;
        const data = (await response.json()) as { tutorPresent?: boolean };
        if (active) setTutorPresent(Boolean(data.tutorPresent));
      } catch {
        // Keep the waiting state and retry on the next poll.
      }
    };
    void checkTutorPresence();
    const interval = window.setInterval(checkTutorPresence, 2_500);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [bookingId, isTutor, joined]);

  async function joinAsTutor(withRecording: boolean) {
    setJoining(true);
    setJoinError(null);
    if (withRecording && !recordingConsented) {
      const result = await consentToSessionRecording(bookingId);
      if (result.error) {
        setJoinError(result.error);
        setJoining(false);
        return;
      }
      setRecordingConsented(true);
    }
    setJoined(true);
  }

  return (
    <div
      ref={roomRef}
      className="relative mx-auto h-[calc(100dvh-6.5rem)] w-full overflow-hidden rounded-2xl border border-hairline bg-black sm:aspect-video sm:h-auto sm:w-[85%] sm:max-w-none [&:fullscreen]:h-[100dvh] [&:fullscreen]:w-full [&:fullscreen]:max-w-none [&:fullscreen]:rounded-none [&:fullscreen]:border-0 [&:fullscreen]:aspect-auto"
      data-lk-theme="default"
    >
      {joined && <Button type="button" size="sm" variant="secondary" className="absolute top-3 right-3 z-30" onClick={enterFullscreen}>{isFullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}{isFullscreen ? "Exit full screen" : "Full screen"}</Button>}
      {!joined ? <div className="absolute inset-0 flex flex-col items-center justify-center overflow-y-auto px-6 py-6 text-center text-white"><div className="flex size-14 shrink-0 items-center justify-center rounded-full bg-white/10"><Video className="size-6" /></div><h2 className="mt-5 font-heading text-xl font-semibold">{isTutor ? "Continue this session" : tutorPresent ? "Your tutor is here" : "Waiting for your tutor"}</h2><p className="mt-2 max-w-md text-sm leading-relaxed text-white/70">{isTutor ? "Your original start time and lesson history are preserved. When you leave, transcription and recording will pause; rejoining starts a new recording segment." : tutorPresent ? "You’re in the waiting area. Join the call when you’re ready." : "You’ll be able to join the call as soon as your tutor arrives."}</p>{isTutor && (recordingConsented ? <p className="mt-4 flex items-center gap-2 text-sm text-white/80"><Check className="size-4 text-emerald-400" />Recording will start when you join and be deleted after 90 days.</p> : <div className="mt-5 max-w-lg rounded-xl border border-white/15 bg-white/5 p-4 text-left"><label className="flex cursor-pointer items-start gap-3 text-sm leading-relaxed"><input type="checkbox" checked={consentForRecording} onChange={(event) => setConsentForRecording(event.target.checked)} className="mt-1 size-4 accent-saffron" /><span>I agree to record this lesson’s audio and video. The recording is saved with the session and automatically deleted after 90 days.</span></label></div>)}{!isTutor && recordingConsented && <p className="mt-4 text-sm text-white/80">This session is being recorded for lesson notes. The recording is deleted after 90 days.</p>}{joining ? <Button type="button" size="lg" className="mt-6" disabled><LoaderCircle className="size-4 animate-spin" />Connecting…</Button> : isTutor ? <div className="mt-6 flex flex-col items-center gap-2"><Button type="button" size="lg" onClick={() => void joinAsTutor(recordingConsented || consentForRecording)}><Play className="size-4" />{recordingConsented || consentForRecording ? "Continue and record" : "Continue without recording"}</Button>{!recordingConsented && consentForRecording && <Button type="button" size="sm" variant="ghost" className="text-white/75 hover:text-white" onClick={() => void joinAsTutor(false)}>Join without recording</Button>}</div> : <Button type="button" size="lg" className="mt-6" disabled={!tutorPresent} onClick={() => setJoined(true)}><Play className="size-4" />Join session</Button>}{joinError && <p role="alert" className="mt-3 text-sm text-red-300">{joinError}</p>}</div> : <LiveKitRoom
        token={token}
        serverUrl={serverUrl}
        connect
        audio
        video
        style={{ height: "100%" }}
        onConnected={() => { if (isTutor) setTutorPresent(true); }}
        onDisconnected={() => setJoined(false)}
      >
        <VideoConference />
        {!isTutor && <TutorPresenceMonitor tutorIdentity={tutorIdentity} onPresenceChange={setTutorPresent} />}
      </LiveKitRoom>}
      <span className="sr-only">{subject} session</span>
    </div>
  );
}

function TutorPresenceMonitor({
  tutorIdentity,
  onPresenceChange,
}: {
  tutorIdentity: string;
  onPresenceChange: (present: boolean) => void;
}) {
  const room = useRoomContext();
  const [present, setPresent] = useState(false);

  useEffect(() => {
    const updatePresence = () => {
      // Before the room finishes connecting, remoteParticipants is empty and
      // says nothing about who is in the call. Treating that as "the tutor
      // left" would hide the call behind the overlay and cut the student's
      // devices while they were still connecting.
      if (room.state !== ConnectionState.Connected) return;

      const tutorIsPresent = room.remoteParticipants.has(tutorIdentity);
      setPresent(tutorIsPresent);
      onPresenceChange(tutorIsPresent);
      if (!tutorIsPresent) {
        void room.localParticipant.setMicrophoneEnabled(false);
        void room.localParticipant.setCameraEnabled(false);
      }
    };

    updatePresence();
    // Connected and Reconnected matter as much as the participant events: a
    // tutor who was already in the room when the student joined is populated
    // during connection and never raises ParticipantConnected, so those two
    // events alone would leave the student waiting for something that has
    // already happened.
    room.on(RoomEvent.Connected, updatePresence);
    room.on(RoomEvent.Reconnected, updatePresence);
    room.on(RoomEvent.ParticipantConnected, updatePresence);
    room.on(RoomEvent.ParticipantDisconnected, updatePresence);
    return () => {
      room.off(RoomEvent.Connected, updatePresence);
      room.off(RoomEvent.Reconnected, updatePresence);
      room.off(RoomEvent.ParticipantConnected, updatePresence);
      room.off(RoomEvent.ParticipantDisconnected, updatePresence);
    };
  }, [onPresenceChange, room, tutorIdentity]);

  return present ? null : <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/85 px-6 text-center text-white"><LoaderCircle className="size-7 animate-spin text-saffron" /><h2 className="mt-4 font-heading text-xl font-semibold">Your tutor has left the session</h2><p className="mt-2 max-w-md text-sm leading-relaxed text-white/75">You’re safely waiting here. Your microphone and camera are off. The room will resume when your tutor rejoins.</p></div>;
}
