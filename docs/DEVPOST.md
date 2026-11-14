# Devpost copy

Replace anything in [brackets] before submitting. Do not publish numbers you did not measure.

**Project name:** PromptProof

**Tagline:** Debug your prompt before you trust the output.

## Inspiration

We all write prompts every day, and none of us could say which words in them actually mattered. People copy phrases like "you are an expert" because they feel right, yet published research has found that expert personas do not reliably improve accuracy. We wanted a way to stop guessing and run the experiment.

## What it does

You write a prompt, and PromptProof:

1. Runs it and shows the AI answer.
2. Scores the answer against fixed, rule-based requirements. No AI judges the score.
3. X-rays your prompt: it removes one part at a time, reruns the task, and shows which parts helped, which had no measured effect, and which may have hurt. Each label is confirmed across three runs.
4. Shows the details you left out as ghost text you can click to add.
5. Shows before and after side by side when you rerun.

There are two modes. Practice scenarios give you a realistic task with facts only you can see. Your own prompt lets you paste a prompt you actually use and state what a good answer must do, as rules you choose. The model can suggest those rules from a one-line description, and you approve them.

It also flags risky wording patterns such as personas, leading assumptions, and conflicting instructions. These are labeled as warnings, separate from measured effects.

## How we built it

- Next.js, React, and TypeScript, deployed on Vercel.
- OpenAI API, called only from the server.
- A rule-based engine: prompt segmentation, leave-one-out ablation with parallel model calls, deterministic scoring, and pattern warnings.
- No database. Prompts are not stored.
- 31 unit tests, plus an offline mock model so the whole pipeline can be tested without a key.
- A canvas-drawn spectral wave background and scroll-driven walkthrough, built without an animation library, with reduced-motion and mobile versions.

## Challenges we ran into

- Making scores trustworthy. We chose fixed rules over an AI judge so a score is a fact, not an opinion.
- Stopping a capable model from guessing the requirements. Each task depends on facts the model never sees.
- Speed. An X-ray needs one model call per part of the prompt, so we run them in parallel. [Add measured time from the report.]
- Honesty about randomness. AI answers vary, so the app says "no measurable decline on this task" and never "this phrase is useless."

## Accomplishments that we're proud of

- The X-ray moment: watching a phrase you were sure about turn grey.
- Every number on screen is either an objective check or labeled as a model-based observation.
- [Add user testing result with sample size, for example "N of M hackers improved their score on the second attempt."]

## What we learned

- [Add one finding from your own testing.]
- Clear constraints and specific facts moved scores more than tone or role-play wording in our tasks.
- Small scope finishes. One complete loop beat five half-built features.

## What's next

- Measuring pairs of instructions together, since removing one at a time misses overlaps.
- Running the same X-ray across several models to show where a phrase matters.
- More tasks across writing, data, and code.

## Prior work

Leave-one-out ablation is an established research method, and developer tools for prompt ablation and context attribution exist (for example ContextCite from MIT). We adapted ablation analysis into an interactive learning and debugging experience for everyday users. Other products also use the name PromptProof. We are not affiliated with them.

## Built with

nextjs, react, typescript, openai, vercel, vitest

## Links

- Live demo: [URL]
- Code: [GitHub URL]
- Video: [URL]

## Prize categories

- One [HACKUMASS] category: Most Impactful AI Hack.
- Sponsor prizes: none by default. The app no longer uses Gemini, so do not enter Best Use of Gemini API.
