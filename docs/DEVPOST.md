# Devpost copy

Replace anything in [brackets] before submitting. Do not publish numbers you did not measure.

**Project name:** PromptProof

**Tagline:** Debug your prompt before you trust the output.

## Inspiration

We all write prompts every day, and none of us could say which words in them actually mattered. People copy phrases like "you are an expert" because they feel right, yet published research has found that expert personas do not reliably improve accuracy. We wanted a way to stop guessing and run the experiment.

## What it does

PromptProof turns a rough prompt into a tested one.

1. You write a prompt and say what you want from the answer, in ordinary words.
2. It proposes an evaluation for you to review: rule-based checks where a rule can verify something, at most two short questions that use what you already said (a date is asked for with a date field, and can be skipped), and everything else left to a goal review. Nothing is used until you accept it.
3. It runs the prompt and shows the answer beside two separate things: rule-based checks with their evidence, and a model-assisted goal review that flags problems a checklist cannot see, such as an answer written for the wrong reader.
4. It leads with a one-line diagnosis and one complete revised prompt you can edit, marked as untested. Amounts, dates, and identifiers from your original are kept, and a detail it cannot support becomes a visible placeholder. The evidence is one click away.
5. You test the revised prompt with one click. The comparison shows prompt changes and answer changes under the same goal and checks, including regressions.
6. Optionally, an X-ray removes one instruction at a time to show what the results depend on, and a bounded helper tries up to three revisions.

A perfect checklist score never hides a goal-review concern, and the review never changes a checklist result. Neither is presented as a quality score.

## How we built it

- Next.js, React, and TypeScript, deployed on Vercel.
- OpenAI API, called only from the server.
- A rule-based engine: prompt segmentation, leave-one-out ablation with parallel model calls, rule-based checks, an evaluation-context fingerprint, and failure diagnosis.
- No database. The app's own code does not store or log prompts. We did not audit the hosting provider's request logs, and prompts are sent to the model provider.
- 126 tests on an offline mock model and 53 browser checks, including regression tests for invalid comparisons, a prompt that passes every check while answering the wrong task, a check whose label did not match its rule, cut-off answers, and revisions that drop or invent details.
- A canvas-drawn spectral wave background on the landing page, built without an animation library, with a pause control and reduced-motion and mobile versions.

## Challenges we ran into

- Making comparisons valid. An early version compared runs with different requirements and reported a meaningless improvement. Every result now carries a fingerprint of its evaluation context.
- A perfect score that was wrong. A prompt asking for a vendor email passed all five checks on a task that wanted a CFO summary. That is why the goal review exists as its own layer.
- A check that did not mean what its label said. "Opens with the billing errors" passed an answer that named delivery first. Every label now states exactly what its rule tests, with counterexample tests.
- Cut-off answers. A long answer that hit the output limit was being judged as if the prompt had failed. Incomplete answers are now marked, not scored, and not compared.
- Being honest about what a rule proves. A fixed rule is repeatable, not complete. An exact-text check shows a phrase appears, not that it is explained correctly.
- Stopping a capable model from guessing the requirements. Each task depends on facts the model never sees.
- Speed. An X-ray needs one model call per part of the prompt, so we run them in parallel. [Add measured time from the report.]
- Honesty about randomness. AI answers vary, so the app says "no measurable decline on this task" and never "this phrase is useless."

## Accomplishments that we're proud of

- The wrong-task moment: five of five checks pass, and the app still tells you the answer is for the wrong reader.
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
