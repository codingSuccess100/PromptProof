"use client";

import { useEffect, useState } from "react";
import { APP_NAME, REPO_URL, SUBTEXT, TAGLINE } from "@/lib/brand";

export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <header className={`nav${scrolled ? " scrolled" : ""}`}>
      <a className="brand" href="#top" aria-label={`${APP_NAME} home`}>
        <span className="brand-mark" aria-hidden="true" />
        {APP_NAME}
      </a>
      <nav aria-label="Sections">
        <a href="#how">How it works</a>
        <a href="#try">Try it</a>
        <a href="#about">About</a>
        <a href={REPO_URL} target="_blank" rel="noreferrer" className="nav-extra">
          GitHub
        </a>
      </nav>
    </header>
  );
}

export function Hero() {
  return (
    <section className="hero" id="top">
      <p className="hero-kicker">{APP_NAME}, an experimental prompt debugger</p>
      <h1>{TAGLINE}</h1>
      <p className="hero-sub">{SUBTEXT}</p>
      <div className="hero-actions">
        <a className="btn primary" href="#try">
          Try {APP_NAME}
        </a>
        <a className="btn" href="#how">
          See how it works
        </a>
      </div>
    </section>
  );
}

export function About() {
  return (
    <section className="about" id="about">
      <div className="section-head">
        <h2>What a result means, and what it does not</h2>
        <p>
          PromptProof runs a small experiment. Like any experiment, it answers a narrow question well and says nothing
          about the rest.
        </p>
      </div>
      <div className="about-grid">
        <article className="glass">
          <h3>What it measures</h3>
          <ul>
            <li>Whether the answer met each stated requirement. Every check is a fixed rule, and no AI grades the answer.</li>
            <li>What happened to that score when one part of your prompt was removed and the task was run again.</li>
            <li>How often that happened across three runs.</li>
          </ul>
        </article>
        <article className="glass">
          <h3>What it cannot tell you</h3>
          <ul>
            <li>Whether the answer is good. A response can meet every requirement and still be a weak piece of writing.</li>
            <li>What a phrase does on other tasks or other models. Results are for this task and the model named on screen.</li>
            <li>How overlapping instructions interact. Parts are removed one at a time, so two phrases that say the same thing can each look unnecessary.</li>
          </ul>
        </article>
        <article className="glass">
          <h3>Where the idea comes from</h3>
          <p>
            Removing one input at a time and measuring the change is called ablation, an established research method.
            Developer tools already apply it to prompts. We adapted ablation analysis into an interactive learning and
            debugging experience for people who are not prompt engineers.
          </p>
          <p>
            Your prompt and any text you paste are sent to the AI model to get an answer. Nothing is stored on our
            server. Do not paste confidential or personal information.
          </p>
        </article>
      </div>
      <div className="closing">
        <h2>Stop guessing which words matter.</h2>
        <a className="btn primary" href="#try">
          Run the experiment
        </a>
        <p className="fine">
          Built at HackUMass XIV. <a href={REPO_URL} target="_blank" rel="noreferrer">Source on GitHub</a>
        </p>
      </div>
    </section>
  );
}
