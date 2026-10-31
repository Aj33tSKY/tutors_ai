"use client";

import { useEffect, useState } from "react";
import { AudioWaveform } from "./audio-waveform";

const EXCHANGES = [
  { subject: "PHYSICS", tutor: "The magnetic force provides the centripetal force.", student: "So it keeps the particle moving in a circle?" },
  { subject: "MATHEMATICS", tutor: "The derivative gives the gradient at any point.", student: "So a turning point has a gradient of zero?" },
  { subject: "CHEMISTRY", tutor: "A catalyst lowers the activation energy.", student: "So more particles have enough energy to react?" },
  { subject: "BIOLOGY", tutor: "The DNA base sequence determines the amino acids.", student: "So a mutation could change the protein's shape?" },
  { subject: "COMPUTING", tutor: "Binary search halves the search space each time.", student: "That's why the list needs to be sorted first!" },
  { subject: "PHYSICS", tutor: "Resistance increases as the wire gets hotter.", student: "Because the electrons collide more often?" },
] as const;

// Leave the waveform a little ahead of the live transcript.
const CAPTION_DELAY = 650;
const CHARACTER_TIME = 42;
const CYCLE_TIME = 10_000;

function typedCaption(text: string, elapsed: number, turnStart: number) {
  const count = Math.max(0, Math.floor((elapsed - turnStart - CAPTION_DELAY) / CHARACTER_TIME));
  return { text: text.slice(0, count), typing: count > 0 && count < text.length };
}

export function LessonSignal() {
  const [startedAt, setStartedAt] = useState(0);
  const [transcript, setTranscript] = useState({ index: 0, elapsed: 0, reduced: false });

  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let start = performance.now();
    let cycle = 0;
    let index = 0;
    setStartedAt(start);
    const update = () => {
      if (document.hidden) return;
      const elapsed = performance.now() - start;
      const nextCycle = Math.floor(elapsed / CYCLE_TIME);
      if (nextCycle !== cycle) {
        // Draw from all the other exchanges, so adjacent conversations never repeat.
        index = (index + 1 + Math.floor(Math.random() * (EXCHANGES.length - 1))) % EXCHANGES.length;
        cycle = nextCycle;
      }
      setTranscript({ index, elapsed: elapsed % CYCLE_TIME, reduced: motion.matches });
    };
    const reset = () => { start = performance.now(); cycle = 0; setStartedAt(start); update(); };
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

  const exchange = EXCHANGES[transcript.index];
  return (
    <div className="conversation-stage" role="group" aria-label="Illustrative tutor and student conversation">
      <div className="conversation-stage__header">
        <span><i /> A MOMENT OF UNDERSTANDING</span>
        <span>{String(transcript.index + 1).padStart(2, "0")} / {exchange.subject}</span>
      </div>
      {(["tutor", "student"] as const).map((speaker) => {
        const caption = transcript.reduced
          ? { text: exchange[speaker], typing: false }
          : typedCaption(exchange[speaker], transcript.elapsed, speaker === "tutor" ? 300 : 5100);
        return (
          <div key={speaker} className={`conversation-voice conversation-voice--${speaker}`}>
            <div className="conversation-voice__label"><span className="conversation-avatar">{speaker === "tutor" ? "T" : "Y"}</span><span>{speaker === "tutor" ? "Your tutor" : "You"}<small>{speaker === "tutor" ? "THE EXPLANATION" : "THE LIGHTBULB MOMENT"}</small></span><span className="conversation-voice__status">Speaking</span></div>
            <AudioWaveform speaker={speaker} startedAt={startedAt} />
            <p className="conversation-caption">
              <span className="sr-only">{exchange[speaker]}</span>
              <span aria-hidden="true">{caption.text && `“${caption.text}`}{caption.text === exchange[speaker] && "”"}{caption.typing && <span className="conversation-caption__cursor" />}</span>
            </p>
          </div>
        );
      })}
      <div className="conversation-stage__footer"><span className="conversation-record"><i /> ILLUSTRATIVE LESSON</span><span>Human connection. Lasting understanding.</span></div>
    </div>
  );
}
