import type { CheckResult, GhostSuggestion, Task } from "./types";

// Ghost suggestions come straight from the task's own requirements.
// No model call: the task already knows what a failed check needs.

export function promptMentions(cue: string, prompt: string): boolean {
  return new RegExp(cue, "i").test(prompt);
}

export function ghostSuggestions(task: Task, prompt: string, checks: CheckResult[]): GhostSuggestion[] {
  const failed = new Set(checks.filter((c) => !c.pass).map((c) => c.id));
  return task.checks
    .filter((spec) => failed.has(spec.id))
    .map((spec) => ({
      checkId: spec.id,
      clause: spec.ghostClause,
      alreadyInPrompt: promptMentions(spec.promptCue, prompt),
    }));
}
