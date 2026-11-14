# PromptProof

Debug your prompt before you trust the output.

You get a realistic task and a situation card. You write a prompt. PromptProof runs it, scores the answer with fixed rules, then removes one part of your prompt at a time and reruns the task to show which parts changed the result.

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
| `npm test` | 27 unit tests for checks, segmentation, friction rules, ghost suggestions, X-ray |
| `npm run report` | One benchmark: model check, latency, weak against strong prompt, X-ray repeatability. Writes `promptproof-report.md` with no secrets. Stops with an error if no key is set. |
| `npm run report:mock` | Same report against the offline mock, only to see its shape |
| `npm run check` | Tests, then production build |

## Environment variables

| Name | Default | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | none | Server only. Never prefix with `NEXT_PUBLIC_`. |
| `OPENAI_MODEL` | `gpt-6-luna` | `npm run report` verifies it and suggests a working model if it fails. |
| `MAX_PARALLEL` | 5 | Concurrent model calls during an X-ray |
| `XRAY_RUNS` | 1 | Runs per removed part (1 to 3). More runs, more stable labels, more latency. |
| `OPENAI_REASONING_EFFORT` | `none` | Reasoning is off by default for speed and repeatable answers. |

## How it works

- `src/lib/tasks.ts`: the three tasks. Each has a situation card (never sent to the model), source material (sent with the prompt), and five checks.
- `src/lib/checks.ts`: rule-based scoring. No model judges the score.
- `src/lib/segment.ts`: splits a prompt into at most 8 parts.
- `src/lib/engine.ts`: `runTask` (one model call) and `xrayTask` (one baseline plus one call per part, in parallel).
- `src/lib/friction.ts`: wording rules that flag possible risks (persona, leading assumption, vague reference, conflict, loaded wording). These are warnings, not measurements.
- `src/lib/ghost.ts`: suggestions for missing details, taken from the failed checks. No model call.
- `src/lib/model.ts`: the only file that talks to the model provider.
- `src/app/api/*`: `GET /api/tasks`, `POST /api/run`, `POST /api/xray`.

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
- Model output varies between runs. With `XRAY_RUNS=1` a label is a single observation.
- Leave-one-out ablation is an existing research method. This project adapts it into an interactive learning and debugging experience.
