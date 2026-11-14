"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "./hooks";

// A scroll-driven walkthrough of one real experiment.
// Every label and score here comes from runs on gpt-6-luna on November 14, 2026.

type Kind = "helpful" | "none";
const PARTS: { text: string; kind: Kind; friction?: boolean; note: string }[] = [
  { text: "You are an expert analyst.", kind: "none", friction: true, note: "No measured effect" },
  { text: "Summarize this feedback", kind: "none", note: "No measured effect" },
  { text: "for our CFO", kind: "none", note: "No measured effect" },
  { text: "under 60 words,", kind: "helpful", note: "Helped, 3 of 3 runs" },
  { text: "put billing errors first,", kind: "helpful", note: "Helped, 3 of 3 runs" },
  { text: "mention the $1,200 refund cost.", kind: "helpful", note: "Helped, 3 of 3 runs" },
];
const GHOST = "Say that a decision is needed by Friday.";
const REWRITE =
  "Summarize this customer feedback for our CFO in one plain paragraph with no bullet points. Keep it under 60 words. " +
  "Start with the billing errors, not the delivery complaints. Mention that refunds for billing errors cost $1,200 last month. " +
  "Say that a decision is needed by Friday.";

const STEPS: { title: string; body: string }[] = [
  { title: "A prompt that looks fine", body: "It scored 4 of 5 against five fixed requirements. Which words earned that score?" },
  { title: "Remove one part, run it again", body: "PromptProof deletes each part in turn and reruns the task, so every part gets its own experiment." },
  { title: "Three parts earned their place", body: "Take any of them out and a requirement fails, every time." },
  { title: "Three parts changed nothing we could measure", body: "Removing them caused no measurable decline on this task." },
  { title: "One of those is a persona", body: "Flagged as a pattern worth questioning, not as a mistake. The measurement sits next to the warning." },
  { title: "One requirement was never mentioned", body: "The detail the prompt left out appears as ghost text." },
  { title: "Rewrite with what mattered", body: "Keep the parts that moved the score. Add the missing one. Drop the rest if you like." },
  { title: "5 of 5, three runs out of three", body: "The same task, the same model, a prompt you can now explain." },
];

export default function XrayStory() {
  const section = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();
  const [stage, setStage] = useState(0);

  useEffect(() => {
    if (reduced) {
      setStage(STEPS.length - 1);
      return;
    }
    let ticking = false;
    const measure = () => {
      ticking = false;
      const el = section.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const travel = rect.height - window.innerHeight;
      const progress = travel > 0 ? Math.min(1, Math.max(0, -rect.top / travel)) : 0;
      setStage(Math.min(STEPS.length - 1, Math.floor(progress * STEPS.length)));
    };
    const onScroll = () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(measure);
      }
    };
    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [reduced]);

  // With reduced motion there is no scroll sequence: show the explained prompt and the rewrite side by side in the flow.
  const view = reduced ? 5 : stage;
  const rewritten = !reduced && stage >= 6;
  const partClass = (part: (typeof PARTS)[number]) => {
    const classes = ["chunk"];
    if (part.kind === "helpful" && view >= 2) classes.push("helpful", "lit");
    if (part.kind === "none" && view >= 3) classes.push("no_measured_effect", "lit");
    if (part.kind === "helpful" && view < 2) classes.push("pending");
    if (part.kind === "none" && view < 3) classes.push("pending");
    if (part.friction && view >= 4) classes.push("friction");
    return classes.join(" ");
  };

  return (
    <section className={`story${reduced ? " static" : ""}`} id="how" ref={section}>
      <div className="story-pin">
        <div className="story-copy">
          <p className="eyebrow">How it works</p>
          <ol className="story-steps">
            {STEPS.map((step, i) => (
              <li key={step.title} className={i === stage ? "current" : i < stage ? "done" : ""} aria-current={i === stage ? "step" : undefined}>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </li>
            ))}
          </ol>
          <div className="story-progress" aria-hidden="true">
            <span style={{ transform: `scaleX(${(stage + 1) / STEPS.length})` }} />
          </div>
        </div>

        <div className={`specimen glass${stage === 1 ? " scanning" : ""}`}>
          <div className="specimen-top">
            <span className="tag">{rewritten ? "rewritten prompt" : "your prompt"}</span>
            <span className={`specimen-score${!reduced && stage === 7 ? " improved" : ""}`}>
              {!reduced && stage === 7 ? (
                <>
                  <s>4</s> 5 / 5
                </>
              ) : rewritten ? (
                "running"
              ) : (
                "4 / 5"
              )}
            </span>
          </div>

          {rewritten ? (
            <p className="specimen-prompt rewrite">{REWRITE}</p>
          ) : (
            <p className="specimen-prompt xray">
              {PARTS.map((part) => (
                <span key={part.text} className={partClass(part)}>
                  {part.text}
                </span>
              ))}
              {view >= 5 && <span className="ghost shown"> {GHOST}</span>}
            </p>
          )}

          {!rewritten && (
            <ul className="specimen-legend">
              <li className={view >= 2 ? "on" : ""}>
                <i className="dot helpful" />
                Helped: the score fell without it
              </li>
              <li className={view >= 3 ? "on" : ""}>
                <i className="dot none" />
                No measured effect on this task
              </li>
              <li className={view >= 4 ? "on" : ""}>
                <i className="dot friction" />
                Pattern warning: persona with no measured benefit
              </li>
              <li className={view >= 5 ? "on" : ""}>
                <i className="dot ghost" />
                Missing detail, offered as ghost text
              </li>
            </ul>
          )}
          {rewritten && (
            <ul className="specimen-legend">
              <li className="on">
                <i className="dot helpful" />
                Every requirement now has an instruction behind it
              </li>
              <li className={stage === 7 ? "on" : ""}>
                <i className="dot helpful" />
                Scored 5, 5, 5 across three runs
              </li>
            </ul>
          )}
          {reduced && (
            <>
              <div className="specimen-top second">
                <span className="tag">rewritten prompt</span>
                <span className="specimen-score improved">5 / 5</span>
              </div>
              <p className="specimen-prompt rewrite">{REWRITE}</p>
            </>
          )}
          <p className="fine">From real runs on gpt-6-luna, November 14, 2026.</p>
        </div>
      </div>
    </section>
  );
}
