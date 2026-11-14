import { createHash } from "node:crypto";
import { SCORER_VERSION, categoryOf } from "./checks";
import { configuredModel, modelInfo, modelSettings } from "./model";
import type { ContextSnapshot, Task } from "./types";

/**
 * The evaluation context: everything except the prompt that decides what a result means.
 * Change any of it (task, reference material, a requirement, the scorer, the model or its
 * settings) and the id changes, so results from the two contexts are never compared.
 */
export function contextFor(task: Task): ContextSnapshot {
  const info = modelInfo();
  const model = info.mock ? info.model : configuredModel();
  const settings = modelSettings(task.outputTokens);
  const fingerprint = JSON.stringify({
    taskId: task.id,
    material: task.sourceMaterial,
    goal: task.goal,
    checks: task.checks.map((c) => [c.id, c.kind, c.pattern ?? "", c.flags ?? "", c.value ?? "", c.label]),
    scorer: SCORER_VERSION,
    model,
    settings,
  });
  return {
    id: createHash("sha256").update(fingerprint).digest("hex").slice(0, 12),
    taskId: task.id,
    title: task.title,
    material: task.sourceMaterial,
    goal: task.goal,
    criteria: task.checks.map((c) => ({ id: c.id, label: c.label, category: categoryOf(c.kind, !!c.literals) })),
    scorerVersion: SCORER_VERSION,
    model,
    settings,
  };
}
