"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { APP_NAME, REPO_URL } from "@/lib/brand";

export const MOTION_KEY = "promptproof:motion";

export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    try {
      setPaused(localStorage.getItem(MOTION_KEY) === "paused");
    } catch {
      // Storage may be unavailable. The default is motion on.
    }
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  const toggle = () => {
    const next = !paused;
    setPaused(next);
    try {
      localStorage.setItem(MOTION_KEY, next ? "paused" : "on");
    } catch {
      // Not saved, still applied for this page.
    }
    window.dispatchEvent(new CustomEvent("promptproof:motion", { detail: next }));
  };
  return (
    <header className={`nav${scrolled ? " scrolled" : ""}`}>
      <Link className="brand" href="/" aria-label={`${APP_NAME} home`}>
        <span className="brand-mark" aria-hidden="true" />
        {APP_NAME}
      </Link>
      <nav aria-label="Main">
        <Link href="/workspace">Workspace</Link>
        <Link href="/method">Method and privacy</Link>
        <a href={REPO_URL} target="_blank" rel="noreferrer" className="nav-extra">
          GitHub
        </a>
        <button className="nav-motion" onClick={toggle} aria-pressed={paused}>
          {paused ? "Play background" : "Pause background"}
        </button>
      </nav>
    </header>
  );
}

// Recorded on gpt-6-luna, November 14, 2026, with the benchmark in this repository.
// Three runs each: the first prompt met 2, 2, and 0 of 5 requirements, the revision met 5, 5, and 5.
const EXAMPLE = {
  before: "Summarize this feedback.",
  after:
    "Summarize this customer feedback for our CFO in one plain paragraph with no bullet points. Keep it under 60 words. Start with the billing errors, not the delivery complaints. Mention that refunds for billing errors cost $1,200 last month. Say that a decision is needed by Friday.",
  checks: [
    { label: "60 words or fewer", before: true, after: true },
    { label: "Opens with the billing errors", before: false, after: true },
    { label: "Includes the $1,200 refund cost", before: false, after: true },
    { label: "One plain paragraph, no bullets", before: true, after: true },
    { label: "Mentions the Friday decision deadline", before: false, after: true },
  ],
};

export function Landing() {
  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <h1>See why your prompt missed.</h1>
          <p className="hero-sub">
            {APP_NAME} runs your prompt, checks the answer against what you said you needed, shows what to change, and
            retests the revision under the same checks.
          </p>
          <div className="hero-actions">
            <Link className="btn primary" href="/workspace">
              Open the workspace
            </Link>
          </div>
          <p className="fine">Free to try. Starts with a worked example, or bring your own prompt.</p>
        </div>

        <figure className="preview solid" aria-label="Recorded example of a prompt revision">
          <figcaption>
            <span className="badge recorded">Recorded example</span>
            <span className="fine">gpt-6-luna, November 14, 2026. Not a live run.</span>
          </figcaption>
          <div className="preview-grid">
            <div>
              <p className="label">Original prompt</p>
              <p className="preview-prompt">{EXAMPLE.before}</p>
              <p className="preview-score">
                2 <span>of 5 requirements met</span>
              </p>
            </div>
            <div>
              <p className="label">Revised prompt</p>
              <p className="preview-prompt">{EXAMPLE.after}</p>
              <p className="preview-score good">
                5 <span>of 5 requirements met</span>
              </p>
            </div>
          </div>
          <table className="check-table">
            <thead>
              <tr>
                <th scope="col">Same requirements, both runs</th>
                <th scope="col">Original</th>
                <th scope="col">Revised</th>
              </tr>
            </thead>
            <tbody>
              {EXAMPLE.checks.map((c) => (
                <tr key={c.label}>
                  <th scope="row">{c.label}</th>
                  <td className={c.before ? "pass" : "fail"}>{c.before ? "✓ met" : "× missed"}</td>
                  <td className={c.after ? "pass" : "fail"}>{c.after ? "✓ met" : "× missed"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="fine">
            Shown: the first of three runs each. Across three runs the original met 2, 2, and 0, and the revision met
            5, 5, and 5.
          </p>
        </figure>
      </section>

      <section className="steps">
        <ol>
          <li>
            <h2>Say what a good answer must do</h2>
            <p>A word limit, a fact that must appear, a format. You choose the checks, so you know what the result means.</p>
          </li>
          <li>
            <h2>Run it and see what missed</h2>
            <p>Each missed requirement comes with the evidence and one specific edit to try. Not &quot;be more specific&quot;.</p>
          </li>
          <li>
            <h2>Test the revision, same checks</h2>
            <p>Original and revised, side by side: both prompts, both answers, and which requirements changed.</p>
          </li>
        </ol>
        <p className="fine">
          Want to know which instructions in a prompt are doing the work? The workspace can also remove them one at a
          time and rerun. <Link href="/method">How the method works, and its limits.</Link>
        </p>
      </section>
    </>
  );
}

export function Method() {
  return (
    <section className="method">
      <h1>Method and privacy</h1>
      <p className="lede">What {APP_NAME} measures, what it only suggests, and what happens to your text.</p>

      <h2>What is measured</h2>
      <ul>
        <li>
          <b>Requirements met.</b> Each requirement is a fixed rule applied to the answer: a word count, whether an
          exact piece of text appears, whether the answer is one paragraph or a numbered list. The evidence is shown
          beside every result.
        </li>
        <li>
          <b>Comparisons.</b> Two runs are compared only when the task, reference material, requirements, scorer
          version, model, and model settings are all identical. Change any of them and a new experiment starts.
        </li>
        <li>
          <b>The X-ray.</b> Each instruction in your prompt is removed in turn and the task is rerun three times. The
          unchanged prompt is also rerun three times. Results are reported per requirement, as pass counts.
        </li>
      </ul>

      <h2>What is not measured</h2>
      <ul>
        <li>
          <b>Quality.</b> Meeting every requirement does not make an answer good. A fixed rule is repeatable. It is
          not complete, and it is not proof that the rule itself is the right one.
        </li>
        <li>
          <b>Meaning.</b> An exact-text check tells you a phrase appears. It cannot tell you a concept was explained
          correctly. If you require &quot;L&apos;H&ocirc;pital&quot;, an answer that names it and gets it wrong still passes.
        </li>
        <li>
          <b>Why the model did something.</b> Explanations of a missed requirement are sorted from what is visible:
          the prompt, the answer, and the check. They are suggestions until a rerun confirms them.
        </li>
      </ul>

      <h2>Limits of the X-ray</h2>
      <ul>
        <li>It tests phrases against the checks you selected. It does not attribute effects to individual words.</li>
        <li>Three matching runs are three observations, not a guarantee and not a confidence percentage.</li>
        <li>
          Instructions are removed one at a time. If two say the same thing, each can look unnecessary. Do not delete
          everything marked &quot;no change detected&quot; at once. Remove one, then retest the combined rewrite.
        </li>
        <li>If the unchanged prompt met nothing, &quot;no change detected&quot; means almost nothing.</li>
        <li>Results are for the model named on screen. Another model may respond differently.</li>
        <li>A request that fails is reported as failed. It is never counted as a score of zero.</li>
      </ul>

      <h2>Wording notes</h2>
      <p>
        Separate from measurement, a few wording rules point out leading assumptions, unsupported premises, conflicting
        constraints, ambiguous references, and loaded framing. These are prompts for your own judgment. A role such as
        &quot;you are an expert&quot; is not treated as a problem. It is only mentioned when the X-ray found no change
        from it.
      </p>

      <h2>Improve and test</h2>
      <p>
        An optional helper proposes one small edit, tests it on a fresh run under the same requirements, and keeps it
        only if a requirement improved and none regressed. It stops after three edits. It cannot change your
        requirements, and an edit that drops most of your wording or introduces a number you did not supply is blocked
        before testing. Every attempt is listed, including rejected ones. A kept edit is rerun twice more to see if it
        holds.
      </p>

      <h2>Your text</h2>
      <ul>
        <li>
          Your prompt and reference material are sent to OpenAI to generate the answer. OpenAI&apos;s own data
          retention terms apply to that request.
        </li>
        <li>This application has no database. Its code does not write your prompt, material, or answers to logs.</li>
        <li>
          We have not audited the hosting provider&apos;s request logs. Treat the service as you would any web form
          and do not paste confidential or personal information.
        </li>
        <li>
          Your browser keeps the most recent result on this device so it can be replayed if the model is unreachable.
          A replayed result is labeled as recorded. &quot;Clear session&quot; in the workspace deletes it.
        </li>
      </ul>

      <h2>Where the idea comes from</h2>
      <p>
        Removing one input at a time and measuring the change is called ablation, an established research method, and
        developer tools already apply it to prompts. We adapted ablation analysis into an interactive learning and
        debugging experience.
      </p>
      <p>
        <Link className="btn primary" href="/workspace">
          Open the workspace
        </Link>
      </p>
    </section>
  );
}
