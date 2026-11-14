import { scoreOutput } from "./checks";
import { detectFriction } from "./friction";
import { ghostSuggestions } from "./ghost";
import { generate, mapLimit, modelInfo } from "./model";
import { segmentPrompt, withoutChunk } from "./segment";
import type { AblationLabel, AblationResult, CheckResult, RunResult, Task, XrayResult } from "./types";

export const MAX_PROMPT_CHARS = 2000;

export function validatePrompt(prompt: unknown): string | null {
  if (typeof prompt !== "string" || prompt.trim().length === 0) return "Write a prompt first.";
  if (prompt.length > MAX_PROMPT_CHARS) return `Keep the prompt under ${MAX_PROMPT_CHARS} characters.`;
  return null;
}

/** One full run: model answer, objective score, chunks, friction findings, ghost suggestions. One model call. */
export async function runTask(task: Task, prompt: string): Promise<RunResult> {
  const started = Date.now();
  const reply = await generate(task, prompt);
  const { checks, score, total } = scoreOutput(task, reply.text);
  const chunks = segmentPrompt(prompt);
  return {
    taskId: task.id,
    prompt,
    output: reply.text,
    checks,
    score,
    total,
    chunks,
    friction: detectFriction(prompt, chunks),
    ghosts: ghostSuggestions(task, prompt, checks),
    model: reply.model,
    mock: reply.mock,
    ms: Date.now() - started,
  };
}

function average(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function labelAblation(baselineScores: number[], ablatedScores: number[]): AblationLabel {
  const baseline = average(baselineScores);
  const deltas = ablatedScores.map((s) => baseline - s);
  if (ablatedScores.length > 1) {
    const spread = Math.max(...baselineScores) - Math.min(...baselineScores);
    if (Math.abs(average(deltas)) <= spread && spread > 0) return "uncertain";
    const signs = new Set(deltas.map((d) => Math.sign(d)));
    if (signs.size > 1) return "uncertain";
  }
  const delta = average(deltas);
  if (delta > 0) return "helpful";
  if (delta < 0) return "possibly_harmful";
  return "no_measured_effect";
}

function flipped(baseline: CheckResult[], ablated: CheckResult[]): string[] {
  return baseline.filter((b) => ablated.find((a) => a.id === b.id)?.pass !== b.pass).map((b) => b.id);
}

/**
 * Prompt X-ray: remove one chunk at a time, rerun, and measure the change in checklist score.
 * Calls made: runs * (1 baseline + N chunks). Runs go out in parallel up to maxParallel.
 */
export async function xrayTask(
  task: Task,
  prompt: string,
  options: { runs?: number; maxParallel?: number } = {},
): Promise<XrayResult> {
  const started = Date.now();
  const envInt = (value: string | undefined, fallback: number) => {
    const n = Math.floor(Number(value));
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  const runs = Math.min(3, Math.max(1, options.runs ?? envInt(process.env.XRAY_RUNS, 1)));
  const maxParallel = Math.max(1, options.maxParallel ?? envInt(process.env.MAX_PARALLEL, 5));
  const chunks = segmentPrompt(prompt);

  // With a single chunk there is nothing to remove without deleting the whole prompt.
  const targets = chunks.length > 1 ? chunks : [];

  type Job = { chunkIndex: number | null; prompt: string };
  const jobs: Job[] = [];
  for (let r = 0; r < runs; r++) {
    jobs.push({ chunkIndex: null, prompt });
    for (const chunk of targets) jobs.push({ chunkIndex: chunk.index, prompt: withoutChunk(chunks, chunk.index) });
  }

  const outcomes = await mapLimit(jobs, maxParallel, async (job) => {
    const reply = await generate(task, job.prompt);
    return { job, ...scoreOutput(task, reply.text) };
  });

  const baselineRuns = outcomes.filter((o) => o.job.chunkIndex === null);
  const baselineScores = baselineRuns.map((o) => o.score);
  const baselineScore = average(baselineScores);

  const ablations: AblationResult[] = targets.map((chunk) => {
    const mine = outcomes.filter((o) => o.job.chunkIndex === chunk.index);
    const scores = mine.map((o) => o.score);
    return {
      chunkIndex: chunk.index,
      text: chunk.text,
      scores,
      delta: Number((baselineScore - average(scores)).toFixed(2)),
      label: labelAblation(baselineScores, scores),
      flippedChecks: flipped(baselineRuns[0].checks, mine[0].checks),
    };
  });

  const info = modelInfo();
  return {
    taskId: task.id,
    baselineScores,
    baselineScore: Number(baselineScore.toFixed(2)),
    total: task.checks.length,
    runsPerChunk: runs,
    ablations,
    modelCalls: jobs.length,
    ms: Date.now() - started,
    model: info.model,
    mock: info.mock,
  };
}
