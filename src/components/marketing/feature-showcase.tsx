"use client";

import { useState } from "react";
import { ArrowDownRight, ArrowUpRight, Bookmark, FileText, MessageCircle, Play, Sparkles } from "lucide-react";
import { Reveal } from "./reveal";

const CHAPTERS = [
  { label: "In the lesson", title: "A moment of understanding.", body: "A good explanation makes a difficult idea feel simple. Your lesson recording gives you a way back to the tutor’s own words." },
  { label: "After the lesson", title: "The useful parts, kept together.", body: "A lesson recap gathers what you covered, the things that clicked, and what needs another look. Your tutor can edit the notes." },
  { label: "When you revise", title: "Pick up where you left off.", body: "Ask a follow-up question. When your lesson transcripts are available, Revision AI can draw on your tutor’s explanations and methods." },
];

export function FeatureShowcase() {
  const [chapter, setChapter] = useState(0);
  return (
    <section className="landing-memory" id="lesson-memory" aria-labelledby="memory-title">
      <div className="landing-shell">
        <Reveal className="landing-section-intro">
          <p className="landing-kicker">A spark worth keeping</p>
          <h2 id="memory-title">A great lesson shouldn’t<br />end when the call does.</h2>
          <p>From the first explanation to the night before your exam.<br className="landing-desktop-break" /> The same lesson, still working for you.</p>
        </Reveal>
        <div className="landing-memory__layout">
          <div className="landing-memory__chapters" role="tablist" aria-label="Follow a lesson through time" aria-orientation="vertical">
            {CHAPTERS.map((item, index) => (
              <button type="button" key={item.label} role="tab" id={`memory-tab-${index}`} aria-controls="memory-example" aria-selected={chapter === index} onClick={() => setChapter(index)} onKeyDown={event => {
                if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
                event.preventDefault();
                const next = event.key === "Home" ? 0 : event.key === "End" ? CHAPTERS.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + CHAPTERS.length) % CHAPTERS.length;
                setChapter(next);
                document.getElementById(`memory-tab-${next}`)?.focus();
              }} tabIndex={chapter === index ? 0 : -1}>
                <span className="landing-memory__number">0{index + 1}</span>
                <span><small>{item.label}</small><strong>{item.title}</strong><span className="landing-memory__chapter-body">{item.body}</span></span>
                <ArrowUpRight size={17} aria-hidden="true" />
              </button>
            ))}
          </div>
          <div id="memory-example" role="tabpanel" aria-labelledby={`memory-tab-${chapter}`} className="landing-memory__stage" tabIndex={0}>
            <div className="landing-memory__context"><span><span className="landing-memory__dot" /> A-Level Physics</span><span>One lesson. Three useful moments.</span></div>
            <div className="landing-memory__artifact" key={chapter}>
              {chapter === 0 && <>
                <div className="landing-artifact-header"><span className="landing-mini-icon"><Play size={15} /></span><span>Your lesson recording<small>Circular motion</small></span><span className="landing-artifact-tag">Lesson excerpt</span></div>
                <div className="landing-memory__quote"><span className="landing-quote-mark">“</span><p>The magnetic force changes <mark>direction, not the particle’s speed.</mark></p></div>
                <div className="landing-memory__audio" aria-hidden="true">{Array.from({length: 54}, (_, i) => <i key={i} style={{height: `${Math.round(8 + Math.abs(Math.sin(i * 1.9) * Math.cos(i * .4)) * 38)}px`}} />)}</div>
                <div className="landing-memory__understanding"><ArrowDownRight size={18} /><p>“Oh, so it can accelerate without getting any faster!”<span>Your moment of understanding</span></p></div>
              </>}
              {chapter === 1 && <>
                <div className="landing-artifact-header"><span className="landing-mini-icon"><FileText size={17} /></span><span>Physics · lesson recap<small>Circular motion</small></span><Bookmark size={17} className="landing-muted-icon" /></div>
                <h3 className="landing-note-title">What clicked today</h3>
                <p className="landing-note-text">Acceleration can mean a change in direction, even when speed stays the same.</p>
                <div className="landing-note-insight"><Sparkles size={16} /><div><strong>A useful connection</strong><p>You explained the distinction in your own words.</p></div></div>
                <div className="landing-note-next"><small>Worth another look</small><p>Explain why a particle moving at constant speed in a circle is still accelerating.</p></div>
                <span className="landing-artifact-footer">A lesson record your tutor can review and edit</span>
              </>}
              {chapter === 2 && <>
                <div className="landing-artifact-header"><span className="landing-mini-icon"><MessageCircle size={17} /></span><span>Pick it up again<small>A few days later</small></span><span className="landing-artifact-tag">Revision AI</span></div>
                <div className="landing-revision-question">Why is there acceleration if the speed is constant?</div>
                <div className="landing-revision-answer"><Sparkles size={16} /><p>Think back to circular motion in your lesson. Speed tells you how fast. Velocity includes direction. The direction keeps changing, so the velocity changes too. That’s acceleration.</p></div>
                <div className="landing-revision-source"><Bookmark size={13} /><span>Drawing on your circular motion lesson</span></div>
                <span className="landing-artifact-footer">Your question. Your lesson context. A way forward.</span>
              </>}
            </div>
            <p className="landing-memory__example-label">An example of how one lesson can support your revision.</p>
          </div>
        </div>
      </div>
    </section>
  );
}
