"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { APP_NAME, REPO_URL } from "@/lib/brand";

export const MOTION_KEY = "promptproof:motion";

/** `motion` shows the pause control. Only pages with a moving background pass it. */
export function Nav({ motion = false }: { motion?: boolean }) {
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
        {motion && (
          <button className="nav-motion" onClick={toggle} aria-pressed={paused}>
            {paused ? "Play background" : "Pause background"}
          </button>
        )}
      </nav>
    </header>
  );
}

// Recorded on gpt-6-luna, November 14, 2026, with the benchmark script in this repository.
// These are the actual prompts and the actual first answers from those runs.
// Three runs each: the first prompt passed 2, 2, and 0 of 5 checks, the revision passed 5, 5, and 5.
const EXAMPLE = {
  goal: "A short summary of customer feedback for the CFO, who is about to meet the billing vendor.",
  before: "Summarize this feedback.",
  beforeAnswer:
    "Customers most often complained about late deliveries: four of eight comments mentioned delays, including one repeat issue and one missed gift occasion. Two reported billing or invoice errors that required follow-up to resolve. Support feedback was mixed but positive overall: two customers praised friendly, responsive service, while one had to contact support to fix a duplicate charge.",
  after:
    "Summarize this customer feedback for our CFO in one plain paragraph with no bullet points. Keep it under 60 words. Start with the billing errors, not the delivery complaints. Mention that refunds for billing errors cost $1,200 last month. Say that a decision is needed by Friday.",
  afterAnswer:
    "Billing errors, including duplicate charges and incorrect invoices, required refunds costing $1,200 last month. Delivery complaints also point to repeated delays, including missed promised dates and poor communication. Support feedback was positive. A decision is needed by Friday.",
  checks: [
    { label: "Billing is the first issue named", before: false, after: true },
    { label: "Gives $1,200 as the refund cost", before: false, after: true },
    { label: "States a decision or deadline for Friday", before: false, after: true },
    { label: "60 words or fewer", before: true, after: true },
    { label: "One plain paragraph, no bullets", before: true, after: true },
  ],
};

export function Landing() {
  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <h1>Turn a rough prompt into a tested one.</h1>
          <p className="hero-sub">
            Tell {APP_NAME} what you want from the answer. It runs your prompt, points to what missed, proposes a
            specific change, and tests that change against your goal and the checks you chose.
          </p>
          <div className="hero-actions">
            <Link className="btn primary" href="/workspace">
              Open the workspace
            </Link>
          </div>
          <p className="fine">It proposes and tests changes. It does not promise the answer is correct.</p>
        </div>

        <figure className="preview solid" aria-label="Recorded example of a prompt revision">
          <figcaption>
            <span className="badge recorded">Recorded example</span>
            <span className="fine">Real runs on gpt-6-luna, November 14, 2026. Not live.</span>
          </figcaption>
          <p className="preview-goal">
            <span className="label">The goal</span>
            {EXAMPLE.goal}
          </p>
          <div className="preview-grid">
            <div>
              <p className="label">Rough prompt</p>
              <p className="preview-prompt">{EXAMPLE.before}</p>
              <p className="label">Answer</p>
              <p className="preview-answer">{EXAMPLE.beforeAnswer}</p>
              <p className="preview-score">2 of 5 checks passed</p>
            </div>
            <div>
              <p className="label">Revised prompt</p>
              <p className="preview-prompt">{EXAMPLE.after}</p>
              <p className="label">Answer</p>
              <p className="preview-answer">{EXAMPLE.afterAnswer}</p>
              <p className="preview-score good">5 of 5 checks passed</p>
            </div>
          </div>
          <ul className="preview-checks">
            {EXAMPLE.checks.map((c) => (
              <li key={c.label} className={c.before ? "same" : "gained"}>
                <span aria-hidden="true">{c.before ? "=" : "\u2191"}</span> {c.label}
                <span className="fine">{c.before ? " passed both times" : " missed, then passed"}</span>
              </li>
            ))}
          </ul>
          <p className="fine">
            These two answers were recorded on November 14, 2026 and rescored with the current checks: 2 and 5. The
            earlier three-run counts (2, 2, 0 and 5, 5, 5) came from an earlier version of the checks, so they are
            history, not a current result.
          </p>
        </figure>
      </section>

      <section className="steps">
        <ol>
          <li>
            <h2>Say what you want</h2>
            <p>Write your prompt and describe the result you are after, in ordinary words. No rubric to build first.</p>
          </li>
          <li>
            <h2>See what missed, and why</h2>
            <p>Rule-based checks show what can be verified mechanically. A separate goal review flags things like an answer written for the wrong reader.</p>
          </li>
          <li>
            <h2>Revise and compare</h2>
            <p>You get one complete revised prompt to edit. Test it and see both prompts, both answers, and what changed.</p>
          </li>
        </ol>
        <p className="fine">
          <Link href="/method">How it works, what is measured, and what is only suggested.</Link>
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
          <b>Requirements met.</b> Each requirement is a fixed rule applied to the answer: a word count, whether a
          piece of wording appears, whether the answer is one paragraph or a numbered list. The evidence is shown
          beside every result. Each label states what its rule tests. &quot;Billing is the first issue named&quot;
          fails when delivery is named before billing, even in the same sentence.
        </li>
        <li>
          <b>Wording matches.</b> Capitalization, quote style, dash style, and spacing are ignored. Spelling and
          accents must match unless you approve another spelling. The wording must stand on its own, so ABC-123 does
          not match inside ABC-1234, and amounts, IDs, and names are never matched loosely. If you meant a topic and
          not a wording, mark it as a topic. It is then read by the goal review and not scored.
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

      <h2>What the AI receives</h2>
      <ul>
        <li>The AI that writes the answer receives your prompt and your reference notes. Nothing else.</li>
        <li>
          It does not receive your goal, your checks, or the details you confirm in setup. Those are used to evaluate
          the answer and to propose a revision. A proposed revision writes them into the prompt, where you can see
          and edit them.
        </li>
        <li>
          Answers have an output limit. An answer that stops at the limit is marked incomplete. It is not scored as a
          prompt failure, the goal review of it reports nothing as missing, and no revision is proposed from it.
          Structured analysis replies that are cut off are discarded, never patched together.
        </li>
        <li>The output limit is part of the experiment. Changing it starts a new experiment.</li>
      </ul>

      <h2>Goal review</h2>
      <p>
        Rule-based checks cannot tell whether an answer serves your goal. A summary written for the wrong reader can
        pass every one of them. So a second, separate layer asks the model to compare your goal, your prompt, and the
        answer, and to report up to three concerns, such as a different deliverable, a changed recipient, or checks
        that do not cover what you asked for.
      </p>
      <ul>
        <li>It is model-assisted and can be wrong. It is a suggested interpretation, not a measurement.</li>
        <li>It never changes a rule-based result, and a perfect rule-based result never hides it.</li>
        <li>Every quote it shows is verified to appear in your prompt or the answer. Unverified quotes are dropped.</li>
        <li>The same reviewer repeating itself is not proof. Read the answer.</li>
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
        After each run you get one complete proposed prompt, labeled as untested. Amounts, dates, and identifiers
        from your original prompt are checked one by one and restored if the rewrite dropped them. A detail that
        appears in the rewrite but nowhere in your prompt, notes, or goal is replaced with a visible placeholder for
        you to fill in. Nothing is claimed about the proposal until you test it.
      </p>
      <p>
        An optional helper repeats this up to three times. It keeps a revision on its own only when a rule-based
        check improved and none got worse. When only the goal review changed, or one check improved while another got
        worse, it shows you the candidate and you decide. Fewer reviewer concerns is not treated as proof. It cannot
        change your goal or checks, and it will not force an exact phrase into your prompt just to pass a check.
        Every attempt is listed, including rejected ones.
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
