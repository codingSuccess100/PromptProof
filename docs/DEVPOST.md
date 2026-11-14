# Devpost copy

Replace anything in [brackets] before submitting. Do not publish numbers you did not measure.

**Project name:** PromptProof

**Tagline:** Debug your prompt before you trust the output.

## Inspiration

We all write prompts every day, and none of us could say which words in them actually mattered. People copy phrases like "you are an expert" because they feel right, yet published research has found that expert personas do not reliably improve accuracy. We wanted a way to stop guessing and run the experiment.

## What it does

PromptProof gives you a realistic task and a situation card with facts only you can see. You write a prompt. Then it:

1. Runs your prompt and shows the AI answer.
2. Scores the answer against five fixed, rule-based requirements. No AI judges the score.
3. X-rays your prompt: it removes one part at a time, reruns the task, and shows which parts helped, which had no measured effect, and which may have hurt.
4. Shows the details you left out as faded suggestions you can click to add.
5. Lets you rerun and see your score before and after.

It also flags risky wording patterns such as personas, leading assumptions, and conflicting instructions. These are clearly labeled as warnings, separate from measured effects.

## How we built it

- Next.js, React, and TypeScript, deployed on Vercel.
- Gemini API, called only from the server.
- A rule-based engine: prompt segmentation, leave-one-out ablation with parallel model calls, deterministic scoring, and pattern warnings.
- No database. Prompts are not stored.
- 27 unit tests, plus an offline mock model so the whole pipeline can be tested without a key.

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

- Bring your own task: paste a real prompt and define your own checks.
- Three runs per part by default, with confidence shown.
- More tasks across writing, data, and code.

## Prior work

Leave-one-out ablation is an established research method, and developer tools for prompt ablation and context attribution exist (for example ContextCite from MIT). We adapted ablation analysis into an interactive learning and debugging experience for everyday users. Other products also use the name PromptProof. We are not affiliated with them.

## Built with

nextjs, react, typescript, gemini, vercel, vitest

## Links

- Live demo: [URL]
- Code: [GitHub URL]
- Video: [URL]

## Prize categories

- One [HACKUMASS] category: Most Impactful AI Hack.
- Sponsor prize: Best Use of Gemini API.
