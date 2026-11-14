# PromptProof

Debug your prompt before you trust the output.

Write a prompt, run it, and PromptProof scores the answer with fixed rules, then removes one part of your prompt at a time and reruns the task to show which parts changed the result.

Two ways to use it:

- **Practice scenarios:** three realistic tasks, each with a scenario card only you can see.
- **Your own prompt:** paste a prompt you actually use, add the text it works on, and state what a good answer must do as rule-based requirements (word limit, must include, must not mention, format). The model can suggest requirements from a one-line description. You review them, and scoring still uses only fixed rules.

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
| `npm test` | 31 unit tests for checks, segmentation, pattern warnings, ghost suggestions, X-ray, own-prompt mode |
| `npm run report` | One benchmark: model check, latency, weak against strong prompt, X-ray repeatability. Writes `promptproof-report.md` with no secrets. Stops with an error if no key is set. |
| `npm run report:mock` | Same report against the offline mock, only to see its shape |
| `npm run check` | Tests, then production build |

## Environment variables

| Name | Default | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | none | Server only. Never prefix with `NEXT_PUBLIC_`. |
| `OPENAI_MODEL` | `gpt-6-luna` | `npm run report` verifies it and suggests a working model if it fails. |
| `MAX_PARALLEL` | 5 | Concurrent model calls during an X-ray |
| `XRAY_RUNS` | 1 | Runs per removed part for `npm run report`. The app itself does one quick pass, then confirms with three. |
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
- `src/app/api/*`: `GET /api/tasks`, `POST /api/run`, `POST /api/xray`, `POST /api/suggest`.
- `src/components/*`: the interface. `WaveField` is the animated background, `XrayStory` the scroll walkthrough, `Workbench` the tool itself.

## Security and privacy

- The API key lives only in `.env.local` (git-ignored) or the host's environment settings. All model calls happen on the server.
- Prompts are sent to the model provider to produce answers. The app stores nothing: no database, no logs of prompt text.
- `/api/run` and `/api/xray` have a best-effort per-device rate limit. Set a spending cap on the key as well.
- Do not paste personal or sensitive information into prompts during testing.

## More

- `docs/DEPLOY.md`: deployment steps
- `docs/DEVPOST.md`: submission copy
- `docs/DEMO_SCRIPT.md`: demo script under three minutes
- To rename the product, edit `src/lib/brand.ts`.

## Honest limits

- A label such as "No measured effect" means removing that part caused no measurable decline on this task in this run. It does not mean the phrase is useless in general.
- Model output varies between runs. The app confirms each label with three runs and shows how many agreed.
- The score says whether the answer met the stated requirements. It does not say whether the answer is good.
- Parts are removed one at a time, so two overlapping instructions can each look unnecessary.
- Results are for the model named on screen. Other models may respond differently.
- If the live model fails, the app can show the last successful run saved in that browser, labeled as recorded.
- Leave-one-out ablation is an existing research method. This project adapts it into an interactive learning and debugging experience.
