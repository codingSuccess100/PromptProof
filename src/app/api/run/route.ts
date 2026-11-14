import { NextResponse } from "next/server";
import { runTask, validatePrompt } from "@/lib/engine";
import { allowRequest } from "@/lib/ratelimit";
import { resolveTask } from "@/lib/custom";
import type { ApiError, RunResult } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse<RunResult | ApiError>> {
  if (!allowRequest(request, "run", 80)) {
    return NextResponse.json({ error: "Too many requests from this device. Wait a few minutes and try again." }, { status: 429 });
  }

  let body: { taskId?: unknown; prompt?: unknown; custom?: unknown; runs?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const resolved = resolveTask(body.taskId, body.custom);
  if ("error" in resolved) return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  const { task } = resolved;

  const problem = validatePrompt(body.prompt);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  try {
    return NextResponse.json(await runTask(task, body.prompt as string));
  } catch (err) {
    const reason = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: `The AI model did not answer (${reason}). Try again.` }, { status: 502 });
  }
}
