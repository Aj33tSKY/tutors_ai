"use client";

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { InsightConnector } from "./insight-connector";
import "./conversation-floating.css";
import "./conversation-outside.css";
import scenarios from "./data/lesson-scenarios.json";
import { AudioWaveform, type SpeechProfile } from "./audio-waveform";
import speechData from "./data/lesson-speech.json";
import { SPEECH_SPEED, CAPTION_DELAY, TUTOR_START, TURN_GAP, REVIEW_HOLD, shuffledScenarios } from "./lesson-timing";

// Rollback: set this to false to restore the previous grid presentation.
const USE_FLOATING_INSIGHTS = true;
// Set false to put the notes back inside the floating card.
const PLACE_NOTES_OUTSIDE = true;

function typedCaption(profile: SpeechProfile, elapsed: number, turnStart: number) {
  const time = (elapsed - turnStart - CAPTION_DELAY) * SPEECH_SPEED;
  let count = 0;
  for (const [start, end, from, to] of profile.words) {
    if (time < start) break;
    const progress = Math.min(1, (time - start) / Math.max(0.01, end - start));
    count = from + Math.floor((to - from) * progress);
  }
  return { text: profile.text.slice(0, count), typing: count > 0 && count < profile.text.length };
}

export function LessonSignal() {
  const [startedAt, setStartedAt] = useState(0);
  const [transcript, setTranscript] = useState({ index: 0, elapsed: 0, reduced: false });

  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let start = performance.now();
    let index = Math.floor(Math.random() * scenarios.length);
    let queue = shuffledScenarios(scenarios.length, index).filter(value => value !== index);
    setStartedAt(start);
    const update = () => {
      if (document.hidden) return;
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
    const reset = () => { start = performance.now(); setStartedAt(start); update(); };
    let timer: ReturnType<typeof setInterval> | undefined;
    const configure = () => {
      clearInterval(timer);
      reset();
      if (!motion.matches) timer = setInterval(update, 40);
    };
    configure();
    motion.addEventListener("change", configure);
    return () => { clearInterval(timer); motion.removeEventListener("change", configure); };
  }, []);

  const exchange = scenarios[transcript.index];
  const speech = speechData.exchanges[transcript.index];
  const studentStart = TUTOR_START + speech.tutor.duration / SPEECH_SPEED + TURN_GAP;
  const firstInsightAt = TUTOR_START + speech.tutor.duration / SPEECH_SPEED + 0.15;
  const hasInsights = transcript.reduced || transcript.elapsed >= firstInsightAt;
  return (
    <div className="conversation-stage" data-presentation={USE_FLOATING_INSIGHTS ? "floating" : "grid"} data-notes={USE_FLOATING_INSIGHTS && PLACE_NOTES_OUTSIDE ? "outside" : "inside"} data-has-insights={hasInsights} role="group" aria-label="Illustrative tutor and student conversation">
      {(["tutor", "student"] as const).map((speaker) => {
        const caption = transcript.reduced
          ? { text: exchange[speaker], typing: false }
          : typedCaption(speech[speaker], transcript.elapsed, speaker === "tutor" ? TUTOR_START : studentStart);
        const turn = exchange.turns[speaker];
        const turnStart = speaker === "tutor" ? TUTOR_START : studentStart;
        // Let the conversation make room before revealing the first annotation.
        const revealDelay = USE_FLOATING_INSIGHTS && PLACE_NOTES_OUTSIDE && speaker === "tutor" ? 0.75 : 0;
        const reviewed = transcript.reduced || transcript.elapsed >= turnStart + speech[speaker].duration / SPEECH_SPEED + 0.15 + revealDelay;
        const evidenceStart = caption.text.indexOf(turn.evidence);
        const highlight = USE_FLOATING_INSIGHTS && reviewed && evidenceStart >= 0;
        return (
          <div key={speaker} className={`conversation-turn conversation-turn--${speaker}`}>
            {USE_FLOATING_INSIGHTS && <InsightConnector key={transcript.index} ready={highlight} revision={caption.text} />}
            <aside className="conversation-analysis" data-reviewed={reviewed} aria-label={`Smart tutor review of the ${speaker} turn`}>
              <div key={transcript.index} className="conversation-analysis__insight" data-ready={reviewed}>
                <span className="conversation-analysis__signal"><Sparkles className="conversation-insight-icon" size={12} aria-hidden="true" />{turn.signal}</span>
                <p>{turn.review}</p>
              </div>
            </aside>
            <div className={`conversation-voice conversation-voice--${speaker}`}>
              <div className="conversation-voice__label"><span className={`conversation-orb conversation-orb--${speaker}`} aria-hidden="true"><span className="conversation-orb__flow" /><span className="conversation-orb__fold" /><span className="conversation-orb__surface" /></span><span className={`conversation-profile conversation-profile--${speaker}`}>{speaker === "tutor" ? "Your tutor" : "You"}</span></div>
              <AudioWaveform speaker={speaker} startedAt={startedAt} profile={speech[speaker]} turnStart={speaker === "tutor" ? TUTOR_START : studentStart} />
              <p className="conversation-caption">
                <span className="sr-only">{exchange[speaker]}</span>
                <span aria-hidden="true">{caption.text && "“"}{highlight ? <>{caption.text.slice(0, evidenceStart)}<mark className="conversation-evidence">{turn.evidence}</mark>{caption.text.slice(evidenceStart + turn.evidence.length)}</> : caption.text}{caption.text === exchange[speaker] && "”"}{caption.typing && <span className="conversation-caption__cursor" />}</span>
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
