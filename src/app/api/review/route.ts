import { NextResponse } from "next/server";
import { resolveTask } from "@/lib/custom";
import { validatePrompt } from "@/lib/engine";
import { allowRequest } from "@/lib/ratelimit";
import { reviewGoal } from "@/lib/review";
import type { ApiError, GoalReview } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Goal review: a model-assisted read of whether the answer serves the stated goal.
// It runs after the answer and checks are already on screen, and it never changes a check result.
export async function POST(request: Request): Promise<NextResponse<GoalReview | ApiError>> {
  if (!allowRequest(request, "review", 80)) {
    return NextResponse.json({ error: "Too many requests from this device. Wait a few minutes and try again." }, { status: 429 });
  }
  let body: { taskId?: unknown; prompt?: unknown; custom?: unknown; output?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const resolved = resolveTask(body.taskId, body.custom);
  if ("error" in resolved) return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  const problem = validatePrompt(body.prompt);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });
  if (typeof body.output !== "string" || body.output.trim().length === 0) {
    return NextResponse.json({ error: "There is no answer to review." }, { status: 400 });
  }
  try {
    return NextResponse.json(await reviewGoal(resolved.task, body.prompt as string, body.output.slice(0, 12000)));
  } catch (err) {
    const reason = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: `The goal review did not finish (${reason}). The rule-based checks above are unaffected.` }, { status: 502 });
  }
}
