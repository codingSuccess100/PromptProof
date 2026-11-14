# PromptProof

Debug your prompt before you trust the output.

PromptProof turns a rough prompt into a tested one. You say what you want from the answer. It runs your prompt, points to what missed, proposes a specific change, and tests that change against your goal and the checks you chose.

The outcome it is built for: "I gave PromptProof a rough prompt and explained my goal. It identified an important problem, helped me make a specific revision, and showed what improved without exaggerating the evidence."

## Three layers, kept separate

| Layer | What it is | How it is shown |
| --- | --- | --- |
| User goal | What you are trying to get, in your own words. For practice tasks, the task defines it. | Stated at the top of the setup. Part of the evaluation context. |
| Rule-based checks | Things a fixed rule can verify: a word limit, exact text, a format. | "N of M checks passed", with evidence for each. Unscored if there are none. |
| Goal review | A model-assisted read of whether the answer serves the goal: wrong deliverable, changed recipient, checks that miss the point. | A separate box labeled model-assisted. Quotes are verified against the real prompt and answer. |

A perfect rule-based result never hides a goal-review concern, and the review never changes a rule-based result. Neither is a quality score.

## Pages

- `/` explains the product with one recorded example (real runs, labeled as recorded).
- `/workspace` is the tool: try a practice task, or use your own prompt and goal.
- `/method` explains what is measured, what is only suggested, and what happens to your text.

## The flow

1. Write a prompt. Describe the result you want. Optionally review a proposed evaluation: checks to accept, goals left to review, or a clarifying question if the goal is vague. Notes go in a collapsed section. A manual check editor is under "Advanced".
2. Run. The answer appears beside the rule-based checks and the goal review.
3. "What to fix" shows at most three findings first, each with what happened, the evidence, why it matters, an editable edit, and whether it has been tested.
4. Test the revision. The comparison shows prompt changes or answer changes at full width, check by check, only within the same evaluation context.
5. Optional: the X-ray (which instructions the results depend on) and Improve and test (a bounded helper).

## Run it

```
npm install
cp .env.example .env.local     # then paste your key into .env.local
npm run dev                    # http://localhost:3000
```

Without a key the app runs on a built-in offline mock model and says so in the header. The mock only proves the pipeline works. It is not evidence of how a real model behaves.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Local development server |
| `npm run build` | Production build (also type checks) |
| `npm test` | 84 tests on the offline mock: checks, contexts, comparisons, suggestions, goal review, diagnosis, the helper, X-ray, answer rendering |
| `npm run report` | The live validation: model check, latency, weak against strong prompt, X-ray repeatability, Suggest checks on six ordinary goals, and goal review on the vendor-message and calculus cases. Writes `promptproof-report.md` with no secrets. Stops with an error if no key is set. |
| `npm run report:mock` | Same report against the offline mock, only to see its shape |
| `npm run check` | Tests, then production build |

## Environment variables

| Name | Default | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | none | Server only. Never prefix with `NEXT_PUBLIC_`. |
| `OPENAI_MODEL` | `gpt-6-luna` | `npm run report` verifies it and suggests a working model if it fails. |
| `MAX_PARALLEL` | 5 | Concurrent model calls during an X-ray |
| `XRAY_RUNS` | 3 | Runs per removed instruction, 1 to 3. The unchanged prompt is rerun the same number of times. |
| `MOCK_DELAY_MS` | unset | Mock mode only. Adds a pause per call so loading states can be rehearsed without a key. |
| `OPENAI_REASONING_EFFORT` | `none` | Reasoning is off by default for speed and repeatable answers. |

## How it works

- `src/lib/tasks.ts`: the three tasks. Each has a situation card (never sent to the model), source material (sent with the prompt), and five checks.
- `src/lib/checks.ts`: rule-based scoring. No model judges the score.
- `src/lib/segment.ts`: splits a prompt into at most 8 parts.
- `src/lib/engine.ts`: `runTask` (one model call) and `xrayTask` (one baseline plus one call per part, in parallel).
- `src/lib/friction.ts`: wording rules that flag possible risks (persona, leading assumption, vague reference, conflict, loaded wording). These are warnings, not measurements.
- `src/lib/ghost.ts`: suggestions for missing details, taken from the failed checks. No model call.
- `src/lib/model.ts`: the only file that talks to the model provider.
- `src/lib/custom.ts`: turns a user's own requirements into the same rule-based checks. User text is escaped and matched literally.
- `src/lib/context.ts`: the evaluation context fingerprint. Task, reference material, requirements, scorer version, model, and settings. Results are compared only when it matches.
- `src/lib/compare.ts`: check-by-check comparison and prompt diff.
- `src/lib/diagnose.ts`: sorts each failed check into a likely situation using only the prompt, the answer, and the check.
- `src/lib/review.ts`: goal review. Model-assisted, with every quote verified against the source.
- `src/lib/suggest.ts`: turns an ordinary-language goal into proposed checks, goals left to review, or a clarifying question.
- `src/lib/improve.ts`: one guarded step of Improve and test.
- `src/app/api/*`: `GET /api/tasks`, `GET /api/health`, `POST /api/run`, `POST /api/xray`, `POST /api/suggest`, `POST /api/review`, `POST /api/improve`.
- `src/components/*`: the interface. `WaveField` is the animated background, `XrayStory` the scroll walkthrough, `Workbench` the tool itself.

## Model calls

| Action | Calls |
| --- | --- |
| Run a prompt | 1, plus 1 for the goal review |
| X-ray, on request | 3 x (instructions + 1), usually 15 to 27 |
| Suggest checks from a description | 1 |
| Improve and test | up to 11: three edits at up to 3 calls each (propose, test, review), then 2 confirmation runs |

These are counts from the code, not measured latency. `npm run report` measures latency against the live model.

## Security and privacy

- The API key lives only in `.env.local` (git-ignored) or the host's environment settings. All model calls happen on the server.
- Prompts and reference material are sent to the model provider. The provider's retention terms apply.
- The app has no database and its code does not log prompt text. The hosting provider's own request logs have not been audited.
- The browser stores the latest result in `localStorage` for replay. "Clear session" deletes it. A replay is labeled as recorded.
- User text in requirements is escaped and matched literally. Model answers are rendered without HTML injection.
- Text sent to the helper and the suggestion step is wrapped as data, and their JSON output is validated before use.
- Per-device rate limits on every model route. Set a spending cap on the key as well.

## More

- `docs/DEPLOY.md`: deployment steps
- `docs/DEVPOST.md`: submission copy
- `docs/DEMO_SCRIPT.md`: demo script under three minutes
- To rename the product, edit `src/lib/brand.ts`.

## Limits

- The goal review is one model reading another model's answer. It can be wrong, and repeating itself is not proof.
- "Checks passed" counts fixed rules passed. It is repeatable. It is not a measure of answer quality, and a rule can be the wrong rule.
- An exact-text check shows a phrase appears, not that an idea is explained correctly.
- The X-ray is phrase-level testing against the selected checks. Three runs are three observations.
- Instructions are removed one at a time, so overlapping instructions can each look unnecessary. Retest any combined rewrite.
- Results are for the model and settings shown. A failed request is reported as failed, never as a zero score.
- Leave-one-out ablation is an existing research method. This project adapts it into an interactive learning and debugging experience.
