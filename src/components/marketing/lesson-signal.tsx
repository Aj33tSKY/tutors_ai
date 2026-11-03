"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Sparkles } from "lucide-react";
import { InsightConnector } from "./insight-connector";
import { LessonCallControls } from "./lesson-call-controls";
import { PositionedAnnotations } from "./positioned-annotations";
import "./conversation-docked.css";
import "./conversation-floating.css";
import "./conversation-outside.css";
import "./conversation-ribbon.css";
import "./conversation-annotations.css";
import "./conversation-call.css";
import scenarios from "./data/lesson-scenarios.json";
import { AudioWaveform, type SpeechProfile } from "./audio-waveform";
import speechData from "./data/lesson-speech.json";
import { SPEECH_SPEED, CAPTION_DELAY, TUTOR_START, TURN_GAP, REVIEW_HOLD, shuffledScenarios } from "./lesson-timing";

// Rollback: set this to false to restore the previous grid presentation.
const USE_FLOATING_INSIGHTS = true;
// Set false to put the notes back inside the floating card.
const PLACE_NOTES_OUTSIDE = true;
// Set false to restore the curved annotation threads.
const USE_DOCKED_ANNOTATIONS = false;
// Set false to restore the fine thread connectors.
const USE_SOFT_RIBBON = false;
// Set false to compare the previous connection treatments.
const USE_ALIGNED_NOTES = true;
// Stock portraits represent the participants in this illustrative demo.
const USE_PHOTOGRAPHIC_PROFILES = true;
// Set false to compare the audio-only presentation.
const USE_CALL_FRAME = true;

function spokenCaption(profile: SpeechProfile, elapsed: number, turnStart: number) {
  const time = (elapsed - turnStart - CAPTION_DELAY) * SPEECH_SPEED;
  let count = 0;
  let wordStart = 0;
  for (const [start, , from, to] of profile.words) {
    if (time < start) break;
    // Reveal a complete word at its measured speech onset.
    count = to;
    wordStart = from;
  }
  return { text: profile.text.slice(0, count), wordStart, typing: count > 0 && count < profile.text.length };
}

function InsightNote({ turn, ready }: {
  turn: { signal: string; review: string; emphasis?: string };
  ready: boolean;
}) {
  // Preserve the outgoing review while its existing DOM node fades away.
  const [lastVisibleTurn, setLastVisibleTurn] = useState(turn);
  if (ready && lastVisibleTurn !== turn) setLastVisibleTurn(turn);
  const displayedTurn = ready ? turn : lastVisibleTurn;

  return (
    <div className="conversation-analysis__insight" data-ready={ready} aria-hidden={!ready}>
      <span className="conversation-analysis__signal"><Sparkles className="conversation-insight-icon" size={12} aria-hidden="true" />{displayedTurn.signal}</span>
      <p>{displayedTurn.emphasis && displayedTurn.review.startsWith(displayedTurn.emphasis) ? <><strong>{displayedTurn.emphasis}</strong>{displayedTurn.review.slice(displayedTurn.emphasis.length)}</> : displayedTurn.review}</p>
    </div>
  );
}

export function LessonSignal() {
  const stageRef = useRef<HTMLDivElement>(null);
  const aligned = USE_FLOATING_INSIGHTS && PLACE_NOTES_OUTSIDE && USE_ALIGNED_NOTES;
  const docked = USE_FLOATING_INSIGHTS && PLACE_NOTES_OUTSIDE && USE_DOCKED_ANNOTATIONS;
  const [callEnded, setCallEnded] = useState(false);
  const replay = () => { setCallEnded(false); controls.current?.replay(); };
  const [startedAt, setStartedAt] = useState(0);
  const [pausedAt, setPausedAt] = useState<number | null>(null);
  const controls = useRef<{ toggle: () => void; replay: () => void } | null>(null);
  const [transcript, setTranscript] = useState({ index: 0, elapsed: 0, reduced: false });

  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let start = performance.now();
    // Lead with the same circular-motion insight used in the memory story below.
    let index = 3;
    let stoppedAt: number | null = null;
    let queue = shuffledScenarios(scenarios.length, index).filter(value => value !== index);
    const update = () => {
      if (document.hidden || stoppedAt !== null) return;
      let elapsed = (performance.now() - start) / 1000;
      const profile = speechData.exchanges[index];
      const duration = TUTOR_START + profile.tutor.duration / SPEECH_SPEED + TURN_GAP + profile.student.duration / SPEECH_SPEED + REVIEW_HOLD;
      if (!motion.matches && elapsed >= duration) {
        // Show the whole shuffled pool before repeating any scenario.
        if (!queue.length) queue = shuffledScenarios(scenarios.length, index);
        index = queue.pop()!;
        start = performance.now();
        setStartedAt(start);
        elapsed = 0;
      }
      setTranscript({ index, elapsed, reduced: motion.matches });
    };
    const reset = () => {
      start = performance.now();
      stoppedAt = null;
      setPausedAt(null);
      setStartedAt(start);
      update();
    };
    controls.current = {
      toggle: () => {
        if (motion.matches) return;
        const now = performance.now();
        if (stoppedAt === null) {
          stoppedAt = now;
          setPausedAt(now);
        } else {
          start += now - stoppedAt;
          stoppedAt = null;
          setPausedAt(null);
          setStartedAt(start);
          update();
        }
      },
      replay: reset,
    };
    let timer: ReturnType<typeof setInterval> | undefined;
    const configure = () => {
      clearInterval(timer);
      reset();
      if (!motion.matches) timer = setInterval(update, 40);
    };
    const initialFrame = requestAnimationFrame(configure);
    motion.addEventListener("change", configure);
    return () => { cancelAnimationFrame(initialFrame); clearInterval(timer); controls.current = null; motion.removeEventListener("change", configure); };
  }, []);

  const exchange = scenarios[transcript.index];
  const speech = speechData.exchanges[transcript.index];
  const studentStart = TUTOR_START + speech.tutor.duration / SPEECH_SPEED + TURN_GAP;
  const firstInsightAt = TUTOR_START + speech.tutor.duration / SPEECH_SPEED + 0.15;
  const hasInsights = transcript.reduced || transcript.elapsed >= firstInsightAt;
  return (
    <div className="lesson-demo">
    <div ref={stageRef} className="conversation-stage" data-call-frame={USE_CALL_FRAME} data-call-ended={callEnded} data-annotation-style={aligned ? "aligned" : docked ? "docked" : USE_SOFT_RIBBON ? "ribbon" : "threads"} data-presentation={USE_FLOATING_INSIGHTS ? "floating" : "grid"} data-notes={USE_FLOATING_INSIGHTS && PLACE_NOTES_OUTSIDE ? "outside" : "inside"} data-has-insights={hasInsights} role="group" aria-label="Illustrative tutor and student conversation">
      {(["tutor", "student"] as const).map((speaker) => {
        const caption = transcript.reduced
          ? { text: exchange[speaker], wordStart: 0, typing: false }
          : spokenCaption(speech[speaker], transcript.elapsed, speaker === "tutor" ? TUTOR_START : studentStart);
        const turn = exchange.turns[speaker];
        const turnStart = speaker === "tutor" ? TUTOR_START : studentStart;
        // Let the conversation make room before revealing the first annotation.
        const revealDelay = USE_FLOATING_INSIGHTS && PLACE_NOTES_OUTSIDE && speaker === "tutor" ? 0.75 : 0;
        const evidenceReady = transcript.reduced || transcript.elapsed >= turnStart + speech[speaker].duration / SPEECH_SPEED + 0.15 + revealDelay;
        const reviewed = transcript.reduced || transcript.elapsed >= turnStart + speech[speaker].duration / SPEECH_SPEED + 0.55 + revealDelay;
        const evidenceStart = caption.text.indexOf(turn.evidence);
        const highlight = USE_FLOATING_INSIGHTS && evidenceReady && evidenceStart >= 0;
        return (
          <div key={speaker} className={`conversation-turn conversation-turn--${speaker}`}>
            {USE_FLOATING_INSIGHTS && !docked && !aligned && <InsightConnector ready={highlight} revision={caption.text} ribbon={USE_SOFT_RIBBON} />}
            <aside className="conversation-analysis" data-reviewed={reviewed} aria-label={`Smart tutor review of the ${speaker} turn`}>
              <InsightNote turn={turn} ready={reviewed} />
            </aside>
            <div className={`conversation-voice conversation-voice--${speaker}`}>
              {speaker === "tutor" && <span className="conversation-recording" role="img" aria-label={callEnded ? "Lesson preview paused" : "Illustrative recording indicator"} title={callEnded ? "Preview paused" : "Illustrative recording"}><svg className="conversation-recording__icon" viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="7.25" stroke="currentColor" strokeWidth="1.25" /><circle cx="10" cy="10" r="3.5" fill="currentColor" /></svg></span>}
              <div className="conversation-voice__label">{USE_PHOTOGRAPHIC_PROFILES ? <span className={`conversation-avatar-photo conversation-avatar-photo--${speaker}`}><Image src={`/images/marketing/demo-${speaker}-headshot.webp`} width={44} height={44} alt="" />{speaker === "tutor" && <svg className="conversation-avatar-photo__verified" viewBox="0 0 24 24" role="img" aria-label="Verified tutor badge, illustrative profile"><path d="m23 12-2.44-2.79.34-3.69-3.61-.82L15.4 1.5 12 2.96 8.6 1.5 6.71 4.69l-3.61.82.34 3.69L1 12l2.44 2.79-.34 3.69 3.61.82L8.6 22.5l3.4-1.47 3.4 1.47 1.89-3.2 3.61-.82-.34-3.69Z" /><path d="m7.7 12 2.8 2.8 5.8-5.6" fill="none" stroke="white" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" /></svg>}</span> : <span className={`conversation-orb conversation-orb--${speaker}`} aria-hidden="true"><span className="conversation-orb__flow" /><span className="conversation-orb__fold" /><span className="conversation-orb__surface" /></span>}<span className={`conversation-profile conversation-profile--${speaker}`}>{speaker === "tutor" ? "Mr. Johnson" : "You"}</span></div>
              <AudioWaveform speaker={speaker} startedAt={startedAt} pausedAt={pausedAt} profile={speech[speaker]} turnStart={speaker === "tutor" ? TUTOR_START : studentStart} />
              <p className="conversation-caption">
                <span className="sr-only">{exchange[speaker]}</span>
                <span className="conversation-caption__visible" aria-hidden="true">{caption.text && "“"}{highlight ? <>{caption.text.slice(0, evidenceStart)}<mark className="conversation-evidence">{turn.evidence}</mark>{caption.text.slice(evidenceStart + turn.evidence.length)}</> : caption.typing ? <>{caption.text.slice(0, caption.wordStart)}<span key={`${transcript.index}-${caption.wordStart}`} className="conversation-caption__word">{caption.text.slice(caption.wordStart)}</span></> : caption.text}{caption.text === exchange[speaker] && "”"}</span>
                <span className="conversation-caption__measure" aria-hidden="true">“{exchange[speaker]}”</span>
              </p>
            </div>
          </div>
        );
      })}
      {USE_CALL_FRAME && <LessonCallControls key={callEnded ? "ended" : "active"} ended={callEnded} onEnd={() => { if (pausedAt === null) controls.current?.toggle(); setCallEnded(true); }} onReplay={replay} />}
    </div>
    {(docked || aligned) && <PositionedAnnotations stageRef={stageRef} mode={aligned ? "aligned" : "docked"} />}
    </div>
  );
}
