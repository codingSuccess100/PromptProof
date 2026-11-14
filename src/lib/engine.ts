import { scoreOutput } from "./checks";
import { contextFor } from "./context";
import { diagnose } from "./diagnose";
import { detectFriction } from "./friction";
import { ghostSuggestions } from "./ghost";
import { generate, mapLimit, modelInfo } from "./model";
import { segmentPrompt, withoutChunk } from "./segment";
import type { AblationLabel, AblationResult, CheckChange, CheckResult, RunResult, Task, XrayResult } from "./types";

export const MAX_PROMPT_CHARS = 2000;

export function validatePrompt(prompt: unknown): string | null {
  if (typeof prompt !== "string" || prompt.trim().length === 0) return "Write a prompt first.";
  if (prompt.length > MAX_PROMPT_CHARS) return `Keep the prompt under ${MAX_PROMPT_CHARS} characters.`;
  return null;
}

/** One run: the answer, the checks, the context it was evaluated in, and a diagnosis of each failure. One model call. */
export async function runTask(task: Task, prompt: string): Promise<RunResult> {
  const started = Date.now();
  if (task.checks.length === 0) throw new Error("there are no requirements to evaluate against");
  const reply = await generate(task, prompt);
  const { checks, score, total } = scoreOutput(task, reply.text);
  const chunks = segmentPrompt(prompt);
  const friction = detectFriction(prompt, chunks);
  const context = contextFor(task);
  return {
    contextId: context.id,
    context,
    diagnoses: diagnose(task, prompt, reply.text, checks, friction),
    taskId: task.id,
    prompt,
    output: reply.text,
    checks,
    score,
    total,
    chunks,
    friction,
    ghosts: ghostSuggestions(task, prompt, checks),
    model: reply.model,
    mock: reply.mock,
    ms: Date.now() - started,
  };
}

const average = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);

/**
 * Labels one instruction from per-check pass counts, not from totals.
 * `runs` is how many baseline runs returned an answer, `valid` how many runs without the instruction did.
 */
export function labelFromChanges(changes: CheckChange[], runs: number, valid: number): AblationLabel {
  if (valid === 0) return "not_tested";
  if (changes.length === 0) return "no_measured_effect";
  // Compare pass rates, since the two sides can have different numbers of valid runs.
  const down = changes.filter((c) => c.ablatedPasses / valid < c.baselinePasses / runs);
  const up = changes.filter((c) => c.ablatedPasses / valid > c.baselinePasses / runs);
  if (down.length > 0 && up.length > 0) return "tradeoff";
  // "Consistent" means the check flipped in every run: always passed before, never after (or the reverse).
  const clean = (c: CheckChange) =>
    (c.baselinePasses === runs && c.ablatedPasses === 0) || (c.baselinePasses === 0 && c.ablatedPasses === valid);
  if (!changes.every(clean)) return "uncertain";
  return down.length > 0 ? "helpful" : "possibly_harmful";
}

/** Kept for callers that only have totals. Prefer labelFromChanges. */
export function labelAblation(baselineScores: number[], ablatedScores: number[]): AblationLabel {
  const baseline = average(baselineScores);
  const deltas = ablatedScores.map((s) => baseline - s);
  if (ablatedScores.length > 1) {
    const spread = Math.max(...baselineScores) - Math.min(...baselineScores);
    if (Math.abs(average(deltas)) <= spread && spread > 0) return "uncertain";
    if (new Set(deltas.map((d) => Math.sign(d))).size > 1) return "uncertain";
  }
  const delta = average(deltas);
  return delta > 0 ? "helpful" : delta < 0 ? "possibly_harmful" : "no_measured_effect";
}

function flipped(baseline: CheckResult[], ablated: CheckResult[]): string[] {
  return baseline.filter((b) => ablated.find((a) => a.id === b.id)?.pass !== b.pass).map((b) => b.id);
}

/**
 * Prompt X-ray: remove one instruction at a time, rerun, and compare each check's pass rate
 * with the unchanged prompt. The unchanged prompt is rerun the same number of times, so
 * ordinary run-to-run variation is visible instead of being mistaken for an effect.
 * Calls made: runs * (1 + N). A failed call is recorded as failed, never as a zero score.
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
  const maxParallel = Math.max(1, options.maxParallel ?? envInt(process.env.MAX_PARALLEL, 5));
  const chunks = segmentPrompt(prompt);
  // With a single instruction there is nothing to remove without deleting the whole prompt.
  const targets = chunks.length > 1 ? chunks : [];
  const runs = targets.length === 0 ? 1 : Math.min(3, Math.max(1, options.runs ?? envInt(process.env.XRAY_RUNS, 3)));

  type Job = { chunkIndex: number | null; prompt: string };
  const jobs: Job[] = [];
  for (let r = 0; r < runs; r++) {
    jobs.push({ chunkIndex: null, prompt });
    for (const chunk of targets) jobs.push({ chunkIndex: chunk.index, prompt: withoutChunk(chunks, chunk.index) });
  }

  const outcomes = await mapLimit(jobs, maxParallel, async (job) => {
    try {
      const reply = await generate(task, job.prompt);
      return { job, ok: true as const, ...scoreOutput(task, reply.text) };
    } catch (err) {
      return { job, ok: false as const, reason: err instanceof Error ? err.message : "failed" };
    }
  });

  const good = outcomes.filter((o) => o.ok);
  const failedCalls = outcomes.length - good.length;
  const baselineRuns = good.filter((o) => o.job.chunkIndex === null);
  if (baselineRuns.length === 0) {
    const first = outcomes.find((o) => !o.ok);
    throw new Error(first && !first.ok ? first.reason : "the unchanged prompt could not be run");
  }
  const baselineScores = baselineRuns.map((o) => o.score);
  const baselineScore = average(baselineScores);
  const passes = (list: typeof good, id: string) => list.filter((o) => o.checks.find((c) => c.id === id)?.pass).length;
  const baselineChecks = task.checks.map((c) => ({ id: c.id, label: c.label, passes: passes(baselineRuns, c.id) }));

  const ablations: AblationResult[] = targets.map((chunk) => {
    const mine = good.filter((o) => o.job.chunkIndex === chunk.index);
    const scores = mine.map((o) => o.score);
    const changes: CheckChange[] = task.checks
      .map((c) => ({
        checkId: c.id,
        label: c.label,
        baselinePasses: baselineChecks.find((b) => b.id === c.id)!.passes,
        ablatedPasses: passes(mine, c.id),
      }))
      .filter((c) => mine.length > 0 && c.ablatedPasses / mine.length !== c.baselinePasses / baselineRuns.length);
    return {
      chunkIndex: chunk.index,
      text: chunk.text,
      scores,
      delta: mine.length ? Number((baselineScore - average(scores)).toFixed(2)) : 0,
      label: labelFromChanges(changes, baselineRuns.length, mine.length),
      flippedChecks: mine.length ? flipped(baselineRuns[0].checks, mine[0].checks) : [],
      changes,
      validRuns: mine.length,
      failedRuns: runs - mine.length,
    };
  });

  let caution: string | null = null;
  if (baselineScore === 0) {
    caution =
      "The unchanged prompt met none of the requirements, so removing an instruction could not make a check fail. \"No change detected\" here says very little about whether an instruction is needed.";
  } else if (task.checks.length < 3) {
    caution = `Only ${task.checks.length} requirement${task.checks.length === 1 ? " is" : "s are"} being checked, so most of what an instruction does cannot be seen here.`;
  } else if (new Set(baselineScores).size > 1) {
    caution = "The unchanged prompt did not score the same on every run, so small differences below may be ordinary variation.";
  }

  const info = modelInfo();
  return {
    taskId: task.id,
    contextId: contextFor(task).id,
    baselineScores,
    baselineScore: Number(baselineScore.toFixed(2)),
    baselineValidRuns: baselineRuns.length,
    baselineChecks,
    failedCalls,
    caution,
    total: task.checks.length,
    runsPerChunk: runs,
    ablations,
    modelCalls: jobs.length,
    ms: Date.now() - started,
    model: info.model,
    mock: info.mock,
  };
}
