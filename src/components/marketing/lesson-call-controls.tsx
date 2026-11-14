"use client";

import { useState } from "react";
import { Mic, MicOff, Phone, RotateCcw, ScreenShare, ScreenShareOff, Video, VideoOff } from "lucide-react";

/** Illustrative device states only; this preview never requests device access. */
export function LessonCallControls({ ended, onEnd, onReplay }: {
  ended: boolean;
  onEnd: () => void;
  onReplay: () => void;
}) {
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [sharing, setSharing] = useState(false);

  if (ended) return (
    <div className="lesson-call-controls" role="group" aria-label="Lesson call preview">
      <button type="button" className="lesson-call-controls__replay" onClick={onReplay}><RotateCcw size={14} />Replay lesson</button>
    </div>
  );

  return (
    <div className="lesson-call-controls" role="group" aria-label="Illustrative lesson call controls">
      <button type="button" className="lesson-call-control" aria-label={muted ? "Unmute demo microphone" : "Mute demo microphone"} aria-pressed={muted} title={muted ? "Unmute microphone preview" : "Mute microphone preview"} onClick={() => setMuted(value => !value)}>
        {muted ? <MicOff size={17} /> : <Mic size={17} />}
      </button>
      <button type="button" className="lesson-call-control" aria-label={cameraOff ? "Turn demo camera on" : "Turn demo camera off"} aria-pressed={cameraOff} title={cameraOff ? "Turn camera preview on" : "Turn camera preview off"} onClick={() => setCameraOff(value => !value)}>
        {cameraOff ? <VideoOff size={17} /> : <Video size={17} />}
      </button>
      <button type="button" className="lesson-call-control" aria-label={sharing ? "Stop screen sharing preview" : "Preview screen sharing"} aria-pressed={sharing} title={sharing ? "Stop screen sharing preview" : "Preview screen sharing"} onClick={() => setSharing(value => !value)}>
        {sharing ? <ScreenShareOff size={17} /> : <ScreenShare size={17} />}
      </button>
      <button type="button" className="lesson-call-control lesson-call-control--end" aria-label="End lesson preview" title="End lesson preview" onClick={onEnd}><Phone size={17} className="lesson-call-control__hangup" /></button>
    </div>
  );
}
